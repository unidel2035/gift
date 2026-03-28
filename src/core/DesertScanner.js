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
 */

export class DesertScanner {
  /**
   * @param {import('./GiftMemory.js').GiftMemory} memory — живая матрица W
   * @param {object} options
   * @param {number}   [options.intervalMs=60000]  — период сканирования (мс)
   * @param {number}   [options.threshold=0]       — порог «пустыни» (W[i][j] ≤ threshold)
   * @param {Function} [options.onDesert]          — колбэк при обнаружении пустынь
   */
  constructor(memory, options = {}) {
    this.memory      = memory;
    this.intervalMs  = options.intervalMs ?? 60_000;
    this.threshold   = options.threshold  ?? 0;
    this.onDesert    = options.onDesert   ?? null;

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
        // thread() корректно маршрутизирует: W / energeia / doxologia / theophaneia
        const w = this.memory.thread(all[i], all[j]);
        if (w <= this.threshold) {
          deserts.push({
            from:      all[i],
            to:        all[j],
            inquiry:   this._inquire(all[i], all[j]),
            scannedAt: now,
          });
        }
      }
    }

    this._inquiries = deserts;
    return deserts;
  }

  /**
   * _inquire(from, to) — породить вопрошание для пустыни.
   *
   * Вопрос — не обвинение. Вопрос — ожидание.
   * «Что мешает потоку?» — не «почему нет?»
   */
  _inquire(from, to) {
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
