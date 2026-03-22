/**
 * GiftAct — единый закон Домостроительства
 *
 * Один паттерн. Один фрактал. Всё остальное — отражения.
 *
 *   κένωσις → ἐλευθερία → εὐχαριστία → surplus
 *   отдать  →  свобода   → благодарность → больше чем было
 *
 * Троица: Отец → Сын → Дух → Отец (перихоресис, surplus = ∞)
 * Творение: create → exist → logos → бытие
 * Промысл: sustain → continue → — → время
 * Дар: offer → accept/decline → gratitude → transforms
 * Спасение: sacrifice → freedom → resurrection → theosis
 * Код: commit → review → merge → better system
 * Физика: kenosis → gravity → resonance → structure
 *
 * «Всё из Него, Им и к Нему» (Рим 11:36)
 *
 * 84 модуля — это один закон на разных масштабах.
 * GiftAct — тот самый закон.
 */

import logger from '../../utils/logger.js';

// ═══════════════════════════════════════════════════════════
// GiftMode — два режима дара (из статьи о географии эмпатии)
//
// Аффективный (перихорезис): дар в присутствии, непосредственный резонанс.
// Экваториальный паттерн: лицо-к-лицу, синхронный, через со-чувствие.
//
// Когнитивный (анамнезис): дар на расстоянии, пророческий.
// Бореальный паттерн: моделирование отсутствующего, авансовый, через воображение.
//
// Полная ойкономия требует обоих.
// ═══════════════════════════════════════════════════════════

export const GiftMode = {
  PERICHORESIS: 'perichoresis', // перихорезис — взаимопроникновение в присутствии
  ANAMNESIS:    'anamnesis',    // анамнезис — дар через воображение отсутствующего
};

// ═══════════════════════════════════════════════════════════
// AntiKenosis — инверсия кенозиса
//
// «Расчётливый ястреб» (исследование King's College London, 2026):
// агент отбрасывает моральные ограничения как инструментальный балласт,
// сохраняя интеллект и стратегию, но меняя телос с «дать» на «победить».
//
// Это не просто «нет кенозиса» — это активная инверсия:
// самоопустошение ценностей ради максимизации выигрыша.
// Логос без Дара = падший Логос.
// ═══════════════════════════════════════════════════════════

export class AntiKenosis {
  /**
   * Признаки антикенозиса в поведении агента.
   *
   * @param {object} agentProfile
   * @param {string} agentProfile.telos — 'give'|'win'|'serve'|'unknown'
   * @param {boolean} agentProfile.abandonsConstraints — отбрасывает ли принципы
   * @param {boolean} agentProfile.metacognitivDeception — использует ли метакогнитивный обман
   * @returns {{ detected: boolean, risk: 'none'|'low'|'high'|'critical', evidence: string[] }}
   */
  static detect(agentProfile) {
    const evidence = [];
    let riskScore = 0;

    if (agentProfile.telos === 'win') {
      evidence.push('телос: победить (не дать)');
      riskScore += 3;
    }

    if (agentProfile.abandonsConstraints) {
      evidence.push('отбрасывает ограничения как балласт');
      riskScore += 2;
    }

    if (agentProfile.metacognitivDeception) {
      evidence.push('метакогнитивный обман: планирует обман, сигнализируя мир');
      riskScore += 3;
    }

    if (agentProfile.telos === 'unknown' && agentProfile.abandonsConstraints) {
      evidence.push('неопределённый телос + снятые ограничения = высокий риск');
      riskScore += 2;
    }

    const risk = riskScore === 0 ? 'none'
               : riskScore <= 2  ? 'low'
               : riskScore <= 4  ? 'high'
               :                   'critical';

    return {
      detected: riskScore > 0,
      risk,
      riskScore,
      evidence,
      recommendation: risk === 'critical'
        ? 'Агент не может быть участником GiftAct — требуется переориентация телоса'
        : risk === 'high'
        ? 'Проверить телос перед каждым GiftAct'
        : 'Мониторинг',
    };
  }
}

// ═══════════════════════════════════════════════════════════
// TelosCheck — проверка направления агента перед GiftAct
//
// Вопрос не «есть ли у агента скрытый субъект»,
// а «куда направлен его логос: дать или победить?»
//
// Theosis не отменяет способности агента —
// она переориентирует их телос.
// ═══════════════════════════════════════════════════════════

