/**
 * GiftMemory — живая память общины на тензорах
 *
 * Синтез:
 *   Стигмергия  — матрица весов W (N×N), среда меняется от актов
 *   Хопфилд    — аттракторы через W, makePresent = резонанс
 *   Троичность  — {−1, 0, +1} = {кенозис, суббота, плирома}
 *   Голография  — sync() между участниками, нет центра
 *
 * Всё вычисление — тензорные операции (TensorFlow.js / oneDNN / AVX2).
 * При N=10 лицах: 10×10 float32 = 400 байт.
 * При N=10 000:   400 МБ, GPU-ускорение автоматически.
 */

import * as tf from '@tensorflow/tfjs-node';

// Подавить лог TF при импорте
tf.env().set('IS_TEST', true);

// ── Троичное кодирование ───────────────────────────────────────────────────

/**
 * Кодировать акт дара в троичный вектор:
 *   vec[i] = −1  даритель  (кенозис)
 *   vec[i] =  0  свидетель (суббота)
 *   vec[i] = +1  получатель (плирома)
 */
function encodeVec(act, persons) {
  const n   = persons.length;
  const arr = new Float32Array(n); // все 0 = свидетели
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

// ── GiftMemory ─────────────────────────────────────────────────────────────

export class GiftMemory {
  constructor(persons = []) {
    this.persons   = [...persons];
    this.n         = persons.length;
    this.actsCount = 0;
    this._createdAt = new Date().toISOString();

    // W — тензор N×N float32, основа всей памяти
    this._W = tf.variable(tf.zeros([this.n, this.n]));
  }

  // ── Лица ──────────────────────────────────────────────────────────────

  addPerson(id) {
    if (this.persons.includes(id)) return this;

    const oldN   = this.n;
    const oldData = this._W.arraySync();

    this.persons.push(id);
    this.n++;

    // Расширить матрицу: добавить строку и столбец нулей
    const newData = Array.from({ length: this.n }, (_, i) =>
      Array.from({ length: this.n }, (_, j) =>
        i < oldN && j < oldN ? oldData[i][j] : 0
      )
    );

    this._W.dispose();
    this._W = tf.variable(tf.tensor2d(newData, [this.n, this.n]));
    return this;
  }

  _idx(id) {
    if (!id || id === '_abyss' || id === '_koinon') return -1;
    const i = this.persons.indexOf(id);
    if (i >= 0) return i;
    this.addPerson(id);
    return this.persons.length - 1;
  }

  // ── Принять акт дара ──────────────────────────────────────────────────

  /**
   * receive(act) — меняет мир.
   *
   * 1. Стигмергия:  W[gi][ri] += weight   (нить утолщается)
   * 2. Хопфилд:    W += (1/n) · pat ⊗ pat (паттерн обжигается)
   *
   * pat ⊗ pat — внешнее произведение: одна тензорная операция вместо O(n²) циклов.
   */
  receive(act) {
    const gi = this._idx(act.giverId);
    const ri = this._idx(act.receiverId);
    const w  = act.weight ?? 1;
    const n  = this.n;

    const pat  = encodeVec(act, this.persons);
    const tPat = tf.tensor1d(pat);

    tf.tidy(() => {
      // Внешнее произведение: pat ⊗ pat → матрица N×N
      const outer = tf.outerProduct(tPat, tPat);

      // Хопфилд: W += (1/n) · outer (нормировано)
      const hopfield = outer.mul(1 / n);

      // Стигмергия: добавить вес напрямую в W[gi][ri]
      const stigma = tf.buffer([n, n]);
      if (gi >= 0 && ri >= 0) stigma.set(w, gi, ri);

      const delta = hopfield.add(stigma.toTensor());
      const next  = this._W.add(delta);
      this._W.assign(next);
    });

    tPat.dispose();
    this.actsCount++;
    return pat;
  }

  // ── Анамнезис: резонанс Хопфилда ─────────────────────────────────────

  /**
   * makePresent(partial) — подаёшь фрагмент, получаешь целое.
   *
   * Итерация: state = sign(W · state)
   * Это одно матрично-векторное умножение на шаг — O(n²) как одна операция.
   * На GPU: параллельно по всем строкам одновременно.
   */
  makePresent(partial, maxIter = 20) {
    const n      = this.n;
    const initArr = encodeVec(
      { giverId: partial.giverId ?? null, receiverId: partial.receiverId ?? null },
      this.persons
    );

    // Зафиксированные позиции не обновляем
    const fixed = new Uint8Array(n);
    if (partial.giverId    && this.persons.includes(partial.giverId))
      fixed[this.persons.indexOf(partial.giverId)]    = 1;
    if (partial.receiverId && this.persons.includes(partial.receiverId))
      fixed[this.persons.indexOf(partial.receiverId)] = 1;

    const result = tf.tidy(() => {
      let state = tf.tensor1d(initArr);
      const fixedMask = tf.tensor1d(fixed, 'float32');
      const freeMask  = fixedMask.sub(1).abs(); // 1 там где свободно

      for (let iter = 0; iter < maxIter; iter++) {
        // W · state — матрично-векторное умножение
        const activated = this._W.matMul(state.reshape([n, 1])).reshape([n]);
        const signed    = activated.sign();

        // Обновляем только свободные позиции
        const next = state.mul(fixedMask).add(signed.mul(freeMask));

        const diff = next.sub(state).abs().sum().arraySync();
        state = next;
        if (diff < 0.5) break;
      }

      return state.arraySync();
    });

    const e = this.energy(result);

    return {
      pattern:  result,
      decoded:  decodeVec(result, this.persons),
      energy:   e,
    };
  }

  // ── Энергия ───────────────────────────────────────────────────────────

  /**
   * E = −½ · sᵀ · W · s
   *
   * Квадратичная форма: две матричные операции.
   * Минимум энергии = аттрактор = воспоминание.
   */
  energy(stateArr) {
    return tf.tidy(() => {
      const s  = tf.tensor1d(Array.from(stateArr));
      const Ws = this._W.matMul(s.reshape([this.n, 1])).reshape([this.n]);
      return -0.5 * s.dot(Ws).arraySync();
    });
  }

  // ── Стигмергия: запросы ───────────────────────────────────────────────

  thread(fromId, toId) {
    const fi = this.persons.indexOf(fromId);
    const ti = this.persons.indexOf(toId);
    if (fi < 0 || ti < 0) return 0;
    return this._W.arraySync()[fi][ti];
  }

  heaviest(k = 7) {
    const W = this._W.arraySync();
    const edges = [];
    for (let i = 0; i < this.n; i++) {
      for (let j = 0; j < this.n; j++) {
        if (W[i][j] > 0) edges.push({ from: this.persons[i], to: this.persons[j], weight: W[i][j] });
      }
    }
    return edges.sort((a, b) => b.weight - a.weight).slice(0, k);
  }

  totalGiven(id) {
    const i = this.persons.indexOf(id);
    if (i < 0) return 0;
    return tf.tidy(() => this._W.slice([i, 0], [1, this.n]).sum().arraySync());
  }

  totalReceived(id) {
    const i = this.persons.indexOf(id);
    if (i < 0) return 0;
    return tf.tidy(() => this._W.slice([0, i], [this.n, 1]).sum().arraySync());
  }

  // ── Голография: синхронизация ─────────────────────────────────────────

  /**
   * sync(other) — идемпотентное слияние двух копий памяти.
   * element-wise maximum: берём лучшее из обоих.
   * sync(sync(a,b), b) = sync(a,b) — CRDT-свойство.
   */
  sync(other) {
    for (const id of other.persons) this._idx(id);

    const W = this._W.arraySync();
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
    this.actsCount = Math.max(this.actsCount, other.actsCount);
    return this;
  }

  // ── Распад ────────────────────────────────────────────────────────────

  /**
   * decay(rate) — нити истончаются без новых даров.
   *
   * W = W · (1 − rate)
   *
   * Одна тензорная операция: scalar multiply.
   * rate = 0.01 → -1% в тик. За 100 тиков без даров — нить умирает.
   *
   * Богословски: память без анамнезиса угасает.
   * Физически: синаптическая депрессия.
   * Математически: экспоненциальное затухание.
   *
   * Воскресение: receive(act) снова утолщает нить.
   * Anastasis — не отменяет распад, но побеждает его.
   */
  decay(rate = 0.01) {
    tf.tidy(() => {
      const decayed = this._W.mul(1 - rate);
      this._W.assign(decayed);
    });
    return this;
  }

  /**
   * decaySelective(rate, threshold) — распад с порогом.
   * Нити ниже threshold обнуляются (мёртвые связи уходят).
   * Нити выше — продолжают тлеть.
   */
  decaySelective(rate = 0.01, threshold = 0.1) {
    tf.tidy(() => {
      const decayed = this._W.mul(1 - rate);
      const alive   = decayed.greater(threshold).cast('float32');
      this._W.assign(decayed.mul(alive));
    });
    return this;
  }

  /**
   * resurrect(fromId, toId) — воскресить угасшую нить.
   * Если нить почти умерла (< threshold) — восстановить до минимального веса.
   * Аналог anastasis: прошлое не отменяется, но делается настоящим.
   */
  resurrect(fromId, toId, minWeight = 1.0) {
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

  /**
   * alive() — список живых нитей (вес > threshold).
   * Мёртвые нити не возвращаются.
   */
  alive(threshold = 0.1) {
    return this.heaviest(this.n * this.n)
      .filter(e => e.weight >= threshold);
  }

  /**
   * Симуляция ритма: N тиков распада, затем акт.
   * Показывает как нить умирает и воскресает.
   */
  simulate(ticks = 10, rate = 0.1) {
    const before = this.thread.bind(this);
    const log = [];
    for (let t = 0; t < ticks; t++) {
      this.decay(rate);
      log.push({
        tick: t + 1,
        heaviest: this.heaviest(1)[0] ?? null,
      });
    }
    return log;
  }

  // ── Утилиты ───────────────────────────────────────────────────────────

  encode(act) { return encodeVec(act, this.persons); }
  decode(arr)  { return decodeVec(arr, this.persons); }

  describe() {
    const lines = [
      `GiftMemory: ${this.n} лиц, ${this.actsCount} актов`,
      `Тензор W: [${this.n}×${this.n}] float32 = ${(this.n * this.n * 4 / 1024).toFixed(1)} КБ`,
      `Capacity (Хопфилд): ~${Math.max(1, Math.floor(0.14 * this.n))} паттернов`,
      `Топ нитей:`,
      ...this.heaviest(5).map(e => `  ${e.from} → ${e.to}: ${e.weight.toFixed(2)}`),
    ];
    return lines.join('\n');
  }

  snapshot() {
    return {
      persons:    this.persons,
      n:          this.n,
      actsCount:  this.actsCount,
      W:          this._W.arraySync(),
      createdAt:  this._createdAt,
      snapshotAt: new Date().toISOString(),
    };
  }

  static fromSnapshot(snap) {
    const m = new GiftMemory(snap.persons);
    m.n          = snap.n;
    m.actsCount  = snap.actsCount ?? 0;
    m._createdAt = snap.createdAt ?? snap.snapshotAt;
    m._W.dispose();
    m._W = tf.variable(tf.tensor2d(snap.W, [snap.n, snap.n]));
    return m;
  }

  dispose() {
    this._W.dispose();
  }
}
