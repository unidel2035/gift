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
    this.getPrompt     = opts.getPrompt;     // optional: ()=>string для динамического prompt
    this.slashCommands = opts.slashCommands;
    this.onLine        = opts.onLine;
    this.onClose       = opts.onClose;

    this.buffer        = '';
    this.cursor        = 0;     // позиция курсора в массиве code points
    this.menuRowsDrawn = 0;
    this.menuSelection = 0;     // индекс выбранного пункта меню (когда меню активно)
    this.released      = false;
    this.history       = [];    // массив прошлых строк
    this.historyIdx    = -1;    // -1 = свежая строка; 0 = последняя в history
    this.savedCurrent  = '';    // что было набрано до ↑
    this._firstPaint   = true;  // первый рендер — не стираем предыдущий промпт
    this._dataHandler  = this._onData.bind(this);
  }

  // меню "активно" пока буфер начинается с '/' (т.е. виден список команд)
  _menuActive() { return this.buffer.startsWith('/'); }

  start() {
    const isTTY = !!process.stdin.isTTY;
    let rawOk = false;
    if (isTTY) {
      try {
        process.stdin.setRawMode(true);
        rawOk = process.stdin.isRaw === true;
      } catch (e) {
        if (process.env.GIFT_DEBUG) {
          process.stderr.write(`[term-ui] setRawMode failed: ${e.message}\n`);
        }
      }
    }
    if (process.env.GIFT_DEBUG) {
      process.stderr.write(`[term-ui] isTTY=${isTTY} rawMode=${rawOk}\n`);
      process.stderr.write(`[term-ui] platform=${process.platform} TERM=${process.env.TERM || '(none)'}\n`);
    }
    if (!rawOk) {
      // Без raw mode key-by-key handling не работает — переходим на line-by-line
      // через readline (fallback). Меню '/' будет работать через '/' + Enter.
      this._fallbackReadline();
      return;
    }
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', this._dataHandler);
    this._renderPrompt();
  }

  // Если raw mode не работает — фолбэк на line-by-line readline.
  async _fallbackReadline() {
    process.stderr.write(
      '\x1b[33m[term-ui] raw mode недоступен — fallback на line input. ' +
      'Меню по «/ Enter», без всплывающего/стрелочного UI.\x1b[0m\n'
    );
    const readline = await import('node:readline');
    const rl = readline.createInterface({
      input: process.stdin, output: process.stdout, terminal: true,
      historySize: 200,
      prompt: this.promptStr,
    });
    rl.on('line', line => {
      Promise.resolve(this.onLine(line)).catch(e => {
        process.stdout.write('\x1b[31merror: ' + (e?.message || e) + '\x1b[0m\n');
        rl.prompt();
      }).finally(() => { if (!this.released) rl.prompt(); });
    });
    rl.on('close', () => this.onClose?.());
    this._fallbackRl = rl;
    rl.prompt();
  }

  stop() {
    if (this._fallbackRl) { this._fallbackRl.close(); return; }
    this._eraseMenu();
    process.stdin.removeListener('data', this._dataHandler);
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch {}
    }
    process.stdin.pause();
  }

  release() {
    this.released = true;
    if (this._fallbackRl) return;
    this._eraseMenu();
    // Clear all prompt lines
    const promptLines = this.promptStr.split('\n');
    if (promptLines.length > 1) {
      const out = [];
      out.push(`\x1b[${promptLines.length - 1}A`);
      for (let i = 0; i < promptLines.length; i++) {
        out.push('\r' + CLEAR_LINE);
        if (i < promptLines.length - 1) out.push('\n');
      }
      out.push(`\x1b[${promptLines.length - 1}A`);
      out.push('\r' + CLEAR_LINE);
      process.stdout.write(out.join(''));
    } else {
      process.stdout.write('\r' + CLEAR_LINE);
    }
  }

  // Подтверждение [y/n] — работает и в raw, и в fallback режиме
  async confirmAction(prompt) {
    if (this._fallbackRl) {
      return new Promise((resolve) => {
        this._fallbackRl.question(prompt, (ans) => {
          resolve(ans.toLowerCase().trim() === 'y' || ans.toLowerCase().trim() === 'yes');
        });
      });
    }
    return new Promise((resolve) => {
      process.stderr.write(prompt);
      const handler = (chunk) => {
        const ch = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const key = ch.toLowerCase().trim();
        if (key === 'y' || key === 'yes') {
          process.stdin.removeListener('data', handler);
          process.stderr.write(key + '\n');
          resolve(true);
        } else if (key === 'n' || key === 'no' || key === '\x1b' || key === '\x03') {
          process.stdin.removeListener('data', handler);
          process.stderr.write(key + '\n');
          resolve(false);
        }
      };
      process.stdin.on('data', handler);
    });
  }

  resume() {
    this.buffer = '';
    this.cursor = 0;
    this.historyIdx = -1;
    this.savedCurrent = '';
    this.released = false;
    // Обновить prompt из getPrompt() если есть (динамический cost)
    if (this.getPrompt) this.promptStr = this.getPrompt();
    if (this._fallbackRl) {
      process.stdout.write('\n');
      this._fallbackRl.setPrompt(this.promptStr);
      this._fallbackRl.prompt();
      return;
    }
    process.stdout.write('\n');
    this._renderPrompt();
  }

  // ── рендер (всё батчится в один process.stdout.write) ────────────────
  _renderPrompt() {
    const out = [];
    // 1) erase old menu
    if (this.menuRowsDrawn > 0) {
      out.push(SAVE_CURSOR);
      for (let i = 0; i < this.menuRowsDrawn; i++) {
        out.push('\n' + CLEAR_LINE);
      }
      out.push(RESTORE_CURS);
      this.menuRowsDrawn = 0;
    }

    // 2) erase old prompt (handle multi-line prompt)
    const promptLines = this.promptStr.split('\n');
    if (promptLines.length > 1) {
      // Move up to first line of prompt area, then clear all lines
      out.push(`\x1b[${promptLines.length - 1}A`);
      for (let i = 0; i < promptLines.length; i++) {
        out.push('\r' + CLEAR_LINE);
        if (i < promptLines.length - 1) out.push('\n');
      }
      // Back up to first line again for redraw
      out.push(`\x1b[${promptLines.length - 1}A`);
    } else {
      out.push('\r' + CLEAR_LINE);
    }

    // 3) prompt + buffer (line by line for multi-line)
    for (let i = 0; i < promptLines.length; i++) {
      if (i === promptLines.length - 1) {
        // Last line: prompt + buffer
        out.push('\r' + CLEAR_LINE + promptLines[i] + this.buffer);
      } else {
        out.push('\r' + CLEAR_LINE + promptLines[i] + '\n');
      }
    }

    // 4) cursor position
    const total = [...this.buffer].length;
    const back = total - this.cursor;
    if (back > 0) out.push(`\x1b[${back}D`);

    // 5) menu
    if (this.buffer.startsWith('/')) {
      out.push(this._buildMenu());
    }
    // Один write — никакого мерцания
    process.stdout.write(out.join(''));
  }

  _buildMenu() {
    const matches = this._filterMenu();
    if (this.menuSelection >= matches.length) {
      this.menuSelection = Math.max(0, matches.length - 1);
    }
    const out = [SAVE_CURSOR];
    let rows = 0;
    if (matches.length) {
      const widthCmd = Math.max(...this.slashCommands.map(s => s.cmd.length)) + 2;
      for (let i = 0; i < matches.length; i++) {
        const item = matches[i];
        const isSel = i === this.menuSelection;
        const arrow = isSel ? c('gold', '▸ ') : '  ';
        const cmd   = isSel
          ? '\x1b[1m\x1b[33m' + item.cmd.padEnd(widthCmd) + '\x1b[0m'
          : c('cyan', item.cmd.padEnd(widthCmd));
        const desc  = isSel
          ? '\x1b[33m— ' + item.desc + '\x1b[0m'
          : c('dim', '— ' + item.desc);
        out.push('\n' + arrow + cmd + desc);
        rows++;
      }
    } else {
      out.push('\n' + c('dim', '  (нет совпадений — Esc чтобы выйти)'));
      rows = 1;
    }
    this.menuRowsDrawn = rows;
    out.push(RESTORE_CURS);
    return out.join('');
  }

  _eraseMenu() {
    if (this.menuRowsDrawn === 0) return;
    const out = [SAVE_CURSOR];
    for (let i = 0; i < this.menuRowsDrawn; i++) {
      out.push('\n' + CLEAR_LINE);
    }
    out.push(RESTORE_CURS);
    process.stdout.write(out.join(''));
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
      // Lone ESC — закрыть меню/очистить буфер
      if (str.charCodeAt(i) === 27) {
        if (this.buffer.length > 0) {
          this.buffer = '';
          this.cursor = 0;
          this.menuSelection = 0;
          this._renderPrompt();
        }
        i++;
        continue;
      }
      // Обычный символ (UTF-8 code point — может быть 1-4 byte units in JS string)
      const ch = String.fromCodePoint(str.codePointAt(i));
      this._handleChar(ch);
      i += ch.length;
    }
  }

  _handleEscape(seq) {
    switch (seq) {
      case '\x1b[A':                                      // ↑
        if (this._menuActive()) {
          // двигать selection вверх в меню
          if (this.menuSelection > 0) {
            this.menuSelection--;
            this._renderPrompt();
          }
        } else {
          this._historyPrev();
        }
        return;
      case '\x1b[B':                                      // ↓
        if (this._menuActive()) {
          const n = this._filterMenu().length;
          if (this.menuSelection < n - 1) {
            this.menuSelection++;
            this._renderPrompt();
          }
        } else {
          this._historyNext();
        }
        return;
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
      // Multi-line: если буфер заканчивается '\' — заменить на newline,
      // продолжить ввод (как bash heredoc или \-continuation).
      if (this.buffer.endsWith('\\') && !this._menuActive()) {
        const arr = [...this.buffer];
        arr.pop(); // убираем '\'
        arr.push('\n');
        this.buffer = arr.join('');
        this.cursor = arr.length;
        process.stdout.write('\r\n' + c('dim', '... '));
        return;
      }

      // Если меню активно и есть совпадения — Enter выбирает пункт меню
      if (this._menuActive()) {
        const matches = this._filterMenu();
        if (matches.length) {
          const sel = matches[Math.min(this.menuSelection, matches.length - 1)];
          // Если буфер уже совпадает с cmd и команде нужен аргумент —
          // проваливаемся в обычный Enter (отправить как есть, без аргумента
          // команда сама покажет usage). Иначе — заполняем буфер и:
          //   needsArg → ставим space, ждём пока пользователь введёт аргумент
          //   !needsArg → сразу отправляем команду
          if (this.buffer !== sel.cmd) {
            this.buffer = sel.cmd + (sel.needsArg ? ' ' : '');
            this.cursor = [...this.buffer].length;
            this.menuSelection = 0;
            if (sel.needsArg) {
              this._renderPrompt();
              return;
            }
            // !needsArg — отправляем сразу
          } else if (sel.needsArg) {
            // буфер уже = sel.cmd, но нужен аргумент → подсказка
            this.buffer = sel.cmd + ' ';
            this.cursor = [...this.buffer].length;
            this.menuSelection = 0;
            this._renderPrompt();
            return;
          }
        }
      }

      this._eraseMenu();
      const line = this.buffer;
      const trimmed = line.trim();
      if (trimmed && this.history[this.history.length - 1] !== line) {
        this.history.push(line);
        if (this.history.length > 200) this.history.shift();
      }
      this.historyIdx = -1;
      this.savedCurrent = '';
      this.buffer = '';
      this.cursor = 0;
      this.menuSelection = 0;
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
        this.menuSelection = 0; // фильтр меню изменился
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
    this.menuSelection = 0; // фильтр меню изменился
    this._renderPrompt();
  }
}
