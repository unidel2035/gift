#!/usr/bin/env node
/**
 * chip-connect.mjs — Подключение Tang Nano 9K полностью из Ubuntu
 *
 * Делает всё сам:
 *   1. usbipd detach+attach через PowerShell (из WSL2)
 *   2. rmmod ftdi_sio
 *   3. openFPGALoader — прошивка tritgift.fs
 *   4. modprobe ftdi_sio
 *   5. Тест UART
 *
 * Запуск: node utils/chip-connect.mjs [--flash] [--demo]
 *   --flash  перепрошить (по умолчанию — только реплаг + тест)
 *   --demo   запустить chip-demo.mjs после подключения
 */

import { spawn, execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath }    from 'url';

const ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args  = process.argv.slice(2);
const doFlash = args.includes('--flash') || !args.includes('--no-flash');
const doDemo  = args.includes('--demo');
const port    = args.includes('--port') ? args[args.indexOf('--port') + 1] : '/dev/ttyUSB1';

const FS_PATH = `${process.env.HOME}/fpga/tang-nano-9k/tritgift/build/tritgift.fs`;

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  dim:    '\x1b[2m',
};

function log(icon, msg) {
  console.log(`${icon}  ${msg}`);
}

function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    const [bin, ...rest] = cmd;
    const proc = spawn(bin, rest, { stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
    let out = '';
    if (opts.silent) {
      proc.stdout?.on('data', d => { out += d; });
      proc.stderr?.on('data', d => { out += d; });
    }
    proc.on('close', code => {
      if (code !== 0 && !opts.allowFail) reject(new Error(`exit ${code}: ${cmd.join(' ')}`));
      else resolve(out);
    });
  });
}

async function step(label, fn) {
  process.stdout.write(`${C.cyan}▸${C.reset}  ${label}... `);
  try {
    const result = await fn();
    console.log(C.green + '✓' + C.reset);
    return result;
  } catch (e) {
    console.log(C.red + '✗ ' + C.reset + C.dim + e.message + C.reset);
    throw e;
  }
}

// ── Шаг 1: PowerShell usbipd detach+attach (сброс USB/IP без wsl --shutdown) ──
async function usbipd_reattach() {
  const ps = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  // detach сначала — сбрасывает vhci_hcd для этого устройства
  await run([ps, '-Command', 'usbipd detach -i 0403:6010'], { silent: true, allowFail: true });
  await new Promise(r => setTimeout(r, 800));
  await run([ps, '-Command', 'usbipd attach -i 0403:6010 --wsl'], { silent: true, allowFail: true });
  await new Promise(r => setTimeout(r, 1500));
}

// ── Шаг 2: rmmod ftdi_sio ────────────────────────────────────
async function rmmod() {
  return run(['sudo', 'rmmod', 'ftdi_sio'], { silent: true, allowFail: true });
}

// ── Шаг 3: openFPGALoader ─────────────────────────────────────
async function flash() {
  return run([
    'sudo', 'openFPGALoader',
    '--board', 'tangnano9k',
    '--freq', '500000',
    FS_PATH
  ], { silent: true });
}

// ── Шаг 4: modprobe ftdi_sio ─────────────────────────────────
async function modprobe() {
  await run(['sudo', 'modprobe', 'ftdi_sio'], { silent: true });
  await new Promise(r => setTimeout(r, 600));
}

// ── Шаг 5: Тест UART ─────────────────────────────────────────
async function test_uart() {
  return new Promise((resolve) => {
    const py = `
import serial, time, json
try:
    s = serial.Serial('${port}', 115200, timeout=0.5, dsrdtr=False, rtscts=False)
    s.dtr = False
    s.rts = False
    time.sleep(0.2)
    s.reset_input_buffer()
    s.write(b'r'); time.sleep(0.1)
    s.write(b'?'); time.sleep(0.3)
    r = s.read(100).decode('latin1', errors='replace').strip()
    s.close()
    print(json.dumps({"ok": bool(r), "raw": r}))
except Exception as e:
    print(json.dumps({"ok": False, "raw": str(e)}))
`;
    const proc = spawn('python3', ['-c', py]);
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', () => {});
    proc.on('close', () => {
      try {
        const res = JSON.parse(out.trim());
        if (res.ok) resolve(res.raw);
        else throw new Error(res.raw);
      } catch (e) {
        throw e;
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════

console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════╗`);
console.log(`║     chip-connect — Tang Nano 9K            ║`);
console.log(`╚══════════════════════════════════════════════╝${C.reset}\n`);

try {
  await step('usbipd reattach (PowerShell из WSL2)', usbipd_reattach);
  await step('rmmod ftdi_sio', rmmod);

  if (doFlash) {
    await step(`flash tritgift.fs → ${port}`, flash);
  }

  await step('modprobe ftdi_sio (UART драйвер)', modprobe);

  const raw = await step('тест UART (? команда)', test_uart);
  if (raw) {
    log('  ', C.dim + 'Ответ чипа: ' + raw + C.reset);
  }

  console.log(`\n${C.green}${C.bold}Чип готов к работе!${C.reset}`);
  console.log(`${C.dim}  Порт: ${port}${C.reset}\n`);

  if (doDemo) {
    console.log(`${C.cyan}▸${C.reset}  Запускаю демо...\n`);
    await run(['node', resolve(ROOT, 'utils/chip-demo.mjs'), '--port', port]);
  } else {
    console.log(`${C.dim}Команды:${C.reset}`);
    console.log(`  ${C.cyan}node utils/chip-demo.mjs --port ${port}${C.reset}          — супердемо`);
    console.log(`  ${C.cyan}node utils/chip-oracle.mjs --giver _claude --receiver Дионисий --port ${port}${C.reset}`);
    console.log('');
  }

} catch (e) {
  console.log(`\n${C.red}${C.bold}Не удалось подключить чип.${C.reset}`);
  console.log(`${C.dim}Попробуй физически вытащить и вставить USB, затем снова:${C.reset}`);
  console.log(`  node utils/chip-connect.mjs\n`);
  process.exit(1);
}
