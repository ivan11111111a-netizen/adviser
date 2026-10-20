import * as vscode from 'vscode';
import type { Triggers } from '../core/projectConfig';
import type { Mode } from '../core/scheduler';
import type { Autopilot } from './autopilot';
import { clock, doNotDisturbUntil, setMode } from './mode';
import { CONFIG_PATH, type ProjectSettings } from './settings';
import type { UsageTracker } from './usage';

export const MENU_COMMAND = 'adviser.showMenu';

const MODE_TEXT: Record<Mode, { icon: string; title: string; detail: string }> = {
  mentor: {
    icon: '$(mortar-board)',
    title: 'Наставник',
    detail: 'Сам разбирает изменённые функции: при сохранении, уходе из функции и после паузы',
  },
  manual: {
    icon: '$(eye-closed)',
    title: 'Вручную',
    detail: 'Только по команде «Разобрать эту функцию»',
  },
};

/** Когда «Наставник» разбирает сам — по триггерам из настроек проекта. */
function mentorDetail(triggers: Triggers) {
  const when = [
    triggers.onSave ? 'при сохранении' : undefined,
    triggers.onLeaveFunction ? 'при уходе из функции' : undefined,
    triggers.pauseMs ? `после паузы ${triggers.pauseMs / 1000} с` : undefined,
  ].filter(Boolean);
  return when.length
    ? `Сам разбирает изменённые функции: ${when.join(', ')}`
    : 'Триггеры выключены в настройках проекта, разбирает только по команде';
}

/** Статус-бар (6.8 плана): режим, «разбираю…», число замечаний в файле, проблема; по клику — меню. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    'adviser.status',
    vscode.StatusBarAlignment.Right,
    100,
  );
  private readonly subscriptions: vscode.Disposable[];
  private busyCount = 0;
  private problem?: string;
  private dndTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly settings: ProjectSettings,
    private readonly usage: UsageTracker,
  ) {
    this.item.name = 'Adviser';
    this.item.command = MENU_COMMAND;
    this.subscriptions = [
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.languages.onDidChangeDiagnostics(() => this.refresh()),
      settings.onDidChange(() => this.refresh()),
      usage.onDidChange(() => this.refresh()),
    ];
    this.refresh();
    this.item.show();
  }

  async busy<T>(work: Promise<T>): Promise<T> {
    this.busyCount++;
    this.refresh();
    try {
      return await work;
    } finally {
      this.busyCount--;
      this.refresh();
    }
  }

  /** Нет сети, 429, провайдер не настроен: вместо всплывающих окон — значок и подсказка. */
  setProblem(problem: string | undefined) {
    this.problem = problem;
    this.refresh();
  }

  flash(text: string) {
    vscode.window.setStatusBarMessage(`Adviser: ${text}`, 6000);
  }

  refresh() {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const settings = this.settings.get(uri);
    const mode = MODE_TEXT[settings.mode];
    const problem = settings.configError
      ? `исправь ${CONFIG_PATH}: ${settings.configError}`
      : this.problem;
    const dnd = doNotDisturbUntil(this.context);
    clearTimeout(this.dndTimer);
    if (dnd) {
      this.dndTimer = setTimeout(() => this.refresh(), dnd - Date.now() + 500);
    }
    const count = uri
      ? vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'Adviser').length
      : 0;

    const icon = this.busyCount
      ? '$(sync~spin)'
      : problem
        ? '$(warning)'
        : dnd
          ? '$(bell-slash)'
          : mode.icon;
    this.item.text = `${icon} Adviser${count ? ` ${count}` : ''}`;
    this.item.tooltip = [
      this.busyCount ? 'Разбираю…' : undefined,
      problem ? `Проблема: ${problem}` : undefined,
      `Режим «${mode.title}». ${settings.mode === 'mentor' ? mentorDetail(settings.triggers) : mode.detail}.`,
      settings.fromProject.length
        ? `Из ${CONFIG_PATH}: ${settings.fromProject.join(', ')}.`
        : undefined,
      dnd ? `Не беспокоить до ${clock(dnd)}.` : undefined,
      count ? `Замечаний в этом файле: ${count}.` : undefined,
      ...this.usage.summary(),
      'Нажми, чтобы сменить режим.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  dispose() {
    clearTimeout(this.dndTimer);
    this.item.dispose();
    this.subscriptions.forEach((s) => s.dispose());
  }
}

type MenuItem = vscode.QuickPickItem & { run?: () => unknown };

/** Меню по клику на статус-бар: разбор, режимы, «Не беспокоить», журнал. */
export async function showMenu(
  context: vscode.ExtensionContext,
  autopilot: Autopilot,
  log: vscode.LogOutputChannel,
  settings: ProjectSettings,
) {
  const mode = settings.get(vscode.window.activeTextEditor?.document.uri).mode;
  const dnd = doNotDisturbUntil(context);
  const separator: MenuItem = { label: '', kind: vscode.QuickPickItemKind.Separator };
  const modes = (Object.keys(MODE_TEXT) as Mode[]).map((m): MenuItem => ({
    label: `${MODE_TEXT[m].icon} ${MODE_TEXT[m].title}`,
    description: m === mode ? 'сейчас' : undefined,
    detail: MODE_TEXT[m].detail,
    run: () => setMode(m),
  }));
  const quiet: MenuItem[] = dnd
    ? [
        {
          label: '$(bell) Снова беспокоить',
          description: `тишина до ${clock(dnd)}`,
          run: () => autopilot.doNotDisturb(undefined),
        },
      ]
    : [
        { label: '$(bell-slash) Не беспокоить 30 минут', run: () => autopilot.doNotDisturb(30) },
        { label: '$(bell-slash) Не беспокоить 1 час', run: () => autopilot.doNotDisturb(60) },
      ];
  const picked = await vscode.window.showQuickPick<MenuItem>(
    [
      {
        label: '$(play) Разобрать эту функцию',
        run: () => vscode.commands.executeCommand('adviser.reviewFunction'),
      },
      {
        label: '$(book) Журнал ошибок',
        run: () => vscode.commands.executeCommand('adviser.journal.focus'),
      },
      {
        label: '$(graph) Отчёт за неделю',
        run: () => vscode.commands.executeCommand('adviser.weeklyReport'),
      },
      separator,
      ...modes,
      separator,
      ...quiet,
      { label: '$(output) Лог', description: 'Output → Adviser', run: () => log.show() },
    ],
    { title: 'Adviser' },
  );
  await picked?.run?.();
}
