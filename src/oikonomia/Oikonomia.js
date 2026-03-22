/**
 * Oikonomia — Οἰκονομία τοῦ Δώρου
 *
 * Координатор хозяйства на основе Онтологии Дара.
 * Не замена GiftEngine — расширение, использующее его как основание.
 *
 * Центральный тезис: бытие — дар, а не данность.
 * Хозяйствование — не обмен ограниченных ресурсов,
 * а управление потоком даров.
 *
 * 9 подсистем:
 *   1. ExchangeGuard — различение дара и обмена
 *   2. AccountingLedger — координационный счёт (деньги)
 *   3. Prosfora — приношения от домохозяйств
 *   4. Jubilee — юбилейные циклы
 *   5. OikosRegistry — реестр домохозяйств
 *   6. FlowObserver — наблюдатель потока
 *   7. Koinon — общий фонд
 *   8. PerichoresisCycle — перихоретические циклы
 *   9. Oikonomia — этот координатор
 *
 * «Οἰκονομία» значит «устроение дома» (οἶκος + νόμος).
 * Это слово отцы Церкви используют для Домостроительства Спасения.
 */

import ExchangeGuard from './ExchangeGuard.js';
import AccountingLedger from './AccountingLedger.js';
import Prosfora from './Prosfora.js';
import Jubilee from './Jubilee.js';
import OikosRegistry from './OikosRegistry.js';
import FlowObserver from './FlowObserver.js';
import Koinon from './Koinon.js';
import PerichoresisCycle from './PerichoresisCycle.js';

let _instance = null;

class Oikonomia {
  /**
   * @param {import('../GiftEngine.js').GiftEngine} engine
   */
  constructor(engine) {
    this.engine = engine;

    // ── Day 2: Accounting (parallel journal) ────────────────
    this.ledger = new AccountingLedger();

    // ── Day 1: Exchange Guard (distinguish gift from exchange) ──
    this.exchangeGuard = new ExchangeGuard({
      eventStore: engine._eventStore,
      eventBus: engine._eventBus,
      gratitude: engine.gratitude,
    });

    // ── Day 3: Prosfora (offerings) ────────────────────────
    this.prosfora = new Prosfora({
      eventStore: engine._eventStore,
      eventBus: engine._eventBus,
      ledger: this.ledger,
    });

    // ── Day 4: Jubilee (liturgical cycles) ──────────────────
    this.jubilee = new Jubilee({
      eventBus: engine._eventBus,
      clock: engine.clock,
      anamnesis: engine.anamnesis,
      eventStore: engine._eventStore,
    });

    // ── Day 5: Oikos Registry (households) ──────────────────
    this.oikoi = new OikosRegistry({
      eventBus: engine._eventBus,
      persons: engine.persons,
    });

    // ── Perichoresis (trinitarian cycle observer) ────────────
    this.perichoresis = new PerichoresisCycle({
      eventStore: engine._eventStore,
      gratitude: engine.gratitude,
    });

    // ── Koinon (common fund) ─────────────────────────────────
    this.koinon = new Koinon({
      eventBus: engine._eventBus,
      ledger: this.ledger,
    });

    // ── Flow Observer (stream observation) ───────────────────
    this.flowObserver = new FlowObserver({
      eventStore: engine._eventStore,
      eventBus: engine._eventBus,
      gratitude: engine.gratitude,
      ledger: this.ledger,
      oikoi: this.oikoi,
      exchangeGuard: this.exchangeGuard,
    });
  }

  // ── API: Oikos (households) ────────────────────────────────

  registerOikos(data) { return this.oikoi.register(data); }
  getOikos(id) { return this.oikoi.get(id); }
  listOikoi() { return this.oikoi.list(); }
  oikosMembers(id) {
    const oikos = this.oikoi.get(id);
    return oikos ? oikos.members : [];
  }
  expressNeed(oikosId, need) { return this.oikoi.expressNeed(oikosId, need); }
  unmetNeeds() { return this.oikoi.unmetNeeds(); }
  entrust(oikosId, item) { return this.oikoi.entrust(oikosId, item); }

  // ── API: Prosfora (offerings) ──────────────────────────────

  offerProsfora(data) { return this.prosfora.offer(data); }
  receiveProsfora(id, receiverId) { return this.prosfora.receive(id, receiverId); }
  availableOfferings() { return this.prosfora.available(); }
  matchNeedsToOfferings() {
    const needs = this.oikoi.unmetNeeds();
    return this.prosfora.matchNeeds(needs);
  }

  // ── API: Koinon (common fund) ──────────────────────────────

  contributeToKoinon(data) { return this.koinon.contribute(data); }
  sustainFromKoinon(data) { return this.koinon.sustain(data); }
  koinonStatus() { return this.koinon.status(); }

  // ── API: Money (accounting) ────────────────────────────────

  recordMoneyFlow(entry) { return this.ledger.record(entry); }
  moneyFlow(entityId) { return entityId ? this.ledger.flowFor(entityId) : this.ledger.totalFlow(); }

  // ── API: Exchange Guard ────────────────────────────────────

  checkExchange(giftId) {
    const gift = this.engine._eventStore.getById(giftId);
    if (!gift) return { error: 'Дар не найден' };
    return this.exchangeGuard.analyze(gift);
  }
  exchangeAlerts() { return this.exchangeGuard.getAlerts(); }

  // ── API: Flow & Perichoresis ───────────────────────────────

  observeFlow() { return this.flowObserver.observe(); }
  observePerichoresis() { return this.perichoresis.observe(); }

  // ── API: Jubilee ───────────────────────────────────────────

