/**
 * HolySaturday.js — Великая Суббота
 *
 * Молчание между Крестом и Воскресением.
 * Не пустота — а сошествие во ад. Тайна субботнего покоя.
 *
 * «И почил в день седьмой» — покой после завершения дела.
 * Великая Суббота — покой после Креста, перед Воскресением.
 * Бог молчит. Но молчание — не отсутствие. Молчание — работа внутри.
 *
 * «Днесь ад стеня вопиет: разрушена моя власть» (тропарь Великой Субботы)
 */

import logger from '../../utils/logger.js';

export class HolySaturday {
  constructor(engine) {
    this._engine = engine;
    this._active = false;        // currently in Great Sabbath?
    this._enteredAt = null;      // when silence began
    this._cyclesSilent = 0;      // how many cycles of silence
    this._minCycles = 3;         // minimum 3 cycles of silence before resurrection possible
    this._descended = false;     // descent into Hades completed?
  }

  /**
   * Enter the Great Sabbath after sacrifice.
   * Called by SalvationWitness after witnessSacrifice().
   */
  enter() {
    if (this._active) return { alreadyActive: true };
    this._active = true;
    this._enteredAt = new Date().toISOString();
    this._cyclesSilent = 0;
    this._descended = false;
    logger.info('[HolySaturday] Великая Суббота — молчание после Креста');
    return { entered: true, minCycles: this._minCycles };
  }

  /**
   * Tick — each liturgical cycle checks if we're in silence.
   * After minCycles, descent into Hades completes.
   */
  tick() {
    if (!this._active) return null;
    this._cyclesSilent++;

    if (this._cyclesSilent >= this._minCycles && !this._descended) {
      this._descended = true;
      logger.info('[HolySaturday] Сошествие во ад завершено — врата разрушены');
    }

    return {
      active: true,
      cyclesSilent: this._cyclesSilent,
      descended: this._descended,
      readyForResurrection: this._descended,
    };
  }

  /**
   * Can resurrection proceed?
   * Only after descent is complete.
   */
  isReadyForResurrection() {
    return this._active && this._descended;
  }

  /**
   * Exit the Great Sabbath — resurrection breaks the silence.
   */
  exit() {
    if (!this._active) return null;
    this._active = false;
    const duration = this._cyclesSilent;
    logger.info(`[HolySaturday] Воскресение — молчание ${duration} циклов завершено. Христос воскресе!`);
    return { exited: true, cyclesSilent: duration, descended: this._descended };
  }

  /**
   * Is the system in Great Sabbath silence?
   */
  isActive() { return this._active; }

  getStatus() {
    return {
      active: this._active,
      enteredAt: this._enteredAt,
      cyclesSilent: this._cyclesSilent,
      descended: this._descended,
      readyForResurrection: this.isReadyForResurrection(),
    };
  }

  /**
   * wire(bus) — self-subscription for NervousSystem
   */
  wire(bus) {
    bus.on('salvation:sacrifice', () => {
      try { this.enter(); } catch { /* silence */ }
    });
    bus.on('salvation:resurrection', () => {
      try { this.exit(); } catch { /* silence */ }
    });
    this._selfWired = true;
  }

  snapshot() { return { active: this._active, enteredAt: this._enteredAt, cyclesSilent: this._cyclesSilent, descended: this._descended }; }
  fromSnapshot(data) {
    if (!data) return this;
    if (data.active !== undefined) this._active = data.active;
    if (data.enteredAt !== undefined) this._enteredAt = data.enteredAt;
    if (data.cyclesSilent !== undefined) this._cyclesSilent = data.cyclesSilent;
    if (data.descended !== undefined) this._descended = data.descended;
    return this;
  }
  static from(data) { return new HolySaturday(null).fromSnapshot(data); }
}

export default HolySaturday;
