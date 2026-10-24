import * as vscode from 'vscode';
import { gitignoreToGlobs, IGNORE_FILE } from '../core/ignoreFile';
import {
  mergeSettings,
  parseProjectConfig,
  type ProjectConfig,
  type Settings,
} from '../core/projectConfig';
import { currentLevel, currentMode } from './mode';

export const CONFIG_PATH = '.adviser/config.json';

export const NOTEBOOK_CELL_SCHEME = 'vscode-notebook-cell';

/** Где Adviser разбирает код: файлы, безымянные файлы и ячейки ноутбуков (Jupyter). */
export const REVIEWED_SCHEMES = ['file', 'untitled', NOTEBOOK_CELL_SCHEME] as const;

/**
 * Чей это документ на диске. У ячейки ноутбука свой адрес (vscode-notebook-cell:), а папка
 * проекта, настройки и ignore — у самого ноутбука. Путь (fsPath) у ячейки тот же, что у ноутбука.
 */
export function ownerUri(uri: vscode.Uri): vscode.Uri {
  if (uri.scheme !== NOTEBOOK_CELL_SCHEME) {
    return uri;
  }
  return notebookOf(uri)?.uri ?? uri.with({ scheme: 'file', fragment: '' });
}

/** Есть несохранённые правки. У ячейки isDirty всегда false: несохранённым бывает ноутбук. */
export function isDirty(doc: vscode.TextDocument): boolean {
  return doc.uri.scheme === NOTEBOOK_CELL_SCHEME
    ? (notebookOf(doc.uri)?.isDirty ?? false)
    : doc.isDirty;
}

const notebookOf = (cell: vscode.Uri) =>
  vscode.workspace.notebookDocuments.find((nb) =>
    nb.getCells().some((c) => c.document.uri.toString() === cell.toString()),
  );

/** Действующие настройки файла. configError — файлы проекта не разобраны, разборы стоят. */
export type FileSettings = Settings & { configError?: string };

interface Loaded {
  config?: ProjectConfig;
  error?: string;
  /** Шаблоны из .adviserignore, добавляются к ignore из config.json. */
  ignore: string[];
}

/**
 * Настройки в три слоя (6.7 плана): умолчания → VS Code → .adviser/config.json папки проекта,
 * плюс .adviserignore. Файлы читаются заранее и перечитываются при изменении, поэтому get()
 * синхронный.
 */
export class ProjectSettings implements vscode.Disposable {
  private readonly loaded = new Map<string, Loaded>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subscriptions: vscode.Disposable[] = [];

  private constructor(private readonly log: vscode.LogOutputChannel) {
    const reload = (uri: vscode.Uri) => {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (folder) {
        void this.load(folder).then(() => this.emitter.fire());
      }
    };
    for (const path of [CONFIG_PATH, IGNORE_FILE]) {
      const watcher = vscode.workspace.createFileSystemWatcher(`**/${path}`);
      this.subscriptions.push(
        watcher,
        watcher.onDidCreate(reload),
        watcher.onDidChange(reload),
        watcher.onDidDelete(reload),
      );
    }
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.loadAll()),
      vscode.workspace.onDidChangeConfiguration(
        (e) => e.affectsConfiguration('adviser') && this.emitter.fire(),
      ),
    );
  }

  static async create(log: vscode.LogOutputChannel) {
    const settings = new ProjectSettings(log);
    await settings.loadAll();
    return settings;
  }

  get(cellOrFile?: vscode.Uri): FileSettings {
    const uri = cellOrFile && ownerUri(cellOrFile);
    const folder = uri && vscode.workspace.getWorkspaceFolder(uri);
    const loaded = folder ? this.loaded.get(folder.uri.toString()) : undefined;
    const config = vscode.workspace.getConfiguration('adviser', uri);
    const user = {
      mode: currentMode(),
      level: currentLevel(uri),
      language: config.get<string>('language', 'auto'),
      hiddenPatterns: config.get<string[]>('hiddenPatterns', []),
    };
    const merged = mergeSettings(user, loaded?.config);
    // Новый массив: ignore из mergeSettings — это массив самого конфига, его не трогаем.
    const settings = { ...merged, ignore: [...merged.ignore, ...(loaded?.ignore ?? [])] };
    return loaded?.error ? { ...settings, configError: loaded.error } : settings;
  }

  /** Файл попадает под ignore своего проекта. Ячейка — если под него попадает её ноутбук. */
  ignored(doc: vscode.TextDocument, settings: Settings): boolean {
    const folder = vscode.workspace.getWorkspaceFolder(ownerUri(doc.uri));
    return (
      !!folder &&
      settings.ignore.some(
        (glob) =>
          vscode.languages.match({ pattern: new vscode.RelativePattern(folder, glob) }, doc) > 0,
      )
    );
  }

  dispose() {
    this.emitter.dispose();
    this.subscriptions.forEach((s) => s.dispose());
  }

  private async loadAll() {
    this.loaded.clear();
    await Promise.all((vscode.workspace.workspaceFolders ?? []).map((f) => this.load(f)));
    this.emitter.fire();
  }

  private async load(folder: vscode.WorkspaceFolder) {
    const [configText, ignoreText] = await Promise.all([
      readOptional(folder, CONFIG_PATH),
      readOptional(folder, IGNORE_FILE),
    ]);
    const loaded: Loaded = { ignore: [] };
    const errors: string[] = [];
    if (configText instanceof Error) {
      errors.push(vscode.l10n.t('{0} could not be read: {1}', CONFIG_PATH, configText.message));
    } else if (configText !== undefined) {
      const { config, error } = parseProjectConfig(configText);
      if (error === undefined) {
        loaded.config = config;
      } else {
        errors.push(`${CONFIG_PATH}: ${error}`);
      }
    }
    if (ignoreText instanceof Error) {
      errors.push(vscode.l10n.t('{0} could not be read: {1}', IGNORE_FILE, ignoreText.message));
    } else if (ignoreText !== undefined) {
      const { globs, skipped } = gitignoreToGlobs(ignoreText);
      loaded.ignore = globs;
      if (skipped.length) {
        this.log.warn(
          `${IGNORE_FILE}: negations are not supported, skipped: ${skipped.join(', ')}`,
        );
      }
    }
    if (errors.length) {
      // Не применяем ничего: опечатка не должна молча выключить ignore и отправить лишнее.
      loaded.error = errors.join('; ');
      loaded.config = undefined;
      this.log.warn(`"${folder.name}": ${loaded.error}. Reviews in this folder are paused.`);
    } else if (loaded.config || loaded.ignore.length) {
      const what = [
        ...Object.keys(loaded.config ?? {}),
        ...(loaded.ignore.length ? [IGNORE_FILE] : []),
      ];
      this.log.info(`project settings of "${folder.name}": ${what.join(', ')}`);
    }
    this.loaded.set(folder.uri.toString(), loaded);
  }
}

/** Файл проекта: undefined — его нет; Error — есть, но не читается. */
async function readOptional(
  folder: vscode.WorkspaceFolder,
  path: string,
): Promise<string | undefined | Error> {
  try {
    return new TextDecoder().decode(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, path)),
    );
  } catch (e) {
    if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
      return undefined;
    }
    return e instanceof Error ? e : new Error(String(e));
  }
}
