# Adviser

ИИ-наставник в VS Code для тех, кто учится программировать. Он разбирает функцию, которую ты только что изменил, и выдаёт замечание по ступеням: сначала намёк, потом объяснение «почему», и только по запросу — готовый код.

**Статус:** в разработке, этап 0 из 8. Ставить пока нечего. План и принятые решения — в [docs/PLAN.md](docs/PLAN.md).

## Разработка

Нужны Node.js 22+ и VS Code.

```sh
npm install
npm run lint              # ESLint
npm run format:check      # Prettier
npm run check-types       # tsc
npm run test:unit         # Vitest: ядро без VS Code
npm run test:integration  # тесты внутри VS Code (@vscode/test-cli)
```

Запуск расширения — F5 в VS Code (Extension Development Host).

## Лицензия

[MIT](LICENSE)
