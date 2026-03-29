/**
 * fpga-gift-bridge.mjs — Мост: W-матрица ↔ Tang Nano 9K ↔ Анамнезис
 *
 * Три уровня единой системы:
 *   Память  → sacred-history-W.json (W-матрица, снапшот онтологии)
 *   Ум      → агенты Ollama (анамнезис, fpga-command акты)
 *   Чип     → Tang Nano 9K (тритная логика, tritgift.v)
 *
 * Запуск:
 *   node utils/fpga-gift-bridge.mjs           # демо-режим (без чипа)
 *   node utils/fpga-gift-bridge.mjs --port /dev/ttyUSB1  # реальный чип
 *   node utils/fpga-gift-bridge.mjs --ws      # + WebSocket сервер :3701
 *
 * Протокол UART (tritgift.v):
 *   '+'/'-'/'0' → FSM  |  'a'/'A'/..'*'/'=' → CPU  |  '?' → статус
 *   'W' idx from to val → записать нить WMem (4 байта)
 *   'Q' idx             → запросить нить WMem
 *   'T'                 → топ нить WMem
 *
 * WebSocket :3701 — для портала:
 *   Сервер шлёт: {"type":"status","fsm":"Z","cpu":"A:+00 B:000 C:000",...}
 *   Клиент шлёт: {"cmd":"+"}  — FSM шаг или любая UART команда
 *
 * Анамнезис-протокол (content-based, т.к. сервер снимает meta):
 *   fsm-command:  content = '+' | '-' | '0'
 *   fpga-command: content = '5 + 3' | '! 7' | '-4 * 3'
 *   fsm-state:    content = 'Z→P cmd=<actId>'  (бот парсит)
 *   fpga-result:  content = '8 cmd=<actId>'     (бот парсит)
 */

import { readFileSync, existsSync, watchFile, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, '..');
const PORT_WS    = parseInt(process.env.WS_PORT || '3701');
const ANAMNESIS  = process.env.ANAMNESIS_URL || 'http://173.249.2.184:8089';

// Аргументы командной строки
const args    = process.argv.slice(2);
const uartPort = args.includes('--port') ? args[args.indexOf('--port')+1] : null;
const useWS   = args.includes('--ws') || args.includes('--websocket');
const demo    = !uartPort;

// ─────────────────────────────────────────────────────────────────────────────
// Тритное кодирование (зеркало TernaryCore.js + tritgift.v)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Перевести вес из W-матрицы в тритный int [-13..+13].
 */
function encodeWeight(w, maxW) {
  if (maxW <= 0) return 0;
  return Math.round((w / maxW) * 13);
}

/**
 * Конвертировать int [-13..+13] в 3-тритную строку '+++', '+--' и т.д.
 * Веса позиций: 9, 3, 1 (как в tritgift.v).
 */
function toTritStr(v) {
  v = Math.max(-13, Math.min(13, v));
  const places = [9, 3, 1];
  const trits  = [0, 0, 0];
  let rem = v;
  for (let i = 0; i < 3; i++) {
    let t = Math.round(rem / places[i]);
    t = Math.max(-1, Math.min(1, t));
    trits[i] = t;
    rem -= t * places[i];
  }
  return trits.map(t => t > 0 ? '+' : t < 0 ? '-' : '0').join('');
}

/**
 * Декодировать 3-тритную строку обратно в int.
 * '+--' → 9-3-1 = 5
 */
function decodeTrit3(s) {
  const places = [9, 3, 1];
  let result = 0;
  for (let i = 0; i < 3; i++) {
    const c = s[i] || '0';
    result += (c === '+' ? 1 : c === '-' ? -1 : 0) * places[i];
  }
  return result;
}

/**
 * Перевести состояние чипа (K/P/L) в нотацию бота (K/Z/P) и обратно.
 * Чип: K=KEN(-1), P=PRS(0), L=PLR(+1)
 * Бот: K=KEN(-1), Z=PRS(0), P=PLR(+1)
 */
const CHIP_TO_BOT = { K: 'K', P: 'Z', L: 'P' };

/**
 * Загрузить W-матрицу и вернуть топ-16 нитей.
 */
