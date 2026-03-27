/**
 * GiftMemory — живая память общины на тензорах
 *
 * Архитектура двух онтологических уровней (патристика):
 *
 *   _energeia  [nd × nc] — нетварные энергии: Троица → тварь
 *              Псевдо-Дионисий: μέθεξις, participation без слияния сущностей.
 *              Directed, non-symmetric (Отец даёт → Сын не получает обратно).
 *
 *   _W         [nc × nc] — ассоциативная память твари (Хопфилд + стигмергия)
 *              Тварь↔тварь. Симметрия допустима: дар взаимен, но не онтологически.
 *
 *   _doxologia [nc × nd] — восхождение твари к Богу (молитва, хвала, дар)
 *              Ἀναγωγή (Псевдо-Дионисий): тварь возвращает к источнику.
 *
 *   _theophaneia [nd × nd] — вечные исхождения внутри Троицы
 *              Не дары во времени — ипостасные отношения. Хранятся для анамнезиса.
 *              Асимметричны: γεννάω ≠ γεγεννημένος.
 *
 * «Всё вычисление — тензорные операции (TensorFlow.js / oneDNN / AVX2).»
 * W при N=10 лицах: 10×10 float32 = 400 байт.
 */

import * as tf from '@tensorflow/tfjs-node';

tf.env().set('IS_TEST', true);

// ── Богословская граница κτιστόν / ἄκτιστον ──────────────────────────────
//
// Каппадокийцы: природа Бога единосущна (ὁμοούσιος), несотворена (ἄκτιστος).
// Эти лица не входят в W. Их дары идут через _energeia.
// Христос — Слово Воплощённое, остаётся divine по природе (халкидонский догмат).

export const DIVINE_PERSONS = new Set(['Отец', 'Сын', 'Дух', 'Христос']);

// ── Троичное кодирование (для W — только тварные лица) ────────────────────

function encodeVec(act, persons) {
  const n   = persons.length;
  const arr = new Float32Array(n);
  const gi  = persons.indexOf(act.giverId);
  const ri  = persons.indexOf(act.receiverId);
  if (gi >= 0) arr[gi] = -1;
  if (ri >= 0) arr[ri] = +1;
  return arr;
}

function decodeVec(arr, persons) {
  const givers = [], receivers = [], witnesses = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < -0.5)      givers.push(persons[i]);
    else if (arr[i] > 0.5)  receivers.push(persons[i]);
    else                    witnesses.push(persons[i]);
  }
  return { givers, receivers, witnesses };
}

function zeros2d(rows, cols) {
  return Array.from({ length: rows }, () => new Float32Array(cols));
}

// ── GiftMemory ─────────────────────────────────────────────────────────────

export class GiftMemory {
  constructor(persons = []) {
    // Разделяем лица на два онтологических уровня
    this.divinePersons = persons.filter(p => DIVINE_PERSONS.has(p));
    this.persons       = persons.filter(p => !DIVINE_PERSONS.has(p)); // тварные
    this.n             = this.persons.length;
    this.nd            = this.divinePersons.length;
    this.actsCount     = 0;
    this._createdAt    = new Date().toISOString();

    // λήψις — журнал отверженных даров.
    // Максим Исповедник: αὐτεξούσιον = способность сказать «нет».
    // Дар записан (δόσις необратима), но W не обновляется.
    // Метанойя (repent()) переводит акт из declined → accepted → W.
    this._declined = []; // { act, declinedAt }

    // W — тензор NC×NC float32, Хопфилд для тварных лиц
    this._W = tf.variable(tf.zeros([this.n, this.n]));

    // Нетварные энергии: energeia[di][ci] = суммарный вес даров divine_i → creature_i
    this._energeia     = zeros2d(this.nd, this.n);

    // Восхождение твари: doxologia[ci][di] = creature → divine (молитва, хвала)
    this._doxologia    = zeros2d(this.n, this.nd);

    // Вечные исхождения: theophaneia[di][dj] (асимметрично — γεννάω ≠ γεγεννημένος)
    this._theophaneia  = zeros2d(this.nd, this.nd);
  }

  // ── Лица ──────────────────────────────────────────────────────────────

