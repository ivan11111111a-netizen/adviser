---
name: run-vscode
description: Запустить расширение Adviser в живом VS Code и погонять его — F5 (Extension Development Host), команды из палитры, открыть файл, перейти на строку, скриншоты, уведомления. Use when asked to run the extension, try a change in real VS Code, or screenshot it.
---

# Прогон в живом VS Code

`driver.mjs` запускает отдельную копию VS Code из `.vscode-test/`. Профиль у неё чистый: `.vscode-test/driver/profile/` пересоздаётся на каждом прогоне. Драйвер открывает в ней этот проект, выполняет команды из аргументов по порядку и закрывает VS Code. Управляет окнами через Playwright по CDP. Профиль и VS Code пользователя он не трогает. Проверено на Windows; на Linux без дисплея нужен `xvfb-run -a`, но это не проверялось.

```powershell
node .claude/skills/run-vscode/driver.mjs f5 "open src/extension.ts" "goto 6" "ss editor"
```

Каждый аргумент в кавычках — одна команда, её параметр идёт через пробел. Прогон занимает 20–30 с, всё это время на экране пользователя видны окна VS Code. При первом запуске и после выхода новой версии VS Code скачивается ~350 МБ.

| команда | что делает |
|---|---|
| `f5` | F5 во внешнем окне → задача `watch` → окно Extension Development Host. Следующие команды идут в него |
| `cmd <название>` | открыть палитру команд и ввести название. Enter — только если первая строка его содержит |
| `run <id>` | выполнить команду по id, даже если в палитре её нет (`run notebook.cell.edit`): через сочетание клавиш в профиле |
| `open <путь>` | Ctrl+P с абсолютным путём; относительный путь считается от корня проекта |
| `goto <строка>` / `goto <строка>:<колонка>` | Ctrl+G, потом проверка по статус-бару, что курсор действительно там. Для hover нужна колонка: в первой колонке курсор левее подчёркивания |
| `type <текст>` / `press <клавиша>` | клавиатура: `press Control+S`, `press Escape` |
| `click <текст>` | клик мышью по первой видимой ссылке или кнопке ровно с этим текстом, например `click Объяснить` в открытом hover |
| `sleep [мс]` | пауза, по умолчанию 1000 |
| `ss [имя]` | скриншот активного окна в `.vscode-test/driver/shots/<имя>.png`. Потом открыть его через Read и посмотреть |
| `toasts` | тексты уведомлений |
| `text <css>` | innerText элемента, например `text .monaco-hover` после `cmd Show or Focus Hover` |
| `setting <ключ>=<значение>` | записать настройку в профиль, VS Code подхватит на лету. Значение разбирается как JSON, иначе берётся строкой |
| `vsix <путь>` | до запуска поставить собранный `.vsix` в чистый профиль: расширение работает как у пользователя (Production, mock и `claude-code` выключены), F5 не нужен. Сначала `npm run package:vsix` |
| `ext <id>` | до запуска поставить расширение из Marketplace, например `ext ms-toolsai.jupyter` |
| `profile <имя>` | профиль `.vscode-test/driver/profiles/<имя>/` не стирается между прогонами: в нём остаются поставленные расширения, вход в GitHub, настройки и несохранённые файлы. Без этой команды профиль чистый |
| `waittext <текст>` | ждать до 120 с, пока текст появится где-нибудь в окне, например `waittext Adviser: замечаний` |

Разбор на подписке Claude (провайдер `claude-code` работает только из исходников, то есть здесь):

```powershell
node .claude/skills/run-vscode/driver.mjs "setting adviser.provider=claude-code" "setting adviser.model=sonnet" f5 "open test/fixtures/sample.js" "goto 4" "cmd Adviser: Разобрать эту функцию" "waittext Adviser: замечаний" "ss review"
```

