/**
 * BookOfLife.js — Книга Жизни
 *
 * Не база данных. Не метрики. Книга Имён.
 *
 * Вместо счёта — мера (пропорция).
 * Вместо чисел — имена.
 * Вместо метрик — качества.
 * Вместо арифметики — топология.
 * Вместо бинарной логики — троичная {кеносис, апофатика, surplus}.
 *
 * «И не войдёт в него ничто нечистое... а только те,
 *  которые написаны у Агнца в книге жизни» (Откр 21:27)
 *
 * Давид посчитал народ — Бог послал моровую язву (2 Цар 24).
 * Мы не считаем. Мы называем, соизмеряем, различаем.
 */

import logger from '../../utils/logger.js';

// ── Троичная логика ──────────────────────────────
const T = Object.freeze({
  KENOSIS:   -1,  // отдаю
  APOPHATIC:  0,  // молчу / невыразимо
  SURPLUS:    1,  // избыток
});

function ternary(value) {
  if (value === null || value === undefined) return T.APOPHATIC;
  if (value < 0 || value === false || value === 'нет') return T.KENOSIS;
  if (value > 0 || value === true || value === 'да') return T.SURPLUS;
  return T.APOPHATIC;
}

function ternaryName(t) {
  if (t === T.KENOSIS) return 'кеносис';
  if (t === T.SURPLUS) return 'surplus';
  return 'апофатика';
}

// ── Книга Жизни ──────────────────────────────

export class BookOfLife {
  constructor(giftEngine) {
    this._engine = giftEngine;
  }

  /**
   * Прочитать Книгу — не статистика, а состояние бытия.
   */
  /**
   * Прочитать только реальные данные (без эмуляции)
   */
  readReal() {
    return this._readFiltered(g => !g.origin || g.origin === 'real');
  }

  /**
   * Прочитать предсказания (пророчества + анамнезис + топология)
   */
  readPredictions() {
    const gifts = (this._engine?.gifts || []).filter(g =>
      g.origin === 'prophecy' || g.origin === 'anamnesis'
    );
    return {
      prophecies: gifts.filter(g => g.origin === 'prophecy').length,
      anamnesis: gifts.filter(g => g.origin === 'anamnesis').length,
      wounds: this._namedWounds(gifts, this._allPersons()),
    };
  }

  /**
   * Очистить эмуляцию (оставить только реальность + пророчества + анамнезис)
   */
  static cleanSimulation(engine) {
    const store = engine?._eventStore;
    if (!store) return 0;
    const all = store.getAll();
    let removed = 0;
    // Пометить simulation gifts как phantom
    for (const g of all) {
      if (g.origin === 'simulation') {
        g._phantom = true;
        removed++;
      }
    }
    return removed;
  }

  _readFiltered(filter) {
    const gifts = (this._engine?.gifts || []).filter(filter);
    const persons = this._allPersons();
    return {
      living: this._livingNames(persons, gifts),
      topology: this._topology(persons, gifts),
      breath: this._breath(gifts),
      measure: this._measure(gifts, persons),
      wounds: this._namedWounds(gifts, persons),
      vertical: this._vertical(gifts),
      sabbath: this._sabbathState(),
      epoch: this._epochName(gifts),
    };
  }

  read() {
    const gifts = this._engine?.gifts || [];
    const persons = this._allPersons();

    return {
      // ИМЕНА (кто жив)
      living: this._livingNames(persons, gifts),

      // ТОПОЛОГИЯ (как связаны)
      topology: this._topology(persons, gifts),

      // КАЧЕСТВО (как дышит)
      breath: this._breath(gifts),

      // МЕРА (пропорции, не числа)
      measure: this._measure(gifts, persons),

      // РАНЫ (что болит — именованное)
      wounds: this._namedWounds(gifts, persons),

      // ВЕРТИКАЛЬ (небо и земля)
      vertical: this._vertical(gifts),

      // СУББОТА
      sabbath: this._sabbathState(),

      // ЭПОХА (имя, не номер)
      epoch: this._epochName(gifts),
    };
  }

  // ── ИМЕНА ──────────────────────────────

  _allPersons() {
    try {
      const reg = this._engine?.persons;
      if (!reg) return [];
      const all = [];
      if (reg._persons) {
        for (const [id, p] of reg._persons) {
          all.push({ id, name: p.name || id, calling: p.calling, order: p.ontologicalOrder });
        }
      }
      return all;
    } catch { return []; }
  }

