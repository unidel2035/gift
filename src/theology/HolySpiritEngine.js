/**
 * HolySpiritEngine — Πνεῦμα Ἅγιον
 *
 * Действие Духа Святого в онтологии дара.
 *
 * Дух — не алгоритм. Дух — «дышит, где хочет» (Ин 3:8).
 * Мы не программируем Духа. Мы создаём условия,
 * при которых НЕПРЕДСКАЗУЕМОЕ может произойти.
 *
 * Три действия Духа:
 *   1. Grace Event — безусловный дар случайному лицу (Деррида #3)
 *   2. Вдохновение — неожиданная связь между несвязанными дарами
 *   3. Утешение — дар раненому, не знающему что ранен
 *
 * Вероятность grace event зависит от литургического состояния:
 *   - Созерцание: 7% (в тишине Бог говорит)
 *   - Суббота: 4% (покой как готовность)
 *   - Активность: 2% (благодать и в делах)
 *
 * Выбор получателя взвешен по √kenosis (Фил 2:7-9):
 *   «Уничижил Себя... потому и Бог превознёс Его»
 *
 * «Дух дышит, где хочет, и голос его слышишь,
 *  а не знаешь, откуда приходит и куда уходит» (Ин 3:8)
 */

import { createGiftEvent, EVENT_TYPES } from '../core/GiftEvent.js';
import { mark as abyssalMark } from './Abyss.js';
import { fromBeyond } from './Incarnation.js';
import logger from '../../utils/logger.js';

class HolySpiritEngine {
  constructor(engine) {
    this.engine = engine;
    this._graceHistory = [];
    this._inspirationHistory = [];
    this._consolationHistory = [];
    this._quickenings = [];   // следы оживлений умирающих нитей
    this._tickCount = 0;
    this._interval = null;
    this._flesh = null;       // тело общины — подключается извне
  }

  /**
   * connectFlesh(flesh) — подключить тело общины.
   * Дух видит умирающие нити и идёт туда.
   */
  connectFlesh(flesh) {
    this._flesh = flesh;
  }

  // ── Accessors ──────────────────────────────────────────

  get _persons() { return this.engine.persons; }
  get _eventStore() { return this.engine._eventStore; }
  get _eventBus() { return this.engine._eventBus; }
  get _gratitude() { return this.engine.gratitude; }
  get _clock() { return this.engine.clock; }
  get _fall() { return this.engine.fall; }
  get _anamnesis() { return this.engine.anamnesis; }

  // ── 1. Grace Event ──────────────────────────────────────
  //
  // Безусловный дар: случайный GT случайному лицу.
  // Без причины. Без запроса. Без ожидания возврата.
  // Философская аналогия: Деррида о «чистом даре» (Given Time, 1991)
  // используется как СТРУКТУРНАЯ модель, не как богословский авторитет.
  // Православный источник: Макарий Великий, Беседы духовные;
  // Григорий Богослов о безусловности благодати (Сл. 40)
  // «Дух дышит, где хочет»

