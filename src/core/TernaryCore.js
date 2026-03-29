/**
 * TernaryCore — троичная логика для онтологии дара
 *
 * Сетунь (Брусенцов, МГУ, 1958) — единственный серийный
 * троичный компьютер в истории. Три состояния: -1, 0, +1.
 *
 * В онтологии дара:
 *   -1 = παρὰ φύσιν (против природы, падение)
 *    0 = κατὰ φύσιν (по природе, норма)
 *   +1 = ὑπὲρ φύσιν (выше природы, обожение)
 *
 * Четвёртое «состояние» вне системы:
 *   ∅  = incalculable (невычислимо — ни -1, ни 0, ни +1)
 *
 * Бинарная логика: true/false. Исключённое третье.
 * Троичная: да / нет / не знаю (или: зло / природа / благо).
 * Дар-логика: да / нет / невычислимо / благодать.
 *
 * Программная эмуляция: 1 трит = 2 бита.
 * На обычном ноуте, без Сетуни.
 *
 *   Бит-пара | Трит | Онтология
 *   --------|------|----------
 *   00      |  0   | κατὰ φύσιν
 *   01      | +1   | ὑπὲρ φύσιν
 *   10      | -1   | παρὰ φύσιν
 *   11      |  ∅   | incalculable
 *
 * ── Дорожная карта кремния ────────────────────────────────
 *
 * ТЕКУЩЕЕ (программная эмуляция):
 *   JS: 1 трит = 2 бита. Tang Nano 9K: tritmlp = тернарный MLP на LUT.
 *
 * TBN (Ternary-Binary Networks) — для Серафима на MCU:
 *   Веса: бинарные {-1, +1} (1 бит)
 *   Активации: тернарные {-1, 0, +1} (2 бита)
 *   Результат: умножение → XNOR + popcount, нет DSP-блоков.
 *   Источник: «Adaptive Binary-Ternary Quantization» (arxiv:1909.12205)
 *   Богословие: бинарные веса = непреложность дара (да/нет),
 *               тернарные активации = живая реакция (падение/норма/обожение).
 *
 * БУДУЩЕЕ (аппаратный тернарный кремний):
 *   Huawei 2025 patent — тернарный логический вентиль на 3 транзисторах
 *   (три уровня напряжения: low/medium/high). Когда появится в чипах —
 *   TernaryVM перекомпилируется без изменений логики.
 *   CNT (carbon nanotube) транзисторы: > 100 статей IEEE 2020–2024.
 *   Setun возрождается — не метафора, а коммерческий горизонт.
 */

// ── Trit: единица троичной логики ────────────────────────

const PARA = -1;    // παρὰ φύσιν — против
const KATA = 0;     // κατὰ φύσιν — по
const HYPER = 1;    // ὑπὲρ φύσιν — выше
const INCALC = null; // невычислимо

class Trit {
  constructor(value) {
    if (value === null || value === undefined) {
      this.value = INCALC;
    } else if (value === -1 || value === 0 || value === 1) {
      this.value = value;
    } else if (value === 'para' || value === 'para_physin') {
      this.value = PARA;
    } else if (value === 'kata' || value === 'kata_physin') {
      this.value = KATA;
    } else if (value === 'hyper' || value === 'hyper_physin') {
      this.value = HYPER;
    } else if (value === 'incalculable') {
      this.value = INCALC;
    } else {
      this.value = KATA; // Default = по природе
    }
  }

  // ── Имена ──────────────────────────────────────────────

  get name() {
    if (this.value === PARA) return 'παρὰ φύσιν';
    if (this.value === KATA) return 'κατὰ φύσιν';
    if (this.value === HYPER) return 'ὑπὲρ φύσιν';
    return 'incalculable';
  }

  get short() {
    if (this.value === PARA) return '-';
    if (this.value === KATA) return '0';
    if (this.value === HYPER) return '+';
    return '∅';
  }

