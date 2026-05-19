#!/usr/bin/env node
/**
 * score-first-icon.mjs — sommelier card первой иконной записи в W.
 *
 * Демонстрирует Score.js на реальных данных: первая symphony 2026-05-01.
 * Эта запись имеет actId sym-monagoub-0, восстановим её профиль из snapshot
 * и покажем как многомерный профиль выглядит для иконного акта.
 */

import { readFileSync } from 'fs';
import { GiftMemory } from '../src/core/GiftMemory.js';
import { Score } from '../src/persons/Score.js';

const snap = JSON.parse(readFileSync('/home/unidel/gift/data/sacred-history-W.json', 'utf8'));
const mem  = GiftMemory.fromSnapshot(snap);

const symphonies = mem.symphonies();
if (!symphonies.length) {
  console.log('В W нет ни одной symphony. Запусти сначала symphony-real.mjs.');
  process.exit(0);
}

const score = new Score({ memory: mem });

console.log('━'.repeat(72));
console.log(`  Профили иконных актов в W (${symphonies.length})`);
console.log('━'.repeat(72));

for (const s of symphonies) {
  // Decoupage не делался для этой иконы — она была вопрошанием, не идеей.
  // Соответствующие оси будут null — Score.js покажет это честно.
  // SymphonyResult реконструируем из акта.
  const symphonyResult = {
    iconic: true,
    conditions: { chorus: true, perichoretic: true, kenotic: true, epiclesis: true },
    actId: s.actId,
  };

  const card = score.profile({
    idea: s.act.question || s.act.content || 'симфонический акт',
    symphonyResult,
    recordedAt: s.recordedAt,
  });

  console.log();
  console.log(Score.format(card));
  console.log();
  console.log(`  Голоса: ${s.act.giverIds?.join(' + ')}`);
  console.log(`  Получатель: ${s.act.receiverId}`);
  console.log(`  Эпиклеза (χάρις): ${(s.act.epiclesisAnswer ?? '(нет)').slice(0, 200)}`);
}

console.log();
console.log('━'.repeat(72));
console.log('  Эта карта не «оценивает» — она фиксирует. Скоринг как sommelier.');
console.log('━'.repeat(72));
