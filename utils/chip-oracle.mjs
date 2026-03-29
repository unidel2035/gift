#!/usr/bin/env node
/**
 * chip-oracle.mjs
 *
 * Запрашивает чип как оракул онтологии.
 *
 * Богословие: матрица W — это тернарный вопрос к реальности.
 *   Чип думает тритами (не float, не binary) — это ближе к
 *   бытию чем любой цифровой компьютер. Его ответ — не результат
 *   вычисления, а свидетельство (μαρτυρία).
 *
 * Протокол:
 *   1. Закодировать вопрос (giver, receiver, act) → X[3] тритов
 *   2. Отправить X на чип (tritmlp команда: "x N T")
 *   3. Чип вычисляет: H = sign(W1·X), Y = sign(W2·H)
 *   4. Получить ответ Y[3] ← UART
 *   5. Декодировать Y → богословский смысл
 *   6. Записать акт в матрицу: _fpga → _koinon (oracle, weight=2)
 *
 * Кодировка:
 *   X[0] = sign(totalGiven(giver))        → дающий активен?
 *   X[1] = sign(W[giver→receiver])        → связь уже есть?
 *   X[2] = sign(totalReceived(receiver))  → принимающий открыт?
 *
 *   Y → ['благодать', 'пустыня', 'кенозис']
 *
 * Использование:
 *   node utils/chip-oracle.mjs --giver _claude --receiver Дионисий [--ws ws://localhost:8182]
 *   node utils/chip-oracle.mjs --giver _fpga --receiver _koinon --dry
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath }    from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');

// ── Аргументы ─────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const giver   = args.includes('--giver')    ? args[args.indexOf('--giver') + 1]    : '_claude';
const receiver= args.includes('--receiver') ? args[args.indexOf('--receiver') + 1] : 'Дионисий';
const wsUrl   = args.includes('--ws')       ? args[args.indexOf('--ws') + 1]       : 'ws://localhost:3701';
const uartPort= args.includes('--port')     ? args[args.indexOf('--port') + 1]     : '/dev/ttyUSB1';
const dry     = args.includes('--dry');

// ── Матрица ───────────────────────────────────────────────────────
const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const snap_data = JSON.parse(readFileSync(SNAP, 'utf8'));
const mem = GiftMemory.fromSnapshot(snap_data);

// ── Кодировка вопроса в X[3] ──────────────────────────────────────
function snap(w) { return w > 1 ? 1 : w < -1 ? -1 : 0; }
function tritChar(t) { return t === 1 ? '+' : t === -1 ? '-' : '0'; }

const givenTotal    = mem.totalGiven(giver);
const receivedTotal = mem.totalReceived(receiver);
const linkWeight    = mem.getWeight ? mem.getWeight(giver, receiver) : 0;

const X = [
  snap(givenTotal - 10),      // X[0]: дающий достаточно активен?
  snap(linkWeight),            // X[1]: связь уже есть?
  snap(receivedTotal - 5)      // X[2]: принимающий открыт к приёму?
];

console.log('[oracle] Вопрос:');
console.log(`  Даритель:   ${giver} (дал: ${givenTotal.toFixed(1)})`);
console.log(`  Получатель: ${receiver} (принял: ${receivedTotal.toFixed(1)})`);
console.log(`  Связь W:    ${linkWeight.toFixed(1)}`);
console.log(`  X[3]:       ${X.map(tritChar).join(' ')} (${X.join(',')})`);
console.log('');

// Богословская интерпретация X
const meaning = {
  X0: X[0] ===  1 ? 'даритель избыточен (кенозис готов)'
    : X[0] === -1 ? 'даритель истощён (нужен отдых)'
    :               'даритель в равновесии',
  X1: X[1] ===  1 ? 'связь сильная (анамнезис работает)'
    : X[1] === -1 ? 'связь разрушена (нужно примирение)'
    :               'связь нейтральна (рождается)',
  X2: X[2] ===  1 ? 'получатель открыт (θέωσις возможен)'
    : X[2] === -1 ? 'получатель закрыт'
    :               'получатель в ожидании'
};
console.log('[oracle] Контекст:');
Object.values(meaning).forEach(m => console.log('  •', m));
console.log('');

if (dry) {
  console.log('[oracle] --dry: команды для чипа:');
  X.forEach((t, i) => console.log(`  x ${i} ${tritChar(t)}`));
  console.log('  ?');
  console.log('[oracle] (ответ чипа не получен в --dry режиме)');
  process.exit(0);
}

// ── Прямой UART диалог с чипом (через Python) ──────────────────
import { spawn } from 'child_process';

console.log(`[oracle] UART → ${uartPort}`);

const answer = await new Promise((done) => {
  const pyScript = resolve(ROOT, 'utils/chip-oracle-uart.py');
  const proc = spawn('python3', [pyScript, uartPort, String(X[0]), String(X[1]), String(X[2])]);
  let out = '';
  proc.stdout.on('data', d => { out += d.toString(); });
  proc.stderr.on('data', () => {});
  proc.on('close', () => {
    try {
      const result = JSON.parse(out.trim());
      if (result.error) { console.error('[oracle] Python ошибка:', result.error); done(null); }
      else done({ type: 'fpga', raw: result.raw, y: result.y });
    } catch { done(null); }
  });
  setTimeout(() => { proc.kill(); done(null); }, 5000);
});

// ── Интерпретация ответа ────────────────────────────────────────
if (!answer || !answer.y) {
  console.log('[oracle] Чип не ответил — используем JS-симуляцию');

  // Локальная симуляция (если нет чипа)
  // Упрощённый проход через W1/W2 (тернарные)
  const simY = [
    snap(X[0] + X[1]),
    snap(X[1] + X[2]),
    snap(X[0] + X[2])
  ];
  console.log(`[oracle] Y (sim): ${simY.map(tritChar).join(' ')}`);
  interpretY(simY, true);
} else {
  console.log(`[oracle] ← чип ответил: ${answer.raw}`);
  console.log(`[oracle] Y: ${answer.y.map(tritChar).join(' ')}`);
  interpretY(answer.y, false);
}

function interpretY(Y, simulated) {
  // Y[0] = благодать/пустыня, Y[1] = интенсивность, Y[2] = направление
  const grace = Y[0] ===  1 ? 'БЛАГОДАТЬ (дар уместен)'
              : Y[0] === -1 ? 'ПУСТЫНЯ (дар преждевременен)'
              :                'КЕНОЗИС (дар нейтрален, но чист)';
  const intensity = Y[1] ===  1 ? 'сильно'
                  : Y[1] === -1 ? 'слабо'
                  :                'умеренно';
  const direction = Y[2] ===  1 ? '→ усилить'
                  : Y[2] === -1 ? '→ умерить'
                  :                '→ сохранить';

  console.log('');
  console.log('[oracle] ══ Свидетельство чипа ══');
  console.log(`  ${grace}`);
  console.log(`  Интенсивность: ${intensity} ${direction}`);
  console.log(`  Источник: ${simulated ? 'JS-симуляция' : 'Tang Nano 9K'}`);

  // Записать акт в матрицу
  // (GiftMemory уже загружена выше через 'mem')
  mem.receive({
    giverId:    '_fpga',
    receiverId: '_koinon',
    type:       'oracle',
    what:       `свидетельство: ${giver}→${receiver} = ${grace}`,
    weight:     2.0,
    ts:         Date.now(),
    meta:       { giver, receiver, X, Y, source: simulated ? 'sim' : 'chip' }
  });

  writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
  console.log('[oracle] ✓ акт записан в матрицу');
}