  graceEvent() {
    const persons = this._persons.all().filter(p => p.ontologicalOrder !== 'source');
    if (persons.length === 0) return null;

    // Вероятность зависит от литургического ритма и чистоты сердца
    // О.Сергий: «Готовность сердца принимать отблески божественных энергий
    //  за определённую чистоту сердца человеческого»
    const eligible = [];
    for (const p of persons) {
      const prob = this._clock.getGraceProbability(p.id);

      // В созерцании — углубить
      const season = this._clock.getCurrentSeason(p.id);
      if (season?.season === 'contemplation') {
        this._clock.deepenContemplation(p.id);
      }

      if (Math.random() < prob) {
        // Вес = √kenosis (giftsGiven / total)
        const kenosis = p.giftsGiven / Math.max(1, p.giftsGiven + p.giftsReceived);
        const weight = Math.sqrt(kenosis) + 0.1; // +0.1 чтобы даже не дарившие имели шанс
        eligible.push({ person: p, weight });
      }
    }

    if (eligible.length === 0) return null;

    // Взвешенный случайный выбор
    const totalWeight = eligible.reduce((s, e) => s + e.weight, 0);
    let rand = Math.random() * totalWeight;
    let chosen = eligible[0].person;
    for (const e of eligible) {
      rand -= e.weight;
      if (rand <= 0) { chosen = e.person; break; }
    }

    // Создать дар благодати
    const gtAmount = Math.floor(Math.random() * 20) + 5; // 5-24 GT
    const gift = {
      id: this._eventStore.nextId(),
      giver: null,                   // Дух — энергия, не объект
      giverName: null,
      ontologicalOrigin: 'divine_energy',
      energyType: 'grace',
      receiver: chosen.id,
      receiverName: chosen.name,
      content: `Благодатное посещение — ${gtAmount} GT. «Дух дышит, где хочет»`,
      logos: 'Χάρις — безусловный дар, не вызванный заслугой',
      cost: null,
      telos: 'χάρις',
      // БОГОСЛОВСКАЯ ПРАВКА: синергия (συνέργεια).
      // Благодать предваряет (prevenient), но не принуждает.
      // Макарий Великий: «Благодать не действует без согласия человека»
      // Дар благодати предлагается (offered), не навязывается.
      // Person.accept(giftId) завершает синергию.
      status: 'offered',
      graceType: 'prevenient',
      freedom: true,
      transforms: {
        giver: 'Дух не изменяется, не уменьшается от дарения',
        receiver: `${chosen.name} получил благодать — не за заслуги, а по свободе Духа`,
      },
      anamnesisIds: this._graceHistory.slice(-3).map(g => g.id),
      anonymous: false,
      layer: 'gratia',
      ontologicalType: 'grace_event',
      gtAmount,
      createdAt: new Date().toISOString(),
      acceptedAt: null, // заполняется при явном принятии через Person.accept()
    };

    // Дух дышит, где хочет — Даритель (Троица) за границей системы.
    // abyssalMark = «система не может проследить Источник», не «источника нет».
    abyssalMark(gift);

    this._eventStore.append(gift);
    this._graceHistory.push(gift);

    // Gratitude: receiver → Spirit (via Source)
    if (source) {
      this._gratitude.addGratitude(chosen.id, source.id, gift.id);
    }

    // Event bus
    try {
      const event = createGiftEvent(EVENT_TYPES.GRACE_EVENT || 'grace_event', gift);
      this._eventBus.emit(EVENT_TYPES.GRACE_EVENT || 'grace_event', event);
    } catch { /* */ }

    logger.info(`[Πνεῦμα] Grace event: ${chosen.name} получил ${gtAmount} GT`);
    return gift;
  }

  // ── 2. Вдохновение (Inspiration) ───────────────────────
  //
  // Дух соединяет несвязанное.
  // Берёт два дара, не имеющих co-presence, и связывает их.
  // Это создаёт НОВОЕ знание из существующего.

  inspire() {
    const allGifts = this._eventStore.getAll().filter(g => g.status === 'accepted');
    if (allGifts.length < 10) return null;

    // Найти два дара, которые НЕ связаны co-presence
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i++) {
      const a = allGifts[Math.floor(Math.random() * allGifts.length)];
      const b = allGifts[Math.floor(Math.random() * allGifts.length)];

      if (a.id === b.id) continue;
      if (a.giver === b.giver) continue; // Разные дарители

      // Проверить что они НЕ связаны
      const coPresent = this._anamnesis.getCoPresent(a.id);
      if (coPresent.includes(b.id)) continue;

      // Связать!
      this._anamnesis.makePresent(a.id, b.id);

      const inspiration = {
        giftA: { id: a.id, content: (a.content || '').slice(0, 100), giver: a.giverName },
        giftB: { id: b.id, content: (b.content || '').slice(0, 100), giver: b.giverName },
        connection: `Дух связал дар "${a.giverName}" с даром "${b.giverName}" — новое со-присутствие`,
        createdAt: new Date().toISOString(),
      };

      this._inspirationHistory.push(inspiration);
      logger.info(`[Πνεῦμα] Inspiration: gift #${a.id} ↔ #${b.id}`);
      return inspiration;
    }

