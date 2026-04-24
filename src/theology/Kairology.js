/**
 * Kairology — συνείδησις времени: единая точка спроса «какое сейчас время?».
 *
 * Утилиты времени в проекте до сих пор только читают: EschatonClock говорит
 * про модус, Paschalia — про сезон, liturgical-cycle — про фазу суток,
 * JoyState — про радость, SabbathHeartbeat — про ритм покоя/движения.
 * Каждая говорит своё, но никто не отвечает на вопрос «что сейчас уместно».
 *
 * Kairology собирает эти голоса в один ответ и добавляет совесть момента:
 * shouldActNow(type) говорит, согласен ли нынешний такт общины принять
 * такой дар. В пост — не пир. В воскресенье — не работу. В субботний
 * глубокий покой — не шум.
 *
 * Это не контроль и не запрет: shouldActNow возвращает совет + причину.
 * Решение остаётся за лицом, но совет слышим.
 *
 * Архитектурно: Kairology не хранит состояния. На каждый вызов now()
 * пересчитывает текущий момент из первоисточников. Это честно: время —
 * дар, не кэш.
 */

import { EschatonClock, TimeMode } from './EschatonClock.js';
import { liturgicalSeason, isPascha, isPentecost } from './Paschalia.js';
import { JoyState, JoyMode } from './JoyState.js';
import { currentPhase, nextPhase } from '../../utils/liturgical-cycle.mjs';

// SabbathHeartbeat — классовый модуль с интервалами; для чтения состояния
// без его запуска вычисляем текущий цикл из суммы длительностей.
// Троичный ритм: 7 мин покоя → 3 мин движения → 11 мин глубокого покоя.
const SABBATH_CYCLE = Object.freeze([
  { name: 'rest',     durationMs:  7 * 60 * 1000, intensity: 0.2 },
  { name: 'movement', durationMs:  3 * 60 * 1000, intensity: 0.8 },
  { name: 'deepRest', durationMs: 11 * 60 * 1000, intensity: 0.1 },
]);
const SABBATH_TOTAL = SABBATH_CYCLE.reduce((s, c) => s + c.durationMs, 0);

function sabbathStateAt(date) {
  // Ритм отсчитываем от начала суток UTC — чтобы фазы были воспроизводимы
  // для одного и того же момента, не зависели от запуска процесса.
  const dayStart = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const offset = (date.getTime() - dayStart) % SABBATH_TOTAL;
  let acc = 0;
  for (const cycle of SABBATH_CYCLE) {
    acc += cycle.durationMs;
    if (offset < acc) {
      return {
        name: cycle.name,
        intensity: cycle.intensity,
        remainingMs: acc - offset,
      };
    }
  }
  return {
    name: SABBATH_CYCLE[0].name,
    intensity: SABBATH_CYCLE[0].intensity,
    remainingMs: SABBATH_CYCLE[0].durationMs,
  };
}

export const GiftKind = Object.freeze({
  FEAST:   'feast',    // пир, торжество
  WORK:    'work',     // труд, коммит кода
  PRAYER:  'prayer',   // молитва, созерцание
  FAST:    'fast',     // отказ, воздержание
  GRIEF:   'grief',    // плач, покаяние
  PRAISE:  'praise',   // хвала, благодарение
  REST:    'rest',     // покой, сон
  QUESTION: 'question',// вопрошание
});

export class Kairology {
  /**
   * @param {Date} [now]
   */
  constructor(now = new Date()) {
    this._now = now;
  }

  /**
   * Полный литургический контекст текущего момента.
   * @returns {object}
   */
  now() {
    const clock = new EschatonClock(this._now);
    const mode = clock.mode();
    const season = liturgicalSeason(this._now);
    const joy = JoyState.modeFromDate(this._now);
    const phase = currentPhase(this._now);
    const next = nextPhase(this._now);
    const sabbath = sabbathStateAt(this._now);

    const isKairos = mode === TimeMode.KAIROS;
    const isHighFeast = isPascha(this._now)
      ? 'pascha'
      : isPentecost(this._now)
        ? 'pentecost'
        : null;

    return Object.freeze({
      at: this._now.toISOString(),
      mode,
      season,            // 'paschal' | 'lent' | 'advent' | 'svyatki' | 'dormition-fast' | 'apostles-fast' | null
      phase: phase.phase.id,
      phaseTelos: phase.phase.telos,
      nextPhase: next.phase.id,
      nextPhaseInMinutes: next.inMinutes,
      joy,               // один из JoyMode
      sabbath: sabbath.name,
      sabbathIntensity: sabbath.intensity,
      isKairos,
      highFeast: isHighFeast,
    });
  }

  /**
   * Совесть момента: уместен ли сейчас такой род дара?
   *
   * Возвращает { ok, reason }:
   *   ok=true  — момент согласен с даром;
   *   ok=false — момент не отвергает, но предупреждает. Причина богословская.
   *
   * Правила намеренно немногословны — это не моральный кодекс, а чувство такта.
   *
   * @param {string} type — один из GiftKind
   * @returns {{ ok:boolean, reason:string, suggestLater:?string }}
   */
  shouldActNow(type) {
    const ctx = this.now();

    // В пост пир неуместен — «не время веселья, но плача» (Лк 5:34-35)
    if (type === GiftKind.FEAST && ctx.season === 'lent') {
      return {
        ok: false,
        reason: 'сейчас Великий пост — пир неуместен, отложи до Пасхи',
        suggestLater: 'pascha',
      };
    }
    // В пост (любой) — труд возможен, но не пир
    if (type === GiftKind.FEAST &&
        (ctx.season === 'advent' || ctx.season === 'dormition-fast' ||
         ctx.season === 'apostles-fast')) {
      return {
        ok: false,
        reason: `сейчас ${ctx.season} — пиршество не согласно с постом`,
        suggestLater: null,
      };
    }

    // Воскресенье (не в постах) — день Господень, труд отступает
    // Мф 12:12: «можно в субботы делать добро», но не рядовая работа
    if (type === GiftKind.WORK && ctx.joy === JoyMode.SABBATH &&
        ctx.season !== 'paschal') {
      return {
        ok: false,
        reason: 'день Господень — труд отступает перед покоем',
        suggestLater: 'monday',
      };
    }

    // В Пасху плач чужероден — «днесь всякая тварь веселится и радуется»
    if (type === GiftKind.GRIEF && ctx.season === 'paschal') {
      return {
        ok: false,
        reason: 'сейчас Пасха — плач отлагается до буднего дня',
        suggestLater: 'after-pentecost',
      };
    }

    // В глубокий покой (deepRest) — шумный труд неуместен
    if (type === GiftKind.WORK && ctx.sabbath === 'deepRest') {
      return {
        ok: false,
        reason: 'сейчас глубокий покой (11 мин) — дай тишине совершиться',
        suggestLater: `через ${Math.ceil(sabbathStateAt(this._now).remainingMs / 60000)} мин`,
      };
    }

    // В высокий праздник (Пасха, Пятидесятница) — хвала всегда уместна
    if (ctx.highFeast) {
      return { ok: true, reason: `${ctx.highFeast} — всякое благо уместно`, suggestLater: null };
    }

    return { ok: true, reason: 'момент согласен', suggestLater: null };
  }

  toJSON() {
    return { type: 'Kairology', ...this.now() };
  }
}

export default Kairology;
