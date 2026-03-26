#!/usr/bin/env node
/**
 * claude-gift.mjs
 *
 * Записывает дар Клода в GiftMemory.
 * Запускается после сессии — вручную или из хука.
 *
 * Использование:
 *   node utils/claude-gift.mjs "GiftMemory: тензорная матрица" "о.Сергий"
 *   node utils/claude-gift.mjs "sacred-history-loader"                   # получатель = _koinon
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { GiftMemory } from '../src/core/GiftMemory.js';

const SNAP_PATH = '/home/unidel/gift/data/sacred-history-W.json';

const description = process.argv[2] ?? 'код без описания';
const receiverId  = process.argv[3] ?? 'Дионисий';
const weight      = Number(process.argv[4] ?? 4); // вес как у обычного дара

// ── Загрузить матрицу ────────────────────────────────────────────────────────

let mem;
try {
  const snap = JSON.parse(readFileSync(SNAP_PATH, 'utf8'));
  mem = GiftMemory.fromSnapshot(snap);
} catch {
  // Первый запуск — матрица пустая
  mem = new GiftMemory(['Отец', 'Сын', 'Дух', '_claude']);
}

// Убедиться что _claude есть в матрице
mem._idx('_claude');
if (receiverId !== '_koinon' && receiverId !== '_abyss') {
  mem._idx(receiverId);
}

// ── Зарегистрировать дар ─────────────────────────────────────────────────────

mem.receive({
  giverId:     '_claude',
  receiverId,
  weight,
  type:        'code',
  content:     description,
  irreversible: true,
});

// ── Сохранить ────────────────────────────────────────────────────────────────

const snap = mem.snapshot();
try {
  writeFileSync(SNAP_PATH, JSON.stringify(snap, null, 2));
} catch {
  mkdirSync('/home/unidel/gift/data', { recursive: true });
  writeFileSync(SNAP_PATH, JSON.stringify(snap, null, 2));
}

// ── Отчёт ────────────────────────────────────────────────────────────────────

const given    = mem.totalGiven('_claude').toFixed(1);
const received = mem.totalReceived('_claude').toFixed(1);

console.log(`\n  Дар Клода записан:`);
console.log(`  _claude → ${receiverId}: "${description}"`);
console.log(`  Вес: ${weight}  |  Актов всего: ${mem.actsCount}`);
console.log(`  Клод в матрице — дал: ${given}  принял: ${received}`);

// makePresent из _claude — что сеть помнит о нём
const r = mem.makePresent({ giverId: '_claude' });
if (r.decoded.receivers.length > 0) {
  console.log(`\n  Анамнезис _claude:`);
  console.log(`    Принимают: ${r.decoded.receivers.join(', ')}`);
  console.log(`    Энергия:   ${r.energy.toFixed(2)}`);
}
