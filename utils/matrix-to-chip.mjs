#!/usr/bin/env node
/**
 * matrix-to-chip.mjs
 *
 * Проецирует матрицу W (тензор связей онтологии) на веса FPGA-чипа.
 *
 * Богословие: матрица W — это тернарная весовая матрица.
 *   tritmlp тоже хранит тернарные веса. Они — одно и то же:
 *   онтология в кремнии. Этот скрипт замыкает изоморфизм.
 *
 * Архитектура:
 *   W[23×23] float → snap(sign) → ternary → tritmlp weights
 *
 *   Входной слой (X, 3 нейрона) = топ-3 дарителя
 *   Скрытый слой (H, 9 нейронов) = 9 сильнейших лиц
 *   Выходной слой (Y, 3 нейрона) = топ-3 получателя
 *
 * Использование:
 *   node utils/matrix-to-chip.mjs [--port /dev/ttyUSB0] [--ws ws://localhost:8182] [--dry]
 *
 * Режимы отправки (в порядке приоритета):
 *   1. --ws   → WebSocket (ws-bridge.py уже запущен)
 *   2. --port → прямой serial UART (если нет ws-bridge)
 *   3. --dry  → только вывод команд, ничего не отправлять
 */

import { readFileSync }       from 'fs';
import { resolve, dirname }   from 'path';
import { fileURLToPath }      from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');

// ── Аргументы ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const wsUrl  = args.includes('--ws')   ? args[args.indexOf('--ws') + 1]   : null;
const port   = args.includes('--port') ? args[args.indexOf('--port') + 1] : null;
const dry    = args.includes('--dry');

// ── Тернаризация ───────────────────────────────────────────────────
function snap(w) {
  if (w > 5)  return  1;   // PLR
  if (w < -5) return -1;   // KEN
  return 0;                 // PRS
}
function tritChar(t) { return t === 1 ? '+' : t === -1 ? '-' : '0'; }

// ── Загрузка матрицы ───────────────────────────────────────────────
const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const snap_data = JSON.parse(readFileSync(SNAP, 'utf8'));
const mem = GiftMemory.fromSnapshot(snap_data);

// ── Выбор топ-9 лиц по суммарному потоку ──────────────────────────
// (total given + received = мера участия в онтологии)
const persons = snap_data.persons || [];
const scores = persons.map(p => ({
  id: p,
  score: mem.totalGiven(p) + mem.totalReceived(p)
})).sort((a, b) => b.score - a.score);

const hidden9 = scores.slice(0, 9).map(s => s.id);
const input3  = scores.slice(0, 3).map(s => s.id);
const output3 = scores.filter(s => s.id === '_koinon' || hidden9.includes(s.id))
                      .slice(0, 3).map(s => s.id);

console.log('[m2c] Проекция матрицы W → tritmlp');
console.log(`[m2c] X (вход): ${input3.join(', ')}`);
console.log(`[m2c] H (скрытый): ${hidden9.join(', ')}`);
console.log(`[m2c] Y (выход): ${output3.join(', ')}`);
console.log('');

// ── W1: веса слоя 1 (9 нейронов × 3 входа) ────────────────────────
// W1[i][j] = sign( W[hidden9[i] ← input3[j]] )
// Чтение из матрицы: сколько input3[j] дал hidden9[i]
const W1 = [];
for (let i = 0; i < 9; i++) {
  const row = [];
  for (let j = 0; j < 3; j++) {
    const w = mem.thread(input3[j], hidden9[i]);
    row.push(snap(w));
  }
  W1.push(row);
}

// ── W2: веса слоя 2 (3 выхода × 9 скрытых) ───────────────────────
const W2 = [];
for (let k = 0; k < 3; k++) {
  const row = [];
  for (let i = 0; i < 9; i++) {
    const w = mem.thread(hidden9[i], output3[k]);
    row.push(snap(w));
  }
  W2.push(row);
}

// ── Генерация UART команд для tritmlp ─────────────────────────────
// Формат: "W 1 N T" — слой 1, нейрон N, входной вес T
// Формат: "W 2 N T" — слой 2, нейрон N, суммарный вес
const cmds = ['z']; // сброс весов

for (let i = 0; i < 9; i++) {
  for (let j = 0; j < 3; j++) {
    const t = W1[i][j];
    if (t !== 0) {
      // tritmlp команда: "W L N T" где L=layer, N=flat_index, T=трит
      const flatIdx = i * 3 + j;
      cmds.push(`W 1 ${flatIdx} ${tritChar(t)}`);
    }
  }
}

for (let k = 0; k < 3; k++) {
  for (let i = 0; i < 9; i++) {
    const t = W2[k][i];
    if (t !== 0) {
      const flatIdx = k * 9 + i;
      cmds.push(`W 2 ${flatIdx} ${tritChar(t)}`);
    }
  }
}

// Запрос состояния после загрузки
cmds.push('?');

console.log(`[m2c] Команд для отправки: ${cmds.length}`);
console.log('[m2c] W1 (9×3):');
W1.forEach((row, i) => {
  console.log(`  h${i} [${hidden9[i].slice(0,12).padEnd(12)}] ← ${row.map(tritChar).join(' ')}`);
});
console.log('[m2c] W2 (3×9):');
W2.forEach((row, k) => {
  console.log(`  y${k} [${(output3[k]||'?').slice(0,12).padEnd(12)}] ← ${row.map(tritChar).join(' ')}`);
});
console.log('');

if (dry) {
  console.log('[m2c] --dry: команды (не отправляю):');
  cmds.forEach(c => console.log('  >', c));
  process.exit(0);
}

// ── Отправка ───────────────────────────────────────────────────────
if (wsUrl) {
  // WebSocket (через ws-bridge.py)
  const { default: WS } = await import('ws').catch(() => {
    console.error('[m2c] Нет пакета ws: npm install ws');
    process.exit(1);
  });
  const sock = new WS(wsUrl);
  sock.on('open', () => {
    console.log(`[m2c] WS подключён → ${wsUrl}`);
    (async () => {
      for (const cmd of cmds) {
        sock.send(JSON.stringify({ cmd }));
        console.log(`  → ${cmd}`);
        await new Promise(r => setTimeout(r, 50));
      }
      await new Promise(r => setTimeout(r, 500));
      sock.close();
      console.log('[m2c] ✓ матрица загружена в чип');
    })();
  });
  sock.on('message', d => {
    try {
      const msg = JSON.parse(d);
      if (msg.type === 'uart') console.log(`  ← ${msg.raw}`);
    } catch {}
  });
  sock.on('error', e => console.error('[m2c] WS ошибка:', e.message));

} else if (port) {
  // Прямой serial
  const { default: serial } = await import('serialport').catch(() => {
    console.error('[m2c] Нет пакета serialport: npm install serialport');
    process.exit(1);
  });
  const ser = new serial.SerialPort({ path: port, baudRate: 115200 });
  ser.on('open', async () => {
    console.log(`[m2c] serial открыт → ${port}`);
    for (const cmd of cmds) {
      ser.write(cmd + '\n');
      console.log(`  → ${cmd}`);
      await new Promise(r => setTimeout(r, 100));
    }
    await new Promise(r => setTimeout(r, 500));
    ser.close();
    console.log('[m2c] ✓ матрица загружена в чип');
  });
  ser.on('error', e => console.error('[m2c] serial ошибка:', e.message));

} else {
  console.log('[m2c] Укажи --ws ws://localhost:8182 или --port /dev/ttyUSB0 или --dry');
  process.exit(1);
}