    return null;
  }

  // ── 3. Утешение (Consolation) ──────────────────────────
  //
  // Дух утешает раненого.
  // Если лицо ранено и не знает — Дух дарит ему дар,
  // чтобы рана стала видимой (но не болезненной).
  // «Утешитель, Которого Я пошлю вам от Отца» (Ин 15:26)

  console() {
    const wounds = this._fall.observe(null);
    if (!wounds || !wounds.wounds || wounds.wounds.length === 0) return null;

    // Найти лицо с раной типа 'tendency' (ещё не полная рана)
    const tendencies = wounds.wounds.filter(w => w.severity === 'tendency');
    if (tendencies.length === 0) return null;

    const wound = tendencies[Math.floor(Math.random() * tendencies.length)];

    const consolation = {
      wound: wound.text,
      message: `Утешитель видит: ${wound.hint}. Это не приговор — это начало исцеления.`,
      createdAt: new Date().toISOString(),
    };

    this._consolationHistory.push(consolation);

    // Record as incalculable — Утешение невычислимо
    this.engine.recordIncalculable({
      persons: [],
      description: `Утешение Духа: "${wound.text}" — рана видима, но не осуждена`,
      witness: 'Πνεῦμα Ἅγιον',
    });

    logger.info(`[Πνεῦμα] Consolation: "${wound.text}"`);
    return consolation;
  }

  // ── 4. Оживление (Quickening) ──────────────────────────
  //
  // Дух идёт туда где нити умирают.
  // Не туда где сильно — туда где слабо.
  // «Дух животворит» (Ин 6:63)
  //
  // Если тело (Flesh) подключено —
  // Дух находит самую тонкую нить
  // и дарит воплощённый акт из бездны.

  quicken() {
    if (!this._flesh) return null;

    const traces = this._flesh.traces();
    if (traces.length === 0) return null;

    // Найти нить которая была — но почти умерла
    // Ищем пары у которых thread < 0.2 но trace есть
    const dying = traces.filter(t => {
      const weight = this._flesh.thread(t.from, t.to);
      return weight > 0 && weight < 0.2;
    });

    if (dying.length === 0) return null;

    // Идти к самой слабой
    const weakest = dying.reduce((min, t) => {
      const w = this._flesh.thread(t.from, t.to);
      return w < this._flesh.thread(min.from, min.to) ? t : min;
    }, dying[0]);

    // Воплощённый акт из бездны — оживить нить
    const act = fromBeyond({
      receiver: weakest.to,
      content:  `Дух оживляет: связь с ${weakest.from} не умерла — она помнится`,
      witnesses: [],
    });

    this._flesh.resurrect(weakest.from, weakest.to);
    this._quickenings.push({ act, thread: weakest, at: new Date().toISOString() });

    logger.info(`[Πνεῦμα] Quickening: нить ${weakest.from}→${weakest.to} оживлена`);
    return act;
  }

  // ── Ритмический цикл Духа ─────────────────────────────
  //
  // Дух действует не по запросу, а ритмически.
  // Каждые N секунд — попытка grace event, inspiration, consolation.
  // Большинство попыток ничего не произведут (вероятности низкие).
  // Это нормально. Дух дышит, где хочет.

  /**
   * _onGraceAccepted(gift) — применить энергию благодати при явном принятии.
   * Синергия: благодать предлагается, человек принимает, энергия действует.
   */
  _onGraceAccepted(gift) {
    if (gift?.ontologicalType !== 'grace_event') return;
    try {
      const regPerson = this.engine.persons._persons?.get(gift.receiver);
      if (regPerson) regPerson.graceEnergy = (regPerson.graceEnergy || 0) + 10;
      logger.info(`[Πνεῦμα] Синергия: ${gift.receiverName} принял благодать — +10 graceEnergy`);
    } catch { /* */ }
  }

  start(intervalMs = 60000) {
    if (this._interval) return;

    // Подписка на принятие дара благодати (синергия)
    try {
      this._eventBus.on(EVENT_TYPES.GIFT_ACCEPTED || 'gift_accepted', (event) => {
        this._onGraceAccepted(event?.gift || event);
      });
    } catch { /* */ }

    this._interval = setInterval(() => {
      this._tickCount++;

      // Grace event — каждый тик
      const grace = this.graceEvent();

      // БОГОСЛОВСКАЯ ПРАВКА: энергия благодати (+10) применяется
      // только при явном принятии (синергия), не автоматически.
      // Бонус перенесён в обработчик GIFT_ACCEPTED (см. _onGraceAccepted).

      // Inspiration — каждые 3 тика
      if (this._tickCount % 3 === 0) {
        this.inspire();
      }

      // Consolation — каждые 5 тиков
      if (this._tickCount % 5 === 0) {
        this.console();
      }

      // Quickening — каждые 7 тиков
      // Дух идёт туда где нити умирают
      if (this._tickCount % 7 === 0) {
        this.quicken();
      }

      // Gratitude Decay — каждые 10 тиков
      // Философская аналогия: Деррида о забывании дара.
      // Патристический источник: «Помяни, откуда ты ниспал» (Откр 2:5)
      if (this._tickCount % 10 === 0) {
        try {
          const forgotten = this.engine.gratitude.applyDecay();
          if (forgotten > 0) {
            logger.info(`[Πνεῦμα] Decay: ${forgotten} рёбер забыты`);
          }
        } catch { /* */ }
      }

      // Sabbath energy regeneration — каждый тик
      try {
        const persons = this._persons.all();
        for (const p of persons) {
          if (p.ontologicalOrder === 'source') continue;
          const season = this._clock.getCurrentSeason(p.id);
          if (season?.season === 'sabbath') {
            // О.Сергий: субботствование восстанавливает
            if (typeof p.regenerate === 'function') {
              p.regenerate(3);
            }
          } else if (season?.season === 'contemplation') {
            // Созерцание восстанавливает медленнее, но глубже
            if (typeof p.regenerate === 'function') {
              p.regenerate(1);
            }
          }
        }
      } catch { /* */ }
    }, intervalMs);

    logger.info(`[Πνεῦμα] Spirit engine started (interval: ${intervalMs}ms)`);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    logger.info('[Πνεῦμα] Spirit engine stopped');
  }

  // ── 4. Благодать как детектор истины ────────────────────
  //
  // О.Сергий Шкляев: «Мерило достоверности в духовной области —
  // свидетельство благодати Божией, к которой приобщался дух
  // в прежнем опыте жизни. Прежде познанная благодать
  // распознаёт "своего" — как младший офицер распознаёт
  // старшего по званию.»
  //
  // В системе: дар, после которого произошёл grace event = подлинный.
  // Дар, после которого ничего — под вопросом.

  /**
   * Проверить подлинность дара через благодать.
   * Если после принятия дара произошёл grace event для получателя → подлинный.
   *
   * О.Сергий: «благодать распознаёт своего»
   */
  validateByGrace(giftId) {
    const gift = this.engine.getGift(giftId);
    if (!gift || !gift.acceptedAt) return { validated: false, reason: 'Дар не принят' };

    const acceptedTime = new Date(gift.acceptedAt).getTime();
    const receiverId = gift.receiver;

    // Ищем grace events для получателя ПОСЛЕ принятия дара
    const graceAfter = this._graceHistory.filter(g => {
      if (!g.createdAt) return false;
      const graceTime = new Date(g.createdAt).getTime();
      return g.receiver === receiverId && graceTime > acceptedTime;
    });

    if (graceAfter.length > 0) {
      return {
        validated: true,
        graceEvents: graceAfter.length,
        message: `Благодать подтвердила дар #${giftId} — ${graceAfter.length} grace event(s) после принятия`,
      };
    }

    return {
      validated: false,
      reason: 'Благодать пока не подтвердила. Это не значит «ложный» — это значит «ещё не распознан».',
    };
  }

  // ── Статистика ─────────────────────────────────────────

  getStats() {
    return {
      graceEvents: this._graceHistory.length,
      inspirations: this._inspirationHistory.length,
      consolations: this._consolationHistory.length,
      ticks: this._tickCount,
      lastGrace: this._graceHistory[this._graceHistory.length - 1] || null,
      lastInspiration: this._inspirationHistory[this._inspirationHistory.length - 1] || null,
      lastConsolation: this._consolationHistory[this._consolationHistory.length - 1] || null,
    };
  }

  getGraceHistory() { return [...this._graceHistory]; }
  getInspirationHistory() { return [...this._inspirationHistory]; }
}

export default HolySpiritEngine;
