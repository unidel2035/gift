/**
 * REPL исследовательской среды
 *
 * Интерактивный режим: вводите команды, получайте результат.
 *
 * Команды:
 *   help              — список команд
 *   gift <от> → <кому> { <содержание> }   — создать дар
 *   grace <лицо>      — применить благодать
 *   kenosis <лицо>    — кеносис
 *   trit <значение>   — показать трит
 *   logos list        — список λόγοι
 *   graph             — состояние графа
 *   liturgical status — текущий сезон
 *   oikos status      — состояние города
 *   exit              — выйти
 *
 * Использует NaturalGiftInterface для русских команд.
 */

import * as readline from 'readline';
import { createLabLogger } from './logger.js';
import { GiftAct } from '../core/GiftAct.js';
import { Trit, Tryte, TernaryVM } from '../core/TernaryCore.js';
import LogosRegistry from '../core/LogosRegistry.js';
import { GratitudeGraph } from '../traces/GratitudeGraph.js';

const log = createLabLogger('repl');

/** Состояние REPL-сессии */
const state = {
  logoi: new LogosRegistry(),
  graph: new GratitudeGraph(),
  persons: new Map(),
  gifts: [],
};

const COMMANDS = {
  help: () => {
    console.log(`
Команды REPL онтологии Дара:
  help                          — эта справка
  person <имя>                  — зарегистрировать лицо
  persons                       — список лиц
  gift <от> → <кому> <что>     — создать дар
  accept <id>                   — принять дар
  decline <id>                  — отклонить дар
  grace <лицо>                  — благодать
  kenosis <лицо>                — кеносис
  trit <-1|0|1>                 — показать трит
  vm salvation                  — исполнить программу Спасения
  logos list                    — все λόγοι
  logos register <имя>          — зарегистрировать λόγος
  graph                         — граф благодарности
  graph cycles                  — найти перихоретические циклы
  exit | quit                   — выйти
`);
  },

  person: (args) => {
    const name = args.join(' ').trim();
    if (!name) { log.warn('Укажите имя: person Иоанн'); return; }
    state.persons.set(name, { id: state.persons.size + 1, name });
    log.info(`Лицо зарегистрировано: ${name}`);
  },

  persons: () => {
    if (state.persons.size === 0) { log.info('Лиц нет'); return; }
    for (const p of state.persons.values()) log.info(`  ${p.id}. ${p.name}`);
  },

  gift: (args) => {
    // Разбираем: <от> → <кому> <что>
    const raw = args.join(' ');
    const m = raw.match(/^(.+?)\s*[→>-]\s*(.+?)\s+(.+)$/);
    if (!m) { log.warn('Формат: gift Иоанн → Мария хлеб'); return; }
    const [, from, to, content] = m;
    const id = `g${state.gifts.length + 1}`;
    const act = GiftAct.person().cycle(from.trim(), to.trim(), content.trim(), 1, null);
    state.gifts.push({ id, from: from.trim(), to: to.trim(), content: content.trim(), act });
    log.gift(`Дар ${id}: ${from} → ${to} | ${content} | ожидание`);
  },

  accept: (args) => {
    const id = args[0];
    const g = state.gifts.find(x => x.id === id);
    if (!g) { log.warn(`Дар не найден: ${id}`); return; }
    state.graph.addGratitude(g.to, g.from, g.id);
    log.event(`Дар ${id} принят! Благодарность записана: ${g.to} → ${g.from}`);
  },

  decline: (args) => {
    const id = args[0];
    const g = state.gifts.find(x => x.id === id);
    if (!g) { log.warn(`Дар не найден: ${id}`); return; }
    log.info(`Дар ${id} отклонён (свобода в действии)`);
  },

  grace: (args) => {
    const name = args.join(' ');
    const t = new Trit(0).grace();
    log.event(`${name}: благодать → κατὰ→ὑπὲρ φύσιν (${t.name})`);
  },

  kenosis: (args) => {
    const name = args.join(' ');
    const t = new Trit(1).kenosis();
    log.trit(`${name}: кеносис → ὑπὲρ→κατὰ φύσιν (${t.name})`);
  },

  trit: (args) => {
    const v = parseInt(args[0]);
    if (isNaN(v) || ![-1, 0, 1].includes(v)) { log.warn('Значение: -1, 0 или 1'); return; }
    const t = new Trit(v);
    console.log(`Трит: ${t.short} (${t.name})`);
    console.log(`  NOT:    ${t.not().short} (${t.not().name})`);
    console.log(`  grace:  ${t.grace().short} (${t.grace().name})`);
    console.log(`  kenosis: ${t.kenosis().short} (${t.kenosis().name})`);
    console.log(`  metanoia: ${t.metanoia().short} (${t.metanoia().name})`);
  },

  vm: (args) => {
    if (args[0] === 'salvation') {
      const vm = new TernaryVM();
      vm.loadProgram(TernaryVM.salvationProgram());
      const r = vm.run();
      log.info('TernaryVM: программа Спасения');
      for (const s of r.log) log.trit(`  PC=${s.pc} ${s.action} acc=${s.acc}`);
      log.tryte('Финальный аккумулятор', vm.accumulator);
    }
  },

  logos: (args) => {
    if (args[0] === 'list') {
      const all = state.logoi.export();
      if (all.length === 0) { log.info('λόγοι не зарегистрированы'); return; }
      for (const l of all) {
        log.info(`  ${l.id} ${l.name} [${l.movement}] telos: ${l.telos || '—'}`);
      }
    } else if (args[0] === 'register') {
      const name = args.slice(1).join(' ');
      const l = state.logoi.register({ name, bearerType: 'creation' });
      log.info(`λόγος зарегистрирован: ${l.id} "${l.name}"`);
    }
  },

  graph: (args) => {
    if (args[0] === 'cycles') {
      const cycles = state.graph.findCycles?.(5) ?? [];
      if (cycles.length === 0) log.info('Перихоретических циклов нет');
      else for (const c of cycles) log.event('Цикл:', c.join(' → '));
      return;
    }
    log.info('Граф благодарности:');
    log.info(`  Вершин: ${state.graph._edges?.size ?? 0}`);
    log.info(`  Рёбер: ${state.graph._edgeCount ?? 0}`);
    log.info(`  Вертикальных: ${state.graph._verticalCount ?? 0}`);
  },
};

/**
 * Запустить интерактивный REPL.
 */
export function startRepl() {
  log.section('REPL — Онтология Дара');
  log.info('Введите "help" для списка команд');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[35m⟶\x1b[0m ',
  });

  rl.prompt();

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    const [cmd, ...args] = trimmed.split(/\s+/);

    if (cmd === 'exit' || cmd === 'quit') {
      log.info('Аминь.');
      rl.close();
      process.exit(0);
    }

    const handler = COMMANDS[cmd];
    if (handler) {
      try { handler(args); } catch (e) { log.error(e.message); }
    } else {
      log.warn(`Неизвестная команда: ${cmd} — введите "help"`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    log.info('Сессия завершена.');
  });
}

export default startRepl;
