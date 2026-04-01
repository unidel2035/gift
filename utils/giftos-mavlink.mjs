#!/usr/bin/env node
/**
 * giftos-mavlink.mjs — Мост: GiftOS surplus-роли → MAVLink команды полётному контроллеру
 *
 * W-матрица определяет surplus каждого дрона → роль → MAVLink команда.
 * Никакого командира. Соборная координация.
 *
 * Режимы:
 *   node utils/giftos-mavlink.mjs --sim              # UDP loopback 14550 (default)
 *   node utils/giftos-mavlink.mjs --serial /dev/ttyUSB0  # реальный FC
 *   node utils/giftos-mavlink.mjs --demo             # цикл по ролям каждые 3 сек
 *
 * Stdin (JSON Lines):
 *   {"drone":"Адам","role":"EXECUTOR","surplus":5}
 *   {"drone":"Ева","role":"RELAY","surplus":2}
 *
 * MAVLink v2 минимальный фрейм — без внешних зависимостей.
 */

import { createSocket } from 'node:dgram';
import { createInterface } from 'node:readline';

// ─────────────────────────────────────────────────────────────────────────────
// Аргументы
// ─────────────────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const SIM_MODE   = !args.includes('--serial');
const DEMO_MODE  = args.includes('--demo');
const SERIAL_DEV = args.includes('--serial') ? args[args.indexOf('--serial') + 1] : null;

const SIM_HOST   = '127.0.0.1';
const SIM_PORT   = 14550;

// ─────────────────────────────────────────────────────────────────────────────
// Цвета терминала
// ─────────────────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const MAGENTA= '\x1b[35m';
const RED    = '\x1b[31m';
const BLUE   = '\x1b[34m';
const WHITE  = '\x1b[37m';

// ─────────────────────────────────────────────────────────────────────────────
// MAVLink v2 — минимальная реализация без зависимостей
//
// Спецификация: https://mavlink.io/en/guide/serialization.html
//
// Фрейм v2:
//   0xFD        STX (1 byte)
//   len         payload length (1 byte)
//   incompat    incompatibility flags (1 byte, 0x00)
//   compat      compatibility flags (1 byte, 0x00)
//   seq         packet sequence (1 byte, 0..255)
//   sysid       system id (1 byte)
//   compid      component id (1 byte)
//   msgid[0..2] message id (3 bytes, LE)
//   payload     (len bytes)
//   crc[0..1]   CRC-16/MCRF4XX (2 bytes, LE) over header+payload
//               с seed-байтом MAVLINK_MSG_CRC из таблицы
// ─────────────────────────────────────────────────────────────────────────────

// MAVLink message IDs
const MSGID = {
  SET_MODE:          11,   // MAV_CMD_DO_SET_MODE внутри COMMAND_LONG или прямо SET_MODE
  COMMAND_LONG:      76,   // универсальная команда
  MISSION_ITEM_INT: 73,   // mission waypoint (int координаты)
};

// MAVLink MAV_MODE_FLAG + базовые режимы (APM/PX4)
// Custom mode числа для ArduCopter:
const COPTER_MODE = {
  STABILIZE: 0,
  GUIDED:    4,
  AUTO:      3,
  LOITER:    5,
  LAND:      9,
  CIRCLE:    7,
  RTL:       6,
};

// MAV_CMD
const MAV_CMD = {
  DO_SET_MODE:      176,
  DO_CHANGE_SPEED:  178,
  NAV_WAYPOINT:     16,
  NAV_LOITER_UNLIM: 17,
  NAV_RETURN_TO_LAUNCH: 20,
  NAV_LAND:         21,
};

// CRC extra bytes (MAVLINK_MSG_CRC) для каждого msgid
// Получены из исходников mavlink/c_library_v2
const CRC_EXTRA = {
  11:  89,  // SET_MODE
  76: 152,  // COMMAND_LONG
  73: 38,   // MISSION_ITEM_INT
};

let _seq = 0;

/**
 * CRC-16/MCRF4XX — стандарт MAVLink
 * Polynomial: 0x1021, init: 0xFFFF, no reflect, no final XOR
 */
