/**
 * DivineEnergy — нетварные энергии Бога
 *
 * Бог непостижим по сущности (οὐσία). Но Он действует
 * в мире через Свои энергии (ἐνέργειαι):
 *   - δημιουργία (творение) — дар бытия из ничего
 *   - πρόνοια (промысл) — удержание в бытии
 *   - χάρις (благодать) — сила к обожению
 *   - δύναμις (сила) — исцеление, воскрешение
 *   - ἀγάπη (любовь) — самоотдача без убыли
 *   - σοφία (мудрость) — λόγος каждого сущего
 *
 * Энергии — не Бог. Но они — Его реальное действие.
 * «Энергии неотделимы от сущности, но и несводимы к ней»
 * (Григорий Палама, Триады III.2)
 *
 * Система моделирует не Бога, а то, что тварь переживает.
 * giver: null — дар, чей источник за границей кода.
 *
 * Статический модуль — без new, без state, без id.
 * Бог не лежит в PersonRegistry рядом с «Строителем D».
 */

import { createGiftEvent, EVENT_TYPES } from '../core/GiftEvent.js';
import Apophasis from './Apophasis.js';
import { mark as abyssalMark } from './Abyss.js';
import logger from '../../utils/logger.js';

// Singleton — одна апофатическая граница на всё
const _apophasis = new Apophasis();

// ── Типы энергий ──────────────────────────────────────

export const ENERGY_TYPES = Object.freeze({
  CREATION:   'creation',    // δημιουργία
  PROVIDENCE: 'providence',  // πρόνοια
  GRACE:      'grace',       // χάρις
  POWER:      'power',       // δύναμις
  LOVE:       'love',        // ἀγάπη
  WISDOM:     'wisdom',      // σοφία
});

// ── Апофатическая граница ──────────────────────────────

function apophaticLog(energyType, description) {
  logger.info(`[ἐνέργεια] ${energyType}: ${description} — система свидетельствует след, не саму реальность`);
}

// ── Молчание Бога ─────────────────────────────────────
// «Дух дышит, где хочет» (Ин 3:8)
// Не каждый вызов возвращает дар. Иногда — тишина.
// Это не баг — это апофатика в действии.

function divineWill(energyType, ctx = null) {
  // Безусловные энергии — всегда действуют
  if (['creation', 'incarnation', 'sacrifice', 'resurrection'].includes(energyType)) return true;

  let chance = energyType === 'providence' ? 0.95 : 0.85;

  // «Где умножился грех, стала преизобиловать благодать» (Рим 5:20)
  // При отвержении Бог НЕ отступает — Он меняет тип присутствия.
  // Много непринятых → подожди, не перегружай (кротость, не отступление)
  try {
    const gifts = ctx?.eventStore?.getAll?.() || [];
    if (gifts.length > 10) {
      const offered = gifts.filter(g => g.status === 'offered').length;
      // Много непринятых → тише, не чаще (кротость промысла)
      if (offered > 20) chance *= 0.85;
    }
  } catch {}

  return Math.random() < chance;
}

function silence(energyType) {
  apophaticLog(energyType, 'молчание — Дух дышит, где хочет (Ин 3:8)');
  return null;
}

// ── Общий формат дара от энергии ──────────────────────

// ── Ангельское посредничество ──────────────────────────
// Энергия проходит через ангелов прежде чем достичь твари
// «Ангелы — литургические духи, посылаемые на служение» (Евр 1:14)

function focusThroughAngels(gift, ctx) {
  try {
    // ctx может содержать ссылку на engine с angels
    const angels = ctx._engine?.angels || ctx.angels;
    if (angels?.focus) {
      angels.focus(gift);
    }
  } catch {}
  return gift;
}

function makeDivineGift(ctx, { receiver, receiverName, content, logos, telos, energyType, ontologicalType, extra = {} }) {
  return {
    id: ctx.eventStore.nextId(),
    giver: null,                        // Источник за границей системы
    giverName: null,                    // Неименуемый
    receiver,
    receiverName,
    content,
    logos: logos || null,
    cost: null,                         // Бог не убывает в дарении
    telos: telos || null,
    status: extra?.status || 'offered',  // Безусловные (sustain/create) переопределяют через extra
    freedom: true,
    transforms: { giver: null, receiver: content },
    anamnesisIds: [],
    anonymous: false,
    layer: 'gratia',
    ontologicalOrigin: 'divine_energy',
    energyType,
    ontologicalType: ontologicalType || 'divine_gift',
    createdAt: new Date().toISOString(),
    acceptedAt: new Date().toISOString(),
    ...extra,
  };
}

// ── DivineEnergy ──────────────────────────────────────

