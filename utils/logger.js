/**
 * utils/logger.js — автономный логгер для @unidel/gift
 *
 * Не зависит от pino, config/env.js или dronedoc инфраструктуры.
 * Простой console-логгер с уровнями.
 *
 * Совместим с pino API (logger.info, logger.warn, logger.child).
 */

const LEVEL = process.env.LOG_LEVEL || 'info';
const SILENT = process.env.DISABLE_LOGGING === 'true' || process.env.DISABLE_LOGGING === '1';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[LEVEL] ?? 1;

const PREFIXES = {
  debug: '\x1b[2m[debug]\x1b[0m',
  info:  '\x1b[36m[info]\x1b[0m ',
  warn:  '\x1b[33m[warn]\x1b[0m ',
  error: '\x1b[31m[error]\x1b[0m',
};

const fmt = (level, ...args) => {
  if (SILENT) return;
  if ((LEVELS[level] ?? 1) < currentLevel) return;
  const time = new Date().toISOString().slice(11, 23);
  const prefix = PREFIXES[level] || `[${level}]`;
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  console.log(`\x1b[2m${time}\x1b[0m ${prefix} ${msg}`);
};

const logger = {
  debug: (...args) => fmt('debug', ...args),
  info:  (...args) => fmt('info', ...args),
  warn:  (...args) => fmt('warn', ...args),
  error: (...args) => fmt('error', ...args),
  child: (_opts) => logger, // совместимость с pino
  level: LEVEL,
};

export default logger;
