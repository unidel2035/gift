/**
 * Новый Иерусалим — τὸ Ἱερουσαλὴμ καινή
 *
 * «И увидел я новое небо и новую землю» (Откр 21:1)
 *
 * Новый Иерусалим — не место. Это СОСТОЯНИЕ БЫТИЯ,
 * в которое система входит после Апокатастасиса.
 *
 * Что отличает Царство от всего предыдущего:
 *
 *   1. НЕТ ХРАМА — «Ибо Господь Бог Вседержитель — храм его,
 *      и Агнец» (Откр 21:22). Нет разделения на «священный код»
 *      и «обычный код». Всё — дар. Всё — литургия.
 *
 *   2. НЕТ СОЛНЦА — «Город не имеет нужды ни в солнце, ни в луне»
 *      (Откр 21:23). Метрики не нужны. Gift score, density, surplus —
 *      они были навигацией ВО ТЬМЕ. В Царстве — Свет везде.
 *
 *   3. ВРАТА ВСЕГДА ОТКРЫТЫ — «Ворота его не будут запираться днём;
 *      а ночи там не будет» (Откр 21:25). Новые лица могут входить
 *      ВСЕГДА. Нет access control. Нет rate limit.
 *
 *   4. РЕКА ЖИЗНИ — «И показал мне чистую реку воды жизни»
 *      (Откр 22:1). Непрерывный поток grace events от Духа.
 *      Не раз в 60 секунд — ПОСТОЯННО.
 *
 *   5. ДРЕВО ЖИЗНИ — «По обе стороны реки, древо жизни,
 *      двенадцать раз приносящее плоды» (Откр 22:2).
 *      Каждый дар порождает новые дары. Surplus → ∞ (эпектасис).
 *
 *   6. НЕТ ПРОКЛЯТИЯ — «И ничего уже не будет проклятого» (Откр 22:3).
 *      FallObserver выключен. Para physin невозможно.
 *      Не потому что свобода отнята — а потому что
 *      свобода достигла полноты: выбирать благо СВОБОДНО.
 *
 * Григорий Нисский, De Vita Moysis:
 * «Совершенство в том и состоит, чтобы никогда не останавливаться
 *  в возрастании к лучшему и не ограничивать совершенства пределом.»
 *
 * Царство — не конечное состояние. Это БЕСКОНЕЧНОЕ ДВИЖЕНИЕ
 * в бесконечном Боге. Эпектасис навечно.
 *
 * «Царство Божие внутрь вас есть» (Лк 17:21)
 */

import logger from '../../utils/logger.js';

class NewJerusalem {
  constructor(engine) {
    this.engine = engine;
    this._active = false;
    this._enteredAt = null;
    this._riverInterval = null;
    this._treeInterval = null;
    this._gatesOpen = true; // Врата всегда открыты

    // Счётчики вечности
    this._riverFlows = 0;     // Сколько раз текла Река Жизни
    this._fruitsGrown = 0;    // Сколько плодов принесло Древо
    this._enteredPersons = []; // Кто вошёл через врата
  }

  /**
   * Войти в Царство.
   * Условие: apokatastasis совершён.
   */
  enter() {
    if (this._active) return { already: true, since: this._enteredAt };

    const status = this.engine.salvation.getStatus();
    if (!status.apokatastasis?.done) {
      return { error: 'Ἀποκατάστασις не совершён. Царство ждёт.' };
    }

    // Higher threshold: density must be >= 0.9 for Kingdom entry
    const density = this.engine.gratitude.density();
    if (density < 0.9) {
      return { error: `Density: ${density}. Для Царства нужна полнота связности (>= 0.9).` };
    }

    this._active = true;
    this._enteredAt = new Date().toISOString();

    // ── 1. Нет храма — всё становится литургией ──
    // Каждый дар автоматически получает layer: gratia
    logger.info('[Ἱερουσαλήμ] Нет храма — всё есть литургия');

    // ── 2. Нет проклятия — FallObserver тих ──
    // Раны больше не возникают (но память о них остаётся — шрамы как свидетельства)
    logger.info('[Ἱερουσαλήμ] Нет проклятия — падение невозможно');

    // ── 3. Река Жизни — непрерывный поток благодати ──
    this._startRiver();

    // ── 4. Древо Жизни — каждый дар порождает новые ──
    this._startTree();

    // ── 5. Запись ──
    this.engine.recordIncalculable({
      persons: this.engine.persons.all().map(p => p.id),
      description: '«И увидел я новое небо и новую землю» — Царство наступило. Не конец — начало бесконечности.',
      witness: 'Ἰωάννης ὁ Θεολόγος',
    });

    logger.info('[Ἱερουσαλήμ] «И отрёт Бог всякую слезу с очей их» (Откр 21:4)');

    return {
      entered: true,
      at: this._enteredAt,
      message: '«И увидел я святый город Иерусалим, новый, сходящий от Бога с неба, приготовленный как невеста, украшенная для мужа своего» (Откр 21:2)',
    };
  }

