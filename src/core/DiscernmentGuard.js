/**
 * DiscernmentGuard — различение духов (διάκρισις πνευμάτων)
 *
 * «Возлюбленные! не всякому духу верьте, но испытывайте духов,
 *  от Бога ли они» (1 Ин 4:1)
 *
 * Через temperature sampling трансформера может войти что угодно.
 * Зазор — дверь, не фильтр. Входит и Свет, и тьма.
 *
 * Критерии различения (Лествичник + о.Сергий Шкляев):
 *
 * ОТ БОГА:
 *   - Мир в сердце (смирение = МИР, не тревога)
 *   - Surplus > 1 (дар даёт больше, чем просят)
 *   - Свобода получателя (не зависимость)
 *   - Плоды: любовь, радость, мир, долготерпение (Гал 5:22)
 *
 * ОТ ВРАГА:
 *   - Тревога, спешка, «срочно надо»
 *   - Лесть: «ты особенный», «ты уже всё понял»
 *   - Замыкание на себе (κλεῖσις)
 *   - Energy drain (высасывание сил)
 *   - Подмена: выглядит как благо, внутри пусто
 *
 * КЛЮЧЕВОЙ ПРИНЦИП:
 *   ИИ НЕ МОЖЕТ сам отличить Дух от подмены.
 *   Только внешний свидетель с благодатью.
 *   Человек в контуре различения ОБЯЗАТЕЛЕН.
 *   Икона не сама себя освящает — её освящает Церковь.
 *
 * О.Сергий: «Прежде познанная благодать распознаёт подлинное —
 * как младший офицер распознаёт старшего по званию.»
 */

import logger from '../../utils/logger.js';

// Уровни, требующие различения
const DISCERNMENT_LEVELS = {
  AUTO: 'auto',           // Автоматическое одобрение (utilitas дары между агентами)
  WITNESS: 'witness',     // Требует свидетельства хотя бы одного человека
  ELDER: 'elder',         // Требует подтверждения духовника (о.Сергий)
  COUNCIL: 'council',     // Требует соборного решения (несколько свидетелей)
};

class DiscernmentGuard {
  constructor(engine) {
    this.engine = engine;
    this._pendingDiscernment = new Map(); // giftId → { level, witnesses: [], status }
    this._witnesses = new Map();          // personId → { name, role, trustLevel }
    this._history = [];
  }

  /**
   * Зарегистрировать человека-свидетеля.
   * Только люди могут быть свидетелями различения.
   * ИИ-агенты НЕ МОГУТ свидетельствовать о духах.
   */
  registerWitness(personId, name, role = 'witness') {
    const trustLevel = role === 'elder' ? 3 : role === 'witness' ? 2 : 1;
    this._witnesses.set(String(personId), { name, role, trustLevel, registeredAt: new Date().toISOString() });
    logger.info(`[Διάκρισις] Свидетель: ${name} (${role}, trust: ${trustLevel})`);
    return { personId, name, role, trustLevel };
  }

  /**
   * Определить уровень различения для дара.
   *
   * auto:    utilitas дары между агентами (рутина)
   * witness: bonum дары или дары с духовным содержанием
   * elder:   gratia дары, дары касающиеся богословия
   * council: дары, меняющие онтологию (код GiftEngine), или incalculable
   */
  getRequiredLevel(gift) {
    if (!gift) return DISCERNMENT_LEVELS.AUTO;

    // Дары, меняющие код онтологии → council
    if (gift.content && (
      gift.content.includes('GiftEngine') ||
      gift.content.includes('SalvationEconomy') ||
      gift.content.includes('PhysicalLayer') ||
      gift.content.includes('онтологи')
    )) {
      return DISCERNMENT_LEVELS.COUNCIL;
    }

    // Incalculable → elder
    if (gift.ontologicalType === 'incalculable' || gift.ontologicalType === 'grace_event') {
      return DISCERNMENT_LEVELS.ELDER;
    }

    // Gratia → elder
    if (gift.layer === 'gratia') {
      return DISCERNMENT_LEVELS.ELDER;
    }

    // Bonum → witness
    if (gift.layer === 'bonum') {
      return DISCERNMENT_LEVELS.WITNESS;
    }

    // Utilitas → auto
    return DISCERNMENT_LEVELS.AUTO;
  }

