/**
 * KoinonFederation — протокол соборного единства между матрицами
 *
 * Богословие:
 *   Соборность — единство не в единоначалии, а в общности даров.
 *   Несколько Κοινόνов (православные приходы, НКО, школы) обмениваются
 *   дарами через границы своих общин.
 *
 * Архитектура:
 *   Κοινόν A (W_a) ←→ Federation Protocol ←→ Κοινόν B (W_b)
 *                           ↕ sync
 *                      Global W = weighted avg(W_a, W_b, ...)
 *
 * Формат межобщинного адреса: "koinon-id/person-id"
 *   Пример: "koinon-dion/_claude" или "koinon-b/Дионисий"
 *   Локальный без "/": просто "Дионисий"
 *
 * Пасхальная синхронизация:
 *   Пасха → глобальный событийный пик (межобщинные нити × paschaMultiplier)
 *
 * Источник: Дионисий Ареопагит, О церковной иерархии —
 *   «Иерархия есть священный чин, знание и деятельность,
 *    по возможности уподобляющиеся Богоначалию»
 *
 * HTTP-клиент без внешних зависимостей (node:http / node:https).
 */

import { request as httpRequest }  from 'node:http';
import { request as httpsRequest } from 'node:https';

// ── Версия протокола ────────────────────────────────────────────────────────
const PROTOCOL_VERSION = 'koinon-federation/1.0';

// ── KoinonFederation ────────────────────────────────────────────────────────

export class KoinonFederation {
  /**
   * @param {string}     selfId   — идентификатор этого Κοινόν (напр. 'koinon-dion')
   * @param {GiftMemory} memory   — локальная W-матрица
   * @param {object}     options
   *   @param {string} [options.url]              — публичный URL этого узла (http://host:port)
   *   @param {number} [options.paschaMultiplier] — множитель веса в Пасху (default: 7)
   *   @param {number} [options.fetchTimeout]     — таймаут HTTP (мс, default: 10000)
   */
  constructor(selfId, memory, options = {}) {
    this.selfId            = selfId;
    this.selfUrl           = options.url ?? null;
    this.memory            = memory;
    this._peers            = new Map();   // peerId → PeerRecord
    this._interActsLog     = [];          // межобщинные акты
    this._paschaMultiplier = options.paschaMultiplier ?? 7;
    this._fetchTimeout     = options.fetchTimeout ?? 10_000;
  }

  // ── Рукопожатие ───────────────────────────────────────────────────────────

  /**
   * connect(peerUrl) — инициировать рукопожатие с другим Κοινόν.
   *
   * Отправляет POST {peerUrl}/federation/connect со своим дескриптором.
   * Получает дескриптор соседа. Сохраняет в реестре.
   *
   * @param  {string}  peerUrl  — URL узла-соседа (без trailing slash)
   * @returns {PeerRecord}
   */
  async connect(peerUrl) {
    const baseUrl = peerUrl.replace(/\/$/, '');
    let peerDesc;
    try {
      peerDesc = await this._fetch(`${baseUrl}/federation/connect`, 'POST', this.descriptor());
    } catch (err) {
      throw new Error(`Рукопожатие не удалось (${baseUrl}): ${err.message}`);
    }

    if (!peerDesc?.id) {
      throw new Error(`Сосед не вернул id: ${JSON.stringify(peerDesc)}`);
    }
    if (peerDesc.protocol !== PROTOCOL_VERSION) {
      // Предупреждаем, но не отказываем — прощаем несовпадение версий
      console.warn(`[KoinonFederation] Версия протокола соседа: ${peerDesc.protocol}`);
    }

    const record = {
      id:          peerDesc.id,
      url:         baseUrl,
      n:           peerDesc.n          ?? 0,
      actsCount:   peerDesc.actsCount  ?? 0,
      persons:     peerDesc.persons    ?? [],
      protocol:    peerDesc.protocol   ?? '?',
      connectedAt: new Date().toISOString(),
      lastSyncAt:  null,
    };
    this._peers.set(record.id, record);
    return record;
  }