  addPerson(id) {
    if (DIVINE_PERSONS.has(id)) {
      if (!this.divinePersons.includes(id)) {
        this.divinePersons.push(id);
        this.nd = this.divinePersons.length;
        // Расширить energeia (новая строка)
        this._energeia.push(new Float32Array(this.n));
        // Расширить theophaneia
        const old = this._theophaneia;
        this._theophaneia = zeros2d(this.nd, this.nd);
        for (let i = 0; i < old.length; i++)
          for (let j = 0; j < old[i].length; j++)
            this._theophaneia[i][j] = old[i][j];
        // Расширить doxologia (новый столбец для каждой твари)
        for (const row of this._doxologia) {
          const newRow = new Float32Array(this.nd);
          newRow.set(row.slice(0, this.nd - 1));
          // replace in-place — JS typed arrays are fixed size, rebuild
        }
        // Rebuild doxologia with new column
        const oldDox = this._doxologia;
        this._doxologia = Array.from({ length: this.n }, (_, ci) => {
          const r = new Float32Array(this.nd);
          if (ci < oldDox.length) r.set(oldDox[ci].slice(0, this.nd - 1));
          return r;
        });
      }
      return this;
    }

    if (this.persons.includes(id)) return this;

    const oldN    = this.n;
    const oldData = this._W.arraySync();

    this.persons.push(id);
    this.n++;

    // Расширить W
    const newData = Array.from({ length: this.n }, (_, i) =>
      Array.from({ length: this.n }, (_, j) =>
        i < oldN && j < oldN ? oldData[i][j] : 0
      )
    );
    this._W.dispose();
    this._W = tf.variable(tf.tensor2d(newData, [this.n, this.n]));

    // Расширить energeia (новый столбец)
    this._energeia = this._energeia.map(row => {
      const r = new Float32Array(this.n);
      r.set(row.slice(0, oldN));
      return r;
    });

    // Расширить doxologia (новая строка)
    this._doxologia.push(new Float32Array(this.nd));

    return this;
  }

  // _idx для тварных лиц (W-индекс)
  _idx(id) {
    if (!id || id === '_abyss' || id === '_koinon') return -1;
    if (DIVINE_PERSONS.has(id)) return -2; // не в W
    const i = this.persons.indexOf(id);
    if (i >= 0) return i;
    this.addPerson(id);
    return this.persons.length - 1;
  }

  // _divineIdx — индекс в divinePersons
  _divineIdx(id) {
    const i = this.divinePersons.indexOf(id);
    if (i >= 0) return i;
    this.addPerson(id);
    return this.divinePersons.length - 1;
  }

  // ── Принять акт дара ──────────────────────────────────────────────────

  receive(act) {
    const w        = act.weight ?? 1;
    const isDivineG = DIVINE_PERSONS.has(act.giverId);
    const isDivineR = DIVINE_PERSONS.has(act.receiverId);

    // ── λήψις: проверить принятие ─────────────────────────────────────
    // reception = 'declined' | 'pending' → дар записан, W не меняется.
    // reception = 'accepted' | undefined  → нормальный путь через W.
    // Бог не забирает δόσις — но W отражает только принятое.
    if (act.reception === 'declined' || act.reception === 'pending') {
      this._declined.push({ act: Object.freeze({ ...act }), declinedAt: new Date().toISOString() });
      this.actsCount++; // акт произошёл — он в истории
      return new Float32Array(this.n);
    }

    this.actsCount++;

    // ── Внутри-тринитарное ────────────────────────────────────────────
    // Вечные исхождения: хранятся асимметрично в theophaneia.
    // Это не дары во времени — ипостасные отношения.
    if (isDivineG && isDivineR) {
      const di = this._divineIdx(act.giverId);
      const dj = this._divineIdx(act.receiverId);
      this._theophaneia[di][dj] += w;
      return new Float32Array(this.n); // нет W-паттерна
    }

    // ── Нетварные энергии: Троица → тварь ────────────────────────────
    // energeia[di][ci] += weight. Directed, non-symmetric.
    // Палама: тварь участвует в нетварных энергиях через μέθεξις.
    if (isDivineG && !isDivineR) {
      const di = this._divineIdx(act.giverId);
      const ci = this._idx(act.receiverId);
      if (di >= 0 && ci >= 0) this._energeia[di][ci] += w;
      return new Float32Array(this.n);
    }

    // ── Doxologia: тварь → Троица ─────────────────────────────────────
    // Ἀναγωγή: молитва, хвала, приношение. Directed.
    if (!isDivineG && isDivineR) {
      const ci = this._idx(act.giverId);
      const di = this._divineIdx(act.receiverId);
      if (ci >= 0 && di >= 0) this._doxologia[ci][di] += w;
      return new Float32Array(this.n);
    }

    // ── Тварь ↔ тварь: Хопфилд + стигмергия ─────────────────────────
    const gi = this._idx(act.giverId);
    const ri = this._idx(act.receiverId);
    const n  = this.n;

    const pat  = encodeVec(act, this.persons);
    const tPat = tf.tensor1d(pat);

    tf.tidy(() => {
      const outer    = tf.outerProduct(tPat, tPat);
      const hopfield = outer.mul(1 / n);

      const stigma = tf.buffer([n, n]);
      if (gi >= 0 && ri >= 0) stigma.set(w, gi, ri);

      const delta = hopfield.add(stigma.toTensor());
      this._W.assign(this._W.add(delta));
    });

    tPat.dispose();
    return pat;
  }