function crc16_mcrf4xx(buf, crcExtra) {
  let crc = 0xFFFF;
  const update = (b) => {
    let tmp = b ^ (crc & 0xFF);
    tmp = (tmp ^ (tmp << 4)) & 0xFF;
    crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xFFFF;
  };
  for (const b of buf) update(b);
  update(crcExtra);
  return crc;
}

/**
 * Построить MAVLink v2 фрейм.
 * @param {number} msgId   - message ID
 * @param {Buffer} payload - payload bytes
 * @param {number} sysId   - system ID (1 = GCS, 1..255)
 * @param {number} compId  - component ID
 * @returns {Buffer}
 */
function buildFrame(msgId, payload, sysId = 1, compId = 1) {
  const seq   = _seq++ & 0xFF;
  const len   = payload.length;

  // Header (для CRC считается от len до конца msgid включительно)
  const header = Buffer.alloc(9);
  header[0] = 0xFD;       // STX
  header[1] = len;        // payload len
  header[2] = 0x00;       // incompat flags
  header[3] = 0x00;       // compat flags
  header[4] = seq;        // sequence
  header[5] = sysId;      // sysid
  header[6] = compId;     // compid
  header[7] = msgId & 0xFF;           // msgid byte 0
  header[8] = (msgId >> 8) & 0xFF;    // msgid byte 1
  // msgid byte 2 needs to be in crc input but stored separately
  const msgidByte2 = (msgId >> 16) & 0xFF;

  // CRC input: bytes 1..8 of header (len,incompat,compat,seq,sysid,compid,msgid[0],msgid[1])
  //            + msgid byte 2 + payload
  const crcInput = Buffer.concat([
    header.slice(1),            // bytes 1-8
    Buffer.from([msgidByte2]),  // msgid byte 2
    payload,
  ]);

  const extra = CRC_EXTRA[msgId] ?? 0;
  const crc   = crc16_mcrf4xx(crcInput, extra);

  const crcBuf = Buffer.alloc(2);
  crcBuf[0] = crc & 0xFF;
  crcBuf[1] = (crc >> 8) & 0xFF;

  // Full frame: STX + header[1..8] + msgidByte2 + payload + crc
  return Buffer.concat([
    header,
    Buffer.from([msgidByte2]),
    payload,
    crcBuf,
  ]);
}

/**
 * COMMAND_LONG payload (28 bytes)
 * uint8 target_system, uint8 target_component,
 * uint16 command, uint8 confirmation,
 * float param1..param7
 */
function commandLong(targetSys, targetComp, command, confirmation, ...params) {
  const p = [...params];
  while (p.length < 7) p.push(0);
  const buf = Buffer.alloc(33);
  let off = 0;
  // param1..7 as float32 LE
  for (let i = 0; i < 7; i++) {
    buf.writeFloatLE(p[i], off);
    off += 4;
  }
  buf.writeUInt16LE(command, off);  off += 2;
  buf[off++] = targetSys;
  buf[off++] = targetComp;
  buf[off++] = confirmation;
  return buf.slice(0, off);
}

/**
 * SET_MODE payload (6 bytes)
 * uint8 target_system, uint32 custom_mode, uint8 base_mode
 */