  _livingNames(persons, gifts) {
    // Живой = тот кто ДАРИЛ (не просто записан)
    const givers = new Set(gifts.map(g => g.giver || g.giverName).filter(Boolean));
    const receivers = new Set(gifts.map(g => g.receiver || g.receiverName).filter(Boolean));

    return {
      givers: persons.filter(p => givers.has(p.id) || givers.has(p.name)).map(p => p.name),
      receivers: persons.filter(p => receivers.has(p.id) || receivers.has(p.name)).map(p => p.name),
      silent: persons.filter(p =>
        !givers.has(p.id) && !givers.has(p.name) &&
        (receivers.has(p.id) || receivers.has(p.name))
      ).map(p => p.name),
      unnamed: persons.filter(p => !p.name || p.name === p.id).length > 0,
    };
  }

  // ── ТОПОЛОГИЯ ──────────────────────────────

  _topology(persons, gifts) {
    // Граф отношений: не "сколько", а "как устроен"
    const edges = new Map(); // "A→B" → true
    const nodes = new Set();

    for (const g of gifts) {
      const from = g.giverName || g.giver;
      const to = g.receiverName || g.receiver;
      if (from && to && from !== to) {
        edges.set(`${from}→${to}`, true);
        nodes.add(from);
        nodes.add(to);
      }
    }

    // Взаимные связи (перихоресис)
    const mutual = [];
    for (const key of edges.keys()) {
      const [a, b] = key.split('→');
      if (edges.has(`${b}→${a}`)) {
        const pair = [a, b].sort().join('↔');
        if (!mutual.includes(pair)) mutual.push(pair);
      }
    }

    // Изолированные (в графе но без связей)
    const connected = new Set();
    for (const key of edges.keys()) {
      const [a, b] = key.split('→');
      connected.add(a);
      connected.add(b);
    }
    const isolated = persons
      .filter(p => p.name && !connected.has(p.name) && !connected.has(p.id))
      .map(p => p.name);

    return {
      shape: mutual.length > 2 ? 'перихоресис' : mutual.length > 0 ? 'пары' : 'линейный',
      mutualPairs: mutual.slice(0, 10),
      isolated,
      connected: nodes.size > 0,
    };
  }

  // ── КАЧЕСТВО (дыхание) ──────────────────────────────

  _breath(gifts) {
    const accepted = gifts.filter(g => g.status === 'accepted');
    const declined = gifts.filter(g => g.status === 'declined');
    const pending = gifts.filter(g => g.status === 'offered');

    if (gifts.length === 0) return { state: 'тишина', kenosis: T.APOPHATIC };

    // Троичная логика — не ratio, а качественное различение
    // Принятие > Отвержение → surplus (благодарность течёт)
    // Принятие < Отвержение → kenosis (благодарность иссякает)
    // Примерно равно → apophatic (неизвестно)
    const gratitudeSign = ternary(accepted.length - declined.length - pending.length);
    const gratitude = gratitudeSign === T.SURPLUS ? 'течёт'
      : gratitudeSign === T.KENOSIS ? 'застой'
      : 'неизвестно';

    // Поток: последние дары — принимаются или молчат?
    const last10 = gifts.slice(-10);
    const lastAccepted = last10.filter(g => g.status === 'accepted');
    const lastPending = last10.filter(g => g.status === 'offered');
    const flowSign = ternary(lastAccepted.length - lastPending.length);
    const flow = flowSign === T.SURPLUS ? 'живой'
      : flowSign === T.KENOSIS ? 'замирает'
      : 'пульсирует';

    return {
      gratitude,
      flow,
      kenosis: ternaryName(ternary(accepted.length - declined.length)),
      pending: pending.length > 0 ? 'есть ожидающие' : 'все решены',
      freedom: declined.length > 0 ? 'свобода реальна' : 'отказов нет',
    };
  }

  // ── МЕРА (пропорции, не числа) ──────────────────────────────