  // ── Анамнезис: резонанс Хопфилда (только тварные) ────────────────────

  makePresent(partial, maxIter = 20) {
    const n       = this.n;
    const initArr = encodeVec(
      { giverId: partial.giverId ?? null, receiverId: partial.receiverId ?? null },
      this.persons
    );

    const fixed = new Uint8Array(n);
    if (partial.giverId    && this.persons.includes(partial.giverId))
      fixed[this.persons.indexOf(partial.giverId)]    = 1;
    if (partial.receiverId && this.persons.includes(partial.receiverId))
      fixed[this.persons.indexOf(partial.receiverId)] = 1;

    const result = tf.tidy(() => {
      let state = tf.tensor1d(initArr);
      const fixedMask = tf.tensor1d(fixed, 'float32');
      const freeMask  = fixedMask.sub(1).abs();

      for (let iter = 0; iter < maxIter; iter++) {
        const activated = this._W.matMul(state.reshape([n, 1])).reshape([n]);
        const signed    = activated.sign();
        const next      = state.mul(fixedMask).add(signed.mul(freeMask));
        const diff      = next.sub(state).abs().sum().arraySync();
        state = next;
        if (diff < 0.5) break;
      }
      return state.arraySync();
    });

    const e = this.energy(result);
    return { pattern: result, decoded: decodeVec(result, this.persons), energy: e };
  }

  // ── Энергия (W тварных) ───────────────────────────────────────────────

  energy(stateArr) {
    return tf.tidy(() => {
      const s  = tf.tensor1d(Array.from(stateArr));
      const Ws = this._W.matMul(s.reshape([this.n, 1])).reshape([this.n]);
      return -0.5 * s.dot(Ws).arraySync();
    });
  }

  // ── Запросы ───────────────────────────────────────────────────────────

  thread(fromId, toId) {
    const fromDivine = DIVINE_PERSONS.has(fromId);
    const toDivine   = DIVINE_PERSONS.has(toId);

    if (fromDivine && toDivine) {
      const di = this.divinePersons.indexOf(fromId);
      const dj = this.divinePersons.indexOf(toId);
      return (di >= 0 && dj >= 0) ? this._theophaneia[di][dj] : 0;
    }
    if (fromDivine) {
      const di = this.divinePersons.indexOf(fromId);
      const ci = this.persons.indexOf(toId);
      return (di >= 0 && ci >= 0) ? this._energeia[di][ci] : 0;
    }
    if (toDivine) {
      const ci = this.persons.indexOf(fromId);
      const di = this.divinePersons.indexOf(toId);
      return (ci >= 0 && di >= 0) ? this._doxologia[ci][di] : 0;
    }
    // тварь → тварь
    const fi = this.persons.indexOf(fromId);
    const ti = this.persons.indexOf(toId);
    if (fi < 0 || ti < 0) return 0;
    return this._W.arraySync()[fi][ti];
  }