function setModePayload(targetSys, customMode, baseMode = 0b10010001) {
  // baseMode 0b10010001 = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED | GUIDED base
  const buf = Buffer.alloc(6);
  buf.writeUInt32LE(customMode, 0);
  buf[4] = targetSys;
  buf[5] = baseMode;
  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// Роли GiftOS → пакеты MAVLink
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_COLOR = {
  EXECUTOR: GREEN,
  RELAY:    CYAN,
  SCOUT:    YELLOW,
  GUARDIAN: MAGENTA,
  RESTING:  DIM,
};

const ROLE_ICON = {
  EXECUTOR: '★',
  RELAY:    '◉',
  SCOUT:    '▲',
  GUARDIAN: '◆',
  RESTING:  '·',
};

const THEOLOGICAL_NOTE = {
  EXECUTOR: 'Дар движения: энергия κένωσις в действии',
  RELAY:    'Дар присутствия: стояние — тоже служение',
  SCOUT:    'Дар вопрошания: разведка как θεωρία',
  GUARDIAN: 'Дар стражи: любовь ограждает κοινόν',
  RESTING:  'Дар субботы: покой как причастие исходному',
};

/**
 * Вернуть массив MAVLink фреймов для заданной роли.
 * targetSys = 1 по умолчанию (один дрон или broadcast).
 */
function roleToFrames(role, targetSys = 1) {
  const frames = [];

  switch (role) {
    case 'EXECUTOR': {
      // 1. SET_MODE → GUIDED
      frames.push({
        label: 'SET_MODE → GUIDED',
        frame: buildFrame(
          MSGID.SET_MODE,
          setModePayload(targetSys, COPTER_MODE.GUIDED),
          1, 1
        ),
      });
      // 2. DO_CHANGE_SPEED → 10 m/s (airspeed, speed type 0)
      frames.push({
        label: 'DO_CHANGE_SPEED → 10 m/s',
        frame: buildFrame(
          MSGID.COMMAND_LONG,
          commandLong(targetSys, 1, MAV_CMD.DO_CHANGE_SPEED, 0,
            0,    // speed type: 0=airspeed
            10,   // speed m/s
            -1,   // throttle -1 = no change
            0, 0, 0, 0
          ),
          1, 1
        ),
      });
      // 3. NAV_WAYPOINT к цели (пример: 55.7558° N, 37.6173° E, alt 50m)
      frames.push({
        label: 'NAV_WAYPOINT mission target',
        frame: buildFrame(
          MSGID.COMMAND_LONG,
          commandLong(targetSys, 1, MAV_CMD.NAV_WAYPOINT, 0,
            0,          // hold time
            2,          // accept radius
            0,          // pass radius
            0,          // yaw (NaN = keep current)
            55.7558,    // lat (example)
            37.6173,    // lon
            50          // altitude
          ),
          1, 1
        ),
      });
      break;
    }

    case 'RELAY': {
      // SET_MODE → LOITER (hold position)
      frames.push({
        label: 'SET_MODE → LOITER (hold position)',
        frame: buildFrame(
          MSGID.SET_MODE,
          setModePayload(targetSys, COPTER_MODE.LOITER),
          1, 1
        ),
      });
      break;
    }

    case 'SCOUT': {
      // SET_MODE → AUTO (search pattern, waypoints pre-loaded)
      frames.push({
        label: 'SET_MODE → AUTO (search pattern)',
        frame: buildFrame(
          MSGID.SET_MODE,
          setModePayload(targetSys, COPTER_MODE.AUTO),
          1, 1
        ),
      });
      // Рекомендуется загрузить mission waypoints отдельно;
      // здесь шлём LOITER_UNLIM как fallback если миссия не загружена
      frames.push({
        label: 'NAV_LOITER_UNLIM (scout fallback)',
        frame: buildFrame(
          MSGID.COMMAND_LONG,
          commandLong(targetSys, 1, MAV_CMD.NAV_LOITER_UNLIM, 0,
            0, 0, 0, 0, 0, 0, 50
          ),
          1, 1
        ),
      });
      break;
    }

    case 'GUARDIAN': {
      // SET_MODE → CIRCLE (orbit perimeter)
      frames.push({
        label: 'SET_MODE → CIRCLE (orbit perimeter)',
        frame: buildFrame(
          MSGID.SET_MODE,
          setModePayload(targetSys, COPTER_MODE.CIRCLE),
          1, 1
        ),
      });
      break;
    }

    case 'RESTING': {
      // SET_MODE → LAND
      frames.push({
        label: 'SET_MODE → LAND',
        frame: buildFrame(
          MSGID.SET_MODE,
          setModePayload(targetSys, COPTER_MODE.LAND),
          1, 1
        ),
      });
      break;
    }

    default:
      console.warn(`${RED}Неизвестная роль: ${role}${RESET}`);
  }

  return frames;
}

// ─────────────────────────────────────────────────────────────────────────────
// Транспорт: UDP (sim) или Serial
// ─────────────────────────────────────────────────────────────────────────────

class UDPTransport {
  constructor() {
    this.socket = createSocket('udp4');
    this.socket.bind(0); // ephemeral port for sending
    this._rxSocket = null;
  }

  /** Запустить listener на SIM_PORT для наглядности */
  startListener() {
    this._rxSocket = createSocket('udp4');
    this._rxSocket.on('message', (msg, rinfo) => {
      // В sim-режиме просто логируем что получили
      process.stdout.write(
        `${DIM}  [UDP RX ← ${rinfo.address}:${rinfo.port}] ${msg.length} bytes${RESET}\n`
      );
    });
    this._rxSocket.bind(SIM_PORT, SIM_HOST, () => {
      console.log(`${DIM}  UDP listener on ${SIM_HOST}:${SIM_PORT}${RESET}`);
    });
    this._rxSocket.on('error', () => {}); // port busy = ignore
  }

  send(buf) {
    return new Promise((resolve) => {
      this.socket.send(buf, SIM_PORT, SIM_HOST, (err) => {
        if (err) console.error(`${RED}UDP send error: ${err.message}${RESET}`);
        resolve();
      });
    });
  }

  close() {
    this.socket.close();
    if (this._rxSocket) {
      try { this._rxSocket.close(); } catch (_) {}
    }
  }
}

class SerialTransport {
  constructor(device) {
    this.device = device;
    this.fd     = null;
    // Используем fs синхронные методы — без npm зависимостей
    // Для реального использования рекомендуется установить serialport:
    //   npm install serialport
    // Здесь — минимальная запись через /dev/ttyUSBx напрямую
    import('node:fs').then(({ openSync }) => {
      try {
        this.fd = openSync(this.device, 'r+');
        console.log(`${GREEN}Serial: открыт ${this.device}${RESET}`);
      } catch (e) {
        console.error(`${RED}Serial: не удалось открыть ${this.device}: ${e.message}${RESET}`);
        console.error(`${YELLOW}Подсказка: попробуйте --sim для симуляции${RESET}`);
        process.exit(1);
      }
    });
  }

  async send(buf) {
    const { writeSync } = await import('node:fs');
    if (this.fd === null) {
      console.warn(`${YELLOW}Serial: fd не готов, пропускаю отправку${RESET}`);
      return;
    }
    try {
      writeSync(this.fd, buf);
    } catch (e) {
      console.error(`${RED}Serial write error: ${e.message}${RESET}`);
    }
  }

  async close() {
    if (this.fd !== null) {
      const { closeSync } = await import('node:fs');
      try { closeSync(this.fd); } catch (_) {}
      this.fd = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Логирование команды
// ─────────────────────────────────────────────────────────────────────────────

function logCommand(drone, role, surplus, frameLabel, frameBytes) {
  const color = ROLE_COLOR[role] ?? WHITE;
  const icon  = ROLE_ICON[role]  ?? '?';
  const note  = THEOLOGICAL_NOTE[role] ?? '';
  const ts    = new Date().toISOString().slice(11, 23);

  console.log(
    `\n${BOLD}[${ts}] ${color}${icon} ${drone}${RESET}` +
    `  surplus=${BOLD}${surplus}${RESET}` +
    `  роль=${color}${role}${RESET}`
  );
  console.log(`  ${CYAN}↳ MAVLink: ${frameLabel}${RESET}`);
  console.log(`  ${DIM}${note}${RESET}`);

  if (SIM_MODE) {
    // В sim-режиме показываем hex дампа фрейма
    const hex = frameBytes.toString('hex').match(/.{1,2}/g).join(' ');
    console.log(`  ${DIM}frame(${frameBytes.length}B): ${hex}${RESET}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Основная обработка
// ─────────────────────────────────────────────────────────────────────────────

async function processRole(transport, entry) {
  const { drone = 'unknown', role, surplus = 0, sysid = 1 } = entry;

  if (!role) {
    console.warn(`${YELLOW}Пропущен: нет поля role${RESET}`);
    return;
  }

  const frames = roleToFrames(role.toUpperCase(), sysid);

  if (frames.length === 0) return;

  for (const { label, frame } of frames) {
    logCommand(drone, role.toUpperCase(), surplus, label, frame);
    await transport.send(frame);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo mode — цикл по ролям каждые 3 секунды
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_SEQUENCE = [
  { drone: 'Адам',   role: 'EXECUTOR', surplus: 7 },
  { drone: 'Ева',    role: 'RELAY',    surplus: 3 },
  { drone: 'Авраам', role: 'SCOUT',    surplus: 5 },
  { drone: 'Давид',  role: 'GUARDIAN', surplus: 4 },
  { drone: 'Иов',    role: 'RESTING',  surplus: 1 },
];

async function runDemo(transport) {
  console.log(`\n${BOLD}${YELLOW}═══ GiftOS MAVLink Bridge — DEMO MODE ═══${RESET}`);
  console.log(`${DIM}Цикл по ролям каждые 3 сек. Ctrl+C для выхода.${RESET}\n`);

  let i = 0;
  const tick = async () => {
    const entry = DEMO_SEQUENCE[i % DEMO_SEQUENCE.length];
    await processRole(transport, entry);
    i++;
    setTimeout(tick, 3000);
  };
  await tick();
}

// ─────────────────────────────────────────────────────────────────────────────
// Stdin JSON Lines mode
// ─────────────────────────────────────────────────────────────────────────────

async function runStdin(transport) {
  console.log(`\n${BOLD}${CYAN}═══ GiftOS MAVLink Bridge — STDIN MODE ═══${RESET}`);
  console.log(`${DIM}Читаю JSON Lines: {"drone":"Адам","role":"EXECUTOR","surplus":5}${RESET}\n`);

  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      const entry = JSON.parse(trimmed);
      await processRole(transport, entry);
    } catch (e) {
      console.warn(`${YELLOW}Ошибка парсинга JSON: ${e.message}${RESET}`);
      console.warn(`${DIM}Строка: ${trimmed}${RESET}`);
    }
  }

  console.log(`\n${DIM}EOF — stdin закрыт.${RESET}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Точка входа
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // ── Заголовок ──
  console.log(`${BOLD}${BLUE}`);
  console.log('  ┌─────────────────────────────────────────────────┐');
  console.log('  │   GiftOS MAVLink Bridge  v1.0                   │');
  console.log('  │   W-матрица surplus → роль → полётный контроллер│');
  console.log('  │   Κοινόν τοῦ Νοῦ — соборность без командира     │');
  console.log('  └─────────────────────────────────────────────────┘');
  console.log(`${RESET}`);

  // ── Транспорт ──
  let transport;

  if (SIM_MODE) {
    console.log(`${GREEN}Режим: UDP SIM → ${SIM_HOST}:${SIM_PORT}${RESET}`);
    transport = new UDPTransport();
    transport.startListener();
  } else {
    console.log(`${GREEN}Режим: Serial → ${SERIAL_DEV}${RESET}`);
    transport = new SerialTransport(SERIAL_DEV);
  }

  // ── Обработка сигналов ──
  const shutdown = () => {
    console.log(`\n${DIM}Закрываю транспорт...${RESET}`);
    transport.close();
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  // ── Режим работы ──
  if (DEMO_MODE) {
    await runDemo(transport);
  } else {
    // Если stdin — TTY (интерактивный терминал), запускаем demo
    if (process.stdin.isTTY) {
      console.log(`${YELLOW}stdin — терминал. Запускаю --demo режим.${RESET}`);
      console.log(`${DIM}Подсказка: echo '{"drone":"Адам","role":"EXECUTOR","surplus":5}' | node utils/giftos-mavlink.mjs --sim${RESET}\n`);
      await runDemo(transport);
    } else {
      await runStdin(transport);
      shutdown();
    }
  }
}

main().catch((e) => {
  console.error(`${RED}Критическая ошибка: ${e.message}${RESET}`);
  console.error(e.stack);
  process.exit(1);
});
