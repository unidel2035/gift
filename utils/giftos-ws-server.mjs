/**
 * giftos-ws-server.mjs — GiftOS Multiplayer Swarm Simulator
 *
 * WebSocket сервер на порту 3702 (3701 занят fpga-gift-bridge).
 * Управляет общим состоянием роя дронов и W-матрицей дарения.
 *
 * Протокол:
 *   Клиент → Сервер: {"cmd":"killLeader"}
 *                    {"cmd":"obstacle","x":N,"y":N}
 *                    {"cmd":"mergeSwarm"}
 *                    {"cmd":"drain"}
 *
 *   Сервер → Клиент: {"type":"welcome","clientId":"X","totalClients":N}
 *                    {"type":"state","drones":[...],"wMatrix":{...},"tick":N,"log":[...]}
 *
 * Роли: EXECUTOR(★), RELAY(◉), SCOUT(▲), GUARDIAN(◆), RESTING(·)
 *
 * Запуск: node utils/giftos-ws-server.mjs
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';

const PORT = 3702;
const MAX_CLIENTS = 8;
const TICK_MS = 200;
const GRID = 10;            // 10×10 клеток

// ─────────────────────────────────────────────────────────────────────────────
// Начальное состояние роя
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_SYMBOLS = {
  EXECUTOR: '★',
  RELAY:    '◉',
  SCOUT:    '▲',
  GUARDIAN: '◆',
  RESTING:  '·',
};

const DRONE_NAMES = ['Алфавит', 'Бытие', 'Глагол', 'Дар', 'Единство', 'Живот'];

function makeDrones() {
  return DRONE_NAMES.map((name, i) => ({
    id:      `d${i}`,
    name,
    x:       Math.floor(Math.random() * GRID),
    y:       Math.floor(Math.random() * GRID),
    role:    'SCOUT',
    surplus: Math.random() * 4 + 1,      // 1..5
    battery: 80 + Math.random() * 20,    // 80..100
    alive:   true,
    kenotic: false,
  }));
}

// W-матрица: {fromId_toId: weight}
function makeWMatrix(drones) {
  const w = {};
  for (const a of drones) {
    for (const b of drones) {
      if (a.id !== b.id) {
        w[`${a.id}_${b.id}`] = parseFloat((Math.random() * 2).toFixed(2));
      }
    }
  }
  return w;
}

// ─────────────────────────────────────────────────────────────────────────────
// Глобальное состояние
// ─────────────────────────────────────────────────────────────────────────────

let drones    = makeDrones();
let wMatrix   = makeWMatrix(drones);
let tick      = 0;
let obstacles = new Set();   // "x_y"
let log       = [];          // последние N записей
const LOG_MAX = 20;

function addLog(msg) {
  log.push(`[${tick}] ${msg}`);
  if (log.length > LOG_MAX) log.shift();
}

// Набор "занятых" клеток дронами
function occupiedCells() {
  const cells = new Set();
  for (const d of drones) {
    if (d.alive) cells.add(`${d.x}_${d.y}`);
  }
  return cells;
}

// Найти ближайшую свободную клетку для движения
function nearestFreeCell(drone, occupied) {
  let best = null;
  let bestDist = Infinity;
  for (let cx = 0; cx < GRID; cx++) {
    for (let cy = 0; cy < GRID; cy++) {
      const key = `${cx}_${cy}`;
      if (occupied.has(key) || obstacles.has(key)) continue;
      const dist = Math.abs(drone.x - cx) + Math.abs(drone.y - cy);
      if (dist > 0 && dist < bestDist) {
        bestDist = dist;
        best = { x: cx, y: cy };
      }
    }
  }
  return best;
}

// Шаг в направлении цели (один шаг по оси)
function stepToward(drone, target) {
  const dx = target.x - drone.x;
  const dy = target.y - drone.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    drone.x += Math.sign(dx);
  } else {
    drone.y += Math.sign(dy);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Логика тика
// ─────────────────────────────────────────────────────────────────────────────

function electRoles() {
  const alive = drones.filter(d => d.alive);
  if (alive.length === 0) return;

  // Сортируем по профициту (по убыванию)
  const ranked = [...alive].sort((a, b) => b.surplus - a.surplus);

  for (let i = 0; i < ranked.length; i++) {
    const d = ranked[i];
    if (d.kenotic) {
      d.role = 'RESTING';
    } else if (i === 0) {
      d.role = 'EXECUTOR';
    } else if (i === 1) {
      d.role = 'RELAY';
    } else if (i === ranked.length - 1 && ranked.length > 2) {
      d.role = 'GUARDIAN';
    } else {
      d.role = 'SCOUT';
    }
  }
}

function applyGiftEconomy() {
  // Каждые 5 тиков: распределение профицита
  if (tick % 5 !== 0) return;

  for (const d of drones) {
    if (!d.alive) continue;
    if (d.role === 'EXECUTOR') {
      d.surplus += 2;
      addLog(`${d.name}(★) surplus+2 → ${d.surplus.toFixed(1)}`);
    } else if (d.role === 'RELAY') {
      d.surplus += 1;
    } else {
      d.surplus = Math.max(0, d.surplus - 0.5);
    }

    // Кенотическое истощение: отдаёт профицит ближнему
    if (d.kenotic && d.surplus > 0) {
      const neighbors = drones.filter(
        o => o.alive && o.id !== d.id &&
             Math.abs(o.x - d.x) + Math.abs(o.y - d.y) <= 2
      );
      if (neighbors.length > 0) {
        const receiver = neighbors[0];
        const gift = d.surplus;
        // W-матрица: усилить нить дарения
        const key = `${d.id}_${receiver.id}`;
        wMatrix[key] = parseFloat(((wMatrix[key] || 0) + gift * 0.1).toFixed(3));
        receiver.surplus += gift * 0.5;   // половина передаётся
        addLog(`${d.name} кенозис→${receiver.name} дар=${gift.toFixed(1)}`);
        d.surplus = 0;
      }
    }
  }
}

function moveDrones() {
  const occupied = occupiedCells();
  for (const d of drones) {
    if (!d.alive || d.role === 'RESTING') continue;

    const target = nearestFreeCell(d, occupied);
    if (target) {
      occupied.delete(`${d.x}_${d.y}`);
      stepToward(d, target);
      occupied.add(`${d.x}_${d.y}`);
    }
  }
}

function drainBatteries() {
  for (const d of drones) {
    if (!d.alive) continue;
    d.battery = Math.max(0, d.battery - 0.1);

    const wasKenotic = d.kenotic;
    d.kenotic = d.battery < 20;

    if (!wasKenotic && d.kenotic) {
      addLog(`${d.name} вошёл в кенозис (battery=${d.battery.toFixed(1)}%)`);
    }

    if (d.battery <= 0) {
      d.alive = false;
      addLog(`${d.name} отключён (battery=0)`);
    }
  }
}

function simulateTick() {
  tick++;
  drainBatteries();
  applyGiftEconomy();
  electRoles();
  moveDrones();
}

// ─────────────────────────────────────────────────────────────────────────────
// Команды клиентов
// ─────────────────────────────────────────────────────────────────────────────

function handleCommand(cmd, clientId) {
  switch (cmd.cmd) {
    case 'killLeader': {
      const leader = drones.find(d => d.alive && d.role === 'EXECUTOR');
      if (leader) {
        leader.alive = false;
        leader.battery = 0;
        addLog(`[${clientId}] killLeader → ${leader.name} уничтожен`);
      } else {
        addLog(`[${clientId}] killLeader — лидер не найден`);
      }
      break;
    }

    case 'obstacle': {
      const ox = Math.max(0, Math.min(GRID - 1, Number(cmd.x) || 0));
      const oy = Math.max(0, Math.min(GRID - 1, Number(cmd.y) || 0));
      const key = `${ox}_${oy}`;
      if (obstacles.has(key)) {
        obstacles.delete(key);
        addLog(`[${clientId}] obstacle убран (${ox},${oy})`);
      } else {
        obstacles.add(key);
        addLog(`[${clientId}] obstacle поставлен (${ox},${oy})`);
      }
      break;
    }

    case 'mergeSwarm': {
      // Все дроны стягиваются к центру (5,5), перераспределяем профицит
      const alive = drones.filter(d => d.alive);
      if (alive.length === 0) break;
      const totalSurplus = alive.reduce((s, d) => s + d.surplus, 0);
      const share = totalSurplus / alive.length;
      for (const d of alive) {
        d.surplus = parseFloat(share.toFixed(2));
        d.x = 4 + Math.floor(Math.random() * 3);  // 4..6
        d.y = 4 + Math.floor(Math.random() * 3);
      }
      // Усилить все нити W-матрицы
      for (const key of Object.keys(wMatrix)) {
        wMatrix[key] = parseFloat((wMatrix[key] + 0.5).toFixed(3));
      }
      addLog(`[${clientId}] mergeSwarm — surplus=${share.toFixed(2)} каждому`);
      break;
    }

    case 'drain': {
      // Обнулить батарею у самого слабого живого дрона
      const alive = drones.filter(d => d.alive);
      if (alive.length === 0) break;
      const weakest = alive.reduce((w, d) => d.battery < w.battery ? d : w, alive[0]);
      weakest.battery = 0;
      weakest.alive = false;
      addLog(`[${clientId}] drain → ${weakest.name} истощён`);
      break;
    }

    default:
      addLog(`[${clientId}] неизвестная команда: ${cmd.cmd}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket сервер
// ─────────────────────────────────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`GiftOS WS Server — порт ${PORT}\ntick=${tick} drones=${drones.filter(d=>d.alive).length}/${drones.length}\n`);
});

const wss = new WebSocketServer({ server: httpServer });

let clientCounter = 0;
const clients = new Map();  // ws → {clientId, role}

function buildStateMsg() {
  return JSON.stringify({
    type:    'state',
    drones:  drones.map(d => ({ ...d })),
    wMatrix: { ...wMatrix },
    obstacles: [...obstacles],
    tick,
    log:     [...log],
  });
}

function broadcast(msg) {
  const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const [ws] of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

wss.on('connection', (ws, req) => {
  if (clients.size >= MAX_CLIENTS) {
    ws.send(JSON.stringify({ type: 'error', message: 'Максимум клиентов достигнут (8)' }));
    ws.close();
    return;
  }

  clientCounter++;
  const clientId = `obs${clientCounter}`;
  clients.set(ws, { clientId });

  console.log(`[+] ${clientId} подключён (${clients.size}/${MAX_CLIENTS}) ip=${req.socket.remoteAddress}`);

  // Приветствие
  ws.send(JSON.stringify({
    type:         'welcome',
    clientId,
    totalClients: clients.size,
    maxClients:   MAX_CLIENTS,
    roles:        ROLE_SYMBOLS,
  }));

  // Текущее состояние сразу
  ws.send(buildStateMsg());

  ws.on('message', (raw) => {
    let cmd;
    try { cmd = JSON.parse(raw.toString()); }
    catch { return; }

    if (cmd && typeof cmd.cmd === 'string') {
      handleCommand(cmd, clientId);
      // Немедленно разослать обновлённое состояние после команды
      broadcast(buildStateMsg());
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[-] ${clientId} отключён (${clients.size}/${MAX_CLIENTS})`);
    // Уведомить остальных
    broadcast({ type: 'info', message: `${clientId} покинул рой`, totalClients: clients.size });
  });

  ws.on('error', (err) => {
    console.error(`[!] ${clientId} ошибка: ${err.message}`);
    clients.delete(ws);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Главный цикл симуляции
// ─────────────────────────────────────────────────────────────────────────────

setInterval(() => {
  simulateTick();
  if (clients.size > 0) {
    broadcast(buildStateMsg());
  }
}, TICK_MS);

// Если все дроны погибли — перезапустить рой
setInterval(() => {
  if (drones.every(d => !d.alive)) {
    drones  = makeDrones();
    wMatrix = makeWMatrix(drones);
    obstacles.clear();
    addLog('Рой перерождён (все дроны погибли)');
    console.log('[~] Рой перезапущен');
    broadcast({ type: 'info', message: 'Рой перерождён', tick });
  }
}, 2000);

httpServer.listen(PORT, () => {
  console.log(`GiftOS WS Server запущен на порту ${PORT}`);
  console.log(`HTTP health: http://localhost:${PORT}/`);
  console.log(`WebSocket:   ws://localhost:${PORT}/`);
  console.log(`Дронов: ${drones.length} | Тик: ${TICK_MS}мс | Макс. клиентов: ${MAX_CLIENTS}`);
});