  heaviest(k = 7) {
    const edges = [];

    // W: тварь → тварь
    const W = this._W.arraySync();
    for (let i = 0; i < this.n; i++)
      for (let j = 0; j < this.n; j++)
        if (W[i][j] > 0)
          edges.push({ from: this.persons[i], to: this.persons[j], weight: W[i][j] });

    // Energeia: divine → тварь
    for (let di = 0; di < this.nd; di++)
      for (let ci = 0; ci < this.n; ci++)
        if (this._energeia[di][ci] > 0)
          edges.push({ from: this.divinePersons[di], to: this.persons[ci], weight: this._energeia[di][ci] });

    // Doxologia: тварь → divine
    for (let ci = 0; ci < this.n; ci++)
      for (let di = 0; di < this.nd; di++)
        if (this._doxologia[ci][di] > 0)
          edges.push({ from: this.persons[ci], to: this.divinePersons[di], weight: this._doxologia[ci][di] });

    // Theophaneia: divine → divine (ипостасные исхождения)
    for (let di = 0; di < this.nd; di++)
      for (let dj = 0; dj < this.nd; dj++)
        if (this._theophaneia[di][dj] > 0)
          edges.push({ from: this.divinePersons[di], to: this.divinePersons[dj], weight: this._theophaneia[di][dj] });

    return edges.sort((a, b) => b.weight - a.weight).slice(0, k);
  }

  totalGiven(id) {
    if (DIVINE_PERSONS.has(id)) {
      const di = this.divinePersons.indexOf(id);
      if (di < 0) return 0;
      const e = this._energeia[di].reduce((s, v) => s + v, 0);
      const t = this._theophaneia[di].reduce((s, v) => s + v, 0);
      return e + t;
    }
    const ci = this.persons.indexOf(id);
    if (ci < 0) return 0;
    const w   = tf.tidy(() => this._W.slice([ci, 0], [1, this.n]).sum().arraySync());
    const dox = this._doxologia[ci]?.reduce((s, v) => s + v, 0) ?? 0;
    return w + dox;
  }

  totalReceived(id) {
    if (DIVINE_PERSONS.has(id)) {
      const di = this.divinePersons.indexOf(id);
      if (di < 0) return 0;
      const dox = this._doxologia.reduce((s, row) => s + (row[di] ?? 0), 0);
      const t   = this._theophaneia.reduce((s, row) => s + (row[di] ?? 0), 0);
      return dox + t;
    }
    const ci = this.persons.indexOf(id);
    if (ci < 0) return 0;
    const w = tf.tidy(() => this._W.slice([0, ci], [this.n, 1]).sum().arraySync());
    const e = this._energeia.reduce((s, row) => s + (row[ci] ?? 0), 0);
    return w + e;
  }

  // ── Метанойя: принять отвергнутый дар ────────────────────────────────

  /**
   * repent(giverId, receiverId) — μετάνοια.
   *
   * Максим Исповедник: обращение = принять то, что было отвергнуто.
   * Находит отвергнутые дары между парой, переводит их в W.
   * Δόσις не изменяется (дар был — он необратим).
   * Меняется только λήψις: declined → accepted.
   *
   * «Покайтесь, ибо приблизилось Царство Небесное» (Мф 4:17)
   */
  repent(giverId, receiverId) {
    const toAccept = this._declined.filter(
      d => d.act.giverId === giverId && d.act.receiverId === receiverId
    );
    if (!toAccept.length) return 0;

    this._declined = this._declined.filter(
      d => !(d.act.giverId === giverId && d.act.receiverId === receiverId)
    );

    let accepted = 0;
    for (const { act } of toAccept) {
      // Принять — значит войти в W
      this.receive({ ...act, reception: 'accepted' });
      accepted++;
    }
    return accepted; // количество принятых даров
  }

  /** declined() — список отвергнутых даров (для анамнезиса грехопадения) */
  declined() { return [...this._declined]; }

