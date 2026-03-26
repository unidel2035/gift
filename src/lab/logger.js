/**
 * Lab Logger — унифицированное логирование исследовательской среды
 *
 * Выводит: время, модуль, уровень, сообщение.
 * Уровни: section / info / warn / error / event / trit / gift
 *
 * Не заменяет utils/logger.js — дополняет его для lab-среды.
 */

const RESET  = '\x1b[0m';
const DIM    = '\x1b[2m';
const BOLD   = '\x1b[1m';

const COLORS = {
  section:  '\x1b[35m', // magenta
  info:     '\x1b[36m', // cyan
  warn:     '\x1b[33m', // yellow
  error:    '\x1b[31m', // red
  event:    '\x1b[32m', // green
  trit:     '\x1b[34m', // blue
  gift:     '\x1b[37m', // white
};

const ICONS = {
  section:  '═══',
  info:     ' · ',
  warn:     ' ⚠ ',
  error:    ' ✗ ',
  event:    ' ◈ ',
  trit:     ' ⊕ ',
  gift:     ' ⟶ ',
};

/**
 * Создать логгер для модуля.
 * @param {string} module — имя модуля (lab, liturgical, oikos, etc.)
 */
export function createLabLogger(module) {
  const prefix = `${DIM}[${module}]${RESET}`;

  const log = (level, ...args) => {
    const color = COLORS[level] || '';
    const icon = ICONS[level] || ' ? ';
    const time = new Date().toISOString().slice(11, 23);
    const msg = args.map(a =>
      typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
    ).join(' ');
    console.log(`${DIM}${time}${RESET} ${prefix} ${color}${icon}${RESET} ${msg}`);
  };

  return {
    section: (...args) => {
      const line = '═'.repeat(60);
      console.log(`\n${COLORS.section}${BOLD}${line}${RESET}`);
      console.log(`${COLORS.section}${BOLD}  ${args.join(' ')}${RESET}`);
      console.log(`${COLORS.section}${BOLD}${line}${RESET}\n`);
    },
    info:    (...args) => log('info', ...args),
    warn:    (...args) => log('warn', ...args),
    error:   (...args) => log('error', ...args),
    event:   (...args) => log('event', ...args),
    trit:    (...args) => log('trit', ...args),
    gift:    (...args) => log('gift', ...args),

    /** Напечатать состояние трайта */
    tryte: (label, tryte) => {
      const r = typeof tryte.toString === 'function' ? tryte.toString() : JSON.stringify(tryte);
      log('trit', `${label}: ${r}`);
    },

    /** Напечатать результат GiftAct */
    giftResult: (result) => {
      const status = result.accepted ? '✓ принят' : result.wound ? '✗ отклонён' : '… ожидание';
      log('gift', `${result.scale} | ${status} | cost=${result.cost} | gratitude=${result.gratitude}`);
      if (result.apophatic) log('info', `апофасис: ${result.apophatic}`);
    },

    /** Напечатать гармонию логосов */
    harmony: (h) => {
      log('info', `λόγοι: всего=${h.total} κατὰ=${h.kataPhysin} παρὰ=${h.paraPhysin} ὑπὲρ=${h.hyperPhysin}`);
      for (const obs of (h.observations || [])) log('info', `  ${obs}`);
    },
  };
}

export default createLabLogger;
