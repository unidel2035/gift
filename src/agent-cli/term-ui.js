/**
 * term-ui.js — terminal UI на raw stdin для gift chat.
 *
 * Заменяет readline для случая, когда нужны всплывающие меню в момент
 * нажатия клавиши (как `/` в Claude Code). readline в child process
 * (через runRaw) не позволяет надёжно перехватывать keypress до обновления
 * line-буфера, поэтому мы управляем stdin сами.
 *
 * Поддерживает:
 *   - печать символов (включая UTF-8: русский, греческий)
 *   - Backspace
 *   - Enter → коллбэк onLine(текст)
 *   - Ctrl+C, Ctrl+D → onClose
 *   - меню slash-команд при '/' в начале строки (фильтруется по префиксу)
 *   - TAB → если ровно одно совпадение в меню, дополняет
 *   - стрелки/escape — игнорируются (нет history; добавим если нужно)
 *
 * Контракт со streaming-кодом: перед assistant output вызвать ui.release()
 * (стирает меню и prompt), после — ui.resume() (рисует prompt заново).
 */

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan:  '\x1b[36m', gold: '\x1b[33m',
};
const c = (col, s) => `${C[col]}${s}${C.reset}`;

const CLEAR_LINE   = '\x1b[2K';
const CLEAR_BELOW  = '\x1b[J';
const SAVE_CURSOR  = '\x1b7';
const RESTORE_CURS = '\x1b8';

export class TermUI {
  /**
   * @param {{
   *   prompt: string,                                // строка prompt'а (с цветами)
   *   slashCommands: Array<{cmd:string, desc:string}>,
   *   onLine:  (text:string) => void|Promise<void>,
   *   onClose: () => void,
   * }} opts
   */
  constructor(opts) {
    this.promptStr     = opts.prompt;
    this.slashCommands = opts.slashCommands;
    this.onLine        = opts.onLine;
    this.onClose       = opts.onClose;

    this.buffer       = '';
    this.menuRowsDrawn = 0;
    this.released     = false;
    this._dataHandler = this._onData.bind(this);
  }

  start() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', this._dataHandler);
    this._renderPrompt();
  }

  stop() {
    this._eraseMenu();
    process.stdin.removeListener('data', this._dataHandler);
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch {}
    }
    process.stdin.pause();
  }

  /**
   * Освободить экран перед потоком assistant output.
   * Стирает меню и текущий prompt, ставит курсор в начало новой строки.
   */
  release() {
    this._eraseMenu();
    process.stdout.write('\r' + CLEAR_LINE);
    this.released = true;
  }

  /**
   * Восстановить prompt после assistant output.
   * Сбрасывает буфер (turn окончен).
   */
  resume() {
    this.buffer = '';
    this.released = false;
    process.stdout.write('\n');
    this._renderPrompt();
  }

  // ── рендер ──────────────────────────────────────────────────────────
  // Стратегия: каждый _renderPrompt() — атомарная отрисовка с ноля.
  //   1. Стираем старое меню (если было) — идём ниже, чистим N строк, возврат
  //   2. Пишем текущий prompt + buffer на текущей строке
  //   3. Если буфер начинается с '/' — рисуем меню под prompt (cursor возвращаем)
  _renderPrompt() {
    // 1) erase old menu
    if (this.menuRowsDrawn > 0) {
      process.stdout.write(SAVE_CURSOR);
      for (let i = 0; i < this.menuRowsDrawn; i++) {
        process.stdout.write('\n' + CLEAR_LINE);
      }
      process.stdout.write(RESTORE_CURS);
      this.menuRowsDrawn = 0;
    }
    // 2) prompt + buffer
    process.stdout.write('\r' + CLEAR_LINE + this.promptStr + this.buffer);
    // 3) menu (под prompt)
    if (this.buffer.startsWith('/')) {
      this._drawMenu();
    }
  }

  _drawMenu() {
    const matches = this._filterMenu();
    process.stdout.write(SAVE_CURSOR);
    let rows = 0;
    if (matches.length) {
      const widthCmd = Math.max(...this.slashCommands.map(s => s.cmd.length)) + 2;
      for (const item of matches) {
        process.stdout.write('\n' + c('cyan', '  ' + item.cmd.padEnd(widthCmd))
                                  + c('dim', '— ' + item.desc));
        rows++;
      }
    } else {
      process.stdout.write('\n' + c('dim', '  (нет совпадений)'));
      rows = 1;
    }
    this.menuRowsDrawn = rows;
    process.stdout.write(RESTORE_CURS);
  }

  _eraseMenu() {
    if (this.menuRowsDrawn === 0) return;
    process.stdout.write(SAVE_CURSOR);
    for (let i = 0; i < this.menuRowsDrawn; i++) {
      process.stdout.write('\n' + CLEAR_LINE);
    }
    process.stdout.write(RESTORE_CURS);
    this.menuRowsDrawn = 0;
  }

  _filterMenu() {
    return this.slashCommands.filter(item => item.cmd.startsWith(this.buffer));
  }

  // ── input handling ──────────────────────────────────────────────────
  _onData(chunk) {
    // chunk может быть строкой (мы установили UTF-8 encoding) или Buffer
    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    // Многобайтовые символы — итерируем по code points
    let i = 0;
    while (i < str.length) {
      const ch = String.fromCodePoint(str.codePointAt(i));
      this._handleChar(ch, str, i);
      i += ch.length;
    }
  }

  _handleChar(ch, full, idx) {
    if (this.released) {
      // Игнорируем ввод во время assistant output (попадёт в input после resume)
      return;
    }

    const code = ch.codePointAt(0);

    // Enter
    if (ch === '\r' || ch === '\n') {
      this._eraseMenu();
      const line = this.buffer;
      this.buffer = '';
      process.stdout.write('\r\n');
      Promise.resolve(this.onLine(line)).catch(e => {
        process.stdout.write('\x1b[31merror: ' + (e?.message || e) + '\x1b[0m\n');
        this._renderPrompt();
      });
      return;
    }

    // Backspace
    if (code === 127 || code === 8) {
      if (this.buffer.length > 0) {
        // Удаляем последний code point (UTF-8 safe)
        const arr = [...this.buffer];
        arr.pop();
        this.buffer = arr.join('');
        this._renderPrompt();
        if (this.buffer === '' || !this.buffer.startsWith('/')) {
          this._eraseMenu();
          this._renderPrompt();
        }
      }
      return;
    }

    // Ctrl+C
    if (code === 3) {
      process.stdout.write('^C\r\n');
      this.onClose?.();
      return;
    }

    // Ctrl+D — EOF при пустом буфере
    if (code === 4) {
      if (this.buffer === '') {
        process.stdout.write('\r\n');
        this.onClose?.();
      }
      return;
    }

    // ESC sequence — пропустим всю последовательность (стрелки/функ. клавиши)
    if (code === 27) {
      // Если это start of escape sequence (например \x1b[A — стрелка вверх),
      // в chunk обычно идёт ещё несколько символов. Просто игнорируем — они
      // обработаются как ничего (low ASCII < 32 → return ниже).
      return;
    }

    // TAB — single-completion если ровно одно совпадение
    if (ch === '\t') {
      if (this.buffer.startsWith('/')) {
        const matches = this._filterMenu();
        if (matches.length === 1) {
          this.buffer = matches[0].cmd + (matches[0].needsArg ? ' ' : '');
          this._eraseMenu();
          this._renderPrompt();
        }
      }
      return;
    }

    // Контрольные символы — игнор
    if (code < 32) return;

    // Обычный печатный символ — добавляем в буфер
    this.buffer += ch;
    this._renderPrompt();
  }
}
