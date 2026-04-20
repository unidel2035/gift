#!/usr/bin/env node
/**
 * telos-anagogic.mjs — бенчмарк τέλος-классификации пустынь
 *
 * Проверяет:
 *   1) dionysius-christ.gift загружен: doxologia[Дионисий][Христос] > 0
 *   2) thread('Дионисий','Христос') возвращает doxologia-вес, не 0
 *   3) DesertScanner с excludeClassifications:['telos_anagogic']
 *      не возвращает Дионисий→Христос как пустыню
 *   4) Без исключения — классификация всё равно 'telos_anagogic'
 *
 * Богословский контекст:
 *   «Твоя от Твоих Тебе приносяще о всех и за вся» (Анафора И. Златоуста).
 *   Христос — не peer-узел в графе даров, а τέλος — жертвенник, к которому
 *   анафорически обращён всякий труд. Поэтому пустыня «Дионисий→Христос»
 *   в peer-смысле — категориальная ошибка: ищем doxologia-активность,
 *   а не симметричный обмен.
 *
 * Запуск: node benchmarks/telos-anagogic.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory } from '../src/core/GiftMemory.js';
import { DesertScanner, DESERT_CLASS } from '../src/core/DesertScanner.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  const ok = !!cond;
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else    { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\n═══ Бенчмарк: τέλος-анагогическая классификация ═══\n');

if (!existsSync(SNAP)) {
  console.error('[!] Снапшот не найден. Запусти: node utils/sacred-history-loader.mjs');
  process.exit(1);
}

const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const mem  = GiftMemory.fromSnapshot(snap);

// 1) doxologia[Дионисий][Христос] > 0
const ci = mem.persons.indexOf('Дионисий');
const di = mem.divinePersons.indexOf('Христос');
const dox = (ci >= 0 && di >= 0) ? mem._doxologia[ci][di] : 0;
check(
  'doxologia[Дионисий][Христос] > 0 (spec dionysius-christ.gift загружен)',
  dox > 0,
  `значение=${dox}`
);

// 2) thread() маршрутизирует в doxologia, возвращает ненулевой вес
const thr = mem.thread('Дионисий', 'Христос');
check(
  'thread(Дионисий, Христос).weight > 0',
  thr.weight > 0,
  `weight=${thr.weight}, type=${thr.type}`
);
check(
  'thread(Дионисий, Христос).type === "doxologia"',
  thr.type === 'doxologia',
  `type=${thr.type}`
);

// 3) DesertScanner без исключения: классификация присутствует
const scannerAll = new DesertScanner(mem, { threshold: 0.5 });
const allDeserts = scannerAll.scan();
const dionysiusChrist = allDeserts.find(d => d.from === 'Дионисий' && d.to === 'Христос');
// Поскольку doxologia > 0, пары «Дионисий→Христос» в пустынях быть не должно
check(
  'При threshold=0.5 Дионисий→Христос НЕ в пустынях (doxologia насыщена)',
  !dionysiusChrist,
  dionysiusChrist ? `нашли пустыню: weight/classification неизвестно` : ''
);

// Проверим классификацию на заведомо пустой паре: _claude → Христос, если есть
const claudeChristDesert = allDeserts.find(d => d.from === '_claude' && d.to === 'Христос');
if (claudeChristDesert) {
  check(
    'Пара creature→divine классифицируется как telos_anagogic',
    claudeChristDesert.classification === DESERT_CLASS.TELOS_ANAGOGIC,
    `classification=${claudeChristDesert.classification}`
  );
} else {
  console.log('  ~ _claude→Христос не пустынен — пропуск проверки классификации');
}

// 4) С excludeClassifications=[telos_anagogic] — divine-receivers не попадают в список
const scannerPeer = new DesertScanner(mem, {
  threshold: 0.5,
  excludeClassifications: [DESERT_CLASS.TELOS_ANAGOGIC, DESERT_CLASS.THEOPHANEIA],
});
const peerDeserts = scannerPeer.scan();
const divineReceivers = new Set(['Отец', 'Сын', 'Дух', 'Христос']);
const telosLeaks = peerDeserts.filter(d => divineReceivers.has(d.to));
check(
  'excludeClassifications фильтрует все пары с divine-receiver',
  telosLeaks.length === 0,
  `утекло пар: ${telosLeaks.length}`
);

const theophLeaks = peerDeserts.filter(d => divineReceivers.has(d.from) && divineReceivers.has(d.to));
check(
  'theophaneia-пары (divine→divine) тоже отфильтрованы',
  theophLeaks.length === 0,
  `утекло: ${theophLeaks.length}`
);

// 5) Литургический инвариант: если creature→divine удалить из peer-деда,
//    peer-пустынь должно стать строго меньше
check(
  'peer-сканирование даёт < чем полное (τέλος-узлы исключены)',
  peerDeserts.length < allDeserts.length,
  `peer=${peerDeserts.length}, all=${allDeserts.length}`
);

console.log(`\n═══ Итог: ${passed} прошло, ${failed} провалилось ═══\n`);

if (failed > 0) {
  console.error('Анафора не полна — исправь.');
  process.exit(1);
}
console.log('«Твоя от Твоих Тебе приносяще о всех и за вся.»\n');
