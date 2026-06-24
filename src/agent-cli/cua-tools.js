/**
 * cua-tools.js — десктоп-автоматизация через cua-driver (внешний MCP-сервер).
 *
 * cua-driver (trycua/cua, MIT) даёт агенту «руки и глаза» на ДЕСКТОПЕ:
 * launch_app / click / type_text / get_window_state (UIA) / list_windows и др.
 * Это десктопный аналог уже подключённого playwright (браузер).
 *
 * Архитектура на этой машине: gift живёт в WSL, а GUI — на Windows. Бинарь
 * cua-driver.exe запускается из WSL через interop и управляет Windows-десктопом
 * (проверено: MCP-рукопожатие и реальные действия идут через границу WSL↔Windows).
 *
 * Включение — ОПТ-ИН (десктоп-контроль мощный и необратимый):
 *   GIFT_CUA=1                  — включить
 *   CUA_DRIVER_BIN=/path/exe    — переопределить путь к бинарю
 * Иначе buildCuaMcpServer() возвращает {} и ничего не меняется.
 */

import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Путь по умолчанию: Windows-бинарь, видимый из WSL через interop.
const DEFAULT_WIN_BIN =
  '/mnt/c/Users/unide/AppData/Local/Programs/Cua/cua-driver/bin/cua-driver.exe';

/** Включён ли cua (GIFT_CUA=1|true). */
export function cuaEnabled() {
  const v = (process.env.GIFT_CUA ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Найти исполняемый cua-driver. Порядок:
 *   CUA_DRIVER_BIN → Windows interop-путь → `which cua-driver` (нативный Linux).
 * @returns {string|null}
 */
export function findCuaBin() {
  if (process.env.CUA_DRIVER_BIN && existsSync(process.env.CUA_DRIVER_BIN)) {
    return process.env.CUA_DRIVER_BIN;
  }
  if (existsSync(DEFAULT_WIN_BIN)) return DEFAULT_WIN_BIN;
  try {
    const p = execSync('which cua-driver', { encoding: 'utf8' }).trim();
    if (p && existsSync(p)) return p;
  } catch {}
  return null;
}

/**
 * Уже ли cua сконфигурирован вне проекта — в ~/.claude.json или ./.mcp.json?
 * SDK наследует эти конфиги, поэтому если cua там есть (напр. глобальный
 * cua-computer-use), свой сервер не поднимаем, чтобы не дублировать 38 тулзов.
 * Признак: ключ сервера содержит "cua" ИЛИ его command указывает на cua-driver.
 * @returns {boolean}
 */
export function cuaAlreadyConfigured() {
  const files = [join(homedir(), '.claude.json'), join(process.cwd(), '.mcp.json')];
  for (const f of files) {
    try {
      if (!existsSync(f)) continue;
      const servers = JSON.parse(readFileSync(f, 'utf8'))?.mcpServers ?? {};
      for (const [name, cfg] of Object.entries(servers)) {
        const cmd = String(cfg?.command ?? '');
        if (/cua/i.test(name) || /cua-driver/i.test(cmd)) return true;
      }
    } catch {}
  }
  return false;
}

/**
 * Конфиг внешнего stdio-MCP сервера cua для query({ options.mcpServers }).
 * Пусто, если cua выключен, бинарь не найден, или cua уже есть в наследуемом
 * конфиге (тогда агент пользуется им; allow-лист покрывает оба имени).
 * @returns {{ cua: { type:'stdio', command:string, args:string[] } } | {}}
 */
export function buildCuaMcpServer() {
  if (!cuaEnabled()) return {};
  if (cuaAlreadyConfigured()) {
    console.error('\x1b[2m[gift-agent] cua уже сконфигурирован глобально/в проекте — свой сервер не добавляю\x1b[0m');
    return {};
  }
  const bin = findCuaBin();
  if (!bin) {
    console.error(
      '\x1b[33m[gift-agent] GIFT_CUA=1, но cua-driver не найден — поставь драйвер или задай CUA_DRIVER_BIN\x1b[0m'
    );
    return {};
  }
  return { cua: { type: 'stdio', command: bin, args: ['mcp'] } };
}

// Разрешить инструменты cua. Покрываем оба имени: наш проектный сервер (cua)
// и стандартный глобальный (cua-computer-use) — какой бы ни оказался активным.
export const CUA_TOOL_ALLOW = ['mcp__cua', 'mcp__cua-computer-use'];

// Короткая подсказка агенту: как правильно работать с десктопом.
export const CUA_SYSTEM_HINT = [
  'ДЕСКТОП (cua): у тебя есть инструменты mcp__cua__* для управления GUI Windows.',
  'Рабочий цикл: launch_app → list_windows (найти pid+window_id) →',
  'get_window_state(pid, window_id) для element_index → click/type_text по element_index →',
  'снова get_window_state для проверки результата. Предпочитай element_index пиксельным',
  'координатам — он работает по фоновым/свёрнутым окнам и не крадёт фокус.',
].join(' ');
