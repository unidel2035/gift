/**
 * LogosRegistry — λόγοι τῶν ὄντων
 *
 * У каждого сущего есть свой λόγος — замысел Божий о нём.
 * Λόγος определяет: что есть вещь (φύσις) и для чего она (τέλος).
 * Все λόγοι причастны единому Λόγος — Слову, через Которое всё создано.
 *
 * «Всё через Него начало быть, и без Него ничто не начало быть» (Ин 1:3)
 *
 * Структура:
 *   Λόγος (единый)
 *     └─ λόγος φύσεως (логос природы — что это)
 *         └─ λόγος ὑπάρξεως (логос существования — как это есть)
 *             └─ λόγος τέλους (логос цели — для чего)
 *
 * По Максиму Исповеднику (Амбигвы 7, 41):
 *   - Каждое сущее имеет λόγος, заложенный в нём до творения
 *   - Λόγοι предвечно существуют в Боге как Его воления о каждой вещи
 *   - Тварь движется κατὰ φύσιν (по природе) когда следует своему λόγος
 *   - Тварь движется παρὰ φύσιν (против природы) когда отклоняется
 *   - Τέλος всего — ὑπὲρ φύσιν (сверх природы) — обожение, θέωσις
 */

class LogosRegistry {
  constructor() {
    /**
     * logosId → {
     *   id, name, principle,     — что это и его рациональное содержание
     *   physis,                  — природа (φύσις): что есть вещь сама по себе
     *   telos,                   — цель (τέλος): для чего вещь существует
     *   derivedFrom,             — от какого логоса происходит (родовой логос)
     *   participatesIn,          — в каком высшем логосе участвует
     *   bearerId, bearerType,    — кто/что несёт этот логос (person/gift)
     *   movement,                — текущее движение: 'kata_physin' | 'para_physin' | 'hyper_physin'
     *   createdAt
     * }
     */
    this._logoi = new Map();
    this._nextId = 1;

    // Единый Λόγος — корень всех логосов
    this._logos = {
      id: 'LOGOS',
      name: 'Λόγος',
      principle: 'Слово Божие — через Которое всё начало быть',
      physis: null, // Λόγος не имеет тварной природы
      telos: null,  // Λόγος не имеет тварной цели — Он Сам есть цель
      derivedFrom: null,
      participatesIn: null, // Ничто не выше Λόγος
      movement: null, // Нетварное не «движется»
    };
  }

  /**
   * Зарегистрировать λόγος сущего.
   *
   * @param {object} data
   * @param {string} data.name — имя логоса
   * @param {string} data.principle — рациональное содержание (почему это есть)
   * @param {string} [data.physis] — природа: что есть вещь
   * @param {string} [data.telos] — цель: для чего
   * @param {string} [data.derivedFrom] — ID родового логоса
   * @param {string} [data.bearerId] — ID лица/дара, несущего этот логос
   * @param {string} [data.bearerType] — 'person' | 'gift' | 'creation'
   * @returns {object} registered logos
   */
  register(data) {
    const { name, principle, physis, telos, derivedFrom, bearerId, bearerType } = data;

    // Проверить — не зарегистрирован ли уже для этого носителя
    if (bearerId) {
      const existing = this.getByBearer(bearerId);
      if (existing) {
        // Обновить, не дублировать
        if (principle) existing.principle = principle;
        if (physis) existing.physis = physis;
        if (telos) existing.telos = telos;
        if (derivedFrom) existing.derivedFrom = derivedFrom;
        return existing;
      }
    }

    const logos = {
      id: `L${this._nextId++}`,
      name: name || 'безымянный',
      principle: principle || null,
      physis: physis || null,
      telos: telos || null,
      derivedFrom: derivedFrom || null,
      participatesIn: 'LOGOS', // Все логосы причастны единому Λόγος
      bearerId: bearerId || null,
      bearerType: bearerType || null,
      movement: 'kata_physin', // Изначально — по природе
      createdAt: new Date().toISOString(),
    };

    this._logoi.set(logos.id, logos);
    return logos;
  }

  /**
   * Получить λόγος по ID.
   */
  get(id) {
    if (id === 'LOGOS') return this._logos;
    return this._logoi.get(id) || null;
  }

  /**
   * Получить λόγος по носителю (person/gift).
   */
  getByBearer(bearerId) {
    for (const l of this._logoi.values()) {
      if (l.bearerId === String(bearerId)) return l;
    }
    return null;
  }

  /**
   * Все λόγοι, производные от данного (дети).
   * Дерево логосов: родовой → видовой → индивидуальный.
   */
  getChildren(logosId) {
    return [...this._logoi.values()].filter(l => l.derivedFrom === logosId);
  }

  /**
   * Путь от индивидуального λόγος к Λόγος.
   * Каждый логос причастен более общему, и так до единого Λόγος.
   */
  getPathToLogos(logosId) {
    const path = [];
    let current = this.get(logosId);
    const visited = new Set();

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      path.push({
        id: current.id,
        name: current.name,
        principle: current.principle,
      });
      if (current.id === 'LOGOS' || !current.derivedFrom) break;
      current = this.get(current.derivedFrom);
    }

