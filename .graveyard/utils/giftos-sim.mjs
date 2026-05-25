#!/usr/bin/env node
/**
 * giftos-sim.mjs — симулятор роя дронов GiftOS в терминале
 *
 * Визуализирует рой дронов координирующихся через W-матрицу surplus.
 * Нет командира. Нет центра. Только соборность.
 *
 * Использование:
 *   node utils/giftos-sim.mjs
 *   node utils/giftos-sim.mjs --drones=7 --ticks=200 --speed=50
 *   node utils/giftos-sim.mjs --grid=30 --zone=10,10,20,20
 */

import { SwarmCoordinator } from '../src/os/drone/SwarmCoordinator.js';
import { DroneRole } from '../src/os/drone/DroneAgent.js';

// ── Аргументы ─────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const drones  = parseInt(args.find(a => a.startsWith('--drones='))?.split('=')[1]  ?? '5');
const maxTicks= parseInt(args.find(a => a.startsWith('--ticks='))?.split('=')[1]   ?? '300');
const speed   = parseInt(args.find(a => a.startsWith('--speed='))?.split('=')[1]   ?? '80');  // ms/tick
const gridW   = parseInt(args.find(a => a.startsWith('--grid='))?.split('=')[1]    ?? '22');
const gridH   = gridW;

const zoneArg = args.find(a => a.startsWith('--zone='))?.split('=')[1] ?? null;
let targetZone = { x1: 8, y1: 8, x2: 14, y2: 14 };
if (zoneArg) {
  const [x1, y1, x2, y2] = zoneArg.split(',').map(Number);
  targetZone = { x1, y1, x2, y2 };
}

// ── Символы ───────────────────────────────────────────────────────────────

const ROLE_ICON = {
  [DroneRole.SCOUT]:    '▲',
  [DroneRole.RELAY]:    '◉',
  [DroneRole.EXECUTOR]: '★',
  [DroneRole.GUARDIAN]: '◆',
  [DroneRole.RESTING]:  '·',
};

const ROLE_COLOR = {
  [DroneRole.SCOUT]:    '\x1b[33m',   // жёлтый
  [DroneRole.RELAY]:    '\x1b[36m',   // голубой
  [DroneRole.EXECUTOR]: '\x1b[32m',   // зелёный
  [DroneRole.GUARDIAN]: '\x1b[35m',   // фиолетовый
  [DroneRole.RESTING]:  '\x1b[90m',   // серый
};

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RED    = '\x1b[31m';

function colorBattery(b) {
  if (b > 60) return `${GREEN}${b.toFixed(0)}%${RESET}`;
  if (b > 30) return `${YELLOW}${b.toFixed(0)}%${RESET}`;
  return `${RED}${b.toFixed(0)}%${RESET}`;
}

function surplusStr(s) {
  if (s > 0) return `${GREEN}+${s}${RESET}`;
  if (s < 0) return `${RED}${s}${RESET}`;
  return `${DIM}±0${RESET}`;
}

function bar(val, max, width = 20, char = '█') {
  const filled = Math.min(Math.round((val / Math.max(max, 1)) * width), width);
  return `${GREEN}${char.repeat(filled)}${DIM}${'░'.repeat(width - filled)}${RESET}`;
}

// ── Рендер кадра ─────────────────────────────────────────────────────────

