import * as vscode from 'vscode';
import { missingSupport } from '../core/languageSupport';
import type { Triggers } from '../core/projectConfig';
import type { Mode } from '../core/scheduler';
import type { Autopilot } from './autopilot';
import { clock, doNotDisturbUntil, setMode } from './mode';
import { CONFIG_PATH, type ProjectSettings } from './settings';
import type { UsageTracker } from './usage';

export const MENU_COMMAND = 'adviser.showMenu';

/** Названия и описания режимов. Функция, а не константа: перевод готов только после запуска. */
export function modeText(mode: Mode): { icon: string; title: string; detail: string } {
  switch (mode) {
    case 'mentor':
      return {
        icon: '$(mortar-board)',
        title: vscode.l10n.t('Mentor'),
        detail: vscode.l10n.t(
          'Reviews changed functions on its own: on save, when you leave a function and after a pause',
        ),
      };
    case 'reviewer':
      return {
        icon: '$(checklist)',
        title: vscode.l10n.t('Reviewer'),
        detail: vscode.l10n.t(
          'Reviews changed functions on its own on save and when you leave a function, at most 6 times an hour; explanation and solution right away, no hints',
        ),
      };
    case 'manual':
      return {
        icon: '$(eye-closed)',
        title: vscode.l10n.t('Manual'),
        detail: vscode.l10n.t('Only with the "Review This Function" command'),
      };
  }
}

const MODES: Mode[] = ['mentor', 'reviewer', 'manual'];

/** Когда «Наставник» разбирает сам — по триггерам из настроек проекта. */
function mentorDetail(triggers: Triggers) {
  const when = [
    triggers.onSave ? vscode.l10n.t('on save') : undefined,
    triggers.onLeaveFunction ? vscode.l10n.t('when you leave a function') : undefined,
    triggers.pauseMs ? vscode.l10n.t('after a {0} s pause', triggers.pauseMs / 1000) : undefined,
  ].filter(Boolean);
  return when.length
    ? vscode.l10n.t('Reviews changed functions on its own: {0}', when.join(', '))
    : vscode.l10n.t('Triggers are off in the project settings; reviews only on command');
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
      vscode.extensions.onDidChange(() => this.refresh()),
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
    const mode = modeText(settings.mode);
    const support = activeSupport();
    const problem = settings.configError
      ? vscode.l10n.t('fix {0}: {1}', CONFIG_PATH, settings.configError)
      : (this.problem ??
        (support
          ? vscode.l10n.t(
              '{0} needs the {1} extension: without it Adviser does not see functions',
              support.language,
              support.id,
            )
          : undefined));
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
      this.busyCount ? vscode.l10n.t('Reviewing…') : undefined,
      problem ? vscode.l10n.t('Problem: {0}', problem) : undefined,
      vscode.l10n.t(
        'Mode "{0}". {1}.',
        mode.title,
        settings.mode === 'mentor' ? mentorDetail(settings.triggers) : mode.detail,
      ),
      settings.fromProject.length
        ? vscode.l10n.t('From {0}: {1}.', CONFIG_PATH, settings.fromProject.join(', '))
        : undefined,
      dnd ? vscode.l10n.t('Do not disturb until {0}.', clock(dnd)) : undefined,
      count ? vscode.l10n.t('Issues in this file: {0}.', count) : undefined,
      ...this.usage.summary(),
      vscode.l10n.t('Click to change the mode.'),
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

/** Чего не хватает языку активного файла (languageSupport). */
function activeSupport() {
  const languageId = vscode.window.activeTextEditor?.document.languageId;
  return languageId
    ? missingSupport(languageId, (id) => vscode.extensions.getExtension(id) !== undefined)
    : undefined;
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
  const support = activeSupport();
  const install: MenuItem[] = support
    ? [
        {
          label: `$(extensions) ${vscode.l10n.t('Install the extension for {0}', support.language)}`,
          description: support.id,
          run: () => vscode.commands.executeCommand('workbench.extensions.search', support.id),
        },
      ]
    : [];
  const separator: MenuItem = { label: '', kind: vscode.QuickPickItemKind.Separator };
  const modes = MODES.map((m): MenuItem => {
    const text = modeText(m);
    return {
      label: `${text.icon} ${text.title}`,
      description: m === mode ? vscode.l10n.t('current') : undefined,
      detail: text.detail,
      run: () => setMode(m),
    };
  });
  const quiet: MenuItem[] = dnd
    ? [
        {
          label: `$(bell) ${vscode.l10n.t('Disturb again')}`,
          description: vscode.l10n.t('quiet until {0}', clock(dnd)),
          run: () => autopilot.doNotDisturb(undefined),
        },
      ]
    : [
        {
          label: `$(bell-slash) ${vscode.l10n.t('Do not disturb for 30 minutes')}`,
          run: () => autopilot.doNotDisturb(30),
        },
        {
          label: `$(bell-slash) ${vscode.l10n.t('Do not disturb for 1 hour')}`,
          run: () => autopilot.doNotDisturb(60),
        },
      ];
  const command = (icon: string, label: string, id: string): MenuItem => ({
    label: `${icon} ${label}`,
    run: () => vscode.commands.executeCommand(id),
  });
  const picked = await vscode.window.showQuickPick<MenuItem>(
    [
      ...install,
      command('$(play)', vscode.l10n.t('Review This Function'), 'adviser.reviewFunction'),
      command('$(book)', vscode.l10n.t('Mistake journal'), 'adviser.journal.focus'),
      command('$(graph)', vscode.l10n.t('Weekly Report'), 'adviser.weeklyReport'),
      command('$(mortar-board)', vscode.l10n.t('Practice a Frequent Mistake'), 'adviser.exercise'),
      command(
        '$(git-compare)',
        vscode.l10n.t('Do I Understand the Changes'),
        'adviser.understandChanges',
      ),
      separator,
      ...modes,
      separator,
      ...quiet,
      {
        label: `$(output) ${vscode.l10n.t('Log')}`,
        description: 'Output → Adviser',
        run: () => log.show(),
      },
      {
        label: `$(rocket) ${vscode.l10n.t('Get Started')}`,
        description: vscode.l10n.t('model, level, trial review'),
        run: () => vscode.commands.executeCommand('adviser.openWalkthrough'),
      },
    ],
    { title: 'Adviser' },
  );
  await picked?.run?.();
}
