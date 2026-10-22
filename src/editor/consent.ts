import * as vscode from 'vscode';
import { consentDetail, consentKey, isLocal, type Destination } from '../core/consent';

const KEY = 'adviser.consent';

/**
 * Согласие на отправку кода (6.10 плана): спрашиваем один раз на сервер, перед первой отправкой.
 * Локальные серверы не спрашиваем — код не покидает машину.
 */
export class Consent {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private granted(): string[] {
    return this.context.globalState.get<string[]>(KEY, []);
  }

  needed(destination: Destination | undefined): destination is Destination {
    return (
      !!destination &&
      !isLocal(destination.baseUrl) &&
      !this.granted().includes(consentKey(destination))
    );
  }

  /** Модальное окно: человек сам запустил разбор, поэтому спросить уместно. */
  async ask(destination: Destination): Promise<boolean> {
    const allow = 'Разрешить';
    const answer = await vscode.window.showInformationMessage(
      'Adviser отправит код на разбор',
      { modal: true, detail: consentDetail(destination) },
      allow,
    );
    if (answer !== allow) {
      return false;
    }
    await this.context.globalState.update(KEY, [...this.granted(), consentKey(destination)]);
    return true;
  }

  async revoke() {
    await this.context.globalState.update(KEY, undefined);
    vscode.window.setStatusBarMessage(
      'Adviser: разрешения на отправку кода отозваны, спрошу снова',
      6000,
    );
  }
}
