/**
 * benchmarks/timer.mjs — проверка инвариантов Timer.
 *
 * Запуск: node benchmarks/timer.mjs
 *
 * Инварианты:
 *   1. start() идемпотентен
 *   2. stop() необратим (frozen, повтор — no-op)
 *   3. pause() сохраняет elapsed
 *   4. onTick после stop() — молчание
 *   5. kairos-mode: тик только от .kairos()
 *   6. drift-correction: N тиков за N*interval (±сутулая погрешность loop)
 */

import Timer from '../src/core/Timer.js';
import { EschatonClock } from '../src/theology/EschatonClock.js';

let pass = 0, fail = 0;
function check(name, cond, note = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else      { fail++; console.log(`  ✗ ${name}${note ? '  — ' + note : ''}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\n═══ Timer — инварианты ═══\n');

// 1. start() идемпотентен
{
  const t = new Timer({ interval: 20 });
  t.start();
  const s1 = t.state;
  t.start();
  check('start() идемпотентен', t.state === s1 && t.state === 'running');
  t.stop();
}

// 2. stop() необратим и frozen
{
  const t = new Timer({ interval: 20 });
  t.start();
  t.stop();
  check('после stop() состояние stopped', t.state === 'stopped');
  check('объект заморожен', Object.isFrozen(t));
  t.stop(); // повтор — no-op
  check('повторный stop() не бросает', t.state === 'stopped');
  t.start(); // воскресения нет
  check('start() после stop() — no-op', t.state === 'stopped');
}

// 3. pause() сохраняет elapsed
{
  const t = new Timer({ interval: 1000 });
  t.start();
  await sleep(40);
  t.pause();
  const e1 = t.elapsed;
  await sleep(40);
  const e2 = t.elapsed;
  check('pause() сохраняет elapsed', e1 === e2 && e1 >= 30);
  t.resume();
  await sleep(40);
  const e3 = t.elapsed;
  check('resume() продолжает elapsed', e3 > e2);
  t.stop();
}

// 4. onTick после stop() игнорируется
{
  const t = new Timer({ interval: 10 });
  t.start();
  t.stop();
  let fired = 0;
  const unsub = t.onTick(() => fired++);
  await sleep(40);
  check('onTick после stop() — молчание', fired === 0);
  check('unsubscribe после stop() безопасен', typeof unsub === 'function');
}

// 5. kairos-mode: тик только от .kairos()
{
  const t = new Timer({ kairos: true, interval: 10 });
  let ticks = [];
  t.onTick((p) => ticks.push(p));
  t.start();
  await sleep(50); // в καιρός таймер сам не тикает
  check('καιρός не тикает по ms', ticks.length === 0);
  t.kairos({ event: 'исполнилось' });
  check('kairos(event) рождает тик', ticks.length === 1);
  check('payload содержит .kairos', ticks[0]?.kairos?.event === 'исполнилось');
  t.stop();
  const before = ticks.length;
  t.kairos({ event: 'после отпуста' });
  check('kairos() после stop() — no-op', ticks.length === before);
}

// 6. drift-correction
{
  const t = new Timer({ interval: 20 });
  let ticks = 0;
  t.onTick(() => ticks++);
  t.start();
  await sleep(210); // ожидаемо ~10 тиков
  t.stop();
  check(`drift-correction: ~10 тиков за 200ms`, ticks >= 8 && ticks <= 12,
        `получено ${ticks}`);
}

// 7. EschatonClock.heartbeat() возвращает Timer
{
  const clock = new EschatonClock(new Date('2026-07-22T12:00:00Z')); // среда, χρόνος
  const hb = clock.heartbeat({ interval: 50 });
  check('heartbeat() возвращает Timer', hb instanceof Timer);
  check('heartbeat в χρόνος — не kairos', hb.kairos === false);
  hb.stop();

  const paschal = new EschatonClock(new Date('2026-04-12T12:00:00Z')); // Пасха
  const hb2 = paschal.heartbeat({ interval: 50 });
  check('heartbeat в καιρός автоматически kairos=true', hb2.kairos === true);
  hb2.stop();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
