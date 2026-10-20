import type * as vscode from 'vscode';
import type { LineEdit } from '../core/changes';

/** Правки события построчно: строки start..end текста до правки заменены newLines строками. */
export function lineEdits(e: vscode.TextDocumentChangeEvent): LineEdit[] {
  return e.contentChanges.map((c) => ({
    start: c.range.start.line,
    end: c.range.end.line,
    newLines: c.text.split('\n').length,
  }));
}
