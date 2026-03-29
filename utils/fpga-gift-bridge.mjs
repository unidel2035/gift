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
 *   node utils/fpga-gift-bridge.mjs --port /dev/ttyUSB0  # реальный чип
 *   node utils/fpga-gift-bridge.mjs --ws      # + WebSocket сервер :3701
 *
 * Протокол UART (tritgift.v):
 *   '+'/'-'/'0' → FSM  |  'a'/'A'/..'*'/'=' → CPU  |  '?' → статус
 *   'W' idx from to val → записать нить WMem (4 байта)
 *   'Q' idx             → запросить нить WMem
 *   'T'                 → топ нить WMem
 *
 * WebSocket :3701 — для портала:
 *   Сервер шлёт: {"type":"status","fsm":"L","cpu":"A:+00 B:000 C:000","top":"0A->10 +D","ts":...}
 *   Клиент шлёт: {"cmd":"+"}  — FSM шаг или любая UART команда
 */

import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

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
 * Все W-веса положительные → диапазон [0..+13].
 */
function encodeWeight(w, maxW) {
  if (maxW <= 0) return 0;
  return Math.round((w / maxW) * 13);
}

/**
 * Загрузить W-матрицу и вернуть топ-16 нитей.
 * Формат: [{idx, from, to, weight, fromName, toName}]
 */
