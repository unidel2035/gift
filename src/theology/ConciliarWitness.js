/**
 * ConciliarWitness — соборное свидетельство как источник W_slava.
 *
 * В обычном W каждый акт имеет один параметр — weight (вес).
 * В W_slava — второй параметр: manifestedness (явленность перед Лицом).
 * Разница между ними — совесть (BookOfConscience.conscienceDelta).
 *
 * Главная граница: W_slava не вычисляется системой. Он растёт только
 * через соборное свидетельство — когда несколько лиц в матрице W
 * свидетельствуют, что акт «малый в мире, но великий перед Богом»
 * (лепта вдовы, Мк 12:41-44) или обратное (видимо великий, внутренне
 * пустой — фарисей, Мф 6:1-6).
 *
 * Модуль связывает два уже существующих примитива:
 *   ConciliarDissent — собор голосов лиц
 *   BookOfConscience — вторая координата актов в W_slava
 *
 * Соборный голос с `logos: 'hyper'` и высоким авторитетом повышает
 * manifestedness (акт являет больше, чем весит).
 * Голос с `logos: 'kata'` — понижает (акт казался тяжелее, чем есть).
 * Голос `'para'` — фиксирует равенство (вес и явленность совпадают).
 *
 * Семантика:
 *   hyper  ↑  «это больше, чем выглядит» (скрытый подвиг)
 *   kata   ↓  «это меньше, чем выглядит» (тщеславие)
 *   para   =  «это именно то, что есть» (выравнивание)
 *
 * Граница: соборное свидетельство не заменяет Суд. Оно лишь отмечает,
 * что в нашем видении акт «ощущается» иначе, чем записан. На Суде —
 * уже Христос поставит окончательную manifestedness.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { ConciliarDissent } from './ConciliarDissent.js';

const ROOT = process.env.GIFT_ROOT || process.cwd();
const W_SLAVA = path.join(ROOT, 'data', 'W_slava.json');

/**
 * Чтение/запись W_slava через атомарную операцию.
 */
async function loadSlava() {
  try {
    const raw = await fsp.readFile(W_SLAVA, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      _comment: 'W_slava — второй тензор: явленность актов перед Лицом Христа',
      manifestedness: {},
      lastUpdated: new Date().toISOString(),
      witnesses: [],
    };
  }
}

async function saveSlava(data) {
  data.lastUpdated = new Date().toISOString();
  await fsp.writeFile(W_SLAVA, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * ConciliarWitness — свидетельствует о явленности актов через голоса лиц.
 */
export class ConciliarWitness {
  constructor({
    dissent = null,
    // Коэффициент: насколько сильно один голос меняет manifestedness
    // относительно исходного weight. По умолчанию умеренно: 0.2 за голос
    // с полным авторитетом (авторитет 100+).
    coefficient = 0.002,
  } = {}) {
    this.dissent = dissent || new ConciliarDissent();
    this.coefficient = coefficient;
  }

  /**
   * Свидетельствовать о акте: собрать голоса и вычислить Δ явленности.
   *
   * @param {object} act — { id, giver, receiver, weight, content, ... }
   * @param {Array}  voices — { persona, logos: 'kata'|'para'|'hyper', content }
   * @returns {Promise<WitnessResult>}
   */
  async witness(act, voices) {
    if (!act || act.weight == null) {
      throw new Error('ConciliarWitness.witness: акт с weight обязателен');
    }

    const polyphony = await this.dissent.assemble(voices);
    if (polyphony.silent) {
      return {
        acted: false,
        reason: polyphony.silenceReason || 'собор молчит',
        polyphony,
      };
    }

    // Δ явленности: hyper-голоса повышают, kata — понижают, para — нейтрализуют.
    let delta = 0;
    const logosSign = { hyper: +1, kata: -1, para: 0 };
    for (const v of polyphony.voices) {
      delta += (logosSign[v.logos] || 0) * v.authority * this.coefficient;
    }

    // Ограничиваем сдвиг: явленность не может уйти отрицательной
    // и не может быть безгранично больше веса (иначе симуляция Суда).
    // Разумный предел — ×3 от веса (трёхкратное «явление больше сущности»).
    const w = Number(act.weight) || 0;
    let manifestedness = w + delta;
    manifestedness = Math.max(0, Math.min(w * 3 + 1, manifestedness));

    const actId = act.id || act.actId || `${act.giver}→${act.receiver}:${act.content || ''}`;

    const slava = await loadSlava();
    slava.manifestedness[actId] = Number(manifestedness.toFixed(3));
    slava.witnesses.push({
      actId,
      at: new Date().toISOString(),
      weight: w,
      manifestedness: slava.manifestedness[actId],
      delta: Number(delta.toFixed(3)),
      voices: polyphony.voices.map(v => ({
        persona: v.persona, logos: v.logos, authority: v.authority,
      })),
      apophatic: polyphony.apophatic,
    });
    // Храним только последние 500 свидетельств — чтобы журнал не распухал
    if (slava.witnesses.length > 500) {
      slava.witnesses = slava.witnesses.slice(-500);
    }
    await saveSlava(slava);

    return {
      acted: true,
      actId,
      weight: w,
      manifestedness: slava.manifestedness[actId],
      delta: Number(delta.toFixed(3)),
      conscience: Math.abs(slava.manifestedness[actId] - w),
      polyphony,
    };
  }

  /**
   * Прочитать запись W_slava для акта.
   */
  async read(actId) {
    const slava = await loadSlava();
    const m = slava.manifestedness[actId];
    return m == null ? null : {
      actId,
      manifestedness: m,
      witnesses: slava.witnesses.filter(w => w.actId === actId),
    };
  }

  /**
   * Очистить W_slava (для тестов). В проде не используется.
   */
  async _clearForTests() {
    await saveSlava({
      _comment: 'cleared for tests',
      manifestedness: {},
      witnesses: [],
    });
  }
}

export default ConciliarWitness;
