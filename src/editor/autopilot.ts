import * as vscode from 'vscode';
import { DocumentChanges, shiftRange, type FunctionCode } from '../core/changes';
import { functionsOf, type LineRange } from '../core/codeRange';
import { documentSkipReason, pickReady, retryDelay, type SkipReason } from '../core/scheduler';
import { lineEdits } from './edits';
import type { Findings } from './findings';
import { clock, doNotDisturbUntil, setDoNotDisturb } from './mode';
import { showReview, type Outcome, type Reviewer } from './reviewer';
import type { ProjectSettings } from './settings';
import type { StatusBar } from './statusBar';
import { documentSymbols } from './symbols';

type Trigger = 'сохранение' | 'уход из функции' | 'пауза' | 'повтор';

const SKIP_TEXT: Record<SkipReason, string> = {
  errors: 'в ней ошибки компилятора, человек ещё печатает',
  cooldown: 'её недавно разбирали',
  limit: 'исчерпан лимит разборов',
};

/** Курсор стоит: проверяем, не ушёл ли он из функции. */
const CURSOR_SETTLE_MS = 500;
/** Языковой сервер ещё не готов отдать символы: пробуем запомнить функции файла ещё раз. */
const BASELINE_RETRY_MS = 3000;
/** Через сколько после правки чистого документа проверить, не перечитан ли он с диска. */
const RELOAD_CHECK_MS = 300;

interface DocState {
  changes: DocumentChanges;
  pauseTimer?: ReturnType<typeof setTimeout>;
  /** Функция под курсором при прошлой проверке: уход из неё — триггер. */
  cursorKey?: string;
  functions?: { version: number; list: FunctionCode[] };
}

interface Job {
  doc: vscode.TextDocument;
  why: Trigger;
  key: string;
  code: string;
  /** Где функция сейчас; undefined — её правили, пока она ждала или разбиралась. */
  range?: LineRange;
  abort?: AbortController;
}

/**
 * Автопилот (6.1–6.2 плана): копит правки, находит изменённые функции и разбирает их при
 * сохранении, уходе из функции и паузе в наборе. Разборы идут по одному; если функцию правят,
 * пока она ждёт или разбирается, разбор отменяется.
 */
