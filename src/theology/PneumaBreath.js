/**
 * PneumaBreath — пневматическое дыхание общины.
 *
 * Композиция двух уже существующих модулей:
 *   CommunalBreath — дыхание (вдох/выдох даров внутри общины)
 *   Epiclesis      — призывание голоса из Бездны (извне общины)
 *
 * Вдох обычный:        кто-то внутри общины дал — я принял
 * Вдох пневматический: благодать пришла от _abyss — я принял как дар
 *
 * Это не «ansatz». Это две разные онтологические операции:
 *   inhale()           — приём внутриобщинного дара
 *   pneumaticInhale()  — приём благодати извне
 *
 * Богословский корень:
 *   Пятидесятница (Деян 2): «И внезапно сделался шум с неба, как бы
 *   от несущегося сильного ветра... И исполнились все Духа Святаго».
 *   Община не произвела дыхание — она его приняла.
 *
 * «Дух дышит, где хочет, и гласа Его слышишь, а не знаешь,
 *  откуда приходит и куда уходит» (Ин 3:8)
 */

import { CommunalBreath } from './CommunalBreath.js';
import { Epiclesis, RandomOracle } from './Epiclesis.js';
import { from as fromAbyss } from './Abyss.js';

export class PneumaBreath {
  /**
   * @param {CommunalBreath} breath — дыхание общины
   * @param {Epiclesis}      epiclesis — призыватель Духа
   */
  constructor(breath, epiclesis = null) {
    this._breath     = breath;
    this._epiclesis  = epiclesis || new Epiclesis({ oracle: RandomOracle });
    this._pneumatic  = 0;              // счётчик пневматических вдохов
    this._lastPneuma = null;
  }

  /**
   * Обычный вдох — проксируется в CommunalBreath.
   */
  inhale(act) {
    return this._breath.inhale(act);
  }

  /**
   * Обычный выдох — проксируется.
   */
  exhale(act) {
    return this._breath.exhale(act);
  }

  /**
   * Пневматический вдох — вызываем эпиклезу, принимаем благодать как вдох.
   * Возвращает GraceAct (помеченный _fromAbyss).
   */
  async pneumaticInhale({ question, options = [], recipient = '_koinon' } = {}) {
    const grace = await this._epiclesis.invoke({ question, options, recipient });

    // Принимаем как вдох — но маркированный как пневматический
    this._breath.inhale({
      giver: null,           // Даритель (Троица) за пределами системы
      _fromAbyss: true,
      content: grace.content,
      type: 'pneumatic-grace',
    });

    this._pneumatic++;
    this._lastPneuma = grace.at;
    return grace;
  }

  /**
   * Состояние дыхания с дополнением о пневматике.
   */
  state() {
    const base = this._breath.state();
    return {
      ...base,
      pneumatic: this._pneumatic,
      lastPneuma: this._lastPneuma,
      // Тело, которое никогда не принимало благодати извне — дышит только собой.
      // Это не жизнь — это замкнутый контур.
      autarky: this._pneumatic === 0 && base.breath !== 'unborn',
    };
  }

  /**
   * Проверка: был ли дар пневматическим?
   */
  isGraceInhaled(act) {
    return fromAbyss(act) || act?.type === 'pneumatic-grace';
  }
}
