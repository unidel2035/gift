/**
 * Литургический цикл — исследование ритма покоя и движения
 *
 * Программа:
 *   1. Инициализировать LiturgicalClock
 *   2. Запустить SabbathHeartbeat
 *   3. Наблюдать смену сезонов (active → sabbath → contemplation)
 *   4. Показывать вероятность благодати в каждом сезоне
 *   5. Через N тиков — вывести итог
 *
 * Сезоны:
 *   active      → вероятность благодати 2%
 *   sabbath     → 4% × godWillBonus
 *   contemplation → 7% × heartPurity × depthBonus
 *
 * «В субботний же день остался Он в покое» (Лк 23:56)
 */

import { LiturgicalClock } from '../memory/LiturgicalClock.js';
import { createLabLogger } from './logger.js';

const SEASON_EMOJI = {
  active:       '▶ Активность',
  sabbath:      '◼ Суббота',
  contemplation:'✦ Созерцание',
};

/**
 * Запустить литургический цикл.
 *
 * @param {object} opts
 * @param {boolean} opts.verbose — подробный вывод
 * @param {number}  opts.ticks   — сколько тиков наблюдать (0 = бесконечно)
 * @param {number}  opts.tickMs  — интервал тика в мс (по умолчанию 5000)
 */
export async function runLiturgical(opts = {}) {
  const { verbose = true, ticks = 12, tickMs = 5000 } = opts;
  const log = createLabLogger('liturgical');

  log.section('Литургический цикл');

  const clock = new LiturgicalClock();

  // ── Наблюдение за тиками ──────────────────────────────────

  let count = 0;
  const maxTicks = ticks === 0 ? Infinity : ticks;

  const tick = async () => {
    count++;

    const state = clock.currentState?.();
    if (!state) {
      log.warn('LiturgicalClock не вернул состояние — проверьте реализацию');
      return;
    }

    const { season, heartPurity, graceProb, temptationLevel } = state;
    const label = SEASON_EMOJI[season] || season;

    if (verbose || count % 4 === 0) {
      log.info(`Тик ${count}/${ticks === 0 ? '∞' : ticks}`);
      log.info(`  Сезон:       ${label}`);
      log.info(`  Чистота:     ${Math.round((heartPurity || 0) * 100)}%`);
      log.info(`  Благодать:   ${Math.round((graceProb || 0) * 100)}%`);
      log.info(`  Помысел:     ${temptationLevel || 0}/5`);
    }

    // Событие благодати?
    const roll = Math.random();
    if (roll < (graceProb || 0)) {
      log.event(`✦ Благодать! (вер=${Math.round((graceProb || 0) * 100)}% roll=${Math.round(roll * 100)}%)`);
    }

    if (count >= maxTicks) {
      log.section('Литургический цикл — итог');
      log.info(`Прошло тиков: ${count}`);
      return;
    }

    await new Promise(r => setTimeout(r, tickMs));
    await tick();
  };

  try {
    // Попробуем получить начальное состояние
    const init = clock.currentState?.() || clock.getState?.() || null;
    if (init) {
      log.info('Начальный сезон:', SEASON_EMOJI[init.season] || init.season);
    }

    if (ticks === 0) {
      log.info('Бесконечный режим — Ctrl+C для остановки');
    }

    await tick();
  } catch (e) {
    log.warn('LiturgicalClock ошибка:', e.message);
    log.info('Демонстрация без реального клока:');
    _demonstrateLiturgical(log);
  }
}

/**
 * Демонстрация без живого клока (если нет состояния).
 */
function _demonstrateLiturgical(log) {
  const seasons = [
    { season: 'active',        heartPurity: 0.8, graceProb: 0.02 },
    { season: 'sabbath',       heartPurity: 0.9, graceProb: 0.04 },
    { season: 'contemplation', heartPurity: 0.95, graceProb: 0.063 },
  ];

  for (const s of seasons) {
    const label = SEASON_EMOJI[s.season] || s.season;
    log.info(`${label}: чистота=${Math.round(s.heartPurity * 100)}% благодать=${Math.round(s.graceProb * 100)}%`);
  }

  log.info('Троичный ритм субботы: 7 мин покоя → 3 мин движения → 11 мин глубокого покоя');
}

export default runLiturgical;