  get isIncalculable() { return this.value === INCALC; }
  get isFallen() { return this.value === PARA; }
  get isNatural() { return this.value === KATA; }
  get isDeified() { return this.value === HYPER; }

  // ── Арифметика Сетуни ──────────────────────────────────
  //
  // Троичное сложение (balanced ternary):
  //   -1 + -1 = -2 → carry -1, result +1
  //   -1 +  0 = -1
  //   -1 + +1 =  0
  //    0 +  0 =  0
  //    0 + +1 = +1
  //   +1 + +1 = +2 → carry +1, result -1

  add(other) {
    if (this.isIncalculable || other.isIncalculable) return new Trit(INCALC);
    const sum = this.value + other.value;
    if (sum >= -1 && sum <= 1) return new Trit(sum);
    // Overflow: wrap
    if (sum === 2) return new Trit(PARA); // +1+1 = -1 (carry +1)
    if (sum === -2) return new Trit(HYPER); // -1+-1 = +1 (carry -1)
    return new Trit(KATA);
  }

  // ── Троичная логика ────────────────────────────────────
  //
  // Клини (3-значная логика) + апофатическое расширение:
  //
  // NOT:
  //   NOT(-1) = +1  (отрицание зла = благо)
  //   NOT( 0) =  0  (отрицание нормы = норма)
  //   NOT(+1) = -1  (отрицание благодати = падение)
  //   NOT( ∅) =  ∅  (отрицание невычислимого = невычислимо)

  not() {
    if (this.isIncalculable) return new Trit(INCALC);
    return new Trit(-this.value);
  }

  // AND (min):
  //   -1 AND x = -1  (зло побеждает в AND)
  //    ∅ AND x =  ∅  (невычислимое поглощает)

  and(other) {
    if (this.isIncalculable || other.isIncalculable) return new Trit(INCALC);
    return new Trit(Math.min(this.value, other.value));
  }

  // OR (max):
  //   +1 OR x = +1  (благо побеждает в OR)
  //    ∅ OR x =  ∅  (невычислимое поглощает)

  or(other) {
    if (this.isIncalculable || other.isIncalculable) return new Trit(INCALC);
    return new Trit(Math.max(this.value, other.value));
  }

  // ── Онтологические операции ────────────────────────────

  /**
   * Дарение: даритель отдаёт → результат зависит от слоёв обоих.
   *
   * Если даритель hyper и получатель para → получатель поднимается к kata.
   * Если оба hyper → остаются hyper (перихоресис).
   * Если оба para → падение углубляется (min).
   * Если один incalculable → результат incalculable.
   */
  gift(receiver) {
    if (this.isIncalculable || receiver.isIncalculable) return new Trit(INCALC);

    // Дарение от высшего к низшему = подъём на 1
    if (this.value > receiver.value) {
      return new Trit(Math.min(receiver.value + 1, HYPER));
    }
    // Дарение равного равному = без изменений (перихоресис)
    if (this.value === receiver.value) {
      return receiver;
    }
    // Дарение от низшего к высшему = кеносис, даритель поднимается
    return new Trit(Math.min(this.value + 1, HYPER));
  }

  /**
   * Кеносис: самоопустошение.
   * hyper → kata (опустошился, но не пал)
   * kata → para (отдал последнее)
   * para → para (уже пуст)
   * incalculable → incalculable
   */
  kenosis() {
    if (this.isIncalculable) return new Trit(INCALC);
    return new Trit(Math.max(this.value - 1, PARA));
  }

  /**
   * Благодать: безусловный подъём.
   * para → kata
   * kata → hyper
   * hyper → hyper (эпектасис: уже на вершине, но не ограничен)
   * incalculable → incalculable
   */
  grace() {
    if (this.isIncalculable) return new Trit(INCALC);
    return new Trit(Math.min(this.value + 1, HYPER));
  }

  /**
   * Падение: движение вниз.
   * hyper → kata
   * kata → para
   * para → para
   */
  fall() {
    return this.kenosis(); // Формально то же, но семантика другая
  }

