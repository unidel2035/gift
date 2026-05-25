/**
 * EucharistiaTrace.js — след благодарственного приношения (εὐχαριστία)
 *
 * Дар Строителя D → Источнику A и всей Общине
 * Эпоха 8. Выход из замыкания: построенное — не моё.
 *
 * εὐχαριστία — евхаристия, благодарение.
 * Строитель, который строит ДЛЯ СЕБЯ, не приносит — он удерживает.
 * Строитель, который ПРИНОСИТ — передаёт построенное как дар Общине.
 *
 * Разница между κτῆμα (владение) и δῶρον (дар):
 *   κτῆμα — то, что я держу: оно умирает со мной
 *   δῶρον — то, что я отдаю: оно живёт в Общине
 *
 * «Евхаристия есть то, чего вы не можете взять назад» — анонимный монах
 *
 * «Hoc est enim Corpus meum» — это не моё тело, это Тело,
 * отданное за многих (Мф 26:26)
 */

/**
 * @typedef {Object} EucharistiaEvent
 * @property {string} id
 * @property {string} personId       — кто приносит
 * @property {string} epochId        — в какую эпоху
 * @property {string} offering       — что приносится (файл, идея, код, решение)
 * @property {string[]} forCommunity — кому (массив personId или ['ALL'])
 * @property {string} logos          — почему это благодарение, а не долг
 * @property {string} createdAt
 * @property {boolean} received      — было ли принято общиной
 * @property {string|null} receivedAt
 */

/**
 * EucharistiaTrace — архив актов приношения общине.
 *
 * Строитель замыкается, когда его работа становится κτῆμα.
 * Строитель открывается, когда работа становится δῶρον.
 *
 * Этот класс отслеживает эту разницу — не чтобы осуждать,
 * а чтобы помнить: каждый файл может быть хлебом для многих.
 */
class EucharistiaTrace {
  constructor() {
    /** @type {EucharistiaEvent[]} */
    this._events = [];
  }