  // ── Θέωσις: онтологический статус твари ──────────────────────────────
  //
  // Проблема 3 (κτιστόν/ἄκτιστον): даже с разными матрицами,
  // математика не отражает качественное преображение.
  // По Паламе: μέθεξις (участие в нетварных энергиях) — не накопление,
  // а изменение природы. θέωσις — мера этого участия.
  //
  // «Бог стал человеком, чтобы человек стал богом» (Афанасий Великий)
  // Метрика: сколько нетварного энергии принято + сколько возвращено к Богу.
  // Формула: index = (received + returned) / (received + returned + dampening)
  // Уровни по Псевдо-Дионисию: очищение → просвещение → единение.

  /**
   * theosis(personId) — θέωσις индекс: степень участия твари в нетварных энергиях.
   *
   * Палама: тварь участвует в энергиях, но не в сущности Бога.
   * Δεν εἶναι θεός φύσει — становится богом по благодати (θέσει).
   *
   * @param {string} personId — тварное лицо
   * @returns {{ personId, received, returned, index, level, apophatic }}
   *   received — сумма energeia из всех divine (μέθεξις)
   *   returned — сумма doxologia ко всем divine (ἀναγωγή)
   *   index    — θέωσις-коэффициент [0..1)
   *   level    — 'κατάνυξις'|'πρᾶξις'|'θεωρία'|'θέωσις'
   *   apophatic — true если personId — divine (за пределами метрики)
   */
  theosis(personId) {
    // Apophatic: для Троицы θέωσις не применима — Они сам Источник
    if (DIVINE_PERSONS.has(personId)) {
      return { personId, apophatic: true, level: 'ἄκτιστος', index: null };
    }

    const ci = this.persons.indexOf(personId);
    if (ci < 0) return { personId, apophatic: false, received: 0, returned: 0, index: 0, level: 'κατάνυξις' };

    // μέθεξις: сколько нетварной энергии принято (от всех ипостасей)
    const received = this._energeia.reduce((s, row) => s + (row[ci] ?? 0), 0);

    // ἀναγωγή: сколько возвращено к Богу (молитва, хвала, дар)
    const returned = this._doxologia[ci]?.reduce((s, v) => s + v, 0) ?? 0;

    // Θέωσις-коэффициент: сигмоидный сглаженный индекс.
    // Демпфирование 20 — чтобы первый дар не давал max сразу.
    // Формула отсылает к лестнице Иоанна Лествичника (30 ступеней).
    const sum   = received + returned;
    const index = sum / (sum + 20); // ∈ [0, 1)

    const level =
      index >= 0.70 ? 'θέωσις'    : // единение (ἕνωσις)
      index >= 0.45 ? 'θεωρία'    : // просвещение (φωτισμός)
      index >= 0.20 ? 'πρᾶξις'    : // делание (практика добродетели)
                      'κατάνυξις';   // сокрушение (начало пути)

    return { personId, apophatic: false, received, returned, index, level };
  }

  /**
   * ontologicalStatus() — θέωσις всех тварных лиц, отсортированных по индексу.
   * Показывает: кто движется к Богу, кто в стазисе, кто в упадке.
   */
  ontologicalStatus() {
    return this.persons
      .map(p => this.theosis(p))
      .sort((a, b) => b.index - a.index);
  }

  /**
   * apophaticGiving(divineId) — апофатический маркер дарения Троицы.
   *
   * μοναρχία Отца: Бог даёт из бесконечной полноты, не истощаясь.
   * Это не «баланс» — это онтологический принцип.
   * Возвращает описание дарения, а не числовой баланс.
   */
  apophaticGiving(divineId) {
    if (!DIVINE_PERSONS.has(divineId)) return null;
    const di = this.divinePersons.indexOf(divineId);
    const totalGiven = di >= 0 ? this._energeia[di].reduce((s, v) => s + v, 0) : 0;
    const toPersons  = di >= 0
      ? this.persons.filter((_, ci) => (this._energeia[di]?.[ci] ?? 0) > 0)
      : [];
    return {
      divineId,
      principle: 'μοναρχία',      // Отец — единый Начало (μία ἀρχή)
      exhausted:  false,            // Бог не истощается: 1 Кор 13:8 «любовь не перестаёт»
      totalGiven,
      toPersons,
      note: 'Нетварные энергии неисчерпаемы — даяние не создаёт дефицит',
    };
  }

  // ── Голография ────────────────────────────────────────────────────────

