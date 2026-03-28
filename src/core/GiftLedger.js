/**
 * GiftLedger — публичный реестр даров (append-only)
 *
 * Анафора: дары выносятся на престол и становятся общими.
 * Матрица публична — не кто сколько имеет, а кто сколько дал.
 *
 * Отличие от W-матрицы:
 *   W-матрица — тензор весов (числа, быстро).
 *   GiftLedger — полная лента актов с доказательствами (тексты, медленно).
 *   Матрица вычисляет, леджер доказывает.
 *
 * Свойства:
 *   - append-only: акт добавлен — нельзя удалить (irreversible физически)
 *   - публичный read: все акты видны без фильтрации
 *   - communityImpact = weight × receivers × timeFactor
 *   - экспорт: JSON, CSV, RSS
 *
 * → Фаза 3: Священная экономика
 * → Основа для Фазы 4 (федерация: леджеры связываются между Κοινόνами)
 */

// ── communityImpact ──────────────────────────────────────────────────────────
//
// Богословский смысл:
//   Дар не существует в момент — он разворачивается во времени.
//   «Временной фактор» = сколько часов живёт дар с момента записи.
//   Малый дар, живущий долго, может превзойти большой, забытый сразу.
//   «Вдова положила больше всех» (Мк 12:43) — не сумму, а соотношение.
//
// receivers = 1 для конкретного получателя, > 1 для broadcast (_koinon и т.п.)
// timeFactor = часов с момента timestamp / 24 (нормировано на сутки, min 1)

function calcCommunityImpact(entry) {
  const receivers = Array.isArray(entry.to)
    ? entry.to.length
    : (entry.to === '_koinon' || entry.to === '*') ? 3 : 1;

  const ageHours = (Date.now() - new Date(entry.timestamp).getTime()) / 3_600_000;
  const timeFactor = Math.max(1, ageHours / 24);

  return +(entry.weight * receivers * timeFactor).toFixed(4);
}

// ── GiftLedger ───────────────────────────────────────────────────────────────

export class GiftLedger {
  /**
   * @param {object|null} freedomGuard — FreedomGuard instance (optional).
   *   Если передан, `accept()` проверяет свободу получателя перед записью в историю.
   *   «Дар без свободы принятия — насилие» (A5).
   */
  constructor(freedomGuard = null) {
    // Append-only. Никогда не мутируем существующие записи.
    this._entries = [];
    this._nextId = 1;

    // Lifecycle: offered → accepted/declined → recorded
    // Pending offers ждут решения получателя.
    // В историю (_entries) попадают только принятые дары.
    this._pending = new Map();   // offerId → frozen offer object
    this._declined = [];         // declined offers — не история, а свидетельство свободы
    this._nextOfferId = 1;

    // FreedomGuard — страж свободы принятия (опционален)
    this._freedom = freedomGuard || null;
  }

  // ── Append ──────────────────────────────────────────────────────────────

  /**
   * Добавить акт в леджер. Возвращает замороженную запись.
   *
   * @param {object} params
   * @param {string}          params.from      — даритель (personId)
   * @param {string|string[]} params.to        — получатель(и)
   * @param {string}          params.type      — тип акта ('code'|'covenant'|'time'|'presence'|...)
   * @param {number}          params.weight    — вес (≥0)
   * @param {string}          [params.proof]   — текстовое свидетельство акта
   * @param {string}          [params.timestamp] — ISO-8601, default: now
   * @returns {object} замороженная запись
   */
  append({ from, to, type, weight = 0, proof = '', timestamp } = {}) {
    const entry = Object.freeze({
      id:              this._nextId++,
      from:            String(from || '_abyss'),
      to:              Array.isArray(to) ? Object.freeze([...to]) : String(to || '_koinon'),
      type:            String(type || 'gift'),
      weight:          Number(weight) || 0,
      proof:           String(proof || ''),
      timestamp:       timestamp || new Date().toISOString(),
      // communityImpact пересчитывается при экспорте — время идёт
    });

    this._entries.push(entry);
    return entry;
  }