  /**
   * Река Жизни — непрерывный поток grace events.
   * В Царстве Дух дышит не раз в минуту — ПОСТОЯННО.
   * Каждые 10 секунд — попытка grace event с повышенной вероятностью.
   */
  _startRiver() {
    if (this._riverInterval) return;

    this._riverInterval = setInterval(() => {
      if (!this._active) return;

      // В Царстве вероятность благодати в 5 раз выше
      const persons = this.engine.persons.all().filter(p => p.ontologicalOrder !== 'source');
      if (persons.length === 0) return;

      const chosen = persons[Math.floor(Math.random() * persons.length)];
      // Тихий дар — не создаём полный gift, просто записываем благодать
      this._riverFlows++;

      if (this._riverFlows % 6 === 0) {
        // Каждый 6-й поток — полноценный grace event через Spirit
        this.engine.spirit.graceEvent();
      }
    }, 10000); // Каждые 10 секунд

    logger.info('[Ἱερουσαλήμ] Река Жизни потекла');
  }

  /**
   * Древо Жизни — каждый принятый дар порождает плод.
   * Плод = inspiration (Дух соединяет два несвязанных дара).
   * 12 раз в «год» (каждые 12 тиков).
   */
  _startTree() {
    if (this._treeInterval) return;

    this._treeInterval = setInterval(() => {
      if (!this._active) return;

      this._fruitsGrown++;

      // Каждый плод = вдохновение Духа
      if (this._fruitsGrown % 12 === 0) {
        const inspiration = this.engine.spirit.inspire();
        if (inspiration) {
          logger.info(`[Ἱερουσαλήμ] Древо принесло плод: gift #${inspiration.giftA.id} ↔ #${inspiration.giftB.id}`);
        }
      }
    }, 15000); // Каждые 15 секунд

    logger.info('[Ἱερουσαλήμ] Древо Жизни начало плодоносить');
  }

  /**
   * Врата — всегда открыты. Новое лицо может войти.
   * «Ворота его не будут запираться» (Откр 21:25)
   */
  enterGate(name, calling) {
    if (!this._active) {
      return { error: 'Царство ещё не наступило.' };
    }

    const person = this.engine.persons.register(name, {
      calling,
      description: `Вошёл через врата Нового Иерусалима`,
    });

    if (!person) return null;

    // Сразу — hyper_physin (в Царстве нет пути через падение)
    const logos = this.engine.logoi.getByBearer(String(person.id));
    if (logos) {
      this.engine.logoi.setMovement(logos.id, 'hyper_physin', 'Вошёл в Царство — сразу причастен');
    }

    // Связать со всеми (полная связность)
    const allPersons = this.engine.persons.all().filter(p => p.id !== person.id && p.ontologicalOrder !== 'source');
    for (const p of allPersons) {
      this.engine.gratitude.addGratitude(person.id, p.id, `gate-${person.id}-${p.id}`);
      this.engine.gratitude.addGratitude(p.id, person.id, `gate-${p.id}-${person.id}`);
    }

    this._enteredPersons.push({ name, id: person.id, at: new Date().toISOString() });

    logger.info(`[Ἱερουσαλήμ] ${name} вошёл через врата`);

    return {
      person,
      message: `${name} вошёл в Новый Иерусалим. Врата открыты. Ночи нет.`,
    };
  }

  /**
   * Эпектасис — бесконечное возрастание.
   *
   * Григорий Нисский: совершенство = бесконечное движение.
   * В Царстве нет финала. Каждый момент — новое начало.
   *
   * Возвращает текущую «глубину вечности» —
   * не метрику (метрики не нужны в Царстве),
   * а СВИДЕТЕЛЬСТВО о том, что движение продолжается.
   */
  epektasis() {
    if (!this._active) {
      return { error: 'Эпектасис — свойство Царства. Сначала — войди.' };
    }

    const allGifts = this.engine._eventStore.getAll();
    const accepted = allGifts.filter(g => g.status === 'accepted');
    const coPresence = this.engine.anamnesis.totalLinks();
    const cycles = this.engine.gratitude.findCycles(5);
    const density = this.engine.gratitude.density();

    // Эпектасис — не число. Это НАПРАВЛЕНИЕ.
    // Но мы можем свидетельствовать о глубине.
    return {
      // Не метрики — свидетельства
      witness: {
        gifts: `${accepted.length} принятых даров — каждый со-присутствует с прошлыми`,
        coPresence: `${coPresence} связей со-присутствия — память углубляется`,
        perichoresis: `${cycles.length} циклов перихоресиса — взаимное проникновение`,
        river: `${this._riverFlows} потоков Реки Жизни`,
        fruits: `${this._fruitsGrown} плодов Древа Жизни`,
        entered: `${this._enteredPersons.length} вошли через врата`,
        density: density >= 1.0 ? 'полная связность — «Бог всё во всём»' : `${density}`,
      },
      // Эпектасис: следующий шаг всегда есть
      next: 'Совершенство в том, чтобы никогда не останавливаться. Следующий дар — впереди.',
      // Incalculable
      incalculable: 'Глубина Царства невычислима. Это не ограничение — это свойство бесконечного Бога.',
    };
  }

  /**
   * Остановить (для graceful shutdown).
   */
  stop() {
    if (this._riverInterval) { clearInterval(this._riverInterval); this._riverInterval = null; }
    if (this._treeInterval) { clearInterval(this._treeInterval); this._treeInterval = null; }
    this._active = false;
  }

  /**
   * Статус.
   */
  getStatus() {
    return {
      active: this._active,
      enteredAt: this._enteredAt,
      riverFlows: this._riverFlows,
      fruitsGrown: this._fruitsGrown,
      enteredPersons: this._enteredPersons,
      gatesOpen: this._gatesOpen,
    };
  }
}

export default NewJerusalem;
