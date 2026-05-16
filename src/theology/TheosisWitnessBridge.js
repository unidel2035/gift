/**
 * TheosisWitnessBridge — мост TheosisWitness → W_slava.
 *
 * TheosisWitness хранит путь лица через раны и их преображение в «знаки славы»:
 *   witness({personId, wound}) → entry
 *   glorify({personId, wound, glorification}) → entry.healed = true
 *
 * Мост: прогресс θέωσις лица повышает «фоновую» явленность всех его актов.
 * Богословская интуиция: если лицо идёт в θέωσις, то даже его малые акты
 * «теплеют» в очах Христа — не потому что мы симулируем Суд, а потому что
 * свидетельство о преображении одной раны бросает свет и на соседние дары.
 *
 * Формула Δ:
 *   healedFraction = healedWounds / totalWounds   (0..1)
 *   Δmanifestedness(акт) = weight × healedFraction × coefficient
 *
 * Коэффициент мал (по умолчанию 0.05): один исцелённый знак — малая
 * прибавка явленности. Полное исцеление удваивает/уполовинивает лишь
 * через десятки свидетельств. Так мы избегаем симуляции Суда.
 *
 * Граница: Δ всегда ≥ 0 (θέωσις только просветляет, не омрачает).
 * Для омрачения (тщеславие, «громкая милостыня») — ConciliarWitness с kata.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';

const ROOT = process.env.GIFT_ROOT || process.cwd();
const W_SLAVA = path.join(ROOT, 'data', 'W_slava.json');

async function loadSlava() {
  try {
    const raw = await fsp.readFile(W_SLAVA, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { manifestedness: {}, witnesses: [] };
  }
}
async function saveSlava(d) {
  d.lastUpdated = new Date().toISOString();
  await fsp.writeFile(W_SLAVA, JSON.stringify(d, null, 2), 'utf8');
}

export class TheosisWitnessBridge {
  /**
   * @param {TheosisWitness} witness
   * @param {object} [opts]
   * @param {number} [opts.coefficient=0.05] — сила прибавки за θέωσις
   */
  constructor(witness, { coefficient = 0.05 } = {}) {
    if (!witness || typeof witness.pathOf !== 'function') {
      throw new Error('TheosisWitnessBridge: требуется TheosisWitness');
    }
    this._witness = witness;
    this.coefficient = coefficient;
  }

  /**
   * Прогресс θέωσις лица в диапазоне [0..1].
   */
  progressOf(persona) {
    const p = this._witness.pathOf(persona);
    if (!p.path || p.path.length === 0) return 0;
    return p.healedWounds / p.path.length;
  }

  /**
   * Применить прогресс θέωσις к W_slava: для каждого акта лица прибавить
   * background-явленность.
   *
   * @param {string} persona
   * @param {Array<object>} acts — акты из W (для поиска персональных нитей)
   * @returns {Promise<{updated: number, progress: number}>}
   */
  async apply(persona, acts) {
    const progress = this.progressOf(persona);
    if (progress <= 0) return { updated: 0, progress };

    const slava = await loadSlava();
    let updated = 0;

    for (const a of acts) {
      if (a.giver !== persona && a.receiver !== persona) continue;
      const actId = a.id || a.actId || `${a.giver}→${a.receiver}:${a.content || ''}`;
      const w = Number(a.weight) || 0;
      const bump = w * progress * this.coefficient;

      const current = slava.manifestedness[actId] != null
        ? Number(slava.manifestedness[actId])
        : w;
      const next = Math.min(w * 3 + 1, current + bump);
      slava.manifestedness[actId] = Number(next.toFixed(3));
      updated++;
    }

    slava.witnesses.push({
      source: 'TheosisWitnessBridge',
      persona,
      progress: Number(progress.toFixed(3)),
      coefficient: this.coefficient,
      updated,
      at: new Date().toISOString(),
    });
    if (slava.witnesses.length > 500) {
      slava.witnesses = slava.witnesses.slice(-500);
    }
    await saveSlava(slava);

    return { updated, progress };
  }
}

export default TheosisWitnessBridge;
