# Как выпустить Adviser

## Выпуск на GitHub Releases (v0.5, раздача однокурсникам)

Всё готово, нужен только тег.

1. Слить ветки этапов в `main` (сейчас они идут цепочкой `stage-0` → … → `stage-8`, а `main` их не содержит).
2. Проверить, что версия в `package.json` и раздел в `CHANGELOG.md` совпадают (сейчас 0.5.0).
3. `git tag v0.5.0` и `git push origin v0.5.0`.
4. Workflow `Release` (`.github/workflows/release.yml`) прогонит линт и юнит-тесты, проверит версию, соберёт `.vsix` и выпустит его. Нечётная минорная цифра — предварительный выпуск, текст берётся из раздела CHANGELOG.

Этот workflow ещё ни разу не запускался: на первом выпуске проверь страницу Releases.

## Перед публикацией в Marketplace и Open VSX (v1.0)

Это решения автора (раздел 16 плана), поэтому они здесь списком, а не сделаны.

1. **Имя.** «Adviser» — рабочее; в Marketplace и Open VSX уникальны и id, и отображаемое имя. Если имя меняется — одной заменой до первой публикации: `name` и `displayName` в `package.json`, id команд и настроек (`adviser.*`), папка `.adviser/`, `.adviserignore`, тексты.
2. **Publisher** в Marketplace и **namespace** в Open VSX — занять сразу. В `package.json` добавить поле `publisher`.
3. **Marketplace:** `vsce publish --oidc` из GitHub Actions, без personal access token (Azure DevOps отключает глобальные PAT 1 декабря 2026). Настройку доверенной публикации проверить по официальной документации VS Code «Publishing Extensions» на момент выпуска.
4. **Open VSX:** `ovsx publish`, токен — в секретах репозитория.
5. **Предварительные выпуски** — `vsce publish --pre-release` для нечётной минорной цифры.
6. **README.** Картинки в нём относительные: при упаковке `vsce` превращает их в ссылки на `main` в GitHub, поэтому к публикации `docs/images/` должны быть в `main`.

## Проверка пакета перед выпуском

```sh
npm run package:vsix
node .claude/skills/run-vscode/driver.mjs "vsix adviser-0.5.0.vsix" "sleep 4000" "ss installed"
```

Драйвер ставит пакет в чистый профиль: расширение работает так, как у пользователя (mock и `claude-code` выключены), и сам открывается мастер первого запуска.