function loadTopEdges(n = 16) {
  const candidates = [
    join(ROOT, 'data', 'snapshots', 'W-2026-W13.json'),
    join(ROOT, 'data', 'W-prev.json'),
    join(ROOT, 'data', 'sacred-history-W.json'),
  ];
  const snapPath = candidates.find(p => existsSync(p));
  if (!snapPath) throw new Error('Снапшот W-матрицы не найден');
  const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
  const W       = snap.W;
  const persons = snap.persons;
  const size    = W.length;

  const edges = [];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (i !== j && W[i][j] > 0.5) {
        edges.push({ from: i, to: j, w: W[i][j],
          fromName: persons[i] || `p${i}`,
          toName:   persons[j] || `p${j}` });
      }
    }
  }
  edges.sort((a, b) => b.w - a.w);

  const maxW = edges.length > 0 ? edges[0].w : 1;
  return edges.slice(0, n).map((e, idx) => ({
    idx,
    from:     e.from,
    to:       e.to,
    weight:   encodeWeight(e.w, maxW),
    rawWeight: e.w,
    fromName: e.fromName,
    toName:   e.toName,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Демо-режим: программный UART (симуляция tritgift.v в JS)
// ─────────────────────────────────────────────────────────────────────────────

class FPGADemo {
  constructor() {
    this.fsm  = 0;   // -1=KEN, 0=PRS, +1=PLR
    this.fsmH = [0, 0, 0];
    this.regA   = 0;
    this.regB   = 0;
    this.regAcc = 0;
    this.wmem = Array.from({length:16}, () => ({from:0, to:0, w:0}));
    this._onResponse = null;
    this._waiters = [];  // {resolve, reject, timer}
  }

  onResponse(cb) { this._onResponse = cb; }

  _emit(msg) {
    // Сначала отдать ожидающим nextResponse()
    if (this._waiters.length > 0) {
      const w = this._waiters.shift();
      clearTimeout(w.timer);
      w.resolve(msg.replace(/[\r\n]+$/, ''));
    }
    // Затем постоянный обработчик
    if (this._onResponse) this._onResponse(msg);
  }

  /** Ожидать следующий ответ чипа (промис). */
  nextResponse(timeout = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.findIndex(w => w.resolve === resolve);
        if (idx >= 0) this._waiters.splice(idx, 1);
        reject(new Error('FPGA response timeout'));
      }, timeout);
      this._waiters.push({ resolve, reject, timer });
    });
  }

  _clamp(v) { return Math.max(-13, Math.min(13, v)); }
  _fsmChar() { return this.fsm === -1 ? 'K' : this.fsm === 0 ? 'P' : 'L'; }
  _cpuStr()  {
    return `A:${toTritStr(this.regA)} B:${toTritStr(this.regB)} C:${toTritStr(this.regAcc)}`;
  }

  send(cmd) {
    const c = typeof cmd === 'number' ? String.fromCharCode(cmd) : cmd[0];
    switch (c) {
      case '+': this.fsmH = [this.fsm, ...this.fsmH.slice(0,2)];
                this.fsm = Math.min(1, this.fsm + 1);
                this._emit(`F:${this._fsmChar()} i:+\r\n`); break;
      case '-': this.fsmH = [this.fsm, ...this.fsmH.slice(0,2)];
                this.fsm = Math.max(-1, this.fsm - 1);
                this._emit(`F:${this._fsmChar()} i:-\r\n`); break;
      case '0': this._emit(`F:${this._fsmChar()} i:0\r\n`); break;
      case 'a': this.regA = this._clamp(this.regA + 1);    this._emit(this._cpuStr()+'\r\n'); break;
      case 'A': this.regA = this._clamp(this.regA - 1);    this._emit(this._cpuStr()+'\r\n'); break;
      case 'b': this.regB = this._clamp(this.regB + 1);    this._emit(this._cpuStr()+'\r\n'); break;
      case 'B': this.regB = this._clamp(this.regB - 1);    this._emit(this._cpuStr()+'\r\n'); break;
      case 's': this.regAcc = this._clamp(this.regA + this.regB); this._emit(this._cpuStr()+'\r\n'); break;
      case 'd': this.regAcc = this._clamp(this.regA - this.regB); this._emit(this._cpuStr()+'\r\n'); break;
      case '*': this.regAcc = this._clamp(Math.sign(this.regA)*Math.sign(this.regB)*Math.min(Math.abs(this.regA),Math.abs(this.regB))); this._emit(this._cpuStr()+'\r\n'); break;
      case '&': this.regAcc = Math.min(this.regA, this.regB); this._emit(this._cpuStr()+'\r\n'); break;
      case '|': this.regAcc = Math.max(this.regA, this.regB); this._emit(this._cpuStr()+'\r\n'); break;
      case '!': this.regAcc = this._clamp(-this.regA);         this._emit(this._cpuStr()+'\r\n'); break;
      case '=': this.regA = this.regAcc;                        this._emit(this._cpuStr()+'\r\n'); break;
      case 'r': this.regA=0;this.regB=0;this.regAcc=0;this.fsm=0;this.fsmH=[0,0,0];
                this._emit(`S:P A:000 B:000 C:000\r\n`); break;
      case '?': this._emit(`S:${this._fsmChar()} ${this._cpuStr()}\r\n`); break;
      case 'T': {
        const top = this.wmem.reduce((a,b,i)=>b.w>a.e.w?{e:b,i}:a, {e:this.wmem[0],i:0});
        const sign = top.e.w >= 0 ? '+' : '-';
        const hex  = Math.abs(top.e.w).toString(16).toUpperCase();
        this._emit(`T:${hex2(top.e.from)}->${hex2(top.e.to)} ${sign}${hex}\r\n`);
        break;
      }
    }
  }

  sendW(idx, from, to, weight) {
    if (idx < 0 || idx > 15) return;
    this.wmem[idx] = { from, to, w: weight };
    this._emit('OK\r\n');
  }

  sendQ(idx) {
    const e = this.wmem[idx] || {from:0, to:0, w:0};
    const sign = e.w >= 0 ? '+' : '-';
    const hex  = Math.abs(e.w).toString(16).toUpperCase();
    this._emit(`W${hex2(idx)}:${hex2(e.from)}->${hex2(e.to)} ${sign}${hex}\r\n`);
  }

  getState() {
    const top = this.wmem.reduce((a,b,i)=>b.w>a.e.w?{e:b,i}:a, {e:this.wmem[0],i:0});
    return {
      fsm: this._fsmChar(),
      fsmBot: CHIP_TO_BOT[this._fsmChar()] || 'Z',
      fsmN: this.fsm,
      cpu: { a: this.regA, b: this.regB, acc: this.regAcc },
      topEdge: top.e,
      wmem: this.wmem,
    };
  }
}

