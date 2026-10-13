import * as vscode from 'vscode';
import type { SymbolNode } from '../core/codeRange';

/** Символы документа от языкового сервера. Пустой список, если сервера нет или он ещё не готов. */
export async function documentSymbols(uri: vscode.Uri): Promise<SymbolNode[]> {
  const symbols = await vscode.commands.executeCommand<
    (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined
  >('vscode.executeDocumentSymbolProvider', uri);
  return (symbols ?? []).map(toNode);
}

function toNode(s: vscode.DocumentSymbol | vscode.SymbolInformation): SymbolNode {
  const range = 'children' in s ? s.range : s.location.range;
  return {
    kind: s.kind,
    start: range.start.line,
    end: range.end.line,
    children: 'children' in s ? s.children.map(toNode) : [],
  };
}
