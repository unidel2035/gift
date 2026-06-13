import { test } from 'node:test';
import assert from 'node:assert/strict';
import { giftRatio, nearestNode, harmonyZone, gloss, actTrit, SOROKO_NODES, diagnoseMatrix } from '../utils/harmony.mjs';

const GOLDEN = 1 / ((1 + Math.sqrt(5)) / 2); // 0.618…

test('giftRatio: доля дара', () => {
  assert.equal(giftRatio(50, 50), 0.5);
  assert.equal(giftRatio(100, 0), 1);
  assert.equal(giftRatio(0, 100), 0);
  assert.equal(giftRatio(0, 0), null);          // нет нитей — не оценивается
  assert.ok(Math.abs(giftRatio(61.8, 38.2) - GOLDEN) < 0.001);
});

test('nearestNode: золото — узел Сороко', () => {
  assert.ok(SOROKO_NODES.some(n => Math.abs(n - GOLDEN) < 1e-9));
  assert.ok(Math.abs(nearestNode(0.62).node - GOLDEN) < 1e-9);
  assert.equal(nearestNode(0.5).node, 0.5);
});

test('harmonyZone: пять режимов (нейтральные имена)', () => {
  assert.equal(harmonyZone(0.30).zone, 'receiving');  // принимает больше
  assert.equal(harmonyZone(0.50).zone, 'balanced');   // симметрия
  assert.equal(harmonyZone(GOLDEN).zone, 'harmony');  // устойчивый surplus
  assert.equal(harmonyZone(0.95).zone, 'pouring');    // изливает без приёма
  assert.equal(harmonyZone(null).zone, 'silent');     // нет нитей
});

test('gloss: роль меняет вердикт (телос-получатель — не паразит)', () => {
  assert.match(gloss('receiving', 'telos'), /телос/);       // по замыслу
  assert.match(gloss('receiving', 'peer'), /больше, чем даёт/); // дисбаланс
  assert.match(gloss('pouring', 'source'), /источник/);     // по замыслу
  assert.match(gloss('harmony'), /здоровье/);
});

test('harmonyZone: _claude на реальных числах около золота', () => {
  // дал 215.8 / принял 146.2 → r≈0.596 — переходная к золоту, НЕ выгорание
  const z = harmonyZone(giftRatio(215.8, 146.2));
  assert.ok(['transitional', 'harmony'].includes(z.zone), `ожидал около золота, получил ${z.zone}`);
  assert.ok(z.r > 0.5 && z.r < 0.682);
});

test('actTrit: даритель −1, получатель +1, свидетель 0 (как decodeVec ядра)', () => {
  assert.equal(actTrit('даритель'), -1);
  assert.equal(actTrit('получатель'), +1);
  assert.equal(actTrit('свидетель'), 0);
  assert.equal(actTrit('отвержение'), -1);
  assert.equal(actTrit('вопрошание'), 0);
});

test('diagnoseMatrix: считает по лицам через totalGiven/Received (мок)', () => {
  const mem = {
    totalGiven: (p) => ({ A: 100, B: 10, C: 50 }[p] || 0),
    totalReceived: (p) => ({ A: 60, B: 90, C: 50 }[p] || 0),
  };
  const rows = diagnoseMatrix(mem, ['A', 'B', 'C']);
  const byP = Object.fromEntries(rows.map(x => [x.person, x]));
  assert.equal(byP.B.zone, 'receiving');  // 10/100 принимает больше
  assert.equal(byP.C.zone, 'balanced');   // 50/50
  assert.ok(byP.A.r > 0.5);               // даёт больше
  // сортировка по обороту: A (160) первым
  assert.equal(rows[0].person, 'A');
});