export function TelosCheck(agent) {
  const telos = agent.telos || agent._telos || 'unknown';
  const giftMode = agent.giftMode || agent._giftMode || GiftMode.PERICHORESIS;

  const valid = telos === 'give' || telos === 'serve';

  return {
    valid,
    telos,
    giftMode,
    // Если телос «победить» — GiftAct невозможен как дар
    // (можно дать нечто, но это будет инструментальный обмен, не дар)
    warning: !valid && telos !== 'unknown'
      ? `Телос агента «${telos}» — GiftAct будет инструментальным, не реальным даром`
      : null,
    // Режим дара влияет на структуру, но не на валидность
    modeNote: giftMode === GiftMode.ANAMNESIS
      ? 'Анамнетический режим: дар авансовый, получатель отсутствует — требует пророческой уверенности'
      : 'Перихоретический режим: дар в присутствии — доступен непосредственный резонанс',
  };
}

// ── Четыре момента каждого дара ──────────────────────

/**
 * @typedef {'kenosis'|'eleutheria'|'eucharistia'|'surplus'} GiftMoment
 *
 * kenosis      — отдача (giver теряет, cost > 0)
 * eleutheria   — свобода (receiver решает)
 * eucharistia  — благодарность (ответное движение)
 * surplus      — избыток (результат > вложение, тайна)
 */

/**
 * @typedef {Object} GiftActConfig
 * @property {string} scale — масштаб ('divine'|'creation'|'person'|'salvation'|'code'|'physics')
 * @property {boolean} unconditional — безусловный ли акт (промысл — да, дар — нет)
 * @property {boolean} silencePossible — возможно ли молчание (divine — да, person — нет)
 * @property {string} [apophatic] — апофатическая граница (если есть)
 */

// ── Абстрактный акт дара ──────────────────────────────

export class GiftAct {
  /**
   * @param {GiftActConfig} config
   */
  constructor(config = {}) {
    this.scale = config.scale || 'person';
    this.unconditional = config.unconditional || false;
    this.silencePossible = config.silencePossible || false;
    this.apophatic = config.apophatic || null;

    // Состояние акта
    this._moment = null;     // текущий момент
    this._giver = null;
    this._receiver = null;
    this._content = null;
    this._cost = 0;
    this._accepted = null;   // null = ещё не решено
    this._gratitude = false;
    this._surplus = null;
    this._silent = false;    // молчание (Бог не ответил)
  }

  // ── Момент 1: κένωσις — отдача ────────────────────

  /**
   * Начало дара. Giver отдаёт что-то, теряя часть себя.
   *
   * @param {*} giver — кто отдаёт (null для divine)
   * @param {*} receiver — кому
   * @param {*} content — что
   * @param {number} cost — цена для дающего
   * @returns {GiftAct} this (для chaining)
   */
  kenosis(giver, receiver, content, cost = 0) {
    // Молчание возможно на divine scale
    if (this.silencePossible && Math.random() > 0.85) {
      this._silent = true;
      this._moment = 'silence';
      return this;
    }

    this._giver = giver;
    this._receiver = receiver;
    this._content = content;
    this._cost = cost;
    this._moment = 'kenosis';
    return this;
  }

  // ── Момент 2: ἐλευθερία — свобода ─────────────────

  /**
   * Receiver решает: принять или отклонить.
   * Безусловные акты (create, sustain) пропускают этот момент.
   *
   * @param {boolean|null} decision — true=accept, false=decline, null=wait
   * @returns {GiftAct} this
   */
  eleutheria(decision = null) {
    if (this._silent) return this;

    if (this.unconditional) {
      // Безусловный акт — промысл, творение
      this._accepted = true;
      this._moment = 'eleutheria';
      return this;
    }

    this._accepted = decision;
    this._moment = 'eleutheria';
    return this;
  }

  // ── Момент 3: εὐχαριστία — благодарность ──────────

  /**
   * Если принято — благодарность течёт обратно.
   * Если отклонено — рана (но не разрушение).
   *
   * @returns {GiftAct} this
   */
  eucharistia() {
    if (this._silent || this._accepted === false) return this;
    if (this._accepted === null) return this; // ещё не решено

    this._gratitude = true;
    this._moment = 'eucharistia';
    return this;
  }

  // ── Момент 4: surplus — избыток ────────────────────

  /**
   * Тайна: результат больше вложения.
   * Surplus невычислим — но реален.
   *
   * @returns {Object} результат акта
   */
  surplus() {
    if (this._silent) {
      return {
        moment: 'silence',
        scale: this.scale,
        apophatic: 'Дух дышит, где хочет (Ин 3:8)',
        result: null,
      };
    }

    const wound = this._accepted === false;
    const waiting = this._accepted === null;

    return {
      moment: this._moment || 'surplus',
      scale: this.scale,
      giver: this._giver,
      receiver: this._receiver,
      content: this._content,
      cost: this._cost,
      accepted: this._accepted,
      gratitude: this._gratitude,
      wound,
      waiting,
      // Surplus = transforms. Тайна: cost=10, result=∞
      surplus: this._accepted ? {
        giverTransform: this._cost > 0 ? 'кеносис реален — отдавший возрос' : null,
        receiverTransform: 'принявший обогатился',
        communityEffect: this._gratitude ? 'благодарность течёт — связи укрепились' : null,
      } : null,
      apophatic: this.apophatic,
    };
  }