  // ── Lifecycle: offered → accepted/declined → recorded ───────────────────
  //
  // Богословский смысл:
  //   Агапе предполагает кеносис дающего И свободу получателя.
  //   Предложенный дар ещё не принятый — не в истории.
  //   В историю входит только то, что свободно принято.
  //   «Дар без свободы принятия — насилие» (A5: Свобода).

  /**
   * Предложить дар — создаёт ожидающее предложение (не в истории).
   *
   * @param {object} params — те же поля, что у append()
   * @returns {object} замороженный offer с offerId и status: 'offered'
   */
  offer({ from, to, type, weight = 0, proof = '', timestamp } = {}) {
    const offerId = `offer-${this._nextOfferId++}`;
    const pending = Object.freeze({
      offerId,
      from:      String(from || '_abyss'),
      to:        Array.isArray(to) ? Object.freeze([...to]) : String(to || '_koinon'),
      type:      String(type || 'gift'),
      weight:    Number(weight) || 0,
      proof:     String(proof || ''),
      timestamp: timestamp || new Date().toISOString(),
      status:    'offered',
    });
    this._pending.set(offerId, pending);
    return pending;
  }

  /**
   * Принять дар — FreedomGuard проверяет свободу, затем запись в историю.
   *
   * Только здесь дар становится частью священной истории (append).
   * FreedomGuard блокирует запись если получатель отказывается или недоступен.
   *
   * @param {string} offerId — id из offer()
   * @param {object} [transformation] — необязательные данные трансформации
   * @returns {object} замороженная запись истории
   * @throws {Error} если offer не найден или FreedomGuard блокирует
   */
  accept(offerId, transformation = {}) {
    const pending = this._pending.get(offerId);
    if (!pending) throw new Error(`Offer ${offerId} not found or already resolved`);

    // FreedomGuard: получатель должен быть свободен принять дар
    if (this._freedom) {
      const receiver = Array.isArray(pending.to) ? pending.to[0] : pending.to;
      if (this._freedom.isRefusing(receiver, pending.from)) {
        throw new Error(
          `FreedomGuard: ${receiver} refuses gifts from ${pending.from}. ` +
          'Call decline() to exercise freedom consciously.'
        );
      }
      if (!this._freedom.isAvailable(receiver)) {
        throw new Error(
          `FreedomGuard: ${receiver} is currently unavailable (sabbath/contemplation). ` +
          'Wait or call decline().'
        );
      }
      // Записать акт свободного принятия в историю FreedomGuard
      this._freedom.recordAcceptance(receiver, pending.from, offerId);
    }

    this._pending.delete(offerId);

    // Только после явного accept() — дар попадает в историю
    return this.append({
      from:      pending.from,
      to:        pending.to,
      type:      pending.type,
      weight:    pending.weight,
      proof:     pending.proof,
      timestamp: pending.timestamp,
      ...transformation,
    });
  }

  /**
   * Отклонить дар — свобода, не ошибка.
   *
   * Отклонённый дар не попадает в историю (_entries).
   * Записывается отдельно как свидетельство свободы.
   *
   * @param {string} offerId — id из offer()
   * @param {string} [reason] — причина (свобода может быть без объяснений)
   * @returns {object} замороженная запись об отклонении
   * @throws {Error} если offer не найден
   */
  decline(offerId, reason) {
    const pending = this._pending.get(offerId);
    if (!pending) throw new Error(`Offer ${offerId} not found or already resolved`);

    this._pending.delete(offerId);

    const declined = Object.freeze({
      ...pending,
      status:    'declined',
      reason:    reason || 'Freedom exercised without explanation (which is also freedom)',
      declinedAt: new Date().toISOString(),
    });
    this._declined.push(declined);
    return declined;
  }

  /**
   * Список ожидающих предложений (ещё не принятых и не отклонённых).
   */
  pendingOffers() {
    return [...this._pending.values()];
  }