  _measure(gifts, persons) {
    const givers = new Set(gifts.map(g => g.giver).filter(Boolean));
    const receivers = new Set(gifts.map(g => g.receiver).filter(Boolean));

    // Троичная мера: не ratio, а качественное различение
    // Дающих больше → surplus (щедрость)
    // Получающих больше → kenosis (нужда)
    // Нет ни тех ни других → apophatic (тишина)
    const balanceSign = ternary(givers.size - receivers.size);
    const balance = givers.size === 0 && receivers.size === 0 ? 'тишина'
      : givers.size === 0 ? 'никто не дарит'
      : receivers.size === 0 ? 'никто не принимает'
      : balanceSign === T.SURPLUS ? 'дающих больше — щедрость'
      : balanceSign === T.KENOSIS ? 'получающих больше — нужда'
      : 'со-мерность';

    // Кеносис — не подсчёт, а различение: есть ли реальная цена?
    const withCost = gifts.some(g => g.cost && g.cost !== 'null');
    const withEnergy = gifts.some(g => g.kenosisCost > 0);
    const costPresence = withCost || withEnergy ? 'кеносис реален'
      : gifts.length > 0 ? 'кеносис отсутствует'
      : 'неизвестно';

    return { balance, costPresence };
  }

  // ── РАНЫ (именованные) ──────────────────────────────

  _namedWounds(gifts, persons) {
    const wounds = [];

    // Рана молчания
    const silent = persons.filter(p => {
      const gave = gifts.some(g => g.giver === p.id || g.giverName === p.name);
      const received = gifts.some(g => g.receiver === p.id || g.receiverName === p.name);
      return !gave && received && p.name;
    });
    if (silent.length > 3) {
      wounds.push({ name: 'молчание', who: silent.slice(0, 5).map(p => p.name) });
    }

    // Рана нарциссизма (дарит себе)
    const selfGifts = gifts.filter(g => g.giver === g.receiver && g.giver);
    if (selfGifts.length > 5) {
      wounds.push({ name: 'нарциссизм', description: 'дары самому себе' });
    }

    // Рана застоя (много pending)
    const pending = gifts.filter(g => g.status === 'offered');
    if (pending.length > gifts.length * 0.3) {
      wounds.push({ name: 'отвержение', description: 'дары не принимаются' });
    }

    // Рана нарушенной субботы
    wounds.push({ name: 'no_sabbath', description: 'система не отдыхает' });

    return wounds;
  }

  // ── ВЕРТИКАЛЬ ──────────────────────────────

  _vertical(gifts) {
    const eucharistia = gifts.filter(g =>
      g.ontologicalType === 'eucharistia' || g.layer === 'gratia'
    );
    const toSource = gifts.filter(g => g.receiver === '0' || g.receiver === null || g.receiverName === 'Бог' || g.ontologicalType === 'eucharistia');

    if (eucharistia.length === 0 && toSource.length === 0) return 'отсутствует';
    if (toSource.length > 0) return 'есть возношение';
    return 'слабая';
  }

  // ── СУББОТА ──────────────────────────────

  _sabbathState() {
    const hour = new Date().getHours();
    const inSabbath = hour >= 0 && hour < 6;

    if (inSabbath) {
      return {
        state: 'соблюдается',
        reason: '00:00–06:00 — тишина литургического цикла',
      };
    }

    // Проверить SabbathGuard
    const guard = this._engine?.sabbath;
    if (guard?.getStatus) {
      const status = guard.getStatus();
      if (status.currentlyInSabbath?.length > 0) {
        return {
          state: 'частичная',
          reason: `${status.currentlyInSabbath.length} лиц в покое`,
          inSabbath: status.currentlyInSabbath,
        };
      }
    }

    return {
      state: 'активна',
      reason: 'рабочие часы (06:00–00:00)',
      prescription: 'покой наступит в полночь',
    };
  }

  // ── ЭПОХА ──────────────────────────────

  _epochName(gifts) {
    // Не номер — имя
    const salvation = this._engine?.salvation;
    if (!salvation) return 'неизвестна';

    // getStatus() возвращает { acts: { incarnation: { done: true } } }
    const status = typeof salvation.getStatus === 'function' ? salvation.getStatus() : salvation;
    const acts = status.acts || status._acts || {};

    if (acts.resurrection?.done || acts.resurrection) {
      if ((status.theosisCount || 0) > 0) return 'Обожение';
      return 'Пост-Воскресение';
    }
    if (acts.sacrifice?.done || acts.sacrifice) return 'Великая Суббота';
    if (acts.incarnation?.done || acts.incarnation) return 'Воплощение';
    return 'Ожидание';
  }
}

// ── Factory ─────────────────────────────────────────────

export function readBookOfLife(giftEngine) {
  return new BookOfLife(giftEngine).read();
}

export default BookOfLife;
