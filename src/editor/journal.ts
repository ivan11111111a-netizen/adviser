import * as vscode from 'vscode';
import { journalFileSchema, mergeJournals, type JournalEntry } from '../core/journal';

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
      entries = await readJournal(journalFile(dir), log);
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

  /** Записывает журнал, слив его с тем, что успели записать другие окна. */
  flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saving = this.saving
      .then(async () => {
        this.entries = mergeJournals(await readJournal(this.file, this.log), this.entries);
        await vscode.workspace.fs.createDirectory(this.dir);
        await vscode.workspace.fs.writeFile(
          this.file,
          new TextEncoder().encode(JSON.stringify({ version: 1, entries: this.entries })),
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

/** Нет файла — пустой журнал. Испорченный файл не затираем, а откладываем рядом. */
async function readJournal(
  file: vscode.Uri,
  log: vscode.LogOutputChannel,
): Promise<JournalEntry[]> {
  let text: string;
  try {
    text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
  } catch (e) {
    if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
      return [];
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
    return parsed.data.entries;
  }
  const broken = file.with({ path: file.path.replace(/\.json$/, `.broken-${Date.now()}.json`) });
  await vscode.workspace.fs.rename(file, broken, { overwrite: true });
  log.warn(`журнал испорчен и отложен в ${broken.fsPath}, начат новый`);
  return [];
}
