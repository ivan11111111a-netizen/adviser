// Только для разработки: подписка Claude через незамодифицированный `claude -p`.
// Правила Anthropic не разрешают продуктам ходить через подписку пользователей,
// поэтому в установленном расширении этот провайдер не включается (см. src/config/provider.ts).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InvalidResponseError, type ModelRequest, type Provider, type Usage } from '../core/engine';

export interface ClaudeCodeOptions {
  executable: string;
  model: string;
  timeoutMs?: number;
}

/** npm-установка на Windows кладёт в PATH только claude.cmd, а его нельзя запустить без shell. */
export function resolveClaudeExecutable(configured: string): string {
  if (configured !== 'claude' || process.platform !== 'win32' || !process.env.APPDATA) {
    return configured;
  }
  const npmExe = path.join(
    process.env.APPDATA,
    'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe',
  );
  return fs.existsSync(npmExe) ? npmExe : configured;
}

/** `claude -p --output-format json` печатает один JSON; ответ по схеме лежит в structured_output. */
export function parseClaudeOutput(stdout: string): unknown {
  let out: { is_error?: boolean; result?: string; subtype?: string; structured_output?: unknown };
  try {
    out = JSON.parse(stdout);
  } catch {
    throw new InvalidResponseError('claude вернул не JSON');
  }
  if (out.is_error) {
    throw new Error(`claude: ${out.result ?? out.subtype ?? 'ошибка без описания'}`);
  }
  if (out.structured_output === undefined) {
    throw new InvalidResponseError('в ответе claude нет structured_output');
  }
  return out.structured_output;
}

/** Расход из ответа claude -p: входные токены вместе с прочитанными и записанными в кэш. */
export function parseClaudeUsage(stdout: string): Usage | undefined {
  try {
    const { usage } = JSON.parse(stdout) as { usage?: Record<string, number | undefined> };
    if (!usage) {
      return undefined;
    }
    const n = (key: string) => usage[key] ?? 0;
    return {
      inputTokens:
        n('input_tokens') + n('cache_read_input_tokens') + n('cache_creation_input_tokens'),
      outputTokens: n('output_tokens'),
    };
  } catch {
    // Не JSON — это заметит parseClaudeOutput.
    return undefined;
  }
}

export function createClaudeCodeProvider(options: ClaudeCodeOptions): Provider {
  return {
    complete: (request, signal, onUsage) =>
      run(options, request, signal).then((stdout) => {
        const usage = parseClaudeUsage(stdout);
        if (usage) {
          onUsage?.(usage);
        }
        return parseClaudeOutput(stdout);
      }),
  };
}

function run(options: ClaudeCodeOptions, request: ModelRequest, signal?: AbortSignal) {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(request.jsonSchema),
    '--system-prompt',
    request.system,
    // Только модель: без инструментов, настроек, MCP и сохранения сессии.
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--model',
    options.model,
  ];
  const env = { ...process.env };
  delete env.CLAUDECODE; // иначе запуск из сессии Claude Code считается вложенным

  return new Promise<string>((resolve, reject) => {
    // cwd вне проекта, чтобы claude не подхватил CLAUDE.md и AGENTS.md репозитория.
    const child = spawn(options.executable, args, { cwd: os.tmpdir(), env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 120_000);
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`не удалось запустить ${options.executable}: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (stdout.trim()) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `claude завершился с кодом ${code}`));
      }
    });
    child.stdin.end(request.prompt);
  });
}