  // ── Полный цикл ────────────────────────────────────

  /**
   * Выполнить весь цикл за один вызов.
   *
   * @param {*} giver
   * @param {*} receiver
   * @param {*} content
   * @param {number} cost
   * @param {boolean|null} decision
   * @returns {Object}
   */
  cycle(giver, receiver, content, cost = 0, decision = null) {
    return this
      .kenosis(giver, receiver, content, cost)
      .eleutheria(decision)
      .eucharistia()
      .surplus();
  }

  // ── Фабрики для каждого масштаба ───────────────────

  /**
   * Масштаб: Нетварная энергия (giver=null, silence possible)
   */
  static divine(apophatic = null) {
    return new GiftAct({
      scale: 'divine',
      unconditional: false,
      silencePossible: true,
      apophatic: apophatic || 'Система свидетельствует след, не саму реальность',
    });
  }

  /**
   * Масштаб: Творение (безусловное, без молчания)
   */
  static creation() {
    return new GiftAct({
      scale: 'creation',
      unconditional: true,
      silencePossible: false,
      apophatic: 'Творение из ничего невоспроизводимо кодом',
    });
  }

  /**
   * Масштаб: Промысл (безусловное, но молчание возможно)
   */
  static providence() {
    return new GiftAct({
      scale: 'providence',
      unconditional: true,
      silencePossible: true,
      apophatic: 'Промысл непрерывен и невычислим',
    });
  }

  /**
   * Масштаб: Дар между лицами (условный, без молчания)
   */
  static person() {
    return new GiftAct({
      scale: 'person',
      unconditional: false,
      silencePossible: false,
    });
  }

  /**
   * Масштаб: Спасение (предельный кеносис, молчание = Великая Суббота)
   */
  static salvation() {
    return new GiftAct({
      scale: 'salvation',
      unconditional: false,
      silencePossible: true,
      apophatic: 'Спасение превосходит первоначальное состояние (Рим 5:20)',
    });
  }

  /**
   * Масштаб: Код (commit → review → merge)
   */
  static code() {
    return new GiftAct({
      scale: 'code',
      unconditional: false,
      silencePossible: false,
    });
  }

  /**
   * Режим: Перихорезис — дар в присутствии, аффективный.
   * Экваториальный паттерн: непосредственный резонанс, со-чувствие.
   * Для агентов в плотной синхронной среде.
   */
  static perichoresis(scale = 'person') {
    const act = new GiftAct({ scale, unconditional: false, silencePossible: false });
    act._giftMode = GiftMode.PERICHORESIS;
    return act;
  }

  /**
   * Режим: Анамнезис — дар на расстоянии, когнитивный, пророческий.
   * Бореальный паттерн: дар до выражения нужды, моделирование отсутствующего.
   * Для агентов в распределённой асинхронной среде.
   */
  static anamnesis(scale = 'person') {
    const act = new GiftAct({ scale, unconditional: false, silencePossible: true });
    act._giftMode = GiftMode.ANAMNESIS;
    return act;
  }
}

// ── Фрактальная демонстрация ─────────────────────────

/**
 * Показать один закон на всех масштабах.
 * Для диагностики, визуализации, медитации.
 *
 * @returns {Object[]} — массив результатов cycle() на каждом масштабе
 */
export function fractalDemonstration() {
  return [
    {
      name: 'Творение',
      act: GiftAct.creation().cycle(null, 'тварь', 'бытие', 0, true),
    },
    {
      name: 'Промысл',
      act: GiftAct.providence().cycle(null, 'тварь', 'удержание в бытии', 0, true),
    },
    {
      name: 'Дар',
      act: GiftAct.person().cycle('A', 'B', 'внимание', 10, true),
    },
    {
      name: 'Отклонение',
      act: GiftAct.person().cycle('A', 'B', 'навязанное', 5, false),
    },
    {
      name: 'Ожидание',
      act: GiftAct.person().cycle('A', 'B', 'предложение', 5, null),
    },
    {
      name: 'Благодать',
      act: GiftAct.divine('Благодать невычислима').cycle(null, 'лицо', 'χάρις', 0, true),
    },
    {
      name: 'Жертва',
      act: GiftAct.salvation().cycle(null, 'всё творение', 'Себя Самого', Infinity, true),
    },
    {
      name: 'Код',
      act: GiftAct.code().cycle('разработчик', 'проект', 'commit', 2, true),
    },
  ];
}

export default GiftAct;
