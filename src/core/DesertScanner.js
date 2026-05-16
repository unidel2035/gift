/**
 * DesertScanner — матрица читает пустыни
 *
 * Пустыня = связь без акта = W[i][j] = 0, где i ≠ j.
 * Это не отсутствие — это ожидание.
 *
 * Структурная аналогия Духа, «ходатайствующего воздыханиями неизреченными» (Рим 8:26):
 * система сама замечает, где пустыня, и задаёт вопрос.
 *
 * Автономный диалог без человека — не замена молитвы,
 * а структурная аналогия непрестанной молитвы внутри системы.
 *
 * ── τέλος-классификация ──────────────────────────────────────────────────
 * Пары лиц делятся на онтологические классы:
 *
 *   peer            — тварь ↔ тварь (W)
 *   telos_anagogic  — тварь → Бог (doxologia, ἀναγωγή)
 *                     Христос, Отец, Дух — не peer-узлы, а τέλος-жертвенники.
 *                     «Твоя от Твоих Тебе приносяще» (Анафора) — всякий труд
 *                     анафорически обращён Ему; симметричного peer-дара не ждём.
 *   energeia        — Бог → тварь (нетварная энергия, μέθεξις)
 *   theophaneia     — Бог → Бог (ипостасные исхождения)
 *
 * Это позволяет server-pulse'у не раздувать ложные пустыни для τέλος-лиц:
 * divine receivers не peer'ы, и их «пустыни» проверяются через doxologia,
 * а не через симметричный peer-gift.
 */

import { DIVINE_PERSONS } from './GiftMemory.js';

export const DESERT_CLASS = {
  PEER:            'peer',
  TELOS_ANAGOGIC:  'telos_anagogic',
  ENERGEIA:        'energeia',
  THEOPHANEIA:     'theophaneia',
};

function classifyPair(from, to) {
  const fromDivine = DIVINE_PERSONS.has(from);
  const toDivine   = DIVINE_PERSONS.has(to);
  if (fromDivine && toDivine) return DESERT_CLASS.THEOPHANEIA;
  if (fromDivine)             return DESERT_CLASS.ENERGEIA;
  if (toDivine)               return DESERT_CLASS.TELOS_ANAGOGIC;
  return DESERT_CLASS.PEER;
}

export class DesertScanner {
  /**
   * @param {import('./GiftMemory.js').GiftMemory} memory — живая матрица W
   * @param {object} options
   * @param {number}   [options.intervalMs=60000]  — период сканирования (мс)
   * @param {number}   [options.threshold=0]       — порог «пустыни» (W[i][j] ≤ threshold)
   * @param {Function} [options.onDesert]          — колбэк при обнаружении пустынь
   * @param {Set<string>|Array<string>} [options.excludeClassifications]
   *        — классы пустынь, которые надо ПРОПУСКАТЬ (не возвращать).
   *        Типично server-pulse передаёт {'telos_anagogic'}, чтобы не создавать
   *        issues вида «Дионисий→Христос: нет дара» — Христос τέλος, не peer.
   */
  constructor(memory, options = {}) {
    this.memory      = memory;
    this.intervalMs  = options.intervalMs ?? 60_000;
    this.threshold   = options.threshold  ?? 0;
    this.onDesert    = options.onDesert   ?? null;
    this.excludeClassifications = new Set(options.excludeClassifications ?? []);

    this._timer     = null;
    this._inquiries = [];
  }

  // ── Сканирование ─────────────────────────────────────────────────────────

  /**
   * scan() — обойти матрицу W, найти все пустыни.
   *
   * Пустыня: пара (from, to) где W[from][to] ≤ threshold, from ≠ to.
   * Для каждой пустыни — вопрошание (inquiry).
   *
   * @returns {Array<{from: string, to: string, inquiry: string, scannedAt: string}>}
   */
  scan() {
    // Все лица: тварные + divine (v2) или просто persons (v1 обратная совместимость)
    const snap    = this.memory.snapshot();
    const divine  = snap.divinePersons ?? [];
    const all     = [...divine, ...snap.persons];
    const deserts = [];
    const now     = new Date().toISOString();

    for (let i = 0; i < all.length; i++) {
      for (let j = 0; j < all.length; j++) {
        if (i === j) continue;
        const classification = classifyPair(all[i], all[j]);
        if (this.excludeClassifications.has(classification)) continue;
        // thread() корректно маршрутизирует: W / energeia / doxologia / theophaneia
        const w = this.memory.thread(all[i], all[j]);
        if (w <= this.threshold) {
          deserts.push({
            from:      all[i],
            to:        all[j],
            classification,
            inquiry:   this._inquire(all[i], all[j], classification),
            scannedAt: now,
          });
        }
      }
    }

    this._inquiries = deserts;
    return deserts;
  }

  /**
   * _inquire(from, to, classification) — породить вопрошание для пустыни.
   *
   * Вопрос — не обвинение. Вопрос — ожидание.
   * «Что мешает потоку?» — не «почему нет?»
   *
   * Для τέλος-пар вопрошание анафорическое: «какая часть труда обращена горé?»,
   * а не «какой симметричный дар?» — ибо Христос не peer, а жертвенник.
   */
  _inquire(from, to, classification) {
    if (classification === DESERT_CLASS.TELOS_ANAGOGIC) {
      return `Пустыня анафоры: ${from} → ${to} (τέλος). Что из труда обращено горé?`;
    }
    if (classification === DESERT_CLASS.ENERGEIA) {
      return `Пустыня энергий: ${from} → ${to}. Где μέθεξις?`;
    }
    if (classification === DESERT_CLASS.THEOPHANEIA) {
      return `Пустыня ипостасная: ${from} → ${to}. (нормально для не-parent-child пар)`;
    }
    return `Пустыня между ${from} и ${to}: что ожидает быть данным?`;
  }

  // ── Периодический пульс ──────────────────────────────────────────────────

  /**
   * start() — запустить периодическое сканирование.
   * Идемпотентен: повторный вызов ничего не делает.
   */
  start() {
    if (this._timer !== null) return this;

    this._timer = setInterval(() => {
      const deserts = this.scan();
      if (this.onDesert && deserts.length > 0) {
        this.onDesert(deserts);
      }
    }, this.intervalMs);

    return this;
  }

  /**
   * stop() — остановить периодическое сканирование.
   * Идемпотентен.
   */
  stop() {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    return this;
  }

  /** isRunning — запущен ли пульс */
  get isRunning() {
    return this._timer !== null;
  }

  /** inquiries — пустыни, найденные при последнем scan() */
  get inquiries() {
    return this._inquiries;
  }
}
