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

    this.buffer        = '';
    this.cursor        = 0;     // позиция курсора в массиве code points
    this.menuRowsDrawn = 0;
    this.released      = false;
    this.history       = [];    // массив прошлых строк
    this.historyIdx    = -1;    // -1 = свежая строка; 0 = последняя в history
    this.savedCurrent  = '';    // что было набрано до ↑
    this._dataHandler  = this._onData.bind(this);
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
    this.cursor = 0;
    this.historyIdx = -1;
    this.savedCurrent = '';
    this.released = false;
    process.stdout.write('\n');
    this._renderPrompt();
  }

  // ── рендер ──────────────────────────────────────────────────────────
  // Стратегия: каждый _renderPrompt() — атомарная отрисовка с ноля.
  //   1. Стираем старое меню (если было)
  //   2. Пишем текущий prompt + buffer на текущей строке
  //   3. Сдвигаем курсор влево если он не в конце буфера
  //   4. Если буфер начинается с '/' — рисуем меню под prompt
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
    // 3) cursor position
    const total = [...this.buffer].length;
    const back = total - this.cursor;
    if (back > 0) process.stdout.write(`\x1b[${back}D`);
    // 4) menu (под prompt) — saves/restores cursor через ANSI
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
    if (this.released) return; // ввод во время assistant output игнорим
    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let i = 0;
    while (i < str.length) {
      // Detect CSI escape sequence: ESC [ ... <final byte 0x40-0x7E>
      if (str.charCodeAt(i) === 27 && i + 1 < str.length && str[i + 1] === '[') {
        let j = i + 2;
        while (j < str.length) {
          const code = str.charCodeAt(j);
          if (code >= 0x40 && code <= 0x7E) break;
          j++;
        }
        if (j < str.length) {
          this._handleEscape(str.slice(i, j + 1));
          i = j + 1;
          continue;
        }
        // незаконченная sequence — съедим как ESC и продолжим
        i++;
        continue;
      }
      // Lone ESC (без [) — игнор
      if (str.charCodeAt(i) === 27) { i++; continue; }
      // Обычный символ (UTF-8 code point — может быть 1-4 byte units in JS string)
      const ch = String.fromCodePoint(str.codePointAt(i));
      this._handleChar(ch);
      i += ch.length;
    }
  }

  _handleEscape(seq) {
    switch (seq) {
      case '\x1b[A':  this._historyPrev(); return;        // ↑
      case '\x1b[B':  this._historyNext(); return;        // ↓
      case '\x1b[C': {                                    // →
        const total = [...this.buffer].length;
        if (this.cursor < total) { this.cursor++; this._renderPrompt(); }
        return;
      }
      case '\x1b[D':                                      // ←
        if (this.cursor > 0) { this.cursor--; this._renderPrompt(); }
        return;
      case '\x1b[H':  this.cursor = 0;                    // Home
                      this._renderPrompt(); return;
      case '\x1b[F':  this.cursor = [...this.buffer].length;  // End
                      this._renderPrompt(); return;
      case '\x1b[3~': {                                   // Delete
        const arr = [...this.buffer];
        if (this.cursor < arr.length) {
          arr.splice(this.cursor, 1);
          this.buffer = arr.join('');
          this._renderPrompt();
        }
        return;
      }
      // Ctrl+стрелки и пр. — игнор
      default: return;
    }
  }

  _historyPrev() {
    if (!this.history.length) return;
    if (this.historyIdx === -1) this.savedCurrent = this.buffer;
    if (this.historyIdx < this.history.length - 1) {
      this.historyIdx++;
      this.buffer = this.history[this.history.length - 1 - this.historyIdx];
      this.cursor = [...this.buffer].length;
      this._renderPrompt();
    }
  }

  _historyNext() {
    if (this.historyIdx === -1) return;
    if (this.historyIdx === 0) {
      this.historyIdx = -1;
      this.buffer = this.savedCurrent;
      this.savedCurrent = '';
    } else {
      this.historyIdx--;
      this.buffer = this.history[this.history.length - 1 - this.historyIdx];
    }
    this.cursor = [...this.buffer].length;
    this._renderPrompt();
  }

  _handleChar(ch) {
    const code = ch.codePointAt(0);

    // Enter
    if (ch === '\r' || ch === '\n') {
      this._eraseMenu();
      const line = this.buffer;
      // history (без пустых и без duplicate of last)
      const trimmed = line.trim();
      if (trimmed && this.history[this.history.length - 1] !== line) {
        this.history.push(line);
        if (this.history.length > 200) this.history.shift();
      }
      this.historyIdx = -1;
      this.savedCurrent = '';
      this.buffer = '';
      this.cursor = 0;
      process.stdout.write('\r\n');
      Promise.resolve(this.onLine(line)).catch(e => {
        process.stdout.write('\x1b[31merror: ' + (e?.message || e) + '\x1b[0m\n');
        this._renderPrompt();
      });
      return;
    }

    // Backspace — удаляет символ ПЕРЕД cursor
    if (code === 127 || code === 8) {
      if (this.cursor > 0) {
        const arr = [...this.buffer];
        arr.splice(this.cursor - 1, 1);
        this.buffer = arr.join('');
        this.cursor--;
        this._renderPrompt();
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

    // TAB — completion
    if (ch === '\t') {
      if (this.buffer.startsWith('/')) {
        const matches = this._filterMenu();
        if (matches.length === 1) {
          this.buffer = matches[0].cmd + (matches[0].needsArg ? ' ' : '');
          this.cursor = [...this.buffer].length;
          this._renderPrompt();
        }
      }
      return;
    }

    // Контрольные символы — игнор
    if (code < 32) return;

    // Обычный символ — вставляем в позицию cursor
    const arr = [...this.buffer];
    arr.splice(this.cursor, 0, ch);
    this.buffer = arr.join('');
    this.cursor++;
    this._renderPrompt();
  }
}