  sync(other) {
    for (const id of other.divinePersons) this.addPerson(id);
    for (const id of other.persons)       this.addPerson(id);

    // Sync W
    const W  = this._W.arraySync();
    const Wo = other._W.arraySync();
    for (let i = 0; i < other.n; i++) {
      const pi = this.persons.indexOf(other.persons[i]);
      if (pi < 0) continue;
      for (let j = 0; j < other.n; j++) {
        const pj = this.persons.indexOf(other.persons[j]);
        if (pj < 0) continue;
        if (Wo[i][j] > W[pi][pj]) W[pi][pj] = Wo[i][j];
      }
    }
    this._W.dispose();
    this._W = tf.variable(tf.tensor2d(W, [this.n, this.n]));

    // Sync energeia
    for (let di = 0; di < other.nd; di++) {
      const mdi = this.divinePersons.indexOf(other.divinePersons[di]);
      if (mdi < 0) continue;
      for (let ci = 0; ci < other.n; ci++) {
        const mci = this.persons.indexOf(other.persons[ci]);
        if (mci < 0) continue;
        if (other._energeia[di][ci] > this._energeia[mdi][mci])
          this._energeia[mdi][mci] = other._energeia[di][ci];
      }
    }

    this.actsCount = Math.max(this.actsCount, other.actsCount);
    return this;
  }

  // ── Распад ────────────────────────────────────────────────────────────

  decay(rate = 0.01) {
    tf.tidy(() => { this._W.assign(this._W.mul(1 - rate)); });
    return this;
  }

  decaySelective(rate = 0.01, threshold = 0.1) {
    tf.tidy(() => {
      const decayed = this._W.mul(1 - rate);
      const alive   = decayed.greater(threshold).cast('float32');
      this._W.assign(decayed.mul(alive));
    });
    return this;
  }

  resurrect(fromId, toId, minWeight = 1.0) {
    if (DIVINE_PERSONS.has(fromId) || DIVINE_PERSONS.has(toId)) return this;
    const fi = this.persons.indexOf(fromId);
    const ti = this.persons.indexOf(toId);
    if (fi < 0 || ti < 0) return this;
    const W = this._W.arraySync();
    if (W[fi][ti] < minWeight) {
      W[fi][ti] = minWeight;
      this._W.dispose();
      this._W = tf.variable(tf.tensor2d(W, [this.n, this.n]));
    }
    return this;
  }

  alive(threshold = 0.1) {
    return this.heaviest(this.n * this.n).filter(e => e.weight >= threshold);
  }

  simulate(ticks = 10, rate = 0.1) {
    const log = [];
    for (let t = 0; t < ticks; t++) {
      this.decay(rate);
      log.push({ tick: t + 1, heaviest: this.heaviest(1)[0] ?? null });
    }
    return log;
  }

  // ── Утилиты ───────────────────────────────────────────────────────────

  encode(act) { return encodeVec(act, this.persons); }
  decode(arr)  { return decodeVec(arr, this.persons); }

  describe() {
    const status = this.ontologicalStatus().filter(s => s.received > 0 || s.returned > 0).slice(0, 5);
    const lines = [
      `GiftMemory: ${this.n} тварных + ${this.nd} божественных лиц, ${this.actsCount} актов`,
      `Тензор W: [${this.n}×${this.n}] float32 = ${(this.n * this.n * 4 / 1024).toFixed(1)} КБ`,
      `Energeia: [${this.nd}×${this.n}] | Doxologia: [${this.n}×${this.nd}]`,
      `Топ нитей:`,
      ...this.heaviest(5).map(e => `  ${e.from} → ${e.to}: ${e.weight.toFixed(2)}`),
    ];
    if (status.length) {
      lines.push('Θέωσις (κτιστόν):');
      for (const s of status)
        lines.push(`  ${s.personId}: ${s.level} (index=${s.index.toFixed(3)}, recv=${s.received.toFixed(1)}, ret=${s.returned.toFixed(1)})`);
    }
    if (this._declined.length)
      lines.push(`Λήψις: ${this._declined.length} отвергнутых дара ждут μετάνοια`);
    return lines.join('\n');
  }