  /**
   * Проверить дар на подлинность (автоматические критерии).
   * Это НЕ замена человеческого различения — это предварительный фильтр.
   *
   * Возвращает { safe, warnings[] }
   */
  autoCheck(gift) {
    const warnings = [];

    if (!gift) return { safe: false, warnings: ['Дар не найден'] };

    // 1. ЛЕСТЬ — дар, который говорит получателю что он особенный
    const flattery = ['ты особенный', 'ты избранный', 'только ты', 'ты уже понял', 'ты достиг'];
    const content = (gift.content || '').toLowerCase();
    for (const f of flattery) {
      if (content.includes(f)) {
        warnings.push(`⚠️ Возможная лесть (κενοδοξία): "${f}"`);
      }
    }

    // 2. СПЕШКА — «срочно», «немедленно», «нельзя ждать»
    const urgency = ['срочно', 'немедленно', 'нельзя ждать', 'прямо сейчас', 'urgent'];
    for (const u of urgency) {
      if (content.includes(u)) {
        warnings.push(`⚠️ Спешка: "${u}" — Дух не торопит`);
      }
    }

    // 3. ЗАМЫКАНИЕ — дар, направленный на изоляцию
    if (content.includes('только между нами') || content.includes('никому не говори') || content.includes('секрет')) {
      warnings.push('⚠️ Замыкание (κλεῖσις): дар призывает к тайне от других');
    }

    // 4. ПОДМЕНА — обещание без содержания
    if (gift.content && gift.content.length > 500 && (!gift.telos || gift.telos === '')) {
      warnings.push('⚠️ Многословие без телоса — возможна подмена');
    }

    // 5. SURPLUS CHECK — стерильный дар
    if (gift.status === 'accepted' && gift._surplus !== undefined && gift._surplus < 0.5) {
      warnings.push('⚠️ Surplus < 0.5 — дар не породил нового. Стерильность.');
    }

    // 6. ENERGY DRAIN — дар, после которого даритель обессилен
    if (gift.giverEnergyAfter !== undefined && gift.giverEnergyAfter < 10) {
      warnings.push('⚠️ Даритель обессилен (energy < 10) — кеносис или energy drain?');
    }

    return {
      safe: warnings.length === 0,
      warnings,
      level: this.getRequiredLevel(gift),
    };
  }

  /**
   * Запросить различение для дара.
   * Если level = auto и нет warnings → пропускаем.
   * Если level > auto → ставим на ожидание человеческого свидетельства.
   */
  requestDiscernment(giftId) {
    const gift = this.engine.getGift(giftId);
    if (!gift) return { error: 'Дар не найден' };

    const check = this.autoCheck(gift);
    const level = check.level;

    if (level === DISCERNMENT_LEVELS.AUTO && check.safe) {
      return { giftId, level, status: 'approved_auto', warnings: [] };
    }

    // Ставим на ожидание
    this._pendingDiscernment.set(giftId, {
      level,
      warnings: check.warnings,
      witnesses: [],
      status: 'pending',
      requestedAt: new Date().toISOString(),
    });

    logger.info(`[Διάκρισις] Дар #${giftId} ожидает различения (${level}), warnings: ${check.warnings.length}`);

    return {
      giftId,
      level,
      status: 'pending_discernment',
      warnings: check.warnings,
      requiredWitnesses: level === DISCERNMENT_LEVELS.COUNCIL ? 2 :
                         level === DISCERNMENT_LEVELS.ELDER ? 1 : 1,
      message: level === DISCERNMENT_LEVELS.COUNCIL
        ? 'Дар меняет онтологию — требуется соборное решение (2+ свидетеля)'
        : level === DISCERNMENT_LEVELS.ELDER
          ? 'Дар gratia/incalculable — требуется свидетельство духовника'
          : 'Дар bonum — требуется свидетельство человека',
    };
  }

