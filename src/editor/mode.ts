import * as vscode from 'vscode';
import { LEVELS, type Level } from '../core/promptBuilder';
import { MODES, type Mode } from '../core/scheduler';

export function currentLevel(scope?: vscode.Uri): Level {
  const value = vscode.workspace.getConfiguration('adviser', scope).get<string>('level');
  return LEVELS.find((l) => l === value) ?? 'beginner';
}

export function currentMode(): Mode {
  const value = vscode.workspace.getConfiguration('adviser').get<string>('mode');
  return MODES.find((m) => m === value) ?? 'mentor';
}

/** Пишем туда, откуда режим сейчас берётся: настройка проекта перекрыла бы пользовательскую. */
export async function setMode(mode: Mode) {
  const config = vscode.workspace.getConfiguration('adviser');
  const target =
    config.inspect('mode')?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await config.update('mode', mode, target);
}

const DND_KEY = 'adviser.doNotDisturbUntil';

/** До какого времени «Не беспокоить»; undefined — выключено. Переживает перезапуск окна. */
export function doNotDisturbUntil(context: vscode.ExtensionContext): number | undefined {
  const until = context.globalState.get<number>(DND_KEY);
  return until !== undefined && until > Date.now() ? until : undefined;
}

export async function setDoNotDisturb(context: vscode.ExtensionContext, minutes?: number) {
  await context.globalState.update(DND_KEY, minutes ? Date.now() + minutes * 60_000 : undefined);
}

/** Время для подсказок. Интерфейс пока только русский, поэтому и формат русский: 15:30, а не 3:30 PM. */
export const clock = (time: number) =>
  new Date(time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