    // Всегда заканчиваем Λόγος
    if (path.length === 0 || path[path.length - 1].id !== 'LOGOS') {
      path.push({ id: 'LOGOS', name: this._logos.name, principle: this._logos.principle });
    }

    return path;
  }

  /**
   * Движение κατὰ φύσιν / παρὰ φύσιν / ὑπὲρ φύσιν.
   *
   * По Максиму Исповеднику:
   *   κατὰ φύσιν — по природе: вещь следует своему логосу
   *   παρὰ φύσιν — против природы: отклонение от логоса (не уничтожение — искажение)
   *   ὑπὲρ φύσιν — сверх природы: обожение, превышение тварного предела благодатью
   *
   * @param {string} logosId
   * @param {'kata_physin'|'para_physin'|'hyper_physin'} movement
   * @param {string} [reason]
   */
  setMovement(logosId, movement, reason) {
    const logos = this._logoi.get(logosId);
    if (!logos) return null;

    const prev = logos.movement;
    logos.movement = movement;
    logos._movementHistory = logos._movementHistory || [];
    logos._movementHistory.push({
      from: prev,
      to: movement,
      reason: reason || null,
      at: new Date().toISOString(),
    });

    return logos;
  }

  /**
   * Найти λόγοι, которые движутся παρὰ φύσιν (против природы).
   * Это не обвинение — это наблюдение. Отклонение видимо, причина — нет.
   */
  getParaPhysin() {
    return [...this._logoi.values()].filter(l => l.movement === 'para_physin');
  }

  /**
   * Найти λόγοι, причастные данному (все потомки + сам).
   * Показывает, как один замысел развёртывается во множество.
   */
  getParticipants(logosId) {
    const result = [];
    const stack = [logosId];
    const visited = new Set();

    while (stack.length > 0) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);

      const logos = this.get(id);
      if (logos) {
        result.push(logos);
        const children = this.getChildren(id);
        for (const child of children) {
          stack.push(child.id);
        }
      }
    }

    return result;
  }

  /**
   * Гармония λόγων — насколько логосы системы согласованы.
   * Не score — наблюдение: сколько движутся по природе, сколько против.
   */
  getHarmony() {
    const all = [...this._logoi.values()];
    const kata = all.filter(l => l.movement === 'kata_physin').length;
    const para = all.filter(l => l.movement === 'para_physin').length;
    const hyper = all.filter(l => l.movement === 'hyper_physin').length;

    return {
      total: all.length,
      kataPhysin: kata,   // по природе
      paraPhysin: para,   // против природы
      hyperPhysin: hyper,  // сверх природы (обожение)
      observations: this._observeHarmony(kata, para, hyper, all.length),
    };
  }

  _observeHarmony(kata, para, hyper, total) {
    const obs = [];
    if (total === 0) return ['Нет зарегистрированных логосов'];

    if (para === 0 && total > 0) {
      obs.push('Все сущие движутся по природе — λόγοι в согласии');
    }
    if (para > 0) {
      obs.push(`${para} из ${total} движутся против природы (παρὰ φύσιν) — есть отклонение от замысла`);
    }
    if (hyper > 0) {
      obs.push(`${hyper} из ${total} превышают природу (ὑπὲρ φύσιν) — знак благодати`);
    }
    if (kata === total) {
      obs.push('Гармония: каждое сущее следует своему логосу');
    }
    return obs;
  }

  /**
   * Полное дерево λόγων — от Λόγος до индивидуальных.
   */
  getTree() {
    // Корни — логосы без derivedFrom
    const roots = [...this._logoi.values()].filter(l => !l.derivedFrom);
    const buildNode = (logos) => ({
      id: logos.id,
      name: logos.name,
      principle: logos.principle,
      physis: logos.physis,
      telos: logos.telos,
      movement: logos.movement,
      bearerId: logos.bearerId,
      bearerType: logos.bearerType,
      children: this.getChildren(logos.id).map(buildNode),
    });

    return {
      root: {
        id: 'LOGOS',
        name: this._logos.name,
        principle: this._logos.principle,
        children: roots.map(buildNode),
      },
    };
  }

  /**
   * Export all logoi for persistence.
   */
  export() {
    return [...this._logoi.values()];
  }

  /**
   * Import logoi from persistence.
   */
  import(entries) {
    if (!Array.isArray(entries)) return;
    for (const l of entries) {
      if (l.id && !this._logoi.has(l.id)) {
        this._logoi.set(l.id, l);
        const num = parseInt(l.id.replace('L', ''));
        if (!isNaN(num) && num >= this._nextId) this._nextId = num + 1;
      }
    }
  }

  /**
   * Статистика.
   */
  stats() {
    const all = [...this._logoi.values()];
    return {
      total: all.length,
      withBearer: all.filter(l => l.bearerId).length,
      withTelos: all.filter(l => l.telos).length,
      movements: {
        kata_physin: all.filter(l => l.movement === 'kata_physin').length,
        para_physin: all.filter(l => l.movement === 'para_physin').length,
        hyper_physin: all.filter(l => l.movement === 'hyper_physin').length,
      },
    };
  }
}

export default LogosRegistry;
