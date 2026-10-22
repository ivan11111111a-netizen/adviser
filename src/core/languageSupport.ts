/**
 * Границы функций Adviser берёт у языкового сервера. Для JS и TS он встроен в VS Code, а для
 * остальных языков нужно расширение — без него автопилот молча не видит функций.
 */
export const LANGUAGE_EXTENSIONS: Record<string, { language: string; ids: string[] }> = {
  python: { language: 'Python', ids: ['ms-python.python'] },
  java: { language: 'Java', ids: ['redhat.java'] },
  c: { language: 'C', ids: ['ms-vscode.cpptools', 'llvm-vs-code-extensions.vscode-clangd'] },
  cpp: { language: 'C++', ids: ['ms-vscode.cpptools', 'llvm-vs-code-extensions.vscode-clangd'] },
};

/** Чего не хватает для языка файла; undefined — хватает или расширение не нужно. */
export function missingSupport(
  languageId: string,
  installed: (id: string) => boolean,
): { language: string; id: string } | undefined {
  const need = LANGUAGE_EXTENSIONS[languageId];
  if (!need || need.ids.some(installed)) {
    return undefined;
  }
  return { language: need.language, id: need.ids[0] };
}
