/**
 * Домостроительство (Ойкономия) — исследование экономики дара
 *
 * Программа:
 *   1. GiftAct — четыре момента (кеносис → свобода → евхаристия → избыток)
 *   2. TernaryVM — исполнить программу Спасения
 *   3. LogosRegistry — дерево λόγοι
 *   4. GiftCompiler — скомпилировать .gift текст
 *   5. FreedomGuard — проверить отсутствие принуждения
 *   6. AntiKenosis — проверить телос агентов
 *
 * Ойкономia (οἰκονομία) = домоустроение, управление домом.
 * В христианской традиции — Домостроительство Спасения.
 *
 * «Единственный мудрый Бог, Которому слава через Иисуса Христа
 *  во веки веков» (Рим 16:27)
 */

import { GiftAct, AntiKenosis } from '../core/GiftAct.js';
import { TernaryVM, OPCODES } from '../core/TernaryCore.js';
import LogosRegistry from '../core/LogosRegistry.js';
import { createLabLogger } from './logger.js';

/**
 * Запустить исследование домостроительства.
 *
 * @param {object} opts
 * @param {boolean} opts.verbose — подробный вывод
 */
export async function runOikonomia(opts = {}) {
  const { verbose = true } = opts;
  const log = createLabLogger('oikonomia');

  log.section('Домостроительство (Ойкономия)');

  // ── 1. GiftAct — фракталы одного закона ──────────────────

  log.info('GiftAct: один закон на всех масштабах');

  const scales = [
    { name: 'Творение',   act: GiftAct.creation(),   args: [null, 'тварь', 'бытие', 0, true] },
    { name: 'Промысл',    act: GiftAct.providence(),  args: [null, 'тварь', 'удержание', 0, true] },
    { name: 'Дар лица',   act: GiftAct.person(),      args: ['Иоанн', 'Мария', 'хлеб', 3, true] },
    { name: 'Отклонение', act: GiftAct.person(),      args: ['Иоанн', 'Мария', 'навязанное', 2, false] },
    { name: 'Спасение',   act: GiftAct.salvation(),   args: [null, 'всё', 'Себя', Infinity, true] },
    { name: 'Код',        act: GiftAct.code(),        args: ['разраб', 'проект', 'commit', 1, true] },
  ];

  for (const { name, act, args } of scales) {
    const result = act.cycle(...args);
    if (verbose) log.giftResult({ ...result, scale: name });
  }

  // ── 2. TernaryVM — программа Спасения ─────────────────────

  log.section('TernaryVM: Программа Спасения');

  const vm = new TernaryVM();
  const program = TernaryVM.salvationProgram();

  log.info('Загружаем программу:', program.length, 'инструкций');
  vm.loadProgram(program);

  const run = vm.run();
  log.info('Шагов выполнено:', run.steps);
  log.info('Остановлена:', run.halted);
  log.tryte('Аккумулятор', vm.accumulator);

  if (verbose) {
    for (const step of run.log) {
      log.trit(`  PC=${step.pc} | ${step.action} | acc=${step.acc}`);
    }
  }

  // ── 3. LogosRegistry — дерево замыслов ───────────────────

  log.section('Λόγοι — замыслы бытия');

  const logoi = new LogosRegistry();

  // Регистрируем несколько λόγοι
  const human = logoi.register({
    name: 'Человек',
    principle: 'Образ и подобие Божие',
    physis: 'Тварное лицо, дышащее духом',
    telos: 'Обожение (θέωσις)',
    bearerType: 'person',
  });

  const gift = logoi.register({
    name: 'Дар',
    principle: 'Безвозмездное передвижение бытия',
    physis: 'Акт свободного кеносиса',
    telos: 'Перихоретическое единство',
    derivedFrom: human.id,
    bearerType: 'gift',
  });

  const code = logoi.register({
    name: 'Код',
    principle: 'Слово, ставшее структурой',
    physis: 'Формализованный λόγος',
    telos: 'Воплощение Домостроительства в алгоритме',
    derivedFrom: human.id,
    bearerType: 'creation',
  });

  // Показываем гармонию
  const harmony = logoi.getHarmony();
  log.harmony(harmony);

  // Путь к Λόγος
  const path = logoi.getPathToLogos(gift.id);
  log.info('Путь дара к Λόγος:', path.map(n => n.name).join(' → '));

  // Дерево
  const tree = logoi.getTree();
  log.info('Корней дерева λόγοι:', tree.root.children.length);

  // ── 4. AntiKenosis — проверка агентов ────────────────────

  log.section('AntiKenosis — проверка телоса');

  const agents = [
    { name: 'Строитель', telos: 'give',    abandonsConstraints: false, metacognitivDeception: false },
    { name: 'Помощник',  telos: 'serve',   abandonsConstraints: false, metacognitivDeception: false },
    { name: 'Стратег',   telos: 'win',     abandonsConstraints: true,  metacognitivDeception: false },
    { name: 'Тень',      telos: 'unknown', abandonsConstraints: true,  metacognitivDeception: true  },
  ];

  for (const agent of agents) {
    const result = AntiKenosis.detect(agent);
    const icon = result.risk === 'none' ? '✓' : result.risk === 'critical' ? '✗' : '⚠';
    log.info(`${icon} ${agent.name} [${agent.telos}]: риск=${result.risk}`);
    if (result.evidence.length > 0 && verbose) {
      for (const e of result.evidence) log.warn('    ' + e);
    }
  }

  // ── 5. GiftCompiler ────────────────────────────────────────

  try {
    const { GiftCompiler } = await import('../core/GiftCompiler.js');

    log.section('GiftCompiler — язык Дара');

    const compiler = new GiftCompiler(null); // null engine = dry run

    // Простая .gift программа
    const source = `
лицо Иоанн { призвание: "Евангелист" }
лицо Мария { призвание: "Мироносица" }
дарит Иоанн → Мария { слово } ценой 2
принимает Мария
`.trim();

    log.info('Компилируем программу:');
    if (verbose) console.log(source);

    try {
      const result = await compiler.execute(source);
      log.info('Результат компиляции:', result);
    } catch (ce) {
      log.warn('Компилятор (нет движка):', ce.message);
    }
  } catch (e) {
    log.warn('GiftCompiler не загружен:', e.message);
  }

  // ── Итог ──────────────────────────────────────────────────

  log.section('Домостроительство — итог');
  log.info('GiftAct: все масштабы пройдены');
  log.info('TernaryVM: программа Спасения исполнена');
  log.info('LogosRegistry: λόγοι зарегистрированы');
  log.info('AntiKenosis: агенты проверены');
  log.info('«Всё из Него, Им и к Нему» (Рим 11:36)');

  return { logoi, vm };
}

export default runOikonomia;