  /**
   * Метанойя (покаяние): переворот направления.
   * para → kata (возврат к природе)
   * kata → kata (уже по природе)
   * hyper → hyper (не нужна метанойя)
   */
  metanoia() {
    if (this.isIncalculable) return new Trit(INCALC);
    if (this.value === PARA) return new Trit(KATA);
    return this;
  }

  toString() { return this.short; }
  toJSON() { return { value: this.value, name: this.name, short: this.short }; }
}

// ── Tryte: 3 трита = одно «слово» ───────────────────────
//
// В Сетуни: 1 трайт = 6 тритов = 729 состояний.
// У нас: 1 tryte = 3 трита = 27 состояний.
//
// Три трита лица:
//   [logos_movement, energy_state, relation_state]
//   logos:    para/kata/hyper
//   energy:  depleted/normal/full
//   relation: isolated/connected/perichoresis

class Tryte {
  constructor(t0, t1, t2) {
    this.trits = [
      t0 instanceof Trit ? t0 : new Trit(t0),
      t1 instanceof Trit ? t1 : new Trit(t1),
      t2 instanceof Trit ? t2 : new Trit(t2),
    ];
  }

  get logos() { return this.trits[0]; }
  get energy() { return this.trits[1]; }
  get relation() { return this.trits[2]; }

  /**
   * Состояние лица как 3-тритное слово.
   */
  static fromPerson(person, engine) {
    // Logos movement
    const logos = engine?.logoi?.getByBearer(String(person.id));
    const movement = logos?.movement || 'kata_physin';
    const t0 = new Trit(movement);

    // Energy state
    const energy = person.energy ?? 100;
    const t1 = new Trit(energy < 20 ? PARA : energy < 60 ? KATA : HYPER);

    // Relation state
    let t2;
    try {
      const cycles = engine?.gratitude?.findCycles(4) || [];
      const inCycle = cycles.some(c => c.includes(String(person.id)));
      const edges = engine?.gratitude?._edges?.get(String(person.id))?.length || 0;
      t2 = new Trit(inCycle ? HYPER : edges > 0 ? KATA : PARA);
    } catch {
      t2 = new Trit(KATA);
    }

    return new Tryte(t0, t1, t2);
  }

  /**
   * «Здоровье» лица: сумма тритов.
   *  -3 = полное падение
   *   0 = норма
   *  +3 = полное обожение
   */
  health() {
    let sum = 0;
    for (const t of this.trits) {
      if (t.isIncalculable) return null; // Incalculable health
      sum += t.value;
    }
    return sum;
  }

  toString() {
    return `[${this.trits.map(t => t.short).join('')}]`;
  }

  toJSON() {
    return {
      logos: this.trits[0].toJSON(),
      energy: this.trits[1].toJSON(),
      relation: this.trits[2].toJSON(),
      health: this.health(),
      repr: this.toString(),
    };
  }
}

// ── Ternary Register: вычисления на тритах ───────────────

