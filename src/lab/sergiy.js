/**
 * Инструмент отца Сергия — богословский собеседник
 *
 * CLI-чат, в котором:
 *   - о. Сергий задаёт вопросы и моделирует онтологию
 *   - Система отвечает, опираясь на код онтологии
 *   - Запускается многоагентная логика (Тернарная ВМ, GraphAnalysis)
 *   - Протоколируется каждый вопрос и ответ в WitnessJournal
 *
 * Режимы:
 *   --mode chat       — живой разговор (по умолчанию)
 *   --mode model      — смоделировать конкретный акт дара
 *   --mode harmony    — показать гармонию λόγοι
 *   --mode vm         — запустить тернарную ВМ
 *   --mode graph      — исследовать граф благодарности
 *   --mode sandbox    — изолированная симуляция
 *
 * Изоляция:
 *   Среда полностью in-memory.
 *   Никаких обращений к Integram или внешним API (если --dry-run).
 *   Пригодна для обучения и богословских экспериментов.
 *
 * «Придите, поучимся» — Акафист Благовещению
 */

import * as readline from 'readline';
import { createLabLogger } from './logger.js';
import { GiftAct, AntiKenosis, TelosCheck } from '../core/GiftAct.js';
import { Trit, Tryte, TernaryVM, TernaryALU } from '../core/TernaryCore.js';
import LogosRegistry from '../core/LogosRegistry.js';
import { GratitudeGraph } from '../traces/GratitudeGraph.js';
import { LiturgicalClock } from '../memory/LiturgicalClock.js';

// ── Разбор аргументов ────────────────────────────────────────

const args = process.argv.slice(2);
const MODE = args.find(a => a.startsWith('--mode='))?.split('=')[1]
           || (args.includes('--model') ? 'model' : null)
           || 'chat';
const DRY_RUN = args.includes('--dry-run');

// ── Песочница (изолированная среда) ──────────────────────────

class SandboxSession {
  constructor() {
    this.logoi = new LogosRegistry();
    this.graph = new GratitudeGraph();
    this.vm = new TernaryVM();
    this.persons = new Map();
    this.gifts = [];
    this.log = [];
    this.clock = null;

    // Попробуем запустить LiturgicalClock
    try {
      this.clock = new LiturgicalClock();
    } catch {}
  }

  /** Добавить лицо */
  addPerson(name, calling = null) {
    if (!this.persons.has(name)) {
      this.persons.set(name, {
        id: `p${this.persons.size + 1}`,
        name,
        calling,
        giftsGiven: 0,
        giftsReceived: 0,
      });
    }
    return this.persons.get(name);
  }

  /** Дарить */
  gift(from, to, content, cost = 1, decision = null) {
    const act = GiftAct.person();
    const result = act.cycle(from, to, content, cost, decision);
    const id = `g${this.gifts.length + 1}`;
    this.gifts.push({ id, from, to, content, result });
    if (result.accepted && result.gratitude) {
      this.graph.addGratitude(to, from, id);
    }
    return { id, ...result };
  }

  /** Состояние троичной ВМ (программа Спасения) */
  runVM(program = 'salvation') {
    this.vm = new TernaryVM();
    if (program === 'salvation') {
      this.vm.loadProgram(TernaryVM.salvationProgram());
    }
    return this.vm.run();
  }

  /** Текущее состояние сессии */
  status() {
    return {
      persons: this.persons.size,
      gifts: this.gifts.length,
      accepted: this.gifts.filter(g => g.result.accepted).length,
      logoi: this.logoi.stats(),
      graph: {
        edges: this.graph._edgeCount ?? 0,
        density: typeof this.graph.density === 'function' ? this.graph.density() : '—',
      },
      season: (() => {
        try { return this.clock?.currentState?.()?.season ?? '—'; } catch { return '—'; }
      })(),
    };
  }
}

// ── Команды чата ─────────────────────────────────────────────

