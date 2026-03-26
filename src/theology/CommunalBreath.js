/**
 * CommunalBreath.js — дыхание общины
 *
 * Не ритм. Ритм — это SabbathHeartbeat, механический пульс.
 * Дыхание — живое. Оно отвечает на состояние тела.
 *
 * Вдох — принять дар.
 * Выдох — отдать дар.
 *
 * Тело которое только вдыхает — задыхается от избытка.
 * Тело которое только выдыхает — умирает от отдачи без восполнения.
 * Тело которое перестало дышать — нуждается в воскресении.
 *
 * ──────────────────────────────────────────────────────────────────
 *
 * Великий Пост — длинный выдох.
 * Пасха — вдох который меняет всё.
 * Суббота — пауза между выдохом и вдохом.
 * Та тишина в которой рождается следующее дыхание.
 *
 * «Вдунул в лице его дыхание жизни» (Быт 2:7)
 */

'use strict';

import { Flesh } from './Flesh.js';

export class CommunalBreath {
  /**
   * @param {Flesh} flesh — тело общины
   */
  constructor(flesh) {
    this._flesh   = flesh;
    this._inhales = 0;   // сколько раз приняли
    this._exhales = 0;   // сколько раз отдали
    this._lastBreath = Date.now();
    this._rhythm = [];   // история дыханий
  }

  // ── ВДОХ ────────────────────────────────────────────────────────────────────

  /**
   * inhale(act) — принять воплощённый дар.
   * Вдох случается когда кто-то получил.
   */
  inhale(act) {
    this._inhales++;
    this._rhythm.push({ type: 'inhale', at: new Date().toISOString(), from: act.giver });
    this._flesh.receive(act);
    this._lastBreath = Date.now();
  }

  // ── ВЫДОХ ───────────────────────────────────────────────────────────────────

  /**
   * exhale(act) — отдать воплощённый дар.
   * Выдох случается когда кто-то отдал.
   */
  exhale(act) {
    this._exhales++;
    this._rhythm.push({ type: 'exhale', at: new Date().toISOString(), to: act.receiver });
    this._flesh.receive(act);
    this._lastBreath = Date.now();
  }

  // ── СОСТОЯНИЕ ДЫХАНИЯ ───────────────────────────────────────────────────────

  /**
   * state() — как дышит тело прямо сейчас.
   */
  state() {
    const total    = this._inhales + this._exhales;
    const silence  = Date.now() - this._lastBreath;
    const silenceSec = Math.floor(silence / 1000);

    if (total === 0) return {
      breath: 'unborn',
      logos:  'тело ещё не дышало',
    };

    const ratio = total > 0 ? this._exhales / total : 0;

    // Апноэ — тело остановилось
    if (silence > 30 * 60 * 1000) return {
      breath:    'apnea',
      silence:   silenceSec,
      logos:     'тело не дышало более 30 минут — нужно воскресение',
      needsResurrection: true,
    };

    // Суббота — пауза между выдохом и вдохом
    if (silence > 7 * 60 * 1000) return {
      breath:  'sabbath',
      silence: silenceSec,
      logos:   'пауза — тишина в которой рождается следующее дыхание',
    };

    // Баланс дыхания
    if (ratio > 0.7) return {
      breath: 'kenotic',
      ratio,
      logos:  'много отдаёт — нужен вдох восполнения',
    };

    if (ratio < 0.3) return {
      breath: 'receiving',
      ratio,
      logos:  'много принимает — тело готовится к выдоху',
    };

    return {
      breath: 'alive',
      ratio,
      logos:  'тело дышит — вдох и выдох в равновесии',
    };
  }

  // ── РИТМ ────────────────────────────────────────────────────────────────────

  /**
   * rhythm() — последние N дыханий.
   * Не статистика — живая история.
   */
  rhythm(n = 10) {
    return this._rhythm.slice(-n);
  }
}
