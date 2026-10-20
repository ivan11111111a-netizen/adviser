import * as vscode from 'vscode';
import {
  addUsage,
  budgetExceeded,
  formatUsage,
  usageTotals,
  type Budget,
  type UsageLog,
} from '../core/budget';
import type { Usage } from '../core/engine';

const KEY = 'adviser.usage';

/**
 * Учёт расхода (6.9 плана): токены по дням в globalState — общий для окон и переживает перезапуск.
 * Цены и лимиты — из настроек пользователя adviser.budget.*.
 */
export class UsageTracker implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get log(): UsageLog {
    return this.context.globalState.get<UsageLog>(KEY, {});
  }

  async add(usage: Usage) {
    await this.context.globalState.update(KEY, addUsage(this.log, Date.now(), usage));
    this.emitter.fire();
  }

  budget(): Budget {
    const config = vscode.workspace.getConfiguration('adviser.budget');
    const n = (key: string) => Math.max(0, config.get<number>(key, 0));
    return {
      inputPerMillion: n('inputPricePerMillion'),
      outputPerMillion: n('outputPricePerMillion'),
      dailyUsd: n('dailyLimitUsd'),
      monthlyUsd: n('monthlyLimitUsd'),
    };
  }

  /** Почему разборы на паузе из-за денег; undefined — можно разбирать. */
  exceeded(): string | undefined {
    return budgetExceeded(this.log, Date.now(), this.budget());
  }

  /** Строки для подсказки статус-бара. */
  summary(): string[] {
    const { today, month } = usageTotals(this.log, Date.now());
    if (!month.requests) {
      return [];
    }
    const budget = this.budget();
    return [`Сегодня: ${formatUsage(today, budget)}.`, `За месяц: ${formatUsage(month, budget)}.`];
  }

  dispose() {
    this.emitter.dispose();
  }
}