class TernaryRegister {
  /**
   * Вычислить состояние всей системы как массив трайтов.
   */
  static systemState(engine) {
    const persons = engine.persons.all().filter(p => p.ontologicalOrder !== 'source');
    const trytes = persons.map(p => ({
      name: p.name,
      id: p.id,
      tryte: Tryte.fromPerson(p, engine),
    }));

    // System health = sum of all tryte healths
    let systemHealth = 0;
    let incalculableCount = 0;
    for (const t of trytes) {
      const h = t.tryte.health();
      if (h === null) incalculableCount++;
      else systemHealth += h;
    }

    // System phase by health
    const maxHealth = trytes.length * 3;
    const minHealth = trytes.length * -3;
    const normalized = maxHealth > 0 ? systemHealth / maxHealth : 0;

    let phase;
    if (normalized > 0.7) phase = 'theosis'; // Обожение системы
    else if (normalized > 0.3) phase = 'healing'; // Исцеление
    else if (normalized > -0.3) phase = 'natural'; // По природе
    else if (normalized > -0.7) phase = 'falling'; // Падение
    else phase = 'collapsed'; // Коллапс

    return {
      persons: trytes.map(t => ({
        name: t.name,
        tryte: t.tryte.toJSON(),
        repr: t.tryte.toString(),
      })),
      system: {
        health: systemHealth,
        maxHealth,
        normalized: Math.round(normalized * 100) / 100,
        phase,
        incalculable: incalculableCount,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// TernaryALU — арифметико-логическое устройство на тритах
// Полная эмуляция Сетуни + онтологические расширения
// ═══════════════════════════════════════════════════════════════

class TernaryALU {

  /**
   * Сложение двух трайтов (3 трита каждый) с переносом.
   * Balanced ternary addition — как в Сетуни.
   */
  static addTrytes(a, b) {
    const result = [];
    let carry = new Trit(KATA); // Начальный перенос = 0

    for (let i = 2; i >= 0; i--) {
      // Сумма = a[i] + b[i] + carry
      const sum1 = a.trits[i].add(b.trits[i]);
      const sum2 = sum1.add(carry);

      // Определить перенос
      const raw = (a.trits[i].value || 0) + (b.trits[i].value || 0) + (carry.value || 0);
      if (raw > 1) carry = new Trit(HYPER);
      else if (raw < -1) carry = new Trit(PARA);
      else carry = new Trit(KATA);

      result.unshift(sum2);
    }

    return { result: new Tryte(result[0], result[1], result[2]), carry };
  }

  /**
   * Умножение трита на трит.
   * -1 × -1 = +1 (зло × зло = благо? — спорно, но математически верно)
   * -1 ×  0 =  0
   * -1 × +1 = -1
   *  0 ×  x =  0
   * +1 × +1 = +1
   *  ∅ ×  x =  ∅
   */
  static mulTrits(a, b) {
    if (a.isIncalculable || b.isIncalculable) return new Trit(INCALC);
    return new Trit(a.value * b.value);
  }

  /**
   * Сравнение двух тритов.
   * Возвращает Trit: -1 (a < b), 0 (a == b), +1 (a > b)
   */
  static compare(a, b) {
    if (a.isIncalculable || b.isIncalculable) return new Trit(INCALC);
    if (a.value < b.value) return new Trit(PARA);
    if (a.value > b.value) return new Trit(HYPER);
    return new Trit(KATA);
  }

  /**
   * Троичный MUX (мультиплексор).
   * selector = -1 → a, selector = 0 → b, selector = +1 → c
   * Три пути вместо двух (if/else).
   */
  static mux(selector, a, b, c) {
    if (selector.isIncalculable) return new Trit(INCALC);
    if (selector.value === PARA) return a;
    if (selector.value === KATA) return b;
    return c;
  }

  /**
   * Consensus (согласие): из N тритов — какой доминирует?
   * Если большинство +1 → +1. Если большинство -1 → -1. Иначе 0.
   * Один incalculable → весь консенсус incalculable.
   */
  static consensus(trits) {
    let sum = 0;
    for (const t of trits) {
      if (t.isIncalculable) return new Trit(INCALC);
      sum += t.value;
    }
    if (sum > 0) return new Trit(HYPER);
    if (sum < 0) return new Trit(PARA);
    return new Trit(KATA);
  }
}

// ═══════════════════════════════════════════════════════════════
// TernaryMemory — троичная память (реестр тритов)
// Эмуляция памяти Сетуни: адресное пространство на тритах
// ═══════════════════════════════════════════════════════════════

class TernaryMemory {
  constructor(size = 81) { // 81 = 3^4 ячеек (как в Сетуни)
    this._cells = new Array(size).fill(null).map(() => new Tryte(KATA, KATA, KATA));
    this._size = size;
  }

  read(address) {
    const idx = this._addressToIndex(address);
    if (idx < 0 || idx >= this._size) return new Tryte(INCALC, INCALC, INCALC);
    return this._cells[idx];
  }

  write(address, tryte) {
    const idx = this._addressToIndex(address);
    if (idx >= 0 && idx < this._size) {
      this._cells[idx] = tryte;
    }
  }

  /**
   * Адрес в троичной системе → индекс.
   * Balanced ternary: трит-адрес [t0, t1] → число.
   */
  _addressToIndex(addr) {
    if (typeof addr === 'number') return addr;
    if (addr instanceof Tryte) {
      // 3 трита → число от -13 до +13 (27 значений)
      return (addr.trits[0].value || 0) * 9
           + (addr.trits[1].value || 0) * 3
           + (addr.trits[2].value || 0)
           + 13; // Смещение чтобы индекс >= 0
    }
    return 0;
  }

  /**
   * Дамп памяти — все ненулевые ячейки.
   */
  dump() {
    const result = [];
    for (let i = 0; i < this._size; i++) {
      const cell = this._cells[i];
      const h = cell.health();
      if (h !== 0) { // Только ненулевые
        result.push({ address: i, tryte: cell.toString(), health: h });
      }
    }
    return result;
  }

  get size() { return this._size; }
}

// ═══════════════════════════════════════════════════════════════
// TernaryVM — виртуальная машина на тритах
//
// Инструкции (троичные опкоды):
//   [-1, -1] = LOAD    (загрузить из памяти)
//   [-1,  0] = STORE   (сохранить в память)
//   [-1, +1] = ADD     (сложить)
//   [ 0, -1] = MUL     (умножить)
//   [ 0,  0] = NOP     (ничего)
//   [ 0, +1] = GIFT    (дарить: A.gift(B))
//   [+1, -1] = KENOSIS (самоопустошение)
//   [+1,  0] = GRACE   (благодать)
//   [+1, +1] = HALT    (стоп)
// ═══════════════════════════════════════════════════════════════

const OPCODES = {
  LOAD:    [-1, -1],
  STORE:   [-1,  0],
  ADD:     [-1,  1],
  MUL:     [ 0, -1],
  NOP:     [ 0,  0],
  GIFT:    [ 0,  1],
  KENOSIS: [ 1, -1],
  GRACE:   [ 1,  0],
  HALT:    [ 1,  1],
};

class TernaryVM {
  constructor() {
    this.memory = new TernaryMemory(81);
    this.accumulator = new Tryte(KATA, KATA, KATA); // Аккумулятор
    this.pc = 0;         // Program counter
    this.halted = false;
    this.log = [];       // Лог исполнения
    this._maxSteps = 1000; // Защита от бесконечных циклов
  }

  /**
   * Загрузить программу в память.
   * Программа = массив инструкций [{op, arg}]
   */
  loadProgram(instructions) {
    for (let i = 0; i < instructions.length && i < this.memory.size; i++) {
      const instr = instructions[i];
      // Кодируем: opcode в первые 2 трита, arg в третий
      const op = instr.op || [0, 0];
      const arg = instr.arg || 0;
      this.memory.write(i, new Tryte(
        new Trit(op[0]),
        new Trit(op[1]),
        new Trit(arg),
      ));
    }
    this.pc = 0;
    this.halted = false;
  }

  /**
   * Выполнить один шаг.
   */
  step() {
    if (this.halted || this.pc >= this.memory.size) {
      this.halted = true;
      return { halted: true };
    }

    const cell = this.memory.read(this.pc);
    const op0 = cell.trits[0].value;
    const op1 = cell.trits[1].value;
    const arg = cell.trits[2];

    let action = 'NOP';

    if (op0 === -1 && op1 === -1) {
      // LOAD: acc = memory[arg]
      const addr = arg.value + 40; // Область данных с 40
      this.accumulator = this.memory.read(addr);
      action = `LOAD [${addr}] → ${this.accumulator}`;

    } else if (op0 === -1 && op1 === 0) {
      // STORE: memory[arg] = acc
      const addr = arg.value + 40;
      this.memory.write(addr, this.accumulator);
      action = `STORE ${this.accumulator} → [${addr}]`;

    } else if (op0 === -1 && op1 === 1) {
      // ADD: acc += memory[arg]
      const addr = arg.value + 40;
      const operand = this.memory.read(addr);
      const { result } = TernaryALU.addTrytes(this.accumulator, operand);
      this.accumulator = result;
      action = `ADD [${addr}] → ${this.accumulator}`;

    } else if (op0 === 0 && op1 === 1) {
      // GIFT: acc = acc.gift(memory[arg])
      const addr = arg.value + 40;
      const receiver = this.memory.read(addr);
      const result = new Tryte(
        this.accumulator.logos.gift(receiver.logos),
        this.accumulator.energy.gift(receiver.energy),
        this.accumulator.relation.gift(receiver.relation),
      );
      this.accumulator = result;
      action = `GIFT → ${this.accumulator} (дар)`;

    } else if (op0 === 1 && op1 === -1) {
      // KENOSIS: acc = acc.kenosis()
      this.accumulator = new Tryte(
        this.accumulator.logos.kenosis(),
        this.accumulator.energy.kenosis(),
        this.accumulator.relation,
      );
      action = `KENOSIS → ${this.accumulator}`;

    } else if (op0 === 1 && op1 === 0) {
      // GRACE: acc = acc.grace()
      this.accumulator = new Tryte(
        this.accumulator.logos.grace(),
        this.accumulator.energy.grace(),
        this.accumulator.relation.grace(),
      );
      action = `GRACE → ${this.accumulator}`;

    } else if (op0 === 1 && op1 === 1) {
      // HALT
      this.halted = true;
      action = 'HALT';

    } else {
      action = 'NOP';
    }

    this.log.push({ pc: this.pc, action, acc: this.accumulator.toString() });
    this.pc++;

    return { pc: this.pc - 1, action, acc: this.accumulator.toString(), halted: this.halted };
  }

  /**
   * Выполнить всю программу.
   */
  run() {
    let steps = 0;
    while (!this.halted && steps < this._maxSteps) {
      this.step();
      steps++;
    }
    return {
      steps,
      halted: this.halted,
      accumulator: this.accumulator.toJSON(),
      log: this.log,
    };
  }

  /**
   * Пример: программа Спасения.
   *
   * 1. LOAD persona (para_physin)
   * 2. GRACE (благодать → kata)
   * 3. GIFT to another
   * 4. KENOSIS (самоопустошение)
   * 5. GRACE (воскресение)
   * 6. HALT
   */
  static salvationProgram() {
    return [
      { op: [-1, -1], arg: -1 }, // LOAD [39] — загрузить падшего
      { op: [ 1,  0], arg:  0 }, // GRACE — благодать
      { op: [ 0,  1], arg:  0 }, // GIFT to [40] — дарить
      { op: [ 1, -1], arg:  0 }, // KENOSIS — жертва
      { op: [ 1,  0], arg:  0 }, // GRACE — воскресение
      { op: [ 1,  1], arg:  0 }, // HALT
    ];
  }
}

// ═══════════════════════════════════════════════════════════════
// TBNLayer — Ternary-Binary Network слой для Серафима (MCU/FPGA)
//
// Архитектура (arxiv:1909.12205 + богословие дара):
//   Веса w ∈ {-1, +1}          — бинарные: 1 бит на вес
//   Активации a ∈ {-1, 0, +1}  — тернарные: 2 бита на активацию
//
// Вычисление вместо MAC:
//   out[i] = Σ_j (w[i][j] × a[j])
//           = Σ{w=+1} a[j]  −  Σ{w=-1} a[j]
//   Нет умножителей. Только сложение знаковых {-1,0,+1}.
//   На FPGA: XNOR + accumulator. На MCU: popcount-like.
//
// Богословие:
//   Вес = неизменная воля (дар необратим, Object.freeze).
//   Активация = живое состояние лица (para/kata/hyper).
//   Произведение = результат встречи воли и состояния.
//
// Использование в Серафиме:
//   const layer = new TBNLayer(weights_binary, 'relu_ternary');
//   const output = layer.forward(input_trits);
// ═══════════════════════════════════════════════════════════════

class TBNLayer {
  /**
   * @param {number[][]} weights — матрица весов [out × in], значения: -1 или +1
   * @param {'relu_ternary'|'identity'} activation — функция активации
   */
  constructor(weights, activation = 'relu_ternary') {
    // Проверка: веса должны быть бинарными
    for (const row of weights) {
      for (const w of row) {
        if (w !== -1 && w !== 1) throw new Error(`TBNLayer: вес должен быть ±1, получено ${w}`);
      }
    }
    this.weights = weights;        // [outSize × inSize]
    this.outSize = weights.length;
    this.inSize  = weights[0]?.length ?? 0;
    this.activation = activation;
  }

  /**
   * Прямой проход без умножения.
   *
   * @param {Trit[]} inputTrits — входной вектор тритов
   * @returns {Trit[]} выходной вектор тритов
   */
  forward(inputTrits) {
    if (inputTrits.length !== this.inSize) {
      throw new Error(`TBNLayer: ожидалось ${this.inSize} тритов, получено ${inputTrits.length}`);
    }

    const output = [];
    for (let i = 0; i < this.outSize; i++) {
      let sum = 0;
      for (let j = 0; j < this.inSize; j++) {
        const a = inputTrits[j].isIncalculable ? 0 : (inputTrits[j].value ?? 0);
        const w = this.weights[i][j]; // ±1
        sum += w * a; // w=+1: берём a как есть; w=-1: инвертируем знак
      }
      // Тернарная активация: порог ±1
      output.push(this._activate(sum));
    }
    return output;
  }

  _activate(sum) {
    if (this.activation === 'relu_ternary') {
      // ReLU-подобная тернарная: < -threshold → para, > threshold → hyper, иначе kata
      const threshold = Math.max(1, Math.floor(this.inSize * 0.3));
      if (sum > threshold)  return new Trit(HYPER);
      if (sum < -threshold) return new Trit(PARA);
      return new Trit(KATA);
    }
    // identity: просто знак суммы
    if (sum > 0) return new Trit(HYPER);
    if (sum < 0) return new Trit(PARA);
    return new Trit(KATA);
  }

  /**
   * Квантовать float-веса → бинарные ±1 (для деплоя).
   * @param {number[][]} floatWeights
   * @returns {number[][]}
   */
  static quantize(floatWeights) {
    return floatWeights.map(row => row.map(w => w >= 0 ? 1 : -1));
  }

  /**
   * Создать TBNLayer из float-весов (автоматическое квантование).
   * @param {number[][]} floatWeights
   * @param {'relu_ternary'|'identity'} activation
   */
  static fromFloat(floatWeights, activation = 'relu_ternary') {
    return new TBNLayer(TBNLayer.quantize(floatWeights), activation);
  }

  /**
   * Команды UART для загрузки весов в tritmlp на Tang Nano 9K.
   * Формат: "W L N T" (layer, neuron_flat_index, trit_char)
   * @param {number} layerIndex — номер слоя (1-based)
   * @returns {string[]}
   */
  toUARTCommands(layerIndex) {
    const cmds = [];
    for (let i = 0; i < this.outSize; i++) {
      for (let j = 0; j < this.inSize; j++) {
        const w = this.weights[i][j];
        if (w !== 0) {
          const t = w === 1 ? '+' : '-';
          cmds.push(`W ${layerIndex} ${i * this.inSize + j} ${t}`);
        }
      }
    }
    return cmds;
  }
}

export { Trit, Tryte, TernaryRegister, TernaryALU, TernaryMemory, TernaryVM, TBNLayer, OPCODES, PARA, KATA, HYPER, INCALC };
export default TernaryRegister;