export class Autopilot implements vscode.Disposable {
  private readonly docs = new Map<string, DocState>();
  private readonly subscriptions: vscode.Disposable[];
  /** Время запросов к модели за последние сутки — для лимитов. */
  private sent: number[] = [];
  private queue: Job[] = [];
  private running?: Job;
  private failures = 0;
  private retryAt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private cursorTimer?: ReturnType<typeof setTimeout>;
  private activeDoc?: vscode.TextDocument;
  /** Сохранения, которые человек сделал сам. Автосохранение по таймеру — не повод для разбора. */
  private readonly manualSaves = new Set<string>();
  private readonly savedAt = new Map<string, number>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly reviewer: Reviewer,
    private readonly findings: Findings,
    private readonly status: StatusBar,
    private readonly log: vscode.LogOutputChannel,
    private readonly settings: ProjectSettings,
  ) {
    this.subscriptions = [
      vscode.workspace.onDidChangeTextDocument((e) => this.edited(e)),
      vscode.workspace.onWillSaveTextDocument((e) => {
        if (e.reason === vscode.TextDocumentSaveReason.Manual) {
          this.manualSaves.add(e.document.uri.toString());
        }
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        this.savedAt.set(doc.uri.toString(), Date.now());
        if (
          this.manualSaves.delete(doc.uri.toString()) &&
          this.settings.get(doc.uri).triggers.onSave
        ) {
          void this.trigger(doc, 'сохранение');
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        clearTimeout(this.cursorTimer);
        this.cursorTimer = setTimeout(() => void this.cursorMoved(e.textEditor), CURSOR_SETTLE_MS);
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.switched(editor)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.closed(doc)),
      // Режим сменили в настройках или в .adviser/config.json — «Вручную» останавливает разборы.
      settings.onDidChange(() => {
        if (this.running && this.settings.get(this.running.doc.uri).mode === 'manual') {
          this.stop();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (['provider', 'baseUrl', 'model'].some((s) => e.affectsConfiguration(`adviser.${s}`))) {
          // Человек поправил настройки — пробуем сразу, без паузы после ошибки.
          this.failures = 0;
          this.retryAt = 0;
          this.status.setProblem(undefined);
        }
      }),
    ];
    this.switched(vscode.window.activeTextEditor);
  }

  /** Разбор командой: функция с этим кодом уже разобрана, автопилоту её брать не надо. */
  reviewedByCommand(doc: vscode.TextDocument, code: string) {
    this.docs.get(doc.uri.toString())?.changes.reviewed(code, Date.now());
  }

  async doNotDisturb(minutes: number | undefined) {
    await setDoNotDisturb(this.context, minutes);
    if (minutes) {
      this.stop();
    }
    this.status.refresh();
  }

  dispose() {
    this.stop();
    clearTimeout(this.retryTimer);
    clearTimeout(this.cursorTimer);
    this.docs.forEach((state) => clearTimeout(state.pauseTimer));
    this.subscriptions.forEach((s) => s.dispose());
  }

  /** Почему автопилот сейчас молчит; undefined — работает. */
  private blocked(doc: vscode.TextDocument): string | undefined {
    if (this.settings.get(doc.uri).mode === 'manual') {
      return 'режим «Вручную»';
    }
    if (doNotDisturbUntil(this.context)) {
      return '«Не беспокоить»';
    }
    if (Date.now() < this.retryAt) {
      return `пауза после ошибки до ${clock(this.retryAt)}`;
    }
    return undefined;
  }

  /** Отменяет текущий разбор и очередь. Изменённые функции остаются изменёнными. */
  private stop() {
    this.running?.abort?.abort();
    this.queue = [];
  }

  private eligible(doc: vscode.TextDocument) {
    if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') {
      return false;
    }
    const head = Array.from({ length: Math.min(20, doc.lineCount) }, (_, i) => doc.lineAt(i).text);
    return !documentSkipReason({
      path: doc.uri.fsPath,
      languageId: doc.languageId,
      lineCount: doc.lineCount,
      head,
    });
  }

  private state(doc: vscode.TextDocument): DocState {
    const uri = doc.uri.toString();
    let state = this.docs.get(uri);
    if (!state) {
      state = { changes: new DocumentChanges(doc.languageId) };
      this.docs.set(uri, state);
    }
    return state;
  }

  private edited(e: vscode.TextDocumentChangeEvent) {
    const doc = e.document;
    if (!e.contentChanges.length) {
      return;
    }
    const edits = lineEdits(e);
    for (const job of [this.running, ...this.queue]) {
      if (job?.doc === doc && job.range) {
        job.range = shiftRange(job.range, edits);
        if (!job.range) {
          job.abort?.abort();
        }
      }
    }
    this.queue = this.queue.filter((job) => job.range);

    if (e.reason === undefined && !doc.isDirty) {
      // Изменился чистый документ: это первая правка человека или файл перечитан с диска
      // (git checkout и т. п.). isDirty в событии ещё старый, поэтому смотрим чуть позже:
      // после перечитывания документ так и останется чистым, хотя его никто не сохранял.
      const editedAt = Date.now();
      setTimeout(() => {
        const savedAt = this.savedAt.get(doc.uri.toString()) ?? 0;
        if (!doc.isDirty && !doc.isClosed && savedAt < editedAt) {
          this.reloaded(doc);
        }
      }, RELOAD_CHECK_MS);
    }
    if (!this.eligible(doc)) {
      return;
    }
    const state = this.state(doc);
    state.changes.edit(edits);
    clearTimeout(state.pauseTimer);
    const { pauseMs } = this.settings.get(doc.uri).triggers;
    if (pauseMs > 0) {
      state.pauseTimer = setTimeout(() => void this.trigger(doc, 'пауза'), pauseMs);
    }
  }

  private async cursorMoved(editor: vscode.TextEditor) {
    const doc = editor.document;
    const state = this.docs.get(doc.uri.toString());
    if (!state?.changes.hasTouched) {
      if (state) {
        state.cursorKey = undefined;
      }
      return;
    }
    const functions = await this.functions(doc, state);
    if (!functions) {
      return;
    }
    const line = editor.selection.active.line;
    const here = functions.find((f) => line >= f.start && line <= f.end)?.key;
    const left = state.cursorKey;
    state.cursorKey = here;
    if (left && left !== here) {
      void this.trigger(doc, 'уход из функции', left);
    }
  }

  private switched(editor: vscode.TextEditor | undefined) {
    const previous = this.activeDoc;
    this.activeDoc = editor?.document;
    const left = previous && this.docs.get(previous.uri.toString());
    if (previous !== editor?.document && left?.cursorKey) {
      const key = left.cursorKey;
      left.cursorKey = undefined;
      void this.trigger(previous!, 'уход из функции', key);
    }
    if (
      editor &&
      !this.docs.has(editor.document.uri.toString()) &&
      this.eligible(editor.document)
    ) {
      void this.baseline(editor.document, true);
    }
  }

  /** Запоминает функции файла как есть: разбираться будут только те, что человек изменит. */
  private async baseline(doc: vscode.TextDocument, retry: boolean) {
    const state = this.state(doc);
    const functions = await this.functions(doc, state);
    if (functions?.length) {
      state.changes.changed(functions);
    } else if (retry) {
      setTimeout(() => {
        if (!doc.isClosed) {
          void this.baseline(doc, false);
        }
      }, BASELINE_RETRY_MS);
    }
  }

  /** Файл перечитан с диска: это не правки человека, запоминаем функции заново. */
  private reloaded(doc: vscode.TextDocument) {
    this.closed(doc);
    if (this.eligible(doc)) {
      void this.baseline(doc, false);
    }
  }

  private closed(doc: vscode.TextDocument) {
    const uri = doc.uri.toString();
    clearTimeout(this.docs.get(uri)?.pauseTimer);
    this.docs.delete(uri);
    this.manualSaves.delete(uri);
    this.savedAt.delete(uri);
    this.queue = this.queue.filter((job) => job.doc !== doc);
    if (this.running?.doc === doc) {
      this.running.abort?.abort();
    }
  }

  /** Функции документа с кодом. undefined — документ изменился, пока языковой сервер отвечал. */
  private async functions(
    doc: vscode.TextDocument,
    state: DocState,
  ): Promise<FunctionCode[] | undefined> {
    const version = doc.version;
    if (state.functions?.version === version) {
      return state.functions.list;
    }
    const symbols = await documentSymbols(doc.uri);
    if (doc.version !== version || doc.isClosed) {
      return undefined;
    }
    const list = functionsOf(symbols)
      .filter((f) => f.end < doc.lineCount)
      .map((f) => ({
        ...f,
        code: doc.getText(new vscode.Range(f.start, 0, f.end, doc.lineAt(f.end).text.length)),
      }));
    state.functions = { version, list };
    return list;
  }

  private async trigger(doc: vscode.TextDocument, why: Trigger, only?: string) {
    const state = this.docs.get(doc.uri.toString());
    if (!state?.changes.hasTouched || doc.isClosed) {
      return;
    }
    const settings = this.settings.get(doc.uri);
    if (why === 'уход из функции' && !settings.triggers.onLeaveFunction) {
      return;
    }
    const blocked = this.blocked(doc);
    if (blocked) {
      this.log.debug(`${why}: автопилот молчит — ${blocked}`);
      return;
    }
    const functions = await this.functions(doc, state);
    if (!functions) {
      return;
    }
    const pending = [this.running, ...this.queue].filter((job) => job !== undefined);
    const changed = state.changes
      .changed(functions)
      .filter(
        (f) =>
          (!only || f.key === only) && !pending.some((job) => job.doc === doc && job.key === f.key),
      );
    if (!changed.length) {
      return;
    }

    const errors = vscode.languages
      .getDiagnostics(doc.uri)
      .filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
    const now = Date.now();
    this.sent = this.sent.filter((t) => now - t < 24 * 3_600_000);
    const { ready, skipped } = pickReady(
      changed.map((f) => ({
        key: f.key,
        hasErrors: errors.some((d) => d.range.start.line <= f.end && d.range.end.line >= f.start),
        reviewedAt: f.reviewedAt,
      })),
      // Ждущие в очереди тоже считаем: они вот-вот уйдут к модели.
      [...this.sent, ...pending.map(() => now)],
      now,
      settings.limits,
    );
    for (const { key, reason } of skipped) {
      this.log.debug(`${why}: ${key} подождёт — ${SKIP_TEXT[reason]}`);
    }
    for (const key of ready) {
      const fn = changed.find((f) => f.key === key)!;
      this.queue.push({ doc, why, key, code: fn.code, range: { start: fn.start, end: fn.end } });
    }
    if (ready.length) {
      this.log.debug(`${why}: в очереди ${ready.join(', ')}`);
      void this.pump();
    }
  }

  private async pump(): Promise<void> {
    if (this.running) {
      return;
    }
    const job = this.queue.shift();
    if (!job) {
      return;
    }
    if (!job.range || job.doc.isClosed || this.blocked(job.doc)) {
      return this.pump();
    }
    job.abort = new AbortController();
    this.running = job;
    let outcome: Outcome;
    try {
      outcome = await this.status.busy(
        this.reviewer.review(job.doc, job.range, `автопилот, ${job.why}`, job.abort.signal),
      );
    } finally {
      this.running = undefined;
    }
    this.finish(job, outcome);
    return this.pump();
  }

  private finish(job: Job, outcome: Outcome) {
    const now = Date.now();
    const changes = this.docs.get(job.doc.uri.toString())?.changes;
    switch (outcome.kind) {
      case 'reviewed':
        if (!outcome.cached) {
          this.sent.push(now);
        }
        this.failures = 0;
        this.status.setProblem(undefined);
        changes?.reviewed(job.code, now, job.key);
        if (job.range && !job.doc.isClosed) {
          showReview(this.findings, job.doc, job.range, outcome.review.issues);
        }
        return;
      case 'failed': {
        this.sent.push(now);
        if (outcome.invalid) {
          // Тот же код модель снова не разберёт: ждём, пока его изменят.
          changes?.reviewed(job.code, now, job.key);
          return;
        }
        const delay = retryDelay(++this.failures);
        this.retryAt = now + delay;
        this.queue = [];
        this.status.setProblem(`не получилось разобрать, повторю в ${clock(this.retryAt)}`);
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          const doc = vscode.window.activeTextEditor?.document;
          if (doc) {
            void this.trigger(doc, 'повтор');
          }
        }, delay);
        return;
      }
      case 'refused':
        this.queue = [];
        this.status.setProblem(outcome.message);
        this.log.debug(`автопилот: ${outcome.message}`);
        return;
      case 'aborted':
        return;
    }
  }
}