  /**
   * acceptHandshake(incoming) — принять рукопожатие (вызывается сервером).
   *
   * @param  {object} incoming — дескриптор пришедшего узла
   * @returns {object} свой дескриптор
   */
  acceptHandshake(incoming) {
    if (!incoming?.id) throw new Error('Нет id в дескрипторе рукопожатия');

    const existing = this._peers.get(incoming.id);
    this._peers.set(incoming.id, {
      id:          incoming.id,
      url:         incoming.url   ?? existing?.url ?? null,
      n:           incoming.n     ?? 0,
      actsCount:   incoming.actsCount ?? 0,
      persons:     incoming.persons   ?? [],
      protocol:    incoming.protocol  ?? '?',
      connectedAt: existing?.connectedAt ?? new Date().toISOString(),
      lastSyncAt:  existing?.lastSyncAt  ?? null,
    });

    return this.descriptor();
  }

  // ── Список соседей ────────────────────────────────────────────────────────

  peers() {
    return [...this._peers.values()].map(p => ({
      id:          p.id,
      url:         p.url ?? null,
      n:           p.n,
      actsCount:   p.actsCount,
      connectedAt: p.connectedAt,
      lastSyncAt:  p.lastSyncAt,
    }));
  }

  peerCount() { return this._peers.size; }

  hasPeer(id) { return this._peers.has(id); }

  removePeer(id) { return this._peers.delete(id); }

  // ── Межобщинный адрес ─────────────────────────────────────────────────────

  /**
   * parseAddr("koinon-a/_claude") → { koinon: 'koinon-a', person: '_claude' }
   * parseAddr("Дионисий")         → { koinon: null, person: 'Дионисий' }
   */
  static parseAddr(addr) {
    if (!addr) return { koinon: null, person: null };
    const slash = addr.indexOf('/');
    if (slash < 0) return { koinon: null, person: addr };
    return { koinon: addr.slice(0, slash), person: addr.slice(slash + 1) };
  }

  /** Собрать межобщинный адрес: ('koinon-a', '_claude') → 'koinon-a/_claude' */
  static federatedId(koinonId, personId) {
    return `${koinonId}/${personId}`;
  }

  /**
   * localPersonId(addr) — получить локальный id лица для этого Κοινόν.
   * Если addr принадлежит нам → вернуть person-часть.
   * Если чужой → вернуть полный федеративный адрес (хранится как отдельное лицо).
   */
  localPersonId(addr) {
    const { koinon, person } = KoinonFederation.parseAddr(addr);
    if (!koinon || koinon === this.selfId) return person;
    return addr; // чужой: "koinon-b/Дионисий" хранится как federated id
  }

  // ── Межобщинный акт дара ──────────────────────────────────────────────────

  /**
   * giveAcross(act) — отправить межобщинный акт дара.
   *
   * act.from и act.to могут быть:
   *   - локальными:      "Дионисий"
   *   - межобщинными:    "koinon-b/Дионисий"
   *
   * Записывает в локальную матрицу W (с федеративными id).
   * Если получатель — в другом Κοινόν с известным URL, пересылает туда.
   *
   * @param {{ from: string, to: string, weight?: number, type?: string, content?: string }} act
   */
  async giveAcross(act) {
    const { koinon: fromKoinon, person: fromPerson } = KoinonFederation.parseAddr(act.from);
    const { koinon: toKoinon,   person: toPerson   } = KoinonFederation.parseAddr(act.to);

    // Нормализованные ids для W-матрицы
    const giverId    = (!fromKoinon || fromKoinon === this.selfId)
      ? (fromPerson ?? act.from)
      : act.from;
    const receiverId = (!toKoinon || toKoinon === this.selfId)
      ? (toPerson ?? act.to)
      : act.to;

    // Записать в локальную матрицу
    const localAct = {
      giverId,
      receiverId,
      weight:  act.weight  ?? 1,
      type:    act.type    ?? 'inter-community',
      content: act.content ?? '',
    };
    this.memory.receive(localAct);

    // Если получатель в другом Κοινόн — переслать
    if (toKoinon && toKoinon !== this.selfId) {
      const peer = this._peers.get(toKoinon);
      if (peer?.url) {
        try {
          await this._fetch(`${peer.url}/federation/gift`, 'POST', {
            from:     act.from,
            to:       act.to,
            weight:   act.weight  ?? 1,
            type:     act.type    ?? 'inter-community',
            content:  act.content ?? '',
            _fedFrom: this.selfId,
          });
        } catch (_) {
          // Дар ушёл из нашей руки — связь могла прерваться, анамнезис сохранит
        }
      }
    }

    // Логировать
    this._interActsLog.push({
      ...localAct,
      fedFrom: act.from,
      fedTo:   act.to,
      ts:      new Date().toISOString(),
    });

    return { giverId, receiverId, logged: true };
  }

