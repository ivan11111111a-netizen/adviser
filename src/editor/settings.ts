import * as vscode from 'vscode';
import {
  mergeSettings,
  parseProjectConfig,
  type ProjectConfig,
  type Settings,
} from '../core/projectConfig';
import { currentLevel, currentMode } from './mode';

export const CONFIG_PATH = '.adviser/config.json';

/** Действующие настройки файла. configError — .adviser/config.json не разобран, разборы стоят. */
export type FileSettings = Settings & { configError?: string };

type Loaded = { config: ProjectConfig } | { error: string };

/**
 * Настройки в три слоя (6.7 плана): умолчания → VS Code → .adviser/config.json папки проекта.
 * Конфиги читаются заранее и перечитываются при изменении, поэтому get() синхронный.
 */
export class ProjectSettings implements vscode.Disposable {
  private readonly loaded = new Map<string, Loaded>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subscriptions: vscode.Disposable[];

  private constructor(private readonly log: vscode.LogOutputChannel) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_PATH}`);
    const reload = (uri: vscode.Uri) => {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (folder) {
        void this.load(folder).then(() => this.emitter.fire());
      }
    };
    this.subscriptions = [
      watcher,
      watcher.onDidCreate(reload),
      watcher.onDidChange(reload),
      watcher.onDidDelete(reload),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.loadAll()),
      vscode.workspace.onDidChangeConfiguration(
        (e) => e.affectsConfiguration('adviser') && this.emitter.fire(),
      ),
    ];
  }

  static async create(log: vscode.LogOutputChannel) {
    const settings = new ProjectSettings(log);
    await settings.loadAll();
    return settings;
  }

  get(uri?: vscode.Uri): FileSettings {
    const folder = uri && vscode.workspace.getWorkspaceFolder(uri);
    const loaded = folder ? this.loaded.get(folder.uri.toString()) : undefined;
    const user = {
      mode: currentMode(),
      level: currentLevel(uri),
      language: vscode.workspace.getConfiguration('adviser', uri).get<string>('language', 'auto'),
    };
    if (loaded && 'error' in loaded) {
      return { ...mergeSettings(user), configError: loaded.error };
    }
    return mergeSettings(user, loaded?.config);
  }

  /** Файл попадает под ignore своего проекта. */
  ignored(doc: vscode.TextDocument, settings: Settings): boolean {
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
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
    const key = folder.uri.toString();
    const file = vscode.Uri.joinPath(folder.uri, CONFIG_PATH);
    let text: string;
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
    } catch (e) {
      if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
        this.loaded.delete(key);
        return;
      }
      this.loaded.set(key, { error: `не прочитан: ${String(e)}` });
      return;
    }
    const { config, error } = parseProjectConfig(text);
    if (error !== undefined) {
      // Не применяем ничего: опечатка не должна молча выключить ignore и отправить лишнее.
      this.log.warn(`${CONFIG_PATH} в «${folder.name}»: ${error}. Разборы в этой папке стоят.`);
      this.loaded.set(key, { error });
    } else {
      this.log.info(`${CONFIG_PATH} в «${folder.name}»: ${Object.keys(config!).join(', ')}`);
      this.loaded.set(key, { config: config! });
    }
  }
}
