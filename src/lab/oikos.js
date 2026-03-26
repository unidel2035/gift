/**
 * Город (Ойкос) — исследование городской онтологии
 *
 * Программа:
 *   1. Зарегистрировать лица (жители, агенты, дроны)
 *   2. Запустить CityPipeline
 *   3. Наблюдать перихоретические циклы (A→B→C→A)
 *   4. Показывать граф благодарности
 *   5. Обнаруживать изоляты и дефицит дара
 *
 * Ойкос (οἶκος) = дом, домашнее хозяйство, город.
 * Пространство, где дар циркулирует между лицами.
 *
 * «Небесный Иерусалим» — τέλος города (Откр 21)
 */

import { GratitudeGraph } from '../traces/GratitudeGraph.js';
import { Oikonomia } from '../oikonomia/Oikonomia.js';
import { PerichoresisCycle } from '../oikonomia/PerichoresisCycle.js';
import { OikosRegistry } from '../oikonomia/OikosRegistry.js';
import { createLabLogger } from './logger.js';

/**
 * Запустить исследование города.
 *
 * @param {object} opts
 * @param {boolean} opts.verbose — подробный вывод
 * @param {string[]} opts.persons — имена жителей (по умолчанию — демо-набор)
 */
export async function runOikos(opts = {}) {
  const {
    verbose = true,
    persons = ['Иоанн', 'Мария', 'Стефан', 'Феодора', 'Кирилл', 'Анна'],
  } = opts;

  const log = createLabLogger('oikos');
  log.section('Город (Ойкос)');

  // ── 1. Граф благодарности ─────────────────────────────────

  const graph = new GratitudeGraph();

  log.info('Регистрируем жителей:', persons.join(', '));

  // ── 2. Создаём дары и благодарности ──────────────────────

  const gifts = [
    { from: 'Иоанн', to: 'Мария', id: 'g1' },
    { from: 'Мария', to: 'Стефан', id: 'g2' },
    { from: 'Стефан', to: 'Феодора', id: 'g3' },
    { from: 'Феодора', to: 'Иоанн', id: 'g4' }, // Замыкает треугольник → перихоресис
    { from: 'Кирилл', to: 'Анна', id: 'g5' },   // Дуэт (риск обмена)
    { from: 'Анна', to: 'Кирилл', id: 'g6' },
  ];

  log.info('Записываем дары и благодарности...');
  for (const g of gifts) {
    graph.addGratitude(g.to, g.from, g.id);
    if (verbose) {
      log.gift(`${g.to} благодарит ${g.from} за ${g.id}`);
    }
  }

  // ── 3. Анализ графа ───────────────────────────────────────

  log.section('Анализ графа благодарности');

  const density = graph.density?.() ?? '—';
  log.info('Плотность благодарности:', density);

  // Перихоретические циклы (тройки)
  const cycles = graph.findCycles?.(4) ?? [];
  if (cycles.length > 0) {
    log.event(`Найдено перихоретических циклов: ${cycles.length}`);
    for (const c of cycles) {
      log.event('  Цикл:', c.join(' → '));
    }
  } else {
    log.warn('Перихоретических циклов не найдено');
  }

  // Взаимные пары (риск обмена)
  const mutual = graph.getMutualPairs?.() ?? [];
  if (mutual.length > 0) {
    log.warn(`Взаимных пар (риск обмена): ${mutual.length}`);
    for (const [a, b] of mutual) {
      log.warn(`  ${a} ↔ ${b} — проверить: это дар или quid pro quo?`);
    }
  }

  // ── 4. PerichoresisCycle анализ ───────────────────────────

  try {
    const pc = new PerichoresisCycle();
    // PerichoresisCycle работает с oikonomia-данными
    log.info('PerichoresisCycle инициализирован');
  } catch (e) {
    log.warn('PerichoresisCycle недоступен:', e.message);
  }

  // ── 5. OikosRegistry ─────────────────────────────────────

  try {
    const oikos = new OikosRegistry();
    for (const name of persons) {
      await oikos.registerHousehold?.(name, { name });
    }
    const all = oikos.all?.() ?? [];
    log.info(`Ойкосы (домохозяйства): ${all.length}`);
  } catch (e) {
    log.warn('OikosRegistry:', e.message);
  }

  // ── 6. Итог ───────────────────────────────────────────────

  log.section('Ойкос — итог');
  log.info('Вершин в графе:', graph._edges?.size ?? 0);
  log.info('Рёбер (благодарностей):', graph._edgeCount ?? 0);
  log.info('Вертикальных актов (евхаристий):', graph._verticalCount ?? 0);

  if (density > 0.5) {
    log.event('Высокая плотность связей — ойкос живёт');
  } else {
    log.warn('Низкая плотность — есть изоляция');
  }

  return { graph, persons };
}

export default runOikos;
