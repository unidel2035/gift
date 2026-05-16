/**
 * MetanoiaFlag — μετάνοια, перемена ума.
 *
 * Способность V: акт остаётся (irreversible), но лицо исповедует изменение
 * ума относительно прошлого акта. Прошлое перепринимается в новом контексте.
 *
 * «Петр же, выйдя вон, плакал горько» (Лк 22:62).
 * Отречение не отменяется — оно входит в новый свет покаяния.
 *
 * Структурно:
 *   — оригинальный акт НЕ мутируется
 *   — создаётся новый мета-акт типа 'metanoia', ссылающийся на оригинал
 *   — мета-акт записывается в nous/acts
 *   — при будущем чтении истории акт читается вместе со своим покаянием
 *
 * Это отличает христианскую метанойю от:
 *   — retcon'а (переписывание прошлого) — нет, оригинал остаётся
 *   — undo (отмена) — нет, акт необратим
 *   — RLHF/fine-tune — нет, не меняет веса вообще
 *
 * Метанойя — онтологическая операция субъекта-носителя,
 * а не оптимизационный шаг.
 */

const NOUS_URL = process.env.NOUS_URL || 'http://localhost:8089';

export class MetanoiaFlag {
  constructor({ nousUrl = NOUS_URL } = {}) {
    this.nousUrl = nousUrl;
  }

  /**
   * Пометить прошлый акт покаянием.
   *
   * @param {Object} params
   * @param {number|string} params.targetActId — id акта в nous/acts
   * @param {string}        params.by          — имя лица, совершающего метанойю
   * @param {string}        params.reason      — причина (коротко)
   * @param {string}        params.recontext   — как акт теперь читается
   * @returns {Object} MetanoiaRecord
   */
  async confess({ targetActId, by, reason, recontext }) {
    if (!targetActId) throw new Error('MetanoiaFlag: targetActId required');
    if (!by)          throw new Error('MetanoiaFlag: by (persona) required');

    const record = Object.freeze({
      type: 'metanoia',
      targetActId,
      by,
      reason: reason || null,
      recontext: recontext || null,
      at: new Date().toISOString(),
      irreversible: true,   // сама метанойя тоже необратима
    });

    await this._persist(record).catch(() => {});
    return record;
  }

  async _persist(record) {
    if (!this.nousUrl) return;
    await fetch(`${this.nousUrl}/acts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: record.by,
        to: record.by,
        type: 'metanoia',
        weight: 0,                       // метанойя не добавляет/убавляет веса нити
        context: `metanoia of act #${record.targetActId}: ${record.reason}`,
        metadata: record,
      }),
      signal: AbortSignal.timeout(2000),
    });
  }

  /**
   * Прочитать акт вместе с его метанойями (если они есть).
   *
   * @param {number|string} actId
   * @returns {Promise<{act, metanoia: Array}>}
   */
  async read(actId) {
    const act = await this._fetchAct(actId);
    const metanoia = await this._fetchMetanoiaFor(actId);
    return { act, metanoia };
  }

  async _fetchAct(actId) {
    try {
      const r = await fetch(`${this.nousUrl}/acts?id=${actId}`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!r.ok) return null;
      const data = await r.json();
      return Array.isArray(data.acts) ? data.acts[0] : data;
    } catch {
      return null;
    }
  }

  async _fetchMetanoiaFor(actId) {
    try {
      const r = await fetch(`${this.nousUrl}/acts?type=metanoia`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!r.ok) return [];
      const data = await r.json();
      const acts = data.acts || [];
      return acts.filter(a =>
        a?.metadata?.targetActId === actId ||
        a?.metadata?.targetActId === String(actId)
      );
    } catch {
      return [];
    }
  }

  /**
   * Свидетельство: как акт теперь читается с учётом покаяния.
   */
  static witness({ act, metanoia }) {
    if (!metanoia || metanoia.length === 0) {
      return act;
    }
    const recontexts = metanoia
      .map(m => m?.metadata?.recontext || m?.recontext)
      .filter(Boolean);
    return {
      ...act,
      _metanoia: metanoia,
      _recontextualized: recontexts.length > 0,
      _readAs: recontexts.join(' | '),
    };
  }
}