Ступени в hover: после разбора `"goto 9" "press End" "cmd Show or Focus Hover" "click Показать решение" "text .monaco-hover"`. `goto` ставит курсор в колонку 1, а подчёркивание начинается с первого непробельного символа, поэтому нужен `press End`. Модель от прогона к прогону отвечает по-разному: у `critical` кнопки «Объяснить» нет, и `click Объяснить` на такой строке упадёт.

Автопилот (режим «Наставник» по умолчанию) сам разбирает функцию, когда курсор уходит из изменённой функции или файл сохранён вручную. Так его и проверять: `"goto 10" "press End" "press Enter" "type console.log(x);" "goto 4" "sleep 20000" "ss auto"`. Если нужна только команда, а подписку тратить лишний раз не хочется, — `"setting adviser.mode=manual"`. Тестовые правки в `test/fixtures/` не сохранять (`Control+S`), иначе они попадут в репозиторий.

Лог расширения — `.vscode-test/driver/profile/logs/*/window2/exthost/undefined_publisher.adviser/Adviser.log` (у постоянного профиля — `profiles/<имя>/logs/…`).

Ноутбук Jupyter с Pylance (расширения ставятся один раз, в профиль `jupyter`). Ячейку открывают `run notebook.focusTop` и `run notebook.cell.edit`, курсор в ней ставят клавишами (`press Control+Home`, `press ArrowDown`): `goto` смотрит в статус-бар, а у ноутбука там номер ячейки. Надпись «Adviser: issues» показывает только команда; после автопилота меняется число у значка Adviser, поэтому ждать его разбор — через `sleep`:

```powershell
node .claude/skills/run-vscode/driver.mjs "profile jupyter" "ext ms-toolsai.jupyter" "ext ms-python.python" "setting adviser.provider=mock" f5 "open <путь>.ipynb" "sleep 8000" "run notebook.focusTop" "run notebook.cell.edit" "press Control+Home" "press ArrowDown" "cmd Adviser: Review This Function" "sleep 3000" "ss cell"
```

В постоянном профиле VS Code восстанавливает несохранённые правки прошлого прогона: сначала `run workbench.action.files.revert`.

GitHub Copilot: в VS Code 1.143 он встроен, но модели отдаёт только после входа в GitHub, а войти может только человек. Профиль для этого: `"profile copilot" "setting chat.disableAIFeatures=false" "run workbench.action.chat.triggerSetupForceSignIn" "sleep 180000"`. После входа в этом профиле можно гонять `setting adviser.provider=copilot`.

При ошибке драйвер делает `error.png`, печатает причину, закрывает VS Code и выходит с кодом 1.

Драйвер не заменяет тесты (`npm test`). Он нужен, чтобы посмотреть результат глазами.

## Грабли

- **Прокси.** В окружении задан `HTTP_PROXY=127.0.0.1:7890`. Без `NO_PROXY` Playwright идёт к CDP-порту через прокси и получает 502. Драйвер сам выставляет `NO_PROXY`.
- **Модал входа в Copilot.** На чистом профиле он перехватывает клавиатуру, а Enter в нём запускает вход в GitHub. Драйвер заранее ставит `chat.disableAIFeatures: true`, а если модал всё же появился — жмёт «Continue without Signing In». По той же причине `cmd` и `open` проверяют первую строку перед Enter. Не жать Enter вслепую.
- **Хост расширений в окне разработки падает.** Примерно в трети запусков он завершается с кодом 134, это видно в `profile/logs/*/main.log`. Это сбой VS Code 1.141, а не расширения. `f5` делает до трёх попыток.
- **Кавычки в `type` из PowerShell 5.1.** Двойные кавычки внутри аргумента он съедает: `"type `"a`""` напечатает `a`. Аргумент брать в одинарные кавычки, а внутренние экранировать: `'type \"mode\": \"loud\"'`.
- **Не закрывать чужой VS Code.** Если прошлый прогон оставил процессы, закрывать только `Code.exe` из `.vscode-test`: у пользователя открыт свой VS Code.