  declareJubilee(opts) { return this.jubilee.declare(opts); }
  jubileeStatus() { return this.jubilee.status(); }
  needsJubilee() {
    const alerts = this.exchangeGuard.getAlerts();
    const wounds = this.engine.fall ? this.engine.fall.observe() : [];
    return this.jubilee.needsJubilee(alerts, wounds);
  }

  // ── API: Health (aggregate) ────────────────────────────────

  /**
   * Overall health of the oikonomia.
   */
  health() {
    const flow = this.flowObserver.observe();
    const perichoresis = this.perichoresis.observe();
    const koinon = this.koinon.balance();
    const exchange = this.exchangeGuard.observeAll();
    const jubilee = this.jubilee.status();
    const oikoi = this.oikoi.list();
    const needs = this.oikoi.unmetNeeds();

    return {
      oikoi: {
        count: oikoi.length,
        totalMembers: oikoi.reduce((s, o) => s + o.members.length, 0),
      },
      flow: {
        rate: flow.flowRate,
        direction: flow.flowDirection,
        stagnation: flow.stagnation,
        verticalAxis: flow.verticalAxis,
      },
      perichoresis: {
        perichoretic: perichoresis.perichoretic,
        triads: perichoresis.triads.length,
        dyads: perichoresis.dyads.length,
        isolates: perichoresis.isolates.length,
      },
      exchange: {
        alertCount: exchange.withAlerts,
        observation: exchange.observation,
      },
      koinon: {
        balance: koinon.balance,
        observation: koinon.observation,
      },
      needs: {
        unmet: needs.length,
        recent: needs.slice(0, 3),
      },
      jubilee: {
        totalDeclared: jubilee.totalJubilees,
        lastJubilee: jubilee.lastJubilee,
      },
      // Apophatic boundaries
      apophasis: [
        'Справедливая цена не существует — дар превышает любую цену',
        'Эффективность — категория обмена, не дара',
        'Достаточность — тайна между лицом и Богом',
        'Заслуга — если заслужен, это зарплата, не дар',
      ],
    };
  }

  /**
   * Logoi of all economic entities.
   */
  logoi() {
    return [
      {
        name: 'Λόγος труда (ἔργον)',
        physis: 'Труд — со-творчество с Богом. Человек продолжает творение.',
        telos: 'Труд существует ради другого — чтобы плод был подарен.',
        kataPhysin: 'Трудится, потому что λόγος включает это дело. Плод — дар общине.',
        paraPhysin: 'Труд ради накопления. Труд как товар. Труд без покоя.',
        hyperPhysin: 'Жертвенный труд — кеносис. Отдать больше, чем «должен».',
      },
      {
        name: 'Λόγος денег (νόμισμα)',
        physis: 'Деньги — знак доверия общины. Не стоимость, а свидетельство.',
        telos: 'Координация материальных потоков. Ирригация, не вода.',
        kataPhysin: 'Деньги текут: приход → использование → уход.',
        paraPhysin: 'Накопление. Ростовщичество. Цена на всё.',
        hyperPhysin: 'Вдова с двумя лептами — деньги как знак кеносиса.',
      },
      {
        name: 'Λόγος собственности (κτῆσις)',
        physis: 'Ответственное попечение, не владение. «Господня земля» (Пс 23:1).',
        telos: 'Чтобы через собственность можно было дарить.',
        kataPhysin: 'Попечитель использует вверенное для дарения.',
        paraPhysin: 'Собственность как идентичность. Накопление. Закрытие доступа.',
        hyperPhysin: 'Отказ ради другого. Общинное владение (Деян 2:44).',
      },
      {
        name: 'Λόγος нужды (χρεία)',
        physis: 'Нужда — открытость для дара. Кто не нуждается — не может принять.',
        telos: 'Нужда одного зовёт дар другого. Без нужды дар некуда излить.',
        kataPhysin: 'Нужда высказана свободно. Принимается без стыда.',
        paraPhysin: 'Нужда скрытая (гордыня). Искусственная (потребительство). Как манипуляция.',
      },
      {
        name: 'Λόγος общины (κοινωνία)',
        physis: 'Община — общение лиц, не экономическая единица.',
        telos: 'Κοινωνία — плод потока даров.',
        kataPhysin: 'Дары текут между ойкосами. Перихоресис.',
        paraPhysin: 'Община = рынок. Отношения = транзакции.',
        hyperPhysin: 'Деяния 2:42-47 — «у всех было одно сердце и одна душа».',
      },
    ];
  }

  // ── Persistence ────────────────────────────────────────────

  toJSON() {
    return {
      ledger: this.ledger.toJSON(),
      prosfora: this.prosfora.toJSON(),
      jubilee: this.jubilee.toJSON(),
      oikoi: this.oikoi.toJSON(),
      koinon: this.koinon.toJSON(),
    };
  }

  fromJSON(data) {
    if (!data) return;
    if (data.ledger) this.ledger.fromJSON(data.ledger);
    if (data.prosfora) this.prosfora.fromJSON(data.prosfora);
    if (data.jubilee) this.jubilee.fromJSON(data.jubilee);
    if (data.oikoi) this.oikoi.fromJSON(data.oikoi);
    if (data.koinon) this.koinon.fromJSON(data.koinon);
  }

  // ── Singleton ──────────────────────────────────────────────

  static init(engine) {
    if (!_instance) _instance = new Oikonomia(engine);
    return _instance;
  }

  static get() { return _instance; }
  static reset() { _instance = null; }
}

export { Oikonomia };
export default Oikonomia;