function render(swarm, snap) {
  // Очистить экран
  process.stdout.write('\x1b[2J\x1b[H');

  // ── Заголовок ────────────────────────────────────────────────────────
  console.log(`${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║  GiftOS — рой дронов без командира   тик: ${snap.tick.toString().padStart(4)} / ${maxTicks}          ║${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}`);

  // ── Карта ────────────────────────────────────────────────────────────
  const tz = swarm.targetZone;

  // Построить карту
  const mapLines = [];
  for (let y = 0; y < gridH; y++) {
    let line = `${DIM}${y.toString().padStart(2)}${RESET} `;
    for (let x = 0; x < gridW; x++) {
      // Дрон в этой клетке?
      const drone = snap.drones.find(d =>
        Math.round(d.x) === x && Math.round(d.y) === y
      );

      if (drone) {
        const col  = ROLE_COLOR[drone.role] ?? '';
        const icon = ROLE_ICON[drone.role]  ?? '?';
        line += `${col}${BOLD}${icon}${RESET}`;
      } else if (swarm.globalCoverage.has(`${x},${y}`)) {
        // Покрытая клетка в целевой зоне
        if (x >= tz.x1 && x <= tz.x2 && y >= tz.y1 && y <= tz.y2) {
          line += `${GREEN}·${RESET}`;
        } else {
          line += `${DIM}·${RESET}`;
        }
      } else if (x >= tz.x1 && x <= tz.x2 && y >= tz.y1 && y <= tz.y2) {
        // Целевая зона — непокрыта
        line += `${YELLOW}░${RESET}`;
      } else {
        line += ' ';
      }
    }
    mapLines.push(line);
  }

  // ── Панель статуса (справа от карты) ─────────────────────────────────
  const panelLines = [
    `${BOLD}РОЙ${RESET}`,
    `Дронов: ${snap.alive}/${drones}  Спят: ${snap.resting}`,
    '',
    `${BOLD}ПОКРЫТИЕ${RESET}`,
    bar(snap.coverage, 100) + ` ${snap.coverage}%`,
    `${snap.covered}/${snap.totalCells} клеток`,
    '',
    `${BOLD}ЛЕГЕНДА${RESET}`,
    `${ROLE_COLOR[DroneRole.EXECUTOR]}★${RESET} EXECUTOR — цель`,
    `${ROLE_COLOR[DroneRole.SCOUT]}▲${RESET} SCOUT — разведка`,
    `${ROLE_COLOR[DroneRole.RELAY]}◉${RESET} RELAY — связь`,
    `${ROLE_COLOR[DroneRole.GUARDIAN]}◆${RESET} GUARDIAN — охрана`,
    `${ROLE_COLOR[DroneRole.RESTING]}·${RESET} RESTING — sabbath`,
    '',
    `${YELLOW}░${RESET} целевая зона`,
    `${GREEN}·${RESET} покрыто`,
  ];

  for (let i = 0; i < Math.max(mapLines.length, panelLines.length); i++) {
    const ml = mapLines[i]  ?? ' '.repeat(gridW + 4);
    const pl = panelLines[i] ?? '';
    // Убрать escape-коды для подсчёта длины (примерно)
    const rawLen = (mapLines[i] ?? '').replace(/\x1b\[[^m]*m/g, '').length;
    const pad    = Math.max(0, gridW + 6 - rawLen);
    console.log(ml + ' '.repeat(pad) + pl);
  }

  // ── Таблица дронов ───────────────────────────────────────────────────
  console.log('');
  console.log(`${BOLD}  ИМЯ        РОЛЬ        БАТАРЕЯ  SURPLUS  ПОКРЫТО  ПОЗИЦИЯ${RESET}`);
  console.log('  ' + '─'.repeat(60));

  for (const d of snap.drones) {
    const name    = d.id.padEnd(10);
    const role    = `${ROLE_COLOR[d.role]}${d.role.padEnd(10)}${RESET}`;
    const battery = colorBattery(d.battery).padEnd(8);
    const surp    = surplusStr(d.surplus);
    const cov     = String(d.covered).padStart(4);
    const pos     = `(${d.x.toFixed(1)},${d.y.toFixed(1)})`;
    console.log(`  ${name} ${role}  ${battery}  ${surp.padEnd(8)}  ${cov}     ${pos}`);
  }

  // ── W-матрица роя (топ нитей) ─────────────────────────────────────────
  const topGiver = snap.drones.slice().sort((a, b) => b.surplus - a.surplus)[0];
  console.log('');
  console.log(`${BOLD}  W-матрица роя:${RESET}`);
  console.log(`  Топ по surplus: ${GREEN}${topGiver?.id}${RESET} (+${topGiver?.surplus ?? 0})`);
  console.log(`  Покрытие целевой зоны: ${bar(snap.coverage, 100, 30)} ${snap.coverage}%`);

  // Роли и их распределение
  const roleCounts = {};
  for (const d of snap.drones) roleCounts[d.role] = (roleCounts[d.role] ?? 0) + 1;
  const rolesStr = Object.entries(roleCounts)
    .map(([r, n]) => `${ROLE_COLOR[r]}${r}×${n}${RESET}`)
    .join('  ');
  console.log(`  Роли: ${rolesStr}`);
}

// ── Главный цикл ─────────────────────────────────────────────────────────

async function main() {
  const swarm = new SwarmCoordinator({
    droneCount: drones,
    gridW, gridH,
    targetZone,
  });

  console.log('\x1b[?25l'); // скрыть курсор

  let snap;
  for (let t = 0; t < maxTicks; t++) {
    snap = swarm.step();
    render(swarm, snap);

    if (snap.coverage >= 100) {
      break;
    }

    await new Promise(r => setTimeout(r, speed));
  }

  // Финальный экран
  console.log('');
  console.log(`${BOLD}${GREEN}  МИССИЯ ЗАВЕРШЕНА${RESET}`);
  console.log(`  Тиков: ${snap.tick}`);
  console.log(`  Покрыто: ${snap.coverage}%`);
  const topGiver = snap.drones.slice().sort((a, b) => b.given - a.given)[0];
  console.log(`  Главный даритель роя: ${topGiver?.id} (дал ${topGiver?.given} данных)`);
  console.log('');
  console.log(`  ${DIM}Θεωρία: рой без командира — соборность в действии.${RESET}`);
  console.log('');

  console.log('\x1b[?25h'); // показать курсор
}

main().catch(e => {
  console.log('\x1b[?25h');
  console.error(e);
  process.exit(1);
});