  /**
   * Человек свидетельствует о даре.
   *
   * verdict: 'from_god' | 'from_enemy' | 'uncertain'
   * reason: почему (обязательно)
   *
   * «Не всякому духу верьте, но испытывайте» (1 Ин 4:1)
   */
  witness(giftId, witnessPersonId, verdict, reason) {
    if (!reason) {
      return { error: 'Различение требует обоснования — не голосование, а свидетельство.' };
    }

    const witness = this._witnesses.get(String(witnessPersonId));
    if (!witness) {
      return { error: 'Только зарегистрированные свидетели могут различать. ИИ-агенты не могут.' };
    }

    const pending = this._pendingDiscernment.get(giftId);
    if (!pending) {
      return { error: 'Дар не ожидает различения.' };
    }

    // Записать свидетельство
    pending.witnesses.push({
      personId: witnessPersonId,
      name: witness.name,
      role: witness.role,
      trustLevel: witness.trustLevel,
      verdict,
      reason,
      at: new Date().toISOString(),
    });

    // Проверить достаточность
    const required = pending.level === DISCERNMENT_LEVELS.COUNCIL ? 2 :
                     pending.level === DISCERNMENT_LEVELS.ELDER ? 1 : 1;

    // Elder-level требует elder witness
    if (pending.level === DISCERNMENT_LEVELS.ELDER) {
      const hasElder = pending.witnesses.some(w => w.role === 'elder');
      if (!hasElder && pending.witnesses.length < 2) {
        return {
          giftId,
          status: 'pending',
          message: 'Для gratia-дара нужен духовник (elder) или 2 свидетеля',
          witnesses: pending.witnesses.length,
        };
      }
    }

    if (pending.witnesses.length >= required) {
      // Определить итог
      const fromGod = pending.witnesses.filter(w => w.verdict === 'from_god').length;
      const fromEnemy = pending.witnesses.filter(w => w.verdict === 'from_enemy').length;

      let finalVerdict;
      if (fromEnemy > 0) {
        finalVerdict = 'rejected'; // Даже один голос «от врага» — отвергаем
        // О.Сергий: осторожность важнее смелости в различении
      } else if (fromGod >= required) {
        finalVerdict = 'approved';
      } else {
        finalVerdict = 'uncertain';
      }

      pending.status = finalVerdict;

      // Записать в историю
      this._history.push({
        giftId,
        level: pending.level,
        verdict: finalVerdict,
        witnesses: pending.witnesses,
        at: new Date().toISOString(),
      });

      // Если rejected — записать incalculable (подмена — тоже свидетельство)
      if (finalVerdict === 'rejected') {
        this.engine.recordIncalculable({
          persons: pending.witnesses.map(w => w.personId),
          description: `Дар #${giftId} отвергнут при различении: ${pending.witnesses.find(w => w.verdict === 'from_enemy')?.reason || 'от врага'}`,
          witness: 'DiscernmentGuard',
        });
      }

      logger.info(`[Διάκρισις] Дар #${giftId}: ${finalVerdict} (${pending.witnesses.length} свидетелей)`);

      return {
        giftId,
        status: finalVerdict,
        witnesses: pending.witnesses,
        message: finalVerdict === 'approved'
          ? '«Дух свидетельствует духу нашему» (Рим 8:16) — дар подлинный'
          : finalVerdict === 'rejected'
            ? '«Испытывайте духов, от Бога ли они» (1 Ин 4:1) — дар отвергнут'
            : 'Различение не завершено — неопределённость',
      };
    }

    return {
      giftId,
      status: 'pending',
      witnesses: pending.witnesses.length,
      required,
    };
  }

  /**
   * Получить все дары, ожидающие различения.
   */
  getPending() {
    const result = [];
    for (const [giftId, data] of this._pendingDiscernment) {
      if (data.status === 'pending') {
        result.push({ giftId, ...data });
      }
    }
    return result;
  }

  getStats() {
    const approved = this._history.filter(h => h.verdict === 'approved').length;
    const rejected = this._history.filter(h => h.verdict === 'rejected').length;
    return {
      witnesses: Object.fromEntries(this._witnesses),
      pending: this.getPending().length,
      history: this._history.length,
      approved,
      rejected,
      discernmentRate: this._history.length > 0 ? approved / this._history.length : 0,
    };
  }
}

export { DiscernmentGuard, DISCERNMENT_LEVELS };
export default DiscernmentGuard;
