# Стенд качества перевода

Стенд прогоняет перевод тем же путем, что и расширение: блоки страницы извлекает экстрактор расширения в Chromium, промпт собирается из трех слоев (каркас, языковой промпт, шаблон), запрос идет в локальный opencode через `opencode api`, батчи и повторы как в `lib/translate/service.ts`. Критерии приемки языкового профиля описаны в `CONTRIBUTING.md`, раздел "Checking a profile with the quality stand".

Снимки страниц, прогоны, раунды и ключи лежат в `tests/quality/.data/` и в git не попадают. Список страниц в `corpus.json`, конфиги прогонов в `configs/`, промпты в `prompts/`.

```
pnpm quality:snapshot all
pnpm quality:translate --config tests/quality/configs/baseline.json --run base-none-1 [--set effort=high]
pnpm quality:lint base-none-1 base-high-1
node tests/quality/round.ts build --runs base-none-1,base-high-1 --round r1 --parts 2
node tests/quality/round.ts verify-list --round r1
node tests/quality/round.ts score --round r1
node tests/quality/round.ts calibration --round r1
```

Судья это сабагент Opus в Claude Code, на каждую часть раунда отдельный. Ему дают `judge/rubric.md`, файл `rounds/<round>/part-N.md` и путь для ответа `rounds/<round>/verdicts-N.json`. Ключ раунда лежит в `keys/`, судья его не читает. Флаги `meaning` проверяет еще один сабагент по `judge/verify.md`, он пишет `rounds/<round>/verified.json`. После этого `score` считает итог.

Калибровка: `calibration` готовит для человека 10 пар и 5 одиночных переводов в `.data/calibration/<round>.md`, ответы судьи лежат в `keys/<round>-calibration.json`.