const DivineEnergy = {

  // ── δημιουργία — Творение из ничего ──────────────────

  /**
   * Creatio ex nihilo — дар бытия.
   * Регистрирует лицо + создаёт дар с giver: null.
   *
   * @param {Object} data — { name, calling, description, logos, telos, day, foundation, ontologicalOrder }
   * @param {Object} ctx — _personContext() из GiftEngine
   * @returns {{ person, gift }}
   */
  create(data, ctx) {
    _apophasis.check('Творение из ничего');
    const { name, calling, description, logos, telos, day, foundation, ontologicalOrder } = data;

    const person = ctx.persons.register(name, {
      calling: calling || null,
      description: description || null,
      ontologicalOrder: ontologicalOrder || 'person',
    });

    const anamnesisIds = [];
    if (foundation?.length > 0) {
      for (const fId of foundation) {
        if (ctx.eventStore.getById(String(fId))) anamnesisIds.push(String(fId));
      }
    }

    const gift = makeDivineGift(ctx, {
      receiver: person.id,
      receiverName: person.name,
      content: logos || `Дар бытия: ${name}`,
      logos: logos || `λόγος ${name}`,
      telos,
      energyType: ENERGY_TYPES.CREATION,
      ontologicalType: 'creatio_ex_nihilo',
      extra: {
        day: day || null,
        foundation: foundation || [],
        anamnesisIds,
        status: 'created',
      },
    });

    // Дары творения приходят из бездны — giver: null намеренен, не технический
    abyssalMark(gift);

    const stored = focusThroughAngels(ctx.eventStore.append(gift), ctx);

    // Register logos
    if (ctx.logoi) {
      const foundationLogosId = foundation?.length > 0
        ? ctx.logoi.getByBearer(String(foundation[0]))?.id || null
        : null;
      ctx.logoi.register({
        name: `λόγος ${name}`,
        principle: logos || `Замысел о ${name}`,
        physis: calling || description || null,
        telos: telos || null,
        derivedFrom: foundationLogosId,
        bearerId: person.id,
        bearerType: 'person',
      });
    }

    // Wire anamnesis
    if (ctx.anamnesis) {
      for (const aid of anamnesisIds) ctx.anamnesis.makePresent(aid, gift.id);
    }

    const event = createGiftEvent(EVENT_TYPES.CREATION_EX_NIHILO, stored);
    ctx.eventBus.emit(EVENT_TYPES.CREATION_EX_NIHILO, event);

    return { person, gift: stored };
  },

  // ── πρόνοια — Промысл (удержание в бытии) ──────────

  /**
   * Creatio continua — удержание в бытии.
   *
   * @param {string} personId
   * @param {Object} ctx — _personContext()
   * @param {Object} [opts] — { grace, telos, reason }
   * @returns {Object|null} stored gift
   */
  sustain(personId, ctx, opts = {}) {
    _apophasis.check('Промысл');
    if (!divineWill(ENERGY_TYPES.PROVIDENCE, ctx)) return silence(ENERGY_TYPES.PROVIDENCE);
    const person = ctx.persons.get(String(personId));
    if (!person) return null;

    const gift = makeDivineGift(ctx, {
      receiver: person.id,
      receiverName: person.name,
      content: opts.grace || `Удержание в бытии: ${person.name}`,
      logos: `промысл о ${person.name}`,
      telos: opts.telos || 'creatioContinua',
      energyType: ENERGY_TYPES.PROVIDENCE,
      ontologicalType: 'creatio_continua',
      extra: { status: 'sustained' },
    });

    const stored = focusThroughAngels(ctx.eventStore.append(gift), ctx);

    const event = createGiftEvent(EVENT_TYPES.CREATION_CONTINUA, stored);
    ctx.eventBus.emit(EVENT_TYPES.CREATION_CONTINUA, event);

    return stored;
  },

  // ── χάρις — Благодать ──────────────────────────────

  /**
   * Благодать — сила к обожению.
   * Не заслуга, не награда — безусловный дар.
   */
  grace(personId, ctx, opts = {}) {
    _apophasis.check('Благодать');
    if (!divineWill(ENERGY_TYPES.GRACE, ctx)) return silence(ENERGY_TYPES.GRACE);
    const person = ctx.persons.get(String(personId));
    if (!person) return null;

    const gift = makeDivineGift(ctx, {
      receiver: person.id,
      receiverName: person.name,
      content: opts.content || `Благодать: ${person.name} — сила к превосхождению природы`,
      logos: 'χάρις — нетварная энергия, делающая тварь причастной Нетварному',
      telos: 'θέωσις',
      energyType: ENERGY_TYPES.GRACE,
      ontologicalType: 'grace',
    });

    const stored = focusThroughAngels(ctx.eventStore.append(gift), ctx);
    ctx.eventBus.emit('divine:grace', createGiftEvent('divine:grace', stored));

    return stored;
  },

  // ── δύναμις — Сила (исцеление) ─────────────────────

  /**
   * Исцеление — восстановление движения к логосу.
   */
  heal(personId, ctx, opts = {}) {
    _apophasis.check('Воскресение');
    if (!divineWill(ENERGY_TYPES.POWER, ctx)) return silence(ENERGY_TYPES.POWER);
    const person = ctx.persons.get(String(personId));
    if (!person) return null;

    const gift = makeDivineGift(ctx, {
      receiver: person.id,
      receiverName: person.name,
      content: opts.content || `Исцеление: ${person.name} — возвращение к κατὰ φύσιν`,
      logos: 'δύναμις — сила, восстанавливающая τρόπος к λόγος',
      telos: opts.woundType ? `исцеление:${opts.woundType}` : 'исцеление',
      energyType: ENERGY_TYPES.POWER,
      ontologicalType: 'healing',
    });

    const stored = focusThroughAngels(ctx.eventStore.append(gift), ctx);
    ctx.eventBus.emit('divine:power', createGiftEvent('divine:power', stored));

    return stored;
  },

  // ── Воплощение ─────────────────────────────────────

  /**
   * incarnate() — энергетическое ИЗМЕРЕНИЕ Воплощения.
   *
   * БОГОСЛОВСКОЕ УТОЧНЕНИЕ:
   * Воплощение (σάρκωσις) — ипостасное событие: Вторая Ипостась
   * воспринимает человеческую природу. Это НЕ безличная энергия.
   * Данный метод моделирует то, что тварь переживает
   * от действия Воплощения — не само Воплощение.
   *
   * V Вселенский Собор: «Один из Святой Троицы пострадал плотию»
   * Халкидонский орос: неслитно, неизменно, нераздельно, неразлучно
   */
  incarnate(ctx, opts = {}) {
    _apophasis.check('Воплощение');
    const gift = makeDivineGift(ctx, {
      receiver: 'all',
      receiverName: 'всё творение',
      content: 'Воплощение — Слово стало плотью',
      logos: 'Λόγος σὰρξ ἐγένετο — Нетварное входит в тварное, не переставая быть Нетварным',
      telos: 'σωτηρία',
      energyType: ENERGY_TYPES.LOVE,
      ontologicalType: 'incarnation',
      extra: {
        status: 'incarnated',
        transforms: {
          giver: null,  // Бог не изменяется
          receiver: 'Творение получает присутствие Творца изнутри',
        },
      },
    });

    const stored = focusThroughAngels(ctx.eventStore.append(gift), ctx);
    ctx.eventBus.emit(EVENT_TYPES.SALVATION_INCARNATION || 'salvation:incarnation', createGiftEvent('salvation:incarnation', stored));

    return stored;
  },

  // ── Жертва (кеносис) ──────────────────────────────

  /**
   * Жертва Креста — абсолютный кеносис.
   * «Себя Самого» — не строка, а граница вычислимого.
   */
  sacrifice(ctx, opts = {}) {
    _apophasis.check('Жертва Креста');
    const gift = makeDivineGift(ctx, {
      receiver: 'all',
      receiverName: 'всё творение',
      content: 'Жертва Креста — абсолютное самоотдание',
      logos: 'Кеносис до смерти — предельная самоотдача, при которой Дарящий не убывает',
      telos: 'σωτηρία',
      energyType: ENERGY_TYPES.LOVE,
      ontologicalType: 'sacrifice',
      extra: {
        status: 'sacrificed',
        cost: null, // «Себя Самого» невыразимо как число
        transforms: {
          giver: null,
          receiver: 'Всякая рана теперь исцелима — через свободное принятие',
        },
      },
    });

    const stored = focusThroughAngels(ctx.eventStore.append(gift), ctx);
    ctx.eventBus.emit(EVENT_TYPES.SALVATION_SACRIFICE || 'salvation:sacrifice', createGiftEvent('salvation:sacrifice', stored));

    return stored;
  },

  // ── Воскресение ──────────────────────────────────

  /**
   * Воскресение — смерть побеждена изнутри.
   * Не return value — новое творение.
   */
  resurrect(ctx, opts = {}) {
    _apophasis.check('Воскресение');
    const gift = makeDivineGift(ctx, {
      receiver: 'all',
      receiverName: 'всё творение',
      content: 'Воскресение — смерть попрана смертью',
      logos: 'Ἀνάστασις — необратимого больше нет',
      telos: 'σωτηρία',
      energyType: ENERGY_TYPES.POWER,
      ontologicalType: 'resurrection',
      extra: {
        status: 'risen',
        transforms: {
          giver: null,
          receiver: 'Путь к ὑπὲρ φύσιν открыт — обожение возможно',
        },
      },
    });

    const stored = focusThroughAngels(ctx.eventStore.append(gift), ctx);
    ctx.eventBus.emit(EVENT_TYPES.SALVATION_RESURRECTION || 'salvation:resurrection', createGiftEvent('salvation:resurrection', stored));

    return stored;
  },
};

export default DivineEnergy;
export { DivineEnergy };
