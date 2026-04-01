#!/usr/bin/env node
/**
 * eva-swarm-demo.mjs — Рой трёх лиц: Адам, Ева-LLM, Серафим
 *
 * Демонстрирует:
 *   - EvaAgent с языковой миссией (LLM наблюдения через Ollama)
 *   - Два простых дрона (Адам, Серафим) на базе DroneAgent
 *   - 30 тиков симуляции
 *   - Наблюдения Евы в терминале по мере появления
 *   - W-матрица (surplus каждого лица) после 30 тиков
 *
 * Запуск: node utils/eva-swarm-demo.mjs
 */

import { DroneAgent, DroneRole } from '../src/os/drone/DroneAgent.js';
import { EvaAgent }              from '../src/os/drone/EvaAgent.js';

// ── Создаём рой ──────────────────────────────────────────────────────────────

const TOTAL_TICKS = 30;
const GRID_SIZE   = 1;
const TARGET_ZONE = { x1: 6, y1: 6, x2: 10, y2: 10 };

const adam = new DroneAgent({
  id:      'Адам',
  x:       0.5,
  y:       0.5,
  battery: 95,
  role:    DroneRole.SCOUT,
});

const eva = new EvaAgent({
  id:      'Ева',
  x:       1.0,
  y:       0.0,
  battery: 90,
  role:    DroneRole.SCOUT,
});

const seraphim = new DroneAgent({
  id:      'Серафим',
  x:       0.0,
  y:       1.0,
  battery: 85,
  role:    DroneRole.GUARDIAN,
});

const drones   = [adam, eva, seraphim];
const globalCoverage = new Set();
let   lastEvaObsCount = 0;  // следим, когда Ева произнесла новое наблюдение

// ── Простая логика назначения цели ──────────────────────────────────────────

function assignTarget(drone, tick) {
  const tz = TARGET_ZONE;
  const uncovered = [];
  for (let x = tz.x1; x <= tz.x2; x++) {
    for (let y = tz.y1; y <= tz.y2; y++) {
      if (!globalCoverage.has(`${x},${y}`)) uncovered.push({ x, y });
    }
  }

  if (!uncovered.length) {
    drone.target = { x: 1, y: 1 };  // возврат на базу
    return;
  }

  // Ближайшая непокрытая клетка
  drone.target = uncovered.reduce((best, c) =>
    drone.distTo(c.x, c.y) < drone.distTo(best.x, best.y) ? c : best
  );
}

// ── Цвета для терминала ──────────────────────────────────────────────────────

const C = {
  reset:    '\x1b[0m',
  cyan:     '\x1b[36m',
  green:    '\x1b[32m',
  yellow:   '\x1b[33m',
  magenta:  '\x1b[35m',
  blue:     '\x1b[34m',
  dim:      '\x1b[2m',
  bold:     '\x1b[1m',
};

function header(text) {
  const line = '─'.repeat(60);
  console.log(`\n${C.cyan}${line}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${text}${C.reset}`);
  console.log(`${C.cyan}${line}${C.reset}`);
}

function droneStatus(d) {
  const surplusSign = d.surplus >= 0 ? '+' : '';
  return `${C.dim}[${d.id.padEnd(7)}]${C.reset} ` +
    `(${d.x.toFixed(1)},${d.y.toFixed(1)}) ` +
    `${C.dim}роль:${C.reset}${d.role.padEnd(8)} ` +
    `${C.dim}заряд:${C.reset}${d.battery.toFixed(0).padStart(3)}% ` +
    `${C.dim}surplus:${C.reset}${C.green}${surplusSign}${d.surplus}${C.reset}`;
}

// ── Главный цикл ─────────────────────────────────────────────────────────────

header(`Рой трёх лиц: Адам · Ева-LLM · Серафим`);
console.log(`${C.dim}Тиков: ${TOTAL_TICKS} | Зона: [${TARGET_ZONE.x1},${TARGET_ZONE.y1}]→[${TARGET_ZONE.x2},${TARGET_ZONE.y2}]${C.reset}`);
console.log(`${C.dim}Ева общается с Ollama каждые 10 тиков (eva:latest)${C.reset}\n`);

