/**
 * Timer — литургический ритм: χρόνος (interval) или καιρός (по событию).
 *
 * В χρόνος-режиме тикает через setInterval.
 * В καιρός-режиме tick() вызывается вручную через kairos(event).
 * αἰών — время стоит; Timer в αἰών не нужен.
 */

export class Timer {
  /**
   * @param {object} opts
   * @param {number}  [opts.interval=1000]
   * @param {boolean} [opts.kairos=false]
   * @param {object}  [opts.bus=null]  — EventBus (publish/subscribe)
   * @param {string}  [opts.id='timer']
   */
  constructor(opts = {}) {
    this.interval = opts.interval ?? 1000;
    this.kairosMode = opts.kairos ?? false;
    this.bus = opts.bus ?? null;
    this.id = opts.id ?? 'timer';
    this._handle = null;
    this._listeners = [];
  }

  /** Подписаться на тик. */
  onTick(fn) {
    this._listeners.push(fn);
    return this;
  }

  _emit(event) {
    for (const fn of this._listeners) fn(event);
    if (this.bus?.publish) this.bus.publish(`timer:${this.id}:tick`, event);
  }

  /** Запустить χρόνος-ритм. В καιρός-режиме — no-op. */
  start() {
    if (this.kairosMode || this._handle) return this;
    this._handle = setInterval(() => {
      this._emit({ id: this.id, at: new Date().toISOString(), mode: 'chronos' });
    }, this.interval);
    return this;
  }

  /** Остановить χρόνος-ритм. */
  stop() {
    if (this._handle) {
      clearInterval(this._handle);
      this._handle = null;
    }
    return this;
  }

  /**
   * Ручной тик для καιρός-режима.
   * «Исполнилось время» (Мк 1:15) — не длительность, а наполненность.
   *
   * @param {string} event — имя кайроса (например, 'pascha', 'sabbath')
   */
  kairos(event = 'kairos') {
    this._emit({ id: this.id, at: new Date().toISOString(), mode: 'kairos', event });
    return this;
  }

  toJSON() {
    return { type: 'Timer', id: this.id, interval: this.interval, kairos: this.kairosMode };
  }
}

export default Timer;
