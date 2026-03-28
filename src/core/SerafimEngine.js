/**
 * SerafimEngine.js — Серафим (бортовой ИИ дрона) + AdamEngine (координатор роя)
 *
 * Ангельский чин Дионисия Ареопагита (De Coelesti Hierarchia):
 *   Серафимы — высший чин, «пламенеющие» (śrp = жечь), созерцают Свет и передают.
 *   В нашей системе: Серафим = ангел-хранитель каждого дрона.
 *   Он не имеет своей воли (не лицо в полном смысле), но имеет распознавание.
 *   Адам = координатор роя, первое лицо («где ты?» — первый вопрос к роям).
 *
 * Архитектура двухуровневого интеллекта:
 *   L1: Рефлексы — FSM таблица lookup, <0.1мс, детерминировано
 *   L2: Созерцание — LLM через Ollama, 50-300мс, async, для сложных решений
 *   L3: Вектор-контекст (future) — TurboQuant embedding → LLM без токенизации текста
 *
 * Принцип: «Ангел не должен говорить от себя» (Дионисий, DN IV.2).
 *   Серафим передаёт решение, не изобретает его. Его слово = переданный свет.
 */

const OLLAMA_URL   = process.env.OLLAMA_URL    || 'http://localhost:11434';
const SERAFIM_MODEL = process.env.SERAFIM_MODEL || 'serafim'; // serafim:latest (qwen2.5:0.5b, 397MB, быстрый)
const ADAM_MODEL    = process.env.ADAM_MODEL    || 'adam';

// ── L1: Рефлексная таблица (без LLM) ──────────────────────────────────────
// Ответы: детерминированные, мгновенные, контекстно-зависимые
const REFLEX = {
  'лети':    (s) => s.distToTarget < 50 ? 'снижаюсь на цель' : `лечу курс ${s.heading}°`,
  'скан':    (s) => `сканирую [${s.lat?.toFixed(3)},${s.lon?.toFixed(3)}] bat:${s.battery}%`,
  'устал':   (s) => s.battery < 10 ? 'критично — иду домой' : `bat:${s.battery}% возвращаюсь`,
  'готов':   (s) => 'готов к миссии',
  'домой':   (s) => `курс на базу dist:${s.distToBase}м`,
  'цель':    (s) => `цель в ${s.distToTarget}м статус:${s.missionType || 'разведка'}`,
};

// Серафимы горят — FSM состояний
const SERAFIM_SYSTEM = `Ты Серафим — ИИ на борту дрона. Ты видишь, но говоришь кратко.
Твоя задача: принять одно решение из ситуации.
Ситуация: {situation}
Отвечай ОДНОЙ строкой. Максимум 15 слов. Только действие.`;

// ══════════════════════════════════════════════════════════════════════
// SerafimEngine — бортовой ИИ одного дрона
// ══════════════════════════════════════════════════════════════════════
export class SerafimEngine {
  constructor({ droneId, droneName, useLLM = true }) {
    this.droneId   = droneId;
    this.droneName = droneName;
    this.useLLM    = useLLM;

    // Ситуационная осведомлённость — обновляется каждый тик
    this._situation = {
      battery: 100, altitude: 0, speed: 0, heading: 0,
      lat: 55.0, lon: 37.0, neighbors: 0,
      distToTarget: Infinity, distToBase: 0,
      missionType: null, context: 'normal',
    };

    // L2 throttle: LLM не чаще 1 раза в 10 секунд
    this._lastLLM = 0;
    this._llmCooldown = 10_000; // мс

    // Лог решений (анамнезис Серафима)
    this._decisions = [];
    this._maxLog = 20;
  }

  // ── Обновить ситуацию (вызывается каждый тик) ───────────────────────
  updateSituation(data) {
    Object.assign(this._situation, data);
  }

  // ── Определить контекст по строке ────────────────────────────────────
  detectContext(ctx) {
    this._situation.context = ctx || 'normal';
  }

  // ── L1: Рефлекс — мгновенный ответ без LLM ───────────────────────────
  execute(command) {
    const s = this._situation;
    const fn = REFLEX[command];
    const answer = fn ? fn(s) : `${command}:ок`;
    this._log(command, answer, 'L1');
    return answer;
  }