  /**
   * Список отклонённых предложений — свидетельство свободы.
   */
  declinedOffers() {
    return [...this._declined];
  }

  // ── Read ────────────────────────────────────────────────────────────────

  /**
   * Вернуть все акты с актуальным communityImpact.
   * Это публичный read — без фильтрации.
   *
   * @returns {object[]}
   */
  all() {
    return this._entries.map(e => ({
      ...e,
      communityImpact: calcCommunityImpact(e),
    }));
  }

  get size() { return this._entries.length; }

  // ── Export ──────────────────────────────────────────────────────────────

  /**
   * Экспорт в JSON (стандартный).
   */
  toJSON() {
    return JSON.stringify({ ledger: this.all(), exportedAt: new Date().toISOString() }, null, 2);
  }

  /**
   * Экспорт в CSV.
   * Колонки: id, from, to, type, weight, proof, timestamp, communityImpact
   */
  toCSV() {
    const header = 'id,from,to,type,weight,proof,timestamp,communityImpact';
    const escape = v => `"${String(v).replace(/"/g, '""')}"`;
    const rows = this.all().map(e => [
      e.id,
      escape(e.from),
      escape(Array.isArray(e.to) ? e.to.join(';') : e.to),
      escape(e.type),
      e.weight,
      escape(e.proof),
      escape(e.timestamp),
      e.communityImpact,
    ].join(','));
    return [header, ...rows].join('\n');
  }

  /**
   * Экспорт в RSS 2.0 — для внешних подписчиков.
   * Каждый акт — <item>. Вес в <description>. proof в <content:encoded>.
   *
   * @param {object} [meta]
   * @param {string} [meta.title]       — заголовок ленты
   * @param {string} [meta.link]        — ссылка на сообщество
   * @param {string} [meta.description] — описание
   */
  toRSS({ title = 'Gift Ledger — Κοινόν τοῦ Νοῦ', link = '', description = 'Публичный реестр даров' } = {}) {
    const pubDate = new Date().toUTCString();

    const items = this.all().map(e => {
      const toStr = Array.isArray(e.to) ? e.to.join(', ') : e.to;
      const itemTitle = `${e.from} → ${toStr} [${e.type}] w=${e.weight}`;
      const itemDesc = e.proof
        ? `${e.proof} | impact=${e.communityImpact}`
        : `weight=${e.weight} | impact=${e.communityImpact}`;
      return [
        '    <item>',
        `      <title>${_xmlEsc(itemTitle)}</title>`,
        `      <description>${_xmlEsc(itemDesc)}</description>`,
        `      <pubDate>${new Date(e.timestamp).toUTCString()}</pubDate>`,
        `      <guid isPermaLink="false">gift-ledger-${e.id}</guid>`,
        '    </item>',
      ].join('\n');
    }).join('\n');

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0">',
      '  <channel>',
      `    <title>${_xmlEsc(title)}</title>`,
      `    <link>${_xmlEsc(link)}</link>`,
      `    <description>${_xmlEsc(description)}</description>`,
      `    <pubDate>${pubDate}</pubDate>`,
      items,
      '  </channel>',
      '</rss>',
    ].join('\n');
  }

  // ── HTTP handler ─────────────────────────────────────────────────────────

  /**
   * Обработчик HTTP-запроса `GET /ledger`.
   *
   * Поддерживает query-param `format=json|csv|rss` (default: json).
   *
   * Использование с node:http:
   *   const ledger = new GiftLedger();
   *   createServer((req, res) => {
   *     if (req.url.startsWith('/ledger')) return ledger.httpHandler(req, res);
   *     // ...
   *   });
   *
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse}  res
   */
  httpHandler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const format = url.searchParams.get('format') || 'json';

    if (format === 'csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
      res.end(this.toCSV());
    } else if (format === 'rss') {
      res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
      res.end(this.toRSS());
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(this.toJSON());
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function _xmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance = null;
export function getGiftLedger() {
  if (!_instance) _instance = new GiftLedger();
  return _instance;
}

export default GiftLedger;