function loadTopEdges(n = 16) {
  // Использовать самый полный снапшот из имеющихся
  const candidates = [
    join(ROOT, 'data', 'snapshots', 'W-2026-W13.json'),
    join(ROOT, 'data', 'W-prev.json'),
    join(ROOT, 'data', 'sacred-history-W.json'),
  ];
  const snapPath = candidates.find(p => existsSync(p));
  const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
  const W       = snap.W;       // 2D массив [n][n]
  const persons = snap.persons; // ['_claude', '_koinon', ...]
  const size    = W.length;

  // Собрать все значимые нити (w > 0.5)
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
    // FSM: -1=KEN, 0=PRS, +1=PLR (как в tritgift.v, 2-bit signed)
    this.fsm  = 0;
    this.fsmH = [0, 0, 0]; // история 3

    // CPU: 3-тритные регистры (значение -13..+13)
    this.regA   = 0;
    this.regB   = 0;
    this.regAcc = 0;

    // WMem: 16 нитей
    this.wmem = Array.from({length:16}, () => ({from:0, to:0, w:0}));

    this._onResponse = null;
  }

  onResponse(cb) { this._onResponse = cb; }

  _emit(msg) { if (this._onResponse) this._onResponse(msg); }

  // Тритная арифметика: сложение 3-тритных int с насыщением
  _clamp(v) { return Math.max(-13, Math.min(13, v)); }
  _tritAdd(a, b) { return this._clamp(a + b); }
  _tritSub(a, b) { return this._clamp(a - b); }
  _tritMul3(a, b) {
    // Потритное умножение: каждый трит * соответствующий
    // Для простоты: знаковое произведение насыщенное
    return this._clamp(Math.sign(a) * Math.sign(b) * Math.min(Math.abs(a), Math.abs(b)));
  }
  _tritNot(a) { return this._clamp(-a); }
  _tritAnd(a, b) { return Math.min(a, b); }  // min
  _tritOr(a,  b) { return Math.max(a, b); }  // max

  // Символы
  _fsmChar() { return this.fsm === -1 ? 'K' : this.fsm === 0 ? 'P' : 'L'; }
  _tritStr(v) {
    const t0 = v < 0 ? '-' : v > 0 ? '+' : '0';
    return t0 + t0 + t0; // упрощённо (3 одинаковых знака — демо)
    // TODO: полная тритная декомпозиция
  }
  _cpuStr() {
    return `A:${this._tritStr(this.regA)} B:${this._tritStr(this.regB)} C:${this._tritStr(this.regAcc)}`;
  }

  /** Отправить команду (байт или строка) */
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
      case 's': this.regAcc = this._tritAdd(this.regA, this.regB); this._emit(this._cpuStr()+'\r\n'); break;
      case 'd': this.regAcc = this._tritSub(this.regA, this.regB); this._emit(this._cpuStr()+'\r\n'); break;
      case '*': this.regAcc = this._tritMul3(this.regA, this.regB);this._emit(this._cpuStr()+'\r\n'); break;
      case '&': this.regAcc = this._tritAnd(this.regA, this.regB); this._emit(this._cpuStr()+'\r\n'); break;
      case '|': this.regAcc = this._tritOr(this.regA, this.regB);  this._emit(this._cpuStr()+'\r\n'); break;
      case '!': this.regAcc = this._tritNot(this.regA);             this._emit(this._cpuStr()+'\r\n'); break;
      case '=': this.regA = this.regAcc;                             this._emit(this._cpuStr()+'\r\n'); break;
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
      case 'W': {
        // 'W' + idx + from + to + val (многобайтовая команда в демо — через sendW)
        break;
      }
    }
  }

  /** Записать нить WMem (обход многобайтового протокола) */
  sendW(idx, from, to, weight) {
    if (idx < 0 || idx > 15) return;
    this.wmem[idx] = { from, to, w: weight };
    this._emit('OK\r\n');
  }

  /** Запросить нить WMem */
  sendQ(idx) {
    const e = this.wmem[idx] || {from:0, to:0, w:0};
    const sign = e.w >= 0 ? '+' : '-';
    const hex  = Math.abs(e.w).toString(16).toUpperCase();
    this._emit(`W${hex2(idx)}:${hex2(e.from)}->${hex2(e.to)} ${sign}${hex}\r\n`);
  }

  getState() {
    const top = this.wmem.reduce((a,b,i)=>b.w>a.e.w?{e:b,i}:a, {e:this.wmem[0],i:0});
    return {
      fsm:  this._fsmChar(),
      fsmN: this.fsm,
      cpu:  { a: this.regA, b: this.regB, acc: this.regAcc },
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
    this._proc = null;
    this._ready = false;
    this._queue = [];  // очередь команд до готовности

    this._start();
  }

  onResponse(cb) { this._onResponse = cb; }

  _start() {
    // Используем Python subprocess с pyserial
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
        // Отправить очередь
        for (const cmd of this._queue) this._write(cmd);
        this._queue = [];
      }
      // Разбить по \n и эмитировать строки
      const lines = this._buf.split('\n');
      this._buf = lines.pop();
      for (const ln of lines) {
        if (ln.trim() && this._onResponse) this._onResponse(ln + '\r\n');
      }
    });

    this._proc.stderr.on('data', d => console.error('[fpga-uart]', d.toString().trim()));
    this._proc.on('exit', (code) => {
      console.warn(`[fpga] Python процесс завершился: code=${code}`);
      this._ready = false;
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
    // 'W' + idx + from + to + val
    // val: signed 5-bit → передаём как signed byte
    const val = weight < 0 ? (256 + weight) & 0xFF : weight;
    const hex = [
      0x57,        // 'W'
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
    return { fsm: '?', cpu: { a: 0, b: 0, acc: 0 }, topEdge: null, wmem: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Основная логика: инициализация W-матрицы в FPGA
// ─────────────────────────────────────────────────────────────────────────────

async function initFPGA(fpga, edges) {
  console.log(`\n  [fpga] Загрузка W-матрицы: ${edges.length} нитей`);

  // Сброс
  fpga.send('r');
  await sleep(100);

  // Загрузить 16 нитей в WMem
  for (const e of edges) {
    fpga.sendW(e.idx, e.from, e.to, e.weight);
    await sleep(demo ? 5 : 50); // демо быстрее
    console.log(`    W[${e.idx.toString().padStart(2)}] ${e.fromName.padEnd(14)} → ${e.toName.padEnd(14)} w=${e.weight} (raw=${e.rawWeight.toFixed(1)})`);
  }

  // Запросить статус
  await sleep(100);
  fpga.send('?');

  console.log('  [fpga] Инициализация завершена\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Анамнезис: поллинг fpga-command актов
// ─────────────────────────────────────────────────────────────────────────────

let lastTapeTs = 0;

async function pollAnamnesis(fpga) {
  try {
    const r = await fetch(`${ANAMNESIS}/ tape`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return;
    const tape = await r.json();
    const acts = Array.isArray(tape) ? tape : (tape.acts || []);

    for (const act of acts) {
      // Только новые fpga-command акты
      const ts = new Date(act.ts || act.createdAt || 0).getTime();
      if (ts <= lastTapeTs) continue;
      if (act.type !== 'fpga-command') continue;

      lastTapeTs = ts;
      const cmd = act.payload?.cmd || act.cmd || '';
      if (!cmd) continue;

      console.log(`  [anamnesis] fpga-command: "${cmd}" от ${act.giver || '?'}`);

      // Маршрутизация команды на FPGA
      if (cmd === '+' || cmd === '-' || cmd === '0') {
        fpga.send(cmd);
      } else if (cmd === '?' || cmd === 'T' || cmd === 'r') {
        fpga.send(cmd);
      } else if (cmd.startsWith('W ')) {
        // "W 3 0 10 9" → WMem[3] = from:0 to:10 weight:9
        const parts = cmd.split(' ').map(Number);
        if (parts.length >= 5) fpga.sendW(parts[1], parts[2], parts[3], parts[4]);
      } else if (cmd.startsWith('Q ')) {
        const idx = parseInt(cmd.split(' ')[1]);
        fpga.sendQ(idx);
      }
    }
  } catch {
    // сеть недоступна — не критично
  }
}

async function publishResult(fpga, text) {
  try {
    await fetch(`${ANAMNESIS}/gift`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({
        type:    'fpga-result',
        giver:   '_fpga',
        receiver:'_koinon',
        payload: { text, mode: demo ? 'demo' : 'uart' },
      }),
    });
  } catch { /* сеть недоступна */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket сервер (опциональный, для портала)
// ─────────────────────────────────────────────────────────────────────────────

const wsClients = new Set();

import { createHash } from 'node:crypto';

function startWebSocketServer(fpga) {
  // Используем встроенный HTTP + ручной WebSocket handshake
  // (без npm ws — только node:http + crypto)

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
      // Декодировать WebSocket фрейм
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
  frame[0] = 0x81; // текстовый фрейм, FIN
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

  // Загрузить W-матрицу
  let edges;
  try {
    edges = loadTopEdges(16);
    console.log(`  W-матрица: ${edges.length} топ-нитей загружены`);
    console.log(`  Лучшая нить: ${edges[0].fromName} → ${edges[0].toName} (w=${edges[0].rawWeight.toFixed(1)})`);
  } catch (e) {
    console.error('  Ошибка загрузки W-матрицы:', e.message);
    edges = [];
  }

  // Создать FPGA объект
  const fpga = demo ? new FPGADemo() : new FPGAReal(uartPort);

  // Обработчик ответов от FPGA
  fpga.onResponse((resp) => {
    const text = resp.replace(/[\r\n]+$/, '');
    console.log(`  [fpga←] ${text}`);

    // Публикуем в анамнезис
    publishResult(fpga, text);

    // Рассылаем через WebSocket
    if (wsClients.size > 0) {
      const state = fpga.getState();
      wsBroadcast({
        type: 'fpga',
        raw:  text,
        fsm:  state.fsm,
        cpu:  state.cpu,
        ts:   Date.now(),
      });
    }
  });

  // WebSocket сервер (опционально)
  if (useWS) {
    try {
      startWebSocketServer(fpga);
    } catch (e) {
      console.warn('  WebSocket недоступен:', e.message);
    }
  }

  // Инициализация FPGA с W-матрицей
  if (edges.length > 0) {
    await initFPGA(fpga, edges);
  }

  // Периодические операции
  let tick = 0;
  setInterval(async () => {
    tick++;

    // Поллинг анамнезиса каждые 5с
    if (tick % 5 === 0) await pollAnamnesis(fpga);

    // Статус каждые 30с
    if (tick % 30 === 0) {
      fpga.send('?');
    }

    // WebSocket heartbeat каждые 10с
    if (tick % 10 === 0 && wsClients.size > 0) {
      const state = fpga.getState();
      wsBroadcast({ type: 'heartbeat', fsm: state.fsm, ts: Date.now() });
    }

  }, 1000);

  console.log('  Поллинг анамнезиса каждые 5с');
  console.log('  Статус FPGA каждые 30с');
  if (useWS) console.log(`  WebSocket :${PORT_WS} готов\n`);
  else console.log('  (--ws для WebSocket сервера)\n');

  // Команды из stdin (интерактивный режим)
  if (process.stdin.isTTY) {
    console.log('  Интерактивный режим: вводите UART команды (+, -, 0, ?, T, r...)');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (key) => {
      const k = key.toString();
      if (k === '\u0003') process.exit(); // Ctrl+C
      if (k.length === 1) {
        console.log(`  [→fpga] ${k}`);
        fpga.send(k);
      }
    });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