function buildCommands(session, log) {
  return {
    помощь: () => {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║         БОГОСЛОВСКИЙ СОБЕСЕДНИК — ОНТОЛОГИЯ ДАРА            ║
╠══════════════════════════════════════════════════════════════╣
║  Команды:                                                    ║
║  помощь                    — эта справка                    ║
║  лицо <имя> [призвание]    — зарегистрировать лицо          ║
║  лица                      — список лиц                     ║
║  дар <от> → <кому> <что>  — акт дара (ожидание)             ║
║  принять <id>              — принять дар                    ║
║  отклонить <id>            — отклонить дар                  ║
║  благодать <лицо>          — тернарная благодать            ║
║  кеносис <лицо>            — тернарный кеносис              ║
║  метанойя <лицо>           — покаяние (паρὰ→κατὰ φύσιν)    ║
║  логос <имя>               — зарегистрировать λόγος         ║
║  логосы                    — дерево λόγοι                   ║
║  гармония                  — гармония λόγοι                 ║
║  граф                      — граф благодарности             ║
║  циклы                     — перихоретические циклы         ║
║  ВМ [salvation]            — программа на тернарной ВМ      ║
║  статус                    — состояние сессии               ║
║  суббота                   — текущий литургический сезон     ║
║  телос <агент> <give|win>  — проверка телоса агента         ║
║  очистить                  — очистить сессию                ║
║  выйти | exit              — завершить                      ║
╚══════════════════════════════════════════════════════════════╝
`);
    },

    лицо: (args) => {
      const [name, ...rest] = args;
      if (!name) { log.warn('Укажите имя: лицо Иоанн Евангелист'); return; }
      const calling = rest.join(' ') || null;
      const p = session.addPerson(name, calling);
      log.event(`Лицо: ${p.name}${calling ? ' [' + calling + ']' : ''} — id=${p.id}`);
    },

    лица: () => {
      if (session.persons.size === 0) { log.info('Лиц нет'); return; }
      for (const p of session.persons.values()) {
        log.info(`  ${p.id}. ${p.name}${p.calling ? ' (' + p.calling + ')' : ''}`);
      }
    },

    дар: (args) => {
      const raw = args.join(' ');
      const m = raw.match(/^(.+?)\s*[→>]\s*(.+?)\s+(.+)$/);
      if (!m) { log.warn('Формат: дар Иоанн → Мария слово'); return; }
      const [, from, to, content] = m;
      const r = session.gift(from.trim(), to.trim(), content.trim(), 1, null);
      log.gift(`Дар ${r.id}: ${from.trim()} → ${to.trim()} | «${content.trim()}» | ожидание`);
    },

    принять: (args) => {
      const id = args[0];
      const g = session.gifts.find(x => x.id === id);
      if (!g) { log.warn(`Дар не найден: ${id}`); return; }
      // Принимаем
      g.result.accepted = true;
      g.result.gratitude = true;
      session.graph.addGratitude(g.to, g.from, g.id);
      log.event(`Дар ${id} принят! κεφάλαιον: ${g.from} отдал, ${g.to} принял и возблагодарил`);
    },

    отклонить: (args) => {
      const id = args[0];
      const g = session.gifts.find(x => x.id === id);
      if (!g) { log.warn(`Дар не найден: ${id}`); return; }
      g.result.accepted = false;
      log.info(`Дар ${id} отклонён. Свобода (ἐλευθερία) соблюдена`);
    },

    благодать: (args) => {
      const name = args.join(' ');
      const t0 = new Trit(0); // κατὰ φύσιν
      const t1 = t0.grace();
      log.event(`${name}: ${t0.name} → ${t1.name} (благодать)`);
      log.trit(`Трит: ${t0.short} → ${t1.short}`);
    },

    кеносис: (args) => {
      const name = args.join(' ');
      const t0 = new Trit(1); // ὑπὲρ φύσιν
      const t1 = t0.kenosis();
      log.info(`${name}: ${t0.name} → ${t1.name} (кеносис — самоопустошение)`);
      log.trit(`Трит: ${t0.short} → ${t1.short}`);
    },

    метанойя: (args) => {
      const name = args.join(' ');
      const t0 = new Trit(-1); // παρὰ φύσιν
      const t1 = t0.metanoia();
      log.event(`${name}: ${t0.name} → ${t1.name} (μετάνοια — возврат к природе)`);
    },

    логос: (args) => {
      const name = args.join(' ');
      if (!name) { log.warn('Укажите имя: логос Дар'); return; }
      const l = session.logoi.register({ name, bearerType: 'creation' });
      log.event(`λόγος: ${l.id} "${l.name}" [${l.movement}]`);
    },

    логосы: () => {
      const tree = session.logoi.getTree();
      const print = (node, depth = 0) => {
        const indent = '  '.repeat(depth);
        const mov = node.movement ? ` [${node.movement}]` : '';
        log.info(`${indent}${node.name}${mov}`);
        for (const c of (node.children || [])) print(c, depth + 1);
      };
      log.info('Дерево λόγοι:');
      print(tree.root);
    },

    гармония: () => {
      const h = session.logoi.getHarmony();
      log.harmony(h);
    },

    граф: () => {
      log.info('Граф благодарности:');
      log.info(`  Вершин: ${session.graph._edges?.size ?? 0}`);
      log.info(`  Рёбер: ${session.graph._edgeCount ?? 0}`);
      log.info(`  Вертикальных евхаристий: ${session.graph._verticalCount ?? 0}`);
    },

    циклы: () => {
      const cycles = session.graph.findCycles?.(6) ?? [];
      if (cycles.length === 0) { log.info('Перихоретических циклов нет'); return; }
      log.event(`Перихоретических циклов: ${cycles.length}`);
      for (const c of cycles) log.event('  ' + c.join(' → '));
    },

    ВМ: (args) => {
      const program = args[0] || 'salvation';
      log.section('TernaryVM');
      const r = session.runVM(program);
      for (const s of r.log) log.trit(`  PC=${s.pc} | ${s.action} | acc=${s.acc}`);
      log.tryte('Аккумулятор', session.vm.accumulator);
      const h = session.vm.accumulator.health();
      if (h === 3) log.event('Состояние: ὑπὲρ φύσιν — полное обожение!');
      else if (h === 0) log.info('Состояние: κατὰ φύσιν — по природе');
      else if (h < 0) log.warn('Состояние: παρὰ φύσιν — падение');
    },

    статус: () => {
      const s = session.status();
      log.info('Состояние сессии:');
      log.info(`  Лица: ${s.persons}`);
      log.info(`  Дары: ${s.gifts} (принято: ${s.accepted})`);
      log.info(`  λόγοι: ${s.logoi.total}`);
      log.info(`  Граф: рёбер=${s.graph.edges} плотность=${s.graph.density}`);
      log.info(`  Сезон: ${s.season}`);
    },

    суббота: () => {
      try {
        const state = session.clock?.currentState?.();
        if (!state) throw new Error('нет состояния');
        log.info(`Сезон: ${state.season}`);
        log.info(`Чистота сердца: ${Math.round((state.heartPurity || 0) * 100)}%`);
        log.info(`Вероятность благодати: ${Math.round((state.graceProb || 0) * 100)}%`);
      } catch (e) {
        log.warn('LiturgicalClock недоступен:', e.message);
        log.info('Три сезона: active (2%) → sabbath (4%) → contemplation (7%)');
      }
    },

    телос: (args) => {
      const [name, telos] = args;
      if (!name || !telos) { log.warn('Формат: телос Иоанн give'); return; }
      const result = TelosCheck({ telos, name });
      const icon = result.valid ? '✓' : '⚠';
      log.info(`${icon} ${name}: телос="${result.telos}" | ${result.valid ? 'дар возможен' : 'дар инструментален'}`);
      if (result.warning) log.warn(result.warning);
      if (result.modeNote) log.info(result.modeNote);
    },

    очистить: () => {
      Object.assign(session, new SandboxSession());
      log.info('Сессия очищена. Песочница пуста.');
    },
  };
}

// ── Приветствие ───────────────────────────────────────────────

function printWelcome() {
  console.log(`
\x1b[35m╔══════════════════════════════════════════════════════════════╗
║        ОНТОЛОГИЯ ДАРА — Богословская лаборатория            ║
║        Инструмент отца Сергия                               ║
╠══════════════════════════════════════════════════════════════╣
║  Режим: ${MODE.padEnd(51)}║
║  Изоляция: ${DRY_RUN ? 'in-memory (dry-run)' : 'in-memory + возможен API  '}           ║
╠══════════════════════════════════════════════════════════════╣
║  «Не смотрите на внешность» (1 Цар 16:7)                   ║
║  Система видит следы. Не саму реальность.                   ║
╚══════════════════════════════════════════════════════════════╝\x1b[0m
`);
}

// ── Запуск ────────────────────────────────────────────────────

export function startSergiyTool() {
  printWelcome();

  const log = createLabLogger('о.Сергий');
  const session = new SandboxSession();
  const commands = buildCommands(session, log);

  if (MODE === 'sandbox') {
    // Быстрый демо-режим
    log.section('Демо-песочница');
    commands.лицо(['Иоанн', 'Евангелист']);
    commands.лицо(['Мария', 'Мироносица']);
    commands.дар(['Иоанн', '→', 'Мария', 'слово']);
    commands.принять(['g1']);
    commands.ВМ(['salvation']);
    commands.статус();
    return;
  }

  if (MODE === 'harmony') {
    log.section('Гармония λόγοι');
    // Зарегистрировать базовые логосы
    session.logoi.register({ name: 'Человек', telos: 'Обожение', movement: 'kata_physin' });
    session.logoi.register({ name: 'Дар', telos: 'Единство', movement: 'hyper_physin' });
    session.logoi.register({ name: 'Код', telos: 'Воплощение', movement: 'kata_physin' });
    commands.гармония();
    commands.логосы();
    return;
  }

  // ── Интерактивный REPL ─────────────────────────────────────

  log.info('Введите "помощь" для списка команд');
  log.info(`Тип: ${DRY_RUN ? 'dry-run (без API)' : 'live'}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[35мо.Сергий ⟶\x1b[0m ',
  });

  // Правим промпт (escaping)
  rl.setPrompt('\x1b[35m◈ о.Сергий ⟶ \x1b[0m');
  rl.prompt();

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);

    if (cmd === 'выйти' || cmd === 'exit') {
      log.info('Да будет воля Твоя. Аминь.');
      rl.close();
      process.exit(0);
    }

    const handler = commands[cmd];
    if (handler) {
      try { handler(cmdArgs); } catch (e) { log.error(e.message); }
    } else {
      // Попытка понять фразу на естественном русском
      const natural = interpretNatural(trimmed, session, log);
      if (!natural) {
        log.warn(`Неизвестная команда: "${cmd}"`);
        log.info('Введите "помощь" для списка команд');
      }
    }

    rl.prompt();
  });
}

/**
 * Упрощённый естественно-языковой разбор фраз.
 */
function interpretNatural(text, session, log) {
  const t = text.toLowerCase();

  if (/благодать/.test(t)) {
    const name = text.replace(/благодать\s*/i, '').trim() || 'N/A';
    const t0 = new Trit(0).grace();
    log.event(`${name}: благодать → ${t0.name}`);
    return true;
  }

  if (/кеносис|самоопустоши/.test(t)) {
    const name = text.replace(/кеносис\s*|самоопустоши.+\s*/i, '').trim() || 'N/A';
    const t0 = new Trit(1).kenosis();
    log.info(`${name}: кеносис → ${t0.name}`);
    return true;
  }

  if (/что такое (дар|кеносис|обожение|перихоресис|логос|апофасис)/i.test(t)) {
    const concepts = {
      'дар': 'Безвозмездная передача бытия. Четыре момента: κένωσις → ἐλευθερία → εὐχαριστία → surplus.',
      'кеносис': 'Самоопустошение (Флп 2:7). Отдать без гарантии возврата. Не убывание — преображение.',
      'обожение': 'θέωσις — достижение ὑπὲρ φύσιν через благодать. Не слияние с Богом, а со-участие в Его энергиях.',
      'перихоресис': 'Взаимопроникновение. В Троице: Отец→Сын→Дух→Отец. В даре: A→B→C→A (тройной цикл).',
      'логос': 'λόγος — замысел Божий о каждом сущем. Дерево: Λόγος → λόγος φύσεως → ипостаси.',
      'апофасис': 'Отрицательное богословие: что Бог не есть. Системой зафиксировано 18 апофатических границ.',
    };
    const match = t.match(/что такое (\w+)/i);
    if (match) {
      const key = match[1];
      const def = concepts[key] || `"${key}" — пока не задокументировано в системе`;
      log.info(`${key}: ${def}`);
      return true;
    }
  }

  return false;
}

// ── Точка входа ───────────────────────────────────────────────
startSergiyTool();