  /**
   * receiveFromPeer(fedAct) — принять пересланный акт от соседнего Κοινόν.
   * Вызывается сервером при POST /federation/gift.
   */
  receiveFromPeer(fedAct) {
    const giverId    = fedAct.from ? this.localPersonId(fedAct.from) : '_abyss';
    const receiverId = fedAct.to   ? this.localPersonId(fedAct.to)   : '_koinon';

    const act = {
      giverId,
      receiverId,
      weight:  fedAct.weight  ?? 1,
      type:    fedAct.type    ?? 'inter-community',
      content: fedAct.content ?? '',
    };
    this.memory.receive(act);

    this._interActsLog.push({
      ...act,
      fedFrom:   fedAct.from,
      fedTo:     fedAct.to,
      _fedFrom:  fedAct._fedFrom,
      ts:        new Date().toISOString(),
    });

    return { ok: true, giverId, receiverId };
  }

  // ── Глобальный тензор ─────────────────────────────────────────────────────

  /**
   * computeGlobalTensor() — взвешенное среднее матриц всех Κοινόνов.
   *
   * Алгоритм:
   *   1. Загрузить матрицы от всех соседей (GET /federation/matrix)
   *   2. Построить объединённый список лиц с федеративными id
   *   3. Для каждой ячейки (i,j) — взвешенное среднее по всем матрицам,
   *      где оба лица присутствуют
   *      Вес Κοινόν = sqrt(actsCount) — богаче историей → авторитетнее
   *   4. Вернуть в формате snapshot GiftMemory
   *
   * При paschaBoost=true — межобщинные нити умножаются на paschaMultiplier.
   */
  async computeGlobalTensor({ paschaBoost = false } = {}) {
    const localSnap = this.memory.snapshot();
    const snaps = [{ ...localSnap, koinonId: this.selfId }];

    for (const peer of this._peers.values()) {
      if (!peer.url) continue;
      try {
        const snap = await this._fetch(`${peer.url}/federation/matrix`, 'GET');
        if (snap?.persons && Array.isArray(snap.W)) {
          snaps.push({ ...snap, koinonId: peer.id });
          peer.lastSyncAt = new Date().toISOString();
        }
      } catch (_) {
        // Узел недоступен — пропустить
      }
    }

    if (snaps.length === 1) {
      return { ...localSnap, global: false, nodes: 1, nodesIds: [this.selfId] };
    }

    // Объединённый список лиц с федеративными id
    const allPersons = [];
    for (const snap of snaps) {
      for (const p of snap.persons) {
        const fedId = snap.koinonId === this.selfId
          ? p
          : KoinonFederation.federatedId(snap.koinonId, p);
        if (!allPersons.includes(fedId)) allPersons.push(fedId);
      }
    }

    const N = allPersons.length;
    const sumW   = Array.from({ length: N }, () => new Float64Array(N));
    const sumWgt = Array.from({ length: N }, () => new Float64Array(N));

    for (const snap of snaps) {
      const wgt = Math.sqrt(Math.max(1, snap.actsCount));
      for (let si = 0; si < snap.n; si++) {
        for (let sj = 0; sj < snap.n; sj++) {
          const val = snap.W[si][sj];
          if (!val || val === 0) continue;

          const piId = snap.koinonId === this.selfId
            ? snap.persons[si]
            : KoinonFederation.federatedId(snap.koinonId, snap.persons[si]);
          const pjId = snap.koinonId === this.selfId
            ? snap.persons[sj]
            : KoinonFederation.federatedId(snap.koinonId, snap.persons[sj]);

          const gi = allPersons.indexOf(piId);
          const gj = allPersons.indexOf(pjId);
          if (gi < 0 || gj < 0) continue;

          sumW[gi][gj]   += val * wgt;
          sumWgt[gi][gj] += wgt;
        }
      }
    }

    // Нормировать
    const globalW = Array.from({ length: N }, (_, i) =>
      Array.from({ length: N }, (_, j) =>
        sumWgt[i][j] > 0 ? sumW[i][j] / sumWgt[i][j] : 0
      )
    );

    // Пасхальный пик: усиливаем нити между разными Κοινόνами
    if (paschaBoost) {
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          if (globalW[i][j] === 0) continue;
          const ki = KoinonFederation.parseAddr(allPersons[i]).koinon ?? this.selfId;
          const kj = KoinonFederation.parseAddr(allPersons[j]).koinon ?? this.selfId;
          if (ki !== kj) globalW[i][j] *= this._paschaMultiplier;
        }
      }
    }

    return {
      persons:    allPersons,
      n:          N,
      actsCount:  snaps.reduce((s, x) => s + (x.actsCount ?? 0), 0),
      W:          globalW,
      global:     true,
      nodes:      snaps.length,
      nodesIds:   snaps.map(s => s.koinonId),
      computedAt: new Date().toISOString(),
    };
  }

  // ── Пасхальная синхронизация ──────────────────────────────────────────────

  /**
   * paschaDate(year) — дата Православной Пасхи (Юлианский → Григорианский).
   *
   * Алгоритм Миуса для Юлианского Пасхалия.
   * Поправка +13 дней (разница юлианского и григорианского календарей, XX-XXI вв.).
   *
   * @param  {number} year
   * @returns {Date}
   */
  static paschaDate(year) {
    const a = year % 4;
    const b = year % 7;
    const c = year % 19;
    const d = (19 * c + 15) % 30;
    const e = (2 * a + 4 * b - d + 34) % 7;
    const month = Math.floor((d + e + 114) / 31); // 3=март, 4=апрель
    const day   = ((d + e + 114) % 31) + 1;

    // Julian → Gregorian: +13 дней
    const julian = new Date(year, month - 1, day);
    julian.setDate(julian.getDate() + 13);
    return julian;
  }

  /**
   * isPascha(date?) — является ли эта дата Православной Пасхой.
   */
  isPascha(date = new Date()) {
    const pascha = KoinonFederation.paschaDate(date.getFullYear());
    return date.getMonth() === pascha.getMonth() &&
           date.getDate()  === pascha.getDate();
  }

  /**
   * onPascha(year?) — Пасхальная синхронизация.
   *
   * 1. Вычислить дату Пасхи
   * 2. Собрать глобальный тензор с paschaBoost
   * 3. Вернуть: paschaDate, globalTensor, multiplier, Христос воскресе
   */
  async onPascha(year = new Date().getFullYear()) {
    const paschaDate   = KoinonFederation.paschaDate(year);
    const globalTensor = await this.computeGlobalTensor({ paschaBoost: true });

    return {
      paschaDate:    paschaDate.toISOString().split('T')[0],
      year,
      multiplier:    this._paschaMultiplier,
      globalTensor,
      message:       'Χριστὸς ἀνέστη! Ἀληθῶς ἀνέστη! — Христос воскресе! Воистину воскресе!',
    };
  }

  // ── Дескриптор ────────────────────────────────────────────────────────────

  /**
   * descriptor() — сериализация для рукопожатия.
   */
  descriptor() {
    return {
      id:        this.selfId,
      url:       this.selfUrl,
      n:         this.memory.n,
      actsCount: this.memory.actsCount,
      persons:   this.memory.persons,
      protocol:  PROTOCOL_VERSION,
    };
  }

  // ── Снапшот для экспорта ──────────────────────────────────────────────────

  /**
   * matrixSnapshot() — экспорт матрицы для GET /federation/matrix.
   */
  matrixSnapshot() {
    return {
      ...this.memory.snapshot(),
      koinonId: this.selfId,
    };
  }

  // ── История межобщинных актов ─────────────────────────────────────────────

  interCommunityActs(limit = 50) {
    return this._interActsLog.slice(-limit);
  }

  // ── HTTP-клиент (без внешних зависимостей) ────────────────────────────────

  /**
   * _fetch(url, method, body) — HTTP запрос, возвращает JSON.
   * Поддерживает http:// и https://.
   */
  _fetch(url, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
      let parsed;
      try { parsed = new URL(url); } catch (e) { return reject(e); }

      const isHttps = parsed.protocol === 'https:';
      const lib     = isHttps ? httpsRequest : httpRequest;
      const payload = body ? JSON.stringify(body) : null;

      const options = {
        hostname: parsed.hostname,
        port:     parsed.port || (isHttps ? 443 : 80),
        path:     parsed.pathname + (parsed.search || ''),
        method,
        headers: {
          'Content-Type':  'application/json',
          'Accept':        'application/json',
          'X-Koinon-Id':   this.selfId,
          'X-Protocol':    PROTOCOL_VERSION,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: this._fetchTimeout,
      };

      const req = lib(options, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Не JSON (HTTP ${res.statusCode}): ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Таймаут ${this._fetchTimeout}мс: ${url}`));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }
}