  snapshot() {
    return {
      persons:      this.persons,       // тварные лица (W-пространство)
      divinePersons: this.divinePersons,
      n:            this.n,
      nd:           this.nd,
      actsCount:    this.actsCount,
      W:            this._W.arraySync(),
      energeia:     this._energeia.map(row => Array.from(row)),
      doxologia:    this._doxologia.map(row => Array.from(row)),
      theophaneia:  this._theophaneia.map(row => Array.from(row)),
      // λήψις: история отвергнутых даров — память о грехопадении
      declined:     this._declined.map(d => ({ act: { ...d.act }, declinedAt: d.declinedAt })),
      createdAt:    this._createdAt,
      snapshotAt:   new Date().toISOString(),
      schema:       'v2-energeia',       // маркер формата
    };
  }

  static fromSnapshot(snap) {
    // ── Миграция: старый формат v1 (все лица в одном W) ──────────────
    if (snap.schema !== 'v2-energeia') {
      return GiftMemory._migrateV1(snap);
    }

    // ── Новый формат v2 ───────────────────────────────────────────────
    const allPersons = [...(snap.divinePersons ?? []), ...(snap.persons ?? [])];
    const m = new GiftMemory(allPersons);
    m.actsCount  = snap.actsCount ?? 0;
    m._createdAt = snap.createdAt ?? snap.snapshotAt;

    m._W.dispose();
    m._W = tf.variable(tf.tensor2d(snap.W, [snap.n, snap.n]));

    if (snap.energeia)    m._energeia    = snap.energeia.map(r => new Float32Array(r));
    if (snap.doxologia)   m._doxologia   = snap.doxologia.map(r => new Float32Array(r));
    if (snap.theophaneia) m._theophaneia = snap.theophaneia.map(r => new Float32Array(r));
    if (snap.declined)    m._declined    = snap.declined.map(d => ({
      act: Object.freeze({ ...d.act }),
      declinedAt: d.declinedAt,
    }));

    return m;
  }

  // Миграция v1 → v2: разбираем старый W на три матрицы
  static _migrateV1(snap) {
    const oldPersons = snap.persons ?? [];
    const oldW       = snap.W ?? [];

    // Создаём новый GiftMemory с правильным разделением
    const m = new GiftMemory(oldPersons);
    m.actsCount  = snap.actsCount ?? 0;
    m._createdAt = snap.createdAt ?? snap.snapshotAt;

    // Переносим тварную часть старого W в новый W
    const divineInOld = oldPersons.filter(p => DIVINE_PERSONS.has(p));
    const creatureInOld = oldPersons.filter(p => !DIVINE_PERSONS.has(p));

    // Строим W только для тварных лиц
    const nc = m.n;
    const newW = Array.from({ length: nc }, () => new Array(nc).fill(0));
    for (let i = 0; i < creatureInOld.length; i++) {
      const oi = oldPersons.indexOf(creatureInOld[i]);
      for (let j = 0; j < creatureInOld.length; j++) {
        const oj = oldPersons.indexOf(creatureInOld[j]);
        if (oi >= 0 && oj >= 0 && oldW[oi] && oldW[oi][oj] != null)
          newW[i][j] = oldW[oi][oj];
      }
    }
    m._W.dispose();
    m._W = tf.variable(tf.tensor2d(newW, [nc, nc]));

    // Переносим divine→creature часть в energeia
    for (let di = 0; di < divineInOld.length; di++) {
      const oldDi = oldPersons.indexOf(divineInOld[di]);
      const mdi   = m.divinePersons.indexOf(divineInOld[di]);
      if (mdi < 0 || oldDi < 0) continue;
      for (let ci = 0; ci < creatureInOld.length; ci++) {
        const oldCi = oldPersons.indexOf(creatureInOld[ci]);
        const mci   = m.persons.indexOf(creatureInOld[ci]);
        if (mci < 0 || oldCi < 0) continue;
        m._energeia[mdi][mci] = oldW[oldDi]?.[oldCi] ?? 0;
      }
    }

    console.log('[GiftMemory] Мигрировано v1→v2:', divineInOld.length, 'divine,', creatureInOld.length, 'тварных');
    return m;
  }

  dispose() { this._W.dispose(); }
}
