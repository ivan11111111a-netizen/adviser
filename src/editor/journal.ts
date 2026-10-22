import os from 'node:os';
import * as vscode from 'vscode';
import {
  combineJournals,
  journalFileSchema,
  journalSummary,
  type JournalEntry,
  type JournalFile,
} from '../core/journal';

const SAVE_DELAY_MS = 1000;

/**
 * Журнал ошибок (6.6 плана): JSON-файл в globalStorageUri, никуда не отправляется.
 * Пишется с задержкой, а перед записью сливается с файлом: его могут писать другие окна.
 */
export class Journal implements vscode.Disposable {
  private saveTimer?: ReturnType<typeof setTimeout>;
  private saving: Promise<void> = Promise.resolve();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  private readonly file: vscode.Uri;
  /** Когда журнал очищали в этом окне: старые случаи из файла не возвращаются. */
  private clearedAt?: number;

  private constructor(
    private readonly dir: vscode.Uri,
    private readonly log: vscode.LogOutputChannel,
    private entries: JournalEntry[],
  ) {
    this.file = journalFile(dir);
  }

  static async open(context: vscode.ExtensionContext, log: vscode.LogOutputChannel) {
    const dir = context.globalStorageUri;
    let entries: JournalEntry[] = [];
    try {
      // Срок хранения и очистка применяются сразу: в памяти — то же, что попадёт в файл.
      entries = combineJournals(
        await readJournal(journalFile(dir), log),
        [],
        undefined,
        Date.now(),
      ).entries;
    } catch (e) {
      // Записать такой журнал тоже не выйдет: flush сначала читает файл и при ошибке не пишет.
      log.warn(`журнал не прочитан, работаю без истории: ${String(e)}`);
    }
    return new Journal(dir, log, entries);
  }

  all(): readonly JournalEntry[] {
    return this.entries;
  }

  get(id: string): JournalEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  record(entry: JournalEntry) {
    this.entries.push(entry);
    this.changed();
  }

  update(id: string, patch: Partial<Pick<JournalEntry, 'step' | 'resolvedAt' | 'feedback'>>) {
    const entry = this.get(id);
    if (entry) {
      Object.assign(entry, patch);
      this.changed();
    }
  }

  /** Стирает всё: в файле остаётся отметка, чтобы другие окна не вернули старые случаи. */
  async clear() {
    this.clearedAt = Date.now();
    this.entries = [];
    this.emitter.fire();
    await this.flush();
  }

  /** Полный журнал или обезличенная сводка — для себя, преподавателя или пилота. */
  exportText(kind: 'full' | 'summary'): string {
    const data =
      kind === 'full'
        ? { version: 1, entries: this.entries }
        : { exported: new Date().toISOString().slice(0, 10), ...journalSummary(this.entries) };
    return `${JSON.stringify(data, null, 2)}\n`;
  }

  /** Записывает журнал, слив его с тем, что успели записать другие окна. */
  flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saving = this.saving
      .then(async () => {
        const merged = combineJournals(
          await readJournal(this.file, this.log),
          this.entries,
          this.clearedAt,
          Date.now(),
        );
        this.entries = merged.entries;
        await vscode.workspace.fs.createDirectory(this.dir);
        await vscode.workspace.fs.writeFile(
          this.file,
          new TextEncoder().encode(JSON.stringify(merged)),
        );
      })
      .catch((e) => this.log.warn(`журнал не записан: ${String(e)}`));
    return this.saving;
  }

  dispose() {
    this.emitter.dispose();
  }

  private changed() {
    this.emitter.fire();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }
}

const journalFile = (dir: vscode.Uri) => vscode.Uri.joinPath(dir, 'journal.json');

const EMPTY: JournalFile = { version: 1, entries: [] };

/** Нет файла — пустой журнал. Испорченный файл не затираем, а откладываем рядом. */
async function readJournal(file: vscode.Uri, log: vscode.LogOutputChannel): Promise<JournalFile> {
  let text: string;
  try {
    text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
  } catch (e) {
    if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
      return EMPTY;
    }
    throw e;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  const parsed = journalFileSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  const broken = file.with({ path: file.path.replace(/\.json$/, `.broken-${Date.now()}.json`) });
  await vscode.workspace.fs.rename(file, broken, { overwrite: true });
  log.warn(`журнал испорчен и отложен в ${broken.fsPath}, начат новый`);
  return EMPTY;
}

/** Команда «Экспорт журнала»: что выгрузить и куда. */
export async function exportJournal(journal: Journal) {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: 'Обезличенная сводка',
        detail:
          'Только типы ошибок и числа: без файлов, кода и текстов. Для преподавателя или пилота.',
        exportKind: 'summary' as const,
      },
      {
        label: 'Полный журнал',
        detail:
          'Все случаи: файлы, строки, тексты намёков. Для себя или переноса на другой компьютер.',
        exportKind: 'full' as const,
      },
    ],
    { title: 'Adviser: экспорт журнала' },
  );
  if (!picked) {
    return;
  }
  const target = await vscode.window.showSaveDialog({
    filters: { JSON: ['json'] },
    defaultUri: vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(os.homedir()),
      `adviser-${picked.exportKind === 'summary' ? 'summary' : 'journal'}-${new Date().toISOString().slice(0, 10)}.json`,
    ),
  });
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(
    target,
    new TextEncoder().encode(journal.exportText(picked.exportKind)),
  );
  vscode.window.setStatusBarMessage(`Adviser: журнал сохранён в ${target.fsPath}`, 6000);
}

/** Команда «Очистить журнал» — с подтверждением: это не отменить. */
export async function clearJournal(journal: Journal) {
  const clear = 'Очистить';
  const answer = await vscode.window.showWarningMessage(
    `Удалить все случаи из журнала (${journal.all().length})? Это нельзя отменить.`,
    { modal: true, detail: 'Перед этим можно сохранить журнал: «Adviser: Экспорт журнала».' },
    clear,
  );
  if (answer === clear) {
    await journal.clear();
    vscode.window.setStatusBarMessage('Adviser: журнал очищен', 6000);
  }
}
