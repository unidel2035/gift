/**
 * Исследовательская среда онтологии Дара
 *
 * Три программы:
 *   1. Литургический цикл — SabbathHeartbeat + LiturgicalClock
 *   2. Город (Ойкос) — CityPipeline + OikosRegistry
 *   3. Домостроительство — Oikonomia + GiftEngine
 *
 * Инструменты исследования:
 *   - GiftCompiler  — транслирует .gift текст → действия
 *   - NaturalGiftInterface — русский текст → действие
 *   - TernaryVM — исполняет программы на тритах
 *   - GratitudeGraph — граф благодарности
 *   - LogosRegistry — дерево λόγοι
 *
 * Запуск:
 *   node src/lab/index.js liturgical   — только литургический цикл
 *   node src/lab/index.js oikos        — только город
 *   node src/lab/index.js oikonomia    — только домостроительство
 *   node src/lab/index.js all          — все три вместе
 *   node src/lab/index.js repl         — интерактивный REPL
 *
 * «В начале было Слово» (Ин 1:1)
 */

import { createLabLogger } from './logger.js';
import { runLiturgical } from './liturgical.js';
import { runOikos } from './oikos.js';
import { runOikonomia } from './oikonomia.js';
import { startRepl } from './repl.js';

const log = createLabLogger('lab');

// ── Главная точка входа ──────────────────────────────────────

const [,, mode = 'all'] = process.argv;

const MODES = {
  liturgical: () => runLiturgical({ verbose: true }),
  oikos:      () => runOikos({ verbose: true }),
  oikonomia:  () => runOikonomia({ verbose: true }),
  repl:       () => startRepl(),
  all:        () => runAll(),
};

async function runAll() {
  log.section('Онтология Дара — исследовательская среда');
  log.info('Три программы запускаются параллельно');

  await Promise.all([
    runLiturgical({ verbose: false }),
    runOikos({ verbose: false }),
    runOikonomia({ verbose: true }),
  ]);
}

const handler = MODES[mode];
if (!handler) {
  log.error(`Неизвестный режим: ${mode}`);
  log.info(`Доступные режимы: ${Object.keys(MODES).join(', ')}`);
  process.exit(1);
}

log.section(`Режим: ${mode}`);
handler().catch(e => {
  log.error('Критическая ошибка:', e.message);
  process.exit(1);
});

export { runLiturgical, runOikos, runOikonomia, startRepl };