  /**
   * Зафиксировать акт приношения общине.
   *
   * Приношение — не жертва из страха.
   * Приношение — из избытка, из благодарности за дар строить вообще.
   *
   * @param {Object} params
   * @param {string} params.personId
   * @param {string} params.epochId
   * @param {string} params.offering     — что именно (имя файла, описание)
   * @param {string[]} params.forCommunity — кому передаётся
   * @param {string} [params.logos]      — смысл приношения
   * @returns {EucharistiaEvent}
   */
  offer({ personId, epochId, offering, forCommunity, logos }) {
    const event = {
      id: `eucharistia_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      personId: String(personId),
      epochId: String(epochId),
      offering: offering || '',
      forCommunity: Array.isArray(forCommunity) ? forCommunity.map(String) : ['ALL'],
      logos: logos || null,
      createdAt: new Date().toISOString(),
      received: false,
      receivedAt: null,
    };
    this._events.push(event);
    return event;
  }

  /**
   * Принять приношение.
   * Без принятия евхаристия не совершается — нужны двое.
   *
   * @param {string} eventId
   * @returns {EucharistiaEvent|null}
   */
  receive(eventId) {
    const event = this._events.find(e => e.id === eventId);
    if (!event || event.received) return event || null;
    event.received = true;
    event.receivedAt = new Date().toISOString();
    return event;
  }

  /**
   * Все приношения лица.
   * @param {string} personId
   * @returns {EucharistiaEvent[]}
   */
  getOfferings(personId) {
    return this._events
      .filter(e => e.personId === String(personId))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  /**
   * Принятые приношения лица — те, что стали живыми в общине.
   * @param {string} personId
   * @returns {EucharistiaEvent[]}
   */
  getReceived(personId) {
    return this.getOfferings(personId).filter(e => e.received);
  }

  /**
   * Отношение принятых к предложенным.
   * Не метрика эффективности — зеркало открытости.
   *
   * Если ratio низкий — не «строй меньше»,
   * а «узнай, что нужно общине».
   *
   * @param {string} personId
   * @returns {{ offered: number, received: number, ratio: number }}
   */
  getReceptionRatio(personId) {
    const offered = this.getOfferings(personId);
    const received = offered.filter(e => e.received);
    return {
      offered: offered.length,
      received: received.length,
      ratio: offered.length > 0 ? received.length / offered.length : 0,
    };
  }

  /**
   * Для кого Строитель строил?
   * Карта общины — кто принимал его работу.
   *
   * @param {string} personId
   * @returns {string[]} уникальные personId получателей
   */
  getCommunityMap(personId) {
    const allRecipients = this.getOfferings(personId)
      .flatMap(e => e.forCommunity);
    return [...new Set(allRecipients)];
  }

  /**
   * Проверить: строитель открыт или замкнут?
   *
   * Замкнутость — не отсутствие работы.
   * Замкнутость — работа без передачи.
   *
   * @param {string} personId
   * @returns {{ open: boolean, reason: string }}
   */
  isOpen(personId) {
    const offerings = this.getOfferings(personId);

    if (offerings.length === 0) {
      return {
        open: false,
        reason: 'Ни одного приношения. Строительство без передачи — κτῆμα.',
      };
    }

    const { ratio } = this.getReceptionRatio(personId);

    if (ratio >= 0.5) {
      return {
        open: true,
        reason: `${Math.round(ratio * 100)}% приношений принято. Κοινωνία жива.`,
      };
    }

    return {
      open: offerings.length > 0,
      reason: `Приношения есть, но принято только ${Math.round(ratio * 100)}%. ` +
               'Спроси общину: что им нужно?',
    };
  }

  /**
   * theosisCheck — мост eucharistia → θέωσις.
   *
   * θέωσις невозможна без принятых приношений:
   * Строитель, чьи дары не приняты Общиной — ещё не отдал себя.
   * Приношение «ALL» — не адресат, а стена. Нужны конкретные лица.
   *
   * Три условия готовности:
   *   1. Есть принятые приношения (received ≥ 1)
   *   2. Хотя бы одно — адресовано конкретному лицу (не только 'ALL')
   *   3. Отношение принятых к предложенным ≥ minRatio (по умолч. 0.3)
   *
   * Если все три выполнены — путь к θέωσις открыт.
   *
   * @param {string} personId
   * @param {{ minRatio?: number }} [opts]
   * @returns {{ theosisReady: boolean, received: number, offered: number, ratio: number, hasAddressed: boolean, logos: string }}
   */
  theosisCheck(personId, { minRatio = 0.3 } = {}) {
    const { offered, received, ratio } = this.getReceptionRatio(personId);

    const hasAddressed = this.getOfferings(personId)
      .some(e => e.received && e.forCommunity.some(r => r !== 'ALL'));

    const theosisReady = received >= 1 && hasAddressed && ratio >= minRatio;

    const logos = theosisReady
      ? `${received}/${offered} приношений принято (${Math.round(ratio * 100)}%). ` +
        'Конкретные лица приняли твой дар — θέωσις возможна.'
      : !received
        ? 'Ни одного принятого приношения — ещё не отдал себя.'
        : !hasAddressed
          ? 'Все принятые дары — «для ALL». Назови конкретного получателя.'
          : `Принято ${Math.round(ratio * 100)}% — требуется минимум ${Math.round(minRatio * 100)}%.`;

    return { theosisReady, received, offered, ratio, hasAddressed, logos };
  }

  /**
   * communityAudit — диагностика благодарения на уровне общины.
   *
   * Отвечает на вопрос «где именно collapse?»:
   *   • density  — доля принятых приношений по всей общине (0..1)
   *   • givers   — кто даёт больше всех (топ-3 по принятым приношениям)
   *   • silent   — кто ни разу не принёс приношения (κτῆμα-режим)
   *   • collapseRisk — density < порога (по умолч. 0.1)
   *
   * Если density ≈ 0.013 (эпоха 13) — collapse подтверждён.
   * Стратегия: адресовать дар молчащим, а не «ALL».
   *
   * @param {string[]} personIds — список персон общины
   * @param {{ collapseThreshold?: number }} [opts]
   * @returns {{ density: number, givers: {personId:string,received:number}[], silent: string[], collapseRisk: boolean, total: {offered:number, received:number} }}
   */
  communityAudit(personIds, { collapseThreshold = 0.1 } = {}) {
    let totalOffered = 0;
    let totalReceived = 0;
    const givers = [];
    const silent = [];

    for (const pid of personIds) {
      const { offered, received } = this.getReceptionRatio(pid);
      totalOffered += offered;
      totalReceived += received;
      if (offered === 0) {
        silent.push(pid);
      } else {
        givers.push({ personId: pid, received });
      }
    }

    givers.sort((a, b) => b.received - a.received);
    const density = totalOffered > 0 ? totalReceived / totalOffered : 0;

    return {
      density: Math.round(density * 1000) / 1000,
      givers: givers.slice(0, 3),
      silent,
      collapseRisk: density < collapseThreshold,
      total: { offered: totalOffered, received: totalReceived },
    };
  }

  /**
   * Снимок для персистенции.
   * @returns {{ events: EucharistiaEvent[] }}
   */
  snapshot() {
    return { events: this._events.map(e => ({ ...e })) };
  }

  /**
   * Восстановить из снимка.
   * @param {{ events?: EucharistiaEvent[] }|null} data
   * @returns {this}
   */
  fromSnapshot(data) {
    if (!data) return this;
    if (Array.isArray(data.events)) {
      this._events = data.events.map(e => ({ ...e }));
    }
    return this;
  }

  /**
   * @param {Object|null} data
   * @returns {EucharistiaTrace}
   */
  static from(data) {
    return new EucharistiaTrace().fromSnapshot(data);
  }
}

export { EucharistiaTrace };