function hex2(n) {
  return ('00' + Math.abs(n).toString(16).toUpperCase()).slice(-2);
}

// ─────────────────────────────────────────────────────────────────────────────
// UART мост (реальный чип через Python + pyserial)
// ─────────────────────────────────────────────────────────────────────────────

class FPGAReal {
  constructor(port) {
    this.port = port;
    this._buf = '';
    this._onResponse = null;
    this._waiters = [];
    this._proc = null;
    this._ready = false;
    this._queue = [];

    this._start();
  }

  onResponse(cb) { this._onResponse = cb; }

  _emit(msg) {
    if (this._waiters.length > 0) {
      const w = this._waiters.shift();
      clearTimeout(w.timer);
      w.resolve(msg.replace(/[\r\n]+$/, ''));
    }
    if (this._onResponse) this._onResponse(msg);
  }

  nextResponse(timeout = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.findIndex(w => w.resolve === resolve);
        if (idx >= 0) this._waiters.splice(idx, 1);
        reject(new Error('FPGA response timeout'));
      }, timeout);
      this._waiters.push({ resolve, reject, timer });
    });
  }

  _start() {
    const pyScript = `
import serial, sys, threading, time
ser = serial.Serial('${this.port}', 115200, timeout=0.1)
time.sleep(0.5)
sys.stdout.write('READY\\n')
sys.stdout.flush()

def reader():
    while True:
        b = ser.readline()
        if b:
            sys.stdout.buffer.write(b)
            sys.stdout.buffer.flush()

t = threading.Thread(target=reader, daemon=True)
t.start()

for line in sys.stdin:
    line = line.rstrip('\\n')
    if line.startswith('HEX:'):
        data = bytes.fromhex(line[4:])
        ser.write(data)
        ser.flush()
`;

    this._proc = spawn('python3', ['-c', pyScript], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this._proc.stdout.on('data', (chunk) => {
      this._buf += chunk.toString('latin1');
      if (!this._ready && this._buf.includes('READY\n')) {
        this._ready = true;
        this._buf = this._buf.replace('READY\n', '');
        console.log('  [fpga] UART ready →', this.port);
        for (const cmd of this._queue) this._write(cmd);
        this._queue = [];
      }
      const lines = this._buf.split('\n');
      this._buf = lines.pop();
      for (const ln of lines) {
        if (ln.trim()) this._emit(ln + '\r\n');
      }
    });

    this._proc.stderr.on('data', d => console.error('[fpga-uart]', d.toString().trim()));
    this._proc.on('exit', (code) => {
      console.warn(`[fpga] Python процесс завершился: code=${code}`);
      this._ready = false;
      // Отклонить все ожидающие промисы
      for (const w of this._waiters) {
        clearTimeout(w.timer);
        w.reject(new Error('FPGA process exited'));
      }
      this._waiters = [];
    });
  }

  _write(hexStr) {
    if (this._proc && this._proc.stdin.writable) {
      this._proc.stdin.write(`HEX:${hexStr}\n`);
    }
  }

  send(cmd) {
    const byte = typeof cmd === 'string' ? cmd.charCodeAt(0) : cmd;
    const hex  = byte.toString(16).padStart(2,'0');
    if (this._ready) this._write(hex);
    else this._queue.push(hex);
  }

  sendW(idx, from, to, weight) {
    const val = weight < 0 ? (256 + weight) & 0xFF : weight;
    const hex = [
      0x57,
      idx  & 0x0F,
      from & 0x1F,
      to   & 0x1F,
      val  & 0xFF,
    ].map(b => b.toString(16).padStart(2,'0')).join('');
    if (this._ready) this._write(hex);
    else this._queue.push(hex);
  }

  sendQ(idx) {
    const hex = [0x51, idx & 0x0F].map(b => b.toString(16).padStart(2,'0')).join('');
    if (this._ready) this._write(hex);
    else this._queue.push(hex);
  }

  getState() {
    return { fsm: '?', fsmBot: 'Z', cpu: { a: 0, b: 0, acc: 0 }, topEdge: null, wmem: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Инициализация FPGA с W-матрицей
// ─────────────────────────────────────────────────────────────────────────────

async function initFPGA(fpga, edges) {
  console.log(`\n  [fpga] Загрузка W-матрицы: ${edges.length} нитей`);

  fpga.send('r');
  await sleep(100);

  for (const e of edges) {
    fpga.sendW(e.idx, e.from, e.to, e.weight);
    await sleep(demo ? 5 : 50);
    console.log(`    W[${e.idx.toString().padStart(2)}] ${e.fromName.padEnd(14)} → ${e.toName.padEnd(14)} w=${e.weight} (raw=${e.rawWeight.toFixed(1)})`);
  }

  await sleep(100);
  fpga.send('?');
  console.log('  [fpga] Инициализация завершена\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Локальное состояние FSM (трекинг для анамнезиса и W-матрицы)
// ─────────────────────────────────────────────────────────────────────────────

let localFsmChip = 'P';    // текущее состояние чипа: K/P/L
let localFsmHist = [];     // история переходов

function updateLocalFsm(chipState) {
  if (chipState && 'KPL'.includes(chipState)) {
    localFsmHist = [localFsmChip, ...localFsmHist.slice(0, 4)];
    localFsmChip = chipState;
  }
}

/** Записать FSM-переход в W-матрицу через claude-gift.mjs */
function recordFsmInWMatrix(trit) {
  const label = trit === '+' ? 'дар (PLR)' : trit === '-' ? 'кенозис (KEN)' : 'присутствие (PRS)';
  const proc = spawn('node', [join(__dir, 'claude-gift.mjs'), `FSM-переход: ${label}`, 'Дионисий'], {
    stdio: 'ignore',
    detached: true,
  });
  proc.unref();
}

// ─────────────────────────────────────────────────────────────────────────────
// Обработчики команд от анамнезиса
// ─────────────────────────────────────────────────────────────────────────────

/**
 * fsm-command: content = '+' | '-' | '0'
 * Посылает трит на чип, ждёт ответ F:X i:Y, публикует fsm-state в анамнезис.
 */
async function handleFsmCommand(fpga, act) {
  const trit = (act.content || '').trim()[0];
  if (!['+', '-', '0'].includes(trit)) {
    console.warn(`  [fsm] неверный трит: "${act.content}"`);
    return;
  }

  const fromBot = CHIP_TO_BOT[localFsmChip] || 'Z';
  console.log(`  [fsm] трит="${trit}" от ${fromBot}, act.id=${act.id}`);

  fpga.send(trit);

  try {
    // Ждём F:X i:Y от чипа (или S:X ... после r)
    const resp = await fpga.nextResponse(demo ? 500 : 4000);
    // resp: "F:L i:+" или "S:P ..."
    const m = resp.match(/F:([KPL]) i:([+\-0])/);
    if (m) {
      updateLocalFsm(m[1]);
      const toBot = CHIP_TO_BOT[m[1]] || 'Z';
      const content = `${fromBot}→${toBot} cmd=${act.id}`;
      console.log(`  [fsm→anamnesis] ${content}`);
      await publishToAnamnesis(content, 'fsm-state');
      // Запись в W-матрицу
      recordFsmInWMatrix(trit);
    } else {
      console.warn(`  [fsm] неожиданный ответ: "${resp}"`);
    }
  } catch (e) {
    console.warn(`  [fsm] timeout: ${e.message}`);
  }
}

/**
 * fpga-command: content = '5 + 3' | '! 7' | '-4 * 3'
 * Загружает регистры CPU через UART, вычисляет, публикует fpga-result.
 */
async function handleFpgaArithmetic(fpga, act) {
  const expr = (act.content || '').trim();
  let a, b, op;

  const unaryM  = expr.match(/^!\s*(-?\d+)$/);
  const binaryM = expr.match(/^(-?\d+)\s*([+\-*&|])\s*(-?\d+)$/);

  if (unaryM) {
    a = Math.max(-13, Math.min(13, parseInt(unaryM[1])));
    op = '!'; b = null;
  } else if (binaryM) {
    a = Math.max(-13, Math.min(13, parseInt(binaryM[1])));
    op = binaryM[2];
    b = Math.max(-13, Math.min(13, parseInt(binaryM[3])));
  } else {
    console.warn(`  [fpga] не распознано выражение: "${expr}"`);
    return;
  }

  console.log(`  [fpga] вычисление: a=${a} op=${op} b=${b ?? 'n/a'}, act.id=${act.id}`);

  const delay = demo ? 10 : 40;

  // Сброс CPU
  fpga.send('r');
  await sleep(demo ? 30 : 150);

  // Загрузить регистр A
  const cmdA = a >= 0 ? 'a' : 'A';
  for (let i = 0; i < Math.abs(a); i++) { fpga.send(cmdA); await sleep(delay); }

  // Загрузить регистр B
  if (b !== null) {
    const cmdB = b >= 0 ? 'b' : 'B';
    for (let i = 0; i < Math.abs(b); i++) { fpga.send(cmdB); await sleep(delay); }
  }

  // Операция
  const opCmd = {'+':'s', '-':'d', '*':'*', '&':'&', '|':'|', '!':'!'}[op];
  fpga.send(opCmd);

  // Ждём пока все промежуточные ответы (от a/b инкрементов) пройдут
  const totalCmds = 1 + Math.abs(a) + (b !== null ? Math.abs(b) : 0) + 1;
  await sleep(delay * totalCmds + (demo ? 50 : 200));

  // Запросить итоговый статус
  fpga.send('?');
  try {
    const resp = await fpga.nextResponse(demo ? 500 : 5000);
    // resp: "S:P A:+-- B:+00 C:+--"
    const cm = resp.match(/C:([+\-0]{3})/);
    if (cm) {
      const result = decodeTrit3(cm[1]);
      const content = `${result} cmd=${act.id}`;
      console.log(`  [fpga→anamnesis] result=${result} (${cm[1]}), content="${content}"`);
      await publishToAnamnesis(content, 'fpga-result');
    } else {
      console.warn(`  [fpga] не распознан ответ: "${resp}"`);
    }
  } catch (e) {
    console.warn(`  [fpga] arithmetic timeout: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Анамнезис: поллинг actов
// ─────────────────────────────────────────────────────────────────────────────

let lastTapeId   = 0;
let lastSnapMtime = 0;
let processingAct = false;  // мьютекс: один акт за раз

async function pollAnamnesis(fpga) {
  if (processingAct) return;
  try {
    const r = await fetch(`${ANAMNESIS}/tape`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return;
    const tape = await r.json();
    const acts = Array.isArray(tape) ? tape : (tape.acts || []);

    for (const act of acts) {
      const id = act.id || 0;
      if (id <= lastTapeId) continue;
      lastTapeId = Math.max(lastTapeId, id);

      if (act.type === 'fsm-command') {
        processingAct = true;
        try { await handleFsmCommand(fpga, act); } finally { processingAct = false; }

      } else if (act.type === 'fpga-command') {
        processingAct = true;
        try { await handleFpgaArithmetic(fpga, act); } finally { processingAct = false; }

      } else if (['fpga-result', 'fsm-state', 'fsm-transition', 'fpga-status',
                  'fpga-wmem-reload', 'fpga-init'].includes(act.type)) {
        // Наши собственные публикации — не обрабатываем повторно
      } else if (act.type) {
        // Произвольная команда (например, из портала)
        const cmd = act.content || '';
        if (cmd && ['+', '-', '0', '?', 'T', 'r'].includes(cmd)) {
          console.log(`  [anamnesis→chip] "${cmd}"`);
          fpga.send(cmd);
        }
      }
    }
  } catch { /* сеть недоступна */ }
}

// ── Публикация в анамнезис ────────────────────────────────────────────────────
async function publishToAnamnesis(content, type = 'fpga-status') {
  try {
    await fetch(`${ANAMNESIS}/gift`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({ type, content, weight: 1 }),
    });
  } catch { /* сеть недоступна */ }
}

// ── Детектор изменений W-матрицы → reload WMem ───────────────────────────────
const SNAP_PATHS = [
  join(ROOT, 'data', 'snapshots', 'W-2026-W13.json'),
  join(ROOT, 'data', 'W-prev.json'),
  join(ROOT, 'data', 'sacred-history-W.json'),
];

function watchWMatrix(fpga) {
  const snapPath = SNAP_PATHS.find(p => existsSync(p));
  if (!snapPath) return;

  lastSnapMtime = statSync(snapPath).mtimeMs;

  watchFile(snapPath, { interval: 10000 }, (curr) => {
    if (curr.mtimeMs <= lastSnapMtime) return;
    lastSnapMtime = curr.mtimeMs;
    console.log('  [W-матрица] изменение → перезагрузка WMem...');
    try {
      const edges = loadTopEdges(16);
      for (const e of edges) fpga.sendW(e.idx, e.from, e.to, e.weight);
      console.log(`  [W-матрица] WMem обновлён: ${edges.length} нитей`);
      publishToAnamnesis(`WMem reload: ${edges[0]?.fromName}→${edges[0]?.toName}`, 'fpga-wmem-reload');
    } catch (e) {
      console.error('  [W-матрица] ошибка reload:', e.message);
    }
  });
  console.log(`  W-матрица: слежу за ${snapPath.split('/').pop()}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket сервер (для портала)
// ─────────────────────────────────────────────────────────────────────────────

const wsClients = new Set();

function startWebSocketServer(fpga) {
  const server = createServer((req, res) => {
    res.writeHead(200, {'Content-Type':'text/plain'});
    res.end('fpga-gift-bridge WebSocket :3701');
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    wsClients.add(socket);
    socket.on('close', () => wsClients.delete(socket));
    socket.on('error', () => wsClients.delete(socket));

    socket.on('data', (buf) => {
      try {
        const masked = (buf[1] & 0x80) !== 0;
        const len    = buf[1] & 0x7F;
        const maskOff = 2;
        const dataOff = masked ? maskOff + 4 : maskOff;
        const mask   = masked ? buf.slice(maskOff, maskOff+4) : null;
        let text = '';
        for (let i = 0; i < len; i++) {
          text += String.fromCharCode(buf[dataOff+i] ^ (mask ? mask[i%4] : 0));
        }
        const msg = JSON.parse(text);
        if (msg.cmd) fpga.send(msg.cmd);
        if (msg.cmdW) fpga.sendW(msg.cmdW.idx, msg.cmdW.from, msg.cmdW.to, msg.cmdW.w);
      } catch {}
    });
  });

  server.listen(PORT_WS, '0.0.0.0', () => {
    console.log(`  WebSocket :${PORT_WS} (для портала)`);
  });

  return server;
}

function wsBroadcast(obj) {
  const json = JSON.stringify(obj);
  const payload = Buffer.from(json);
  const frame = Buffer.alloc(2 + payload.length);
  frame[0] = 0x81;
  frame[1] = payload.length;
  payload.copy(frame, 2);
  for (const sock of wsClients) {
    try { sock.write(frame); } catch { wsClients.delete(sock); }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Утилиты
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n✦ fpga-gift-bridge — Мост Памяти, Ума и Чипа');
  console.log(`  Режим: ${demo ? 'ДЕМО (без чипа)' : `UART ${uartPort}`}`);
  console.log(`  Анамнезис: ${ANAMNESIS}`);

  let edges;
  try {
    edges = loadTopEdges(16);
    console.log(`  W-матрица: ${edges.length} топ-нитей загружены`);
    console.log(`  Лучшая нить: ${edges[0].fromName} → ${edges[0].toName} (w=${edges[0].rawWeight.toFixed(1)})`);
  } catch (e) {
    console.error('  Ошибка загрузки W-матрицы:', e.message);
    edges = [];
  }

  const fpga = demo ? new FPGADemo() : new FPGAReal(uartPort);

  // Парсинг ответов чипа для обновления localFsmChip
  fpga.onResponse((resp) => {
    const text = resp.replace(/[\r\n]+$/, '');
    console.log(`  [fpga←] ${text}`);

    // Трекинг FSM состояния
    const fsmM = text.match(/[FS]:([KPL])/);
    if (fsmM) updateLocalFsm(fsmM[1]);

    // WebSocket broadcast
    if (wsClients.size > 0) {
      const state = fpga.getState();
      wsBroadcast({
        type: 'fpga', raw: text,
        fsm: CHIP_TO_BOT[state.fsm] || state.fsm,
        cpu: state.cpu, ts: Date.now(),
      });
    }
  });

  if (useWS) {
    try {
      startWebSocketServer(fpga);
    } catch (e) {
      console.warn('  WebSocket недоступен:', e.message);
    }
  }

  if (edges.length > 0) {
    await initFPGA(fpga, edges);
    await publishToAnamnesis(`init: ${edges.length} нитей, топ ${edges[0].fromName}→${edges[0].toName}`, 'fpga-init');
  }

  watchWMatrix(fpga);

  // Инициализировать lastTapeId из текущей ленты (не обрабатывать старые акты)
  try {
    const r = await fetch(`${ANAMNESIS}/tape`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const tape = await r.json();
      const acts = Array.isArray(tape) ? tape : (tape.acts || []);
      if (acts.length > 0) {
        lastTapeId = Math.max(...acts.map(a => a.id || 0));
        console.log(`  Анамнезис: инициализация с id=${lastTapeId} (${acts.length} актов в ленте)`);
      }
    }
  } catch { /* сеть */ }

  let tick = 0;
  setInterval(async () => {
    tick++;
    if (tick % 5 === 0) await pollAnamnesis(fpga);
    if (tick % 30 === 0) fpga.send('?');
    if (tick % 10 === 0 && wsClients.size > 0) {
      const state = fpga.getState();
      wsBroadcast({ type: 'heartbeat', fsm: CHIP_TO_BOT[state.fsm] || state.fsm, ts: Date.now() });
    }
  }, 1000);

  console.log('  Поллинг анамнезиса каждые 5с (fsm-command, fpga-command)');
  console.log('  Статус FPGA каждые 30с');
  if (useWS) console.log(`  WebSocket :${PORT_WS} готов\n`);
  else console.log('  (--ws для WebSocket сервера)\n');

  // Интерактивный режим (stdin)
  if (process.stdin.isTTY) {
    console.log('  Интерактивный режим: вводите UART команды (+, -, 0, ?, T, r...)');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (key) => {
      const k = key.toString();
      if (k === '\u0003') process.exit();
      if (k.length === 1) {
        console.log(`  [→fpga] ${k}`);
        fpga.send(k);
      }
    });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