for (let tick = 1; tick <= TOTAL_TICKS; tick++) {

  // 1. Heartbeat: обмен surplus и позициями
  for (const drone of drones) {
    for (const peer of drones) {
      if (peer.id !== drone.id) {
        drone.updatePeer(peer.id, peer.surplus, { x: peer.x, y: peer.y });
      }
    }
  }

  // 2. Выбор ролей
  for (const drone of drones) {
    drone.electRole(globalCoverage, TARGET_ZONE);
  }

  // 3. Назначение целей
  for (const drone of drones) {
    assignTarget(drone, tick);
  }

  // 4. Движение и сканирование
  for (const drone of drones) {
    if (drone.role === DroneRole.RESTING) continue;
    if (drone.target) drone.stepToward(drone.target.x, drone.target.y);
    const scanned = drone.scan(GRID_SIZE);
    if (scanned) globalCoverage.add(`${scanned.x},${scanned.y}`);
  }

  // 5. Языковая миссия Евы (fire-and-forget — не блокирует тик)
  eva.evaStep(tick).catch(() => {});

  // 6. Вывод каждые 5 тиков или когда Ева заговорила
  const evaObsNow = eva.observations.length;
  const evaSpoke  = evaObsNow > lastEvaObsCount;

  if (tick % 5 === 0 || evaSpoke) {
    console.log(`${C.bold}Тик ${String(tick).padStart(2)}${C.reset}  ` +
      `${C.dim}покрыто: ${globalCoverage.size} клеток${C.reset}`);
    for (const d of drones) console.log('  ' + droneStatus(d));

    if (evaSpoke) {
      const obs = eva.getLastObservation();
      console.log(
        `\n  ${C.magenta}${C.bold}🔭 Ева [тик ${obs.tick}]:${C.reset} ` +
        `${C.yellow}«${obs.text}»${C.reset}` +
        `  ${C.dim}(surplus +3 → ${obs.surplus})${C.reset}\n`
      );
      lastEvaObsCount = evaObsNow;
    } else {
      console.log('');
    }
  }
}

// ── Итоговая W-матрица ────────────────────────────────────────────────────────

// Небольшая пауза — Ева может ещё не получить ответ на тик 30
await new Promise(r => setTimeout(r, 200));

header('W-матрица роя после 30 тиков');

// Строим матрицу отношений
// Строки: кто дал, Столбцы: кто получил
// В нашем рое "получение" — coverage (данные получены от пространства)
// surplus = given - received, where received = coverage от соседей (shared via heartbeat)
// Для наглядности показываем given/received/surplus каждого лица

const colW = 10;
const names = drones.map(d => d.id);

// Заголовок
console.log('\n' + C.dim + '  Лицо'.padEnd(12) +
  'given'.padStart(colW) +
  'received'.padStart(colW) +
  'surplus'.padStart(colW) +
  'покрыто'.padStart(colW) +
  'наблюд.'.padStart(colW) +
  C.reset);
console.log(C.dim + '  ' + '─'.repeat(58) + C.reset);

for (const d of drones) {
  const obsCount = d instanceof EvaAgent ? d.observations.length : '—';
  const surplusStr = d.surplus >= 0 ? `+${d.surplus}` : `${d.surplus}`;
  console.log(
    `  ${C.bold}${d.id.padEnd(10)}${C.reset}` +
    String(d.given).padStart(colW) +
    String(d.received).padStart(colW) +
    `${C.green}${surplusStr.padStart(colW)}${C.reset}` +
    String(d.coverage.size).padStart(colW) +
    String(obsCount).padStart(colW)
  );
}

console.log(C.dim + '  ' + '─'.repeat(58) + C.reset);
console.log(`\n  ${C.dim}Глобальное покрытие: ${globalCoverage.size} клеток${C.reset}`);
console.log(`  ${C.dim}Зона: ${TARGET_ZONE.x2 - TARGET_ZONE.x1 + 1}×${TARGET_ZONE.y2 - TARGET_ZONE.y1 + 1} = ${(TARGET_ZONE.x2 - TARGET_ZONE.x1 + 1) * (TARGET_ZONE.y2 - TARGET_ZONE.y1 + 1)} клеток${C.reset}`);

// ── Наблюдения Евы ────────────────────────────────────────────────────────────

if (eva.observations.length > 0) {
  header('Все наблюдения Евы');
  for (const obs of eva.observations) {
    console.log(
      `  ${C.dim}тик ${String(obs.tick).padStart(2)} | surplus ${obs.surplus >= 0 ? '+' : ''}${obs.surplus}${C.reset}\n` +
      `  ${C.yellow}«${obs.text}»${C.reset}\n`
    );
  }
} else {
  console.log(`\n${C.dim}  Ева ещё не произнесла наблюдений — Ollama, возможно, недоступна.${C.reset}`);
  console.log(`${C.dim}  Запустите Ollama: ollama run eva:latest${C.reset}\n`);
}

// Богословское заключение
console.log(`\n${C.cyan}${'─'.repeat(60)}${C.reset}`);
console.log(`${C.dim}  «Слово = дар. Ева даёт рою невидимое — названное пространство.»${C.reset}`);
console.log(`${C.cyan}${'─'.repeat(60)}${C.reset}\n`);