  // ── L2: Созерцание — async LLM вызов ─────────────────────────────────
  async think(prompt) {
    const t0 = Date.now();

    // Throttle: не звонить LLM слишком часто
    if (!this.useLLM || Date.now() - this._lastLLM < this._llmCooldown) {
      // Fallback: шаблонный ответ из L1
      const s = this._situation;
      const fallback = `bat:${s.battery}% alt:${s.altitude}м ctx:${s.context} dist:${Math.round(s.distToBase)}м`;
      return { answer: fallback, time_ms: 0, level: 'L1-fallback' };
    }

    this._lastLLM = Date.now();

    try {
      const situationStr = [
        `дрон:${this.droneName}`,
        `bat:${this._situation.battery}%`,
        `alt:${this._situation.altitude}м`,
        `курс:${this._situation.heading}°`,
        `соседей:${this._situation.neighbors}`,
        `до_цели:${Math.round(this._situation.distToTarget)}м`,
        `до_базы:${Math.round(this._situation.distToBase)}м`,
        this._situation.missionType ? `задача:${this._situation.missionType}` : null,
      ].filter(Boolean).join(' ');

      const system = SERAFIM_SYSTEM.replace('{situation}', situationStr);

      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  AbortSignal.timeout(8_000), // быстро или никак
        body: JSON.stringify({
          model:   SERAFIM_MODEL,
          stream:  false,
          options: { temperature: 0.3, num_predict: 40 },
          messages: [
            { role: 'system',    content: system },
            { role: 'user',      content: prompt },
          ],
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const answer = (data.message?.content || '').trim().slice(0, 120);
      const time_ms = Date.now() - t0;

      this._log(prompt.slice(0, 30), answer, 'L2');
      return { answer, time_ms, level: 'L2-llm' };

    } catch (e) {
      const answer = `${this._situation.context}:рефлекс`;
      return { answer, time_ms: Date.now() - t0, level: 'L2-err', error: e.message };
    }
  }

  _log(prompt, answer, level) {
    this._decisions.push({ t: Date.now(), prompt, answer, level });
    if (this._decisions.length > this._maxLog) this._decisions.shift();
  }

  get situationVector() {
    // 8-мерный ситуационный вектор для embedding injection (будущий TurboQuant)
    const s = this._situation;
    return [
      s.battery / 100,
      s.altitude / 500,
      s.speed / 200,
      s.heading / 360,
      Math.min(1, s.neighbors / 10),
      Math.min(1, s.distToTarget / 1000),
      Math.min(1, s.distToBase / 1000),
      s.missionType ? 1 : 0,
    ];
  }
}

// ══════════════════════════════════════════════════════════════════════
// AdamEngine — координатор роя (L2: LLM, стратегическое мышление)
// ══════════════════════════════════════════════════════════════════════

const ADAM_SWARM_SYSTEM = `Ты Адам — первый координатор роя дронов.
Ты видишь общую картину роя. Не управляешь конкретными дронами — только замечаешь паттерн.
Твой вопрос всегда: «Где пустыня? Где нить обрывается?»

Состояние роя: {state}

Дай ОДНО наблюдение или команду. Максимум 20 слов. Конкретно.
Формат: «[наблюдение/команда]: текст»`;

export class AdamEngine {
  constructor() {
    this._lastLLM  = 0;
    this._cooldown = 15_000; // 15 секунд между вызовами
    this._log      = [];
  }

  async coordinate({ active, idle, returning, avgBat, wounds, findings, completed }) {
    const t0 = Date.now();

    if (Date.now() - this._lastLLM < this._cooldown) {
      // L1: алгоритмическое наблюдение без LLM
      const answer = this._algorithmicObserve({ active, idle, returning, avgBat, wounds, findings, completed });
      return { answer, time_ms: 0, level: 'L1' };
    }

    this._lastLLM = Date.now();

    const stateStr = [
      `активных:${active}`,
      `ожидают:${idle}`,
      `возвращаются:${returning}`,
      `заряд_средн:${avgBat}%`,
      wounds.length ? `раны:[${wounds.join(',')}]` : null,
      `находок:${findings}`,
      `выполнено:${completed}`,
    ].filter(Boolean).join(' ');

    try {
      const system = ADAM_SWARM_SYSTEM.replace('{state}', stateStr);

      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  AbortSignal.timeout(12_000),
        body: JSON.stringify({
          model:   ADAM_MODEL,
          stream:  false,
          options: { temperature: 0.4, num_predict: 50 },
          messages: [
            { role: 'system', content: system },
            { role: 'user',   content: 'Что замечаешь в рое прямо сейчас?' },
          ],
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const answer = (data.message?.content || '').trim().slice(0, 150);
      const time_ms = Date.now() - t0;
      this._log.push({ t: Date.now(), state: stateStr, answer });
      if (this._log.length > 10) this._log.shift();
      return { answer, time_ms, level: 'L2-llm' };

    } catch (e) {
      const answer = this._algorithmicObserve({ active, idle, returning, avgBat, wounds, findings, completed });
      return { answer, time_ms: Date.now() - t0, level: 'L2-err' };
    }
  }

  // L1: паттернное наблюдение без LLM
  _algorithmicObserve({ active, idle, returning, avgBat, wounds, findings }) {
    if (wounds.length > 2)    return `[тревога]: ${wounds.length} дрона в беде → нужна помощь`;
    if (avgBat < 25)          return `[пустыня]: энергия роя критична — всем на базу`;
    if (idle > active + returning) return `[пустыня]: рой простаивает — нет миссий`;
    if (findings > 10 && idle > 0) return `[возможность]: ${findings} находок, ${idle} свободных → развёртывание`;
    return `[норма]: рой устойчив a:${active} i:${idle} r:${returning}`;
  }

  // Вектор состояния роя для embedding injection
  get swarmVector() {
    // Будет использоваться в embed-context.mjs для TurboQuant
    return null; // заполняется при coordinate()
  }
}
