// Драйвер живого VS Code для агентов: запускает изолированную копию VS Code с этим проектом,
// выполняет команды из аргументов по порядку, закрывает её. Описание команд — в SKILL.md.
//   node .claude/skills/run-vscode/driver.mjs f5 "open src/extension.ts" "goto 6" "ss editor"
import { chromium } from 'playwright-core';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

// Иначе запрос к локальному CDP-порту уходит в HTTP_PROXY из окружения и получает 502.
process.env.NO_PROXY = process.env.no_proxy = '127.0.0.1,localhost';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const WORK = path.join(ROOT, '.vscode-test', 'driver');
const SHOTS = process.env.SCREENSHOT_DIR || path.join(WORK, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms, error) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
  }
  throw new Error(error);
}

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const toasts = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll('.notification-list-item-message')].map((e) => e.textContent),
  );

// Модал «Sign in to use GitHub Copilot» перехватывает клавиатуру. Жать только «без входа».
const dismissOnboarding = (p) =>
  p.evaluate(() => {
    const btn = [...document.querySelectorAll('a, button, .monaco-button')].find(
      (e) => e.textContent?.trim() === 'Continue without Signing In',
    );
    btn?.click();
    return Boolean(btn);
  });

let outer;
let page;
let workbenches;

async function quickInput(open, text, expected) {
  await page.keyboard.press(open);
  await sleep(800);
  await page.keyboard.type(text);
  await sleep(1200);
  const first = await page.evaluate(
    () => document.querySelector('.quick-input-widget .monaco-list-row')?.textContent ?? null,
  );
  // Enter вслепую может нажать что угодно, поэтому сначала проверяем первую строку.
  if (!first?.includes(expected)) {
    throw new Error(`первая строка «${first}», ожидалось «${expected}»; Enter не нажат`);
  }
  await page.keyboard.press('Enter');
  await sleep(1500);
}

const COMMANDS = {
  async f5() {
    // Хост расширений в окне разработки иногда падает сразу после старта (код 134 в main.log),
    // и окно закрывается. Это сбой VS Code, а не расширения: просто жмём F5 ещё раз.
    let dev;
    for (let attempt = 1; !dev; attempt++) {
      await page.keyboard.press('F5');
      const result = await waitFor(
        async () => {
          const p = workbenches().find((w) => w !== outer && !w.isClosed());
          if (!p) return undefined;
          await p.waitForSelector('.monaco-workbench', { timeout: 30_000 }).catch(() => {});
          await sleep(4000);
          return p.isClosed() ? 'closed' : p;
        },
        60_000,
        'не появилось за 60 с',
      ).catch((e) => e.message);
      if (typeof result !== 'string') {
        dev = result;
      } else if (attempt === 3) {
        console.log('уведомления во внешнем окне:', await toasts(outer));
        throw new Error(`окно разработки ${result}; логи: ${path.join(WORK, 'profile', 'logs')}`);
      } else {
        console.log(
          `попытка ${attempt}: окно разработки ${result === 'closed' ? 'закрылось' : result}, жму F5 снова`,
        );
      }
    }
    await dismissOnboarding(dev);
    page = dev;
    console.log('окно разработки:', await dev.title());
  },
  cmd: (title) => quickInput('Control+Shift+P', title, title),
  async open(file) {
    const abs = path.resolve(ROOT, file);
    await quickInput('Control+P', abs, path.basename(abs));
  },
  async goto(line) {
    await page.keyboard.press('Control+G');
    await sleep(800);
    await page.keyboard.type(line);
    await sleep(800);
    await page.keyboard.press('Enter');
    await sleep(800);
    const status = await page.evaluate(
      () => document.getElementById('status.editor.selection')?.innerText ?? null,
    );
    if (!status?.startsWith(`Ln ${line},`)) {
      throw new Error(`курсор не на строке ${line}: статус-бар «${status}»`);
    }
  },
  // click Объяснить — клик мышью по первой видимой ссылке или кнопке ровно с таким текстом.
  async click(text) {
    await page.getByText(text, { exact: true }).first().click({ timeout: 10_000 });
    await sleep(1500);
  },
  type: (text) => page.keyboard.type(text, { delay: 20 }),
  press: (key) => page.keyboard.press(key),
  sleep: (ms) => sleep(Number(ms) || 1000),
  async ss(name) {
    const file = path.join(SHOTS, `${name || Date.now()}.png`);
    await page.screenshot({ path: file });
    console.log('скриншот:', file);
  },
  async toasts() {
    console.log(await toasts(page));
  },
  async text(selector) {
    console.log(
      await page.evaluate(
        (s) => document.querySelector(s)?.innerText ?? '(нет элемента)',
        selector,
      ),
    );
  },
  // setting adviser.provider=claude-code: пишет в settings.json профиля, VS Code подхватывает на лету.
  async setting(assignment) {
    const [key, ...rest] = assignment.split('=');
    const raw = rest.join('=');
    const file = path.join(WORK, 'profile', 'User', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    try {
      settings[key] = JSON.parse(raw);
    } catch {
      settings[key] = raw;
    }
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
    await sleep(1500);
  },
  // waittext Adviser: замечаний — ждёт текст где угодно в окне (статус-бар, уведомления), до 120 с.
  async waittext(text) {
    await waitFor(
      () => page.evaluate((t) => document.body.innerText.includes(t), text),
      120_000,
      `за 120 с в окне не появился текст «${text}»`,
    );
  },
};

const steps = process.argv.slice(2).map((s) => {
  const [cmd, ...rest] = s.trim().split(/\s+/);
  if (!COMMANDS[cmd]) {
    console.error(`неизвестная команда «${cmd}». Есть: ${Object.keys(COMMANDS).join(', ')}`);
    process.exit(2);
  }
  return [cmd, rest.join(' ')];
});

const codeExe = await downloadAndUnzipVSCode({ cachePath: path.join(ROOT, '.vscode-test') });
const profile = path.join(WORK, 'profile');
try {
  fs.rmSync(profile, { recursive: true, force: true });
} catch {
  console.error(
    `не удалось очистить ${profile}: закрой окна VS Code, оставшиеся от прошлого прогона`,
  );
  process.exit(1);
}
fs.mkdirSync(path.join(profile, 'User'), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(
  path.join(profile, 'User', 'settings.json'),
  JSON.stringify({
    'chat.disableAIFeatures': true,
    'workbench.startupEditor': 'none',
    'workbench.tips.enabled': false,
    'update.mode': 'none',
    'telemetry.telemetryLevel': 'off',
  }),
);

const port = await freePort();
const proc = spawn(
  codeExe,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--extensions-dir=${path.join(profile, 'extensions')}`,
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--new-window',
    ROOT,
  ],
  { stdio: 'ignore' },
);

let browser;
try {
  browser = await waitFor(
    () => chromium.connectOverCDP(`http://127.0.0.1:${port}`),
    60_000,
    'VS Code не открыл CDP-порт за 60 с',
  );
  const ctx = browser.contexts()[0];
  workbenches = () => ctx.pages().filter((p) => p.url().includes('workbench.html'));
  outer = page = await waitFor(async () => workbenches()[0], 60_000, 'окно VS Code не появилось');
  await outer.waitForSelector('.monaco-workbench', { timeout: 60_000 });
  await sleep(4000);
  await dismissOnboarding(outer);
  console.log('запущено:', await outer.title());

  for (const [cmd, arg] of steps) {
    console.log(`> ${cmd} ${arg}`.trimEnd());
    await COMMANDS[cmd](arg);
  }
} catch (e) {
  console.error('ОШИБКА:', e.message);
  if (page) await COMMANDS.ss('error').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    } catch {}
  } else {
    proc.kill();
  }
}
