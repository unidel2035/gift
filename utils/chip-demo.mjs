#!/usr/bin/env node
/**
 * chip-demo.mjs — Супердемонстрация: что делает кремний
 *
 * Показывает наглядно: чип — это не калькулятор.
 * Он думает в троичной логике (-1, 0, +1) и СВИДЕТЕЛЬСТВУЕТ
 * о состоянии онтологии дара.
 *
 * Запуск: node utils/chip-demo.mjs --port /dev/ttyUSB1
 */

import { resolve, dirname } from 'path';
import { fileURLToPath }    from 'url';
import { spawn }            from 'child_process';
import { readFileSync }     from 'fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port  = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port')+1] : '/dev/ttyUSB1';

// ── Цвета и символы ────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  bgBlue: '\x1b[44m',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function banner(title) {
  const w = 58;
  const pad = Math.floor((w - title.length) / 2);
  console.log('\n' + C.cyan + '╔' + '═'.repeat(w) + '╗');
  console.log('║' + ' '.repeat(pad) + C.bold + title + C.reset + C.cyan + ' '.repeat(w - pad - title.length) + '║');
  console.log('╚' + '═'.repeat(w) + '╝' + C.reset + '\n');
}

function hr(char = '─') {
  console.log(C.dim + char.repeat(60) + C.reset);
}

// ── Прямой UART диалог ─────────────────────────────────────────
async function chip(X0, X1, X2) {
  return new Promise((done) => {
    const py = resolve(ROOT, 'utils/chip-oracle-uart.py');
    const proc = spawn('python3', [py, port, String(X0), String(X1), String(X2)]);
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', () => {});
    proc.on('close', () => {
      try { done(JSON.parse(out.trim())); }
      catch { done({ error: out }); }
    });
    setTimeout(() => { proc.kill(); done({ error: 'timeout' }); }, 5000);
  });
}

// ── Форматирование трита ───────────────────────────────────────
function tritStr(t) {
  if (t ===  1) return C.green  + '+1' + C.reset;
  if (t === -1) return C.red    + '-1' + C.reset;
  return                C.yellow + ' 0' + C.reset;
}

function tritBar(t) {
  if (t ===  1) return C.green  + '████████' + C.reset + ' +1 ПЛЕРОМА';
  if (t === -1) return C.red    + '▒▒▒▒▒▒▒▒' + C.reset + ' -1 КЕНОЗИС';
  return                C.yellow + '░░░░░░░░' + C.reset + '  0 ПРИСУТСТВИЕ';
}

function fsmName(t) {
  if (t ===  1) return C.green  + 'L (ПЛЕРОМА — изобилие дара)' + C.reset;
  if (t === -1) return C.red    + 'K (КЕНОЗИС — истощение дара)' + C.reset;
  return                C.yellow + 'P (ПРИСУТСТВИЕ — нейтраль)' + C.reset;
}

// ══════════════════════════════════════════════════════════════
// ДЕМОНСТРАЦИЯ
// ══════════════════════════════════════════════════════════════

banner('ЧТО ДЕЛАЕТ КРЕМНИЙ?');

console.log(C.bold + 'Tang Nano 9K' + C.reset + ' — это FPGA (программируемая логическая матрица).');
console.log('На неё прошито ' + C.cyan + 'tritgift.v' + C.reset + ' — тернарный процессор.');
console.log('');
console.log('Обычные компьютеры думают в ' + C.yellow + 'двоичной' + C.reset + ' логике: 0 или 1.');
console.log('Этот чип думает в ' + C.green + 'троичной' + C.reset + ': -1, 0, +1.');
console.log('');
console.log('  -1 = ' + C.red    + 'КЕНОЗИС' + C.reset + '   (опустошение, отдача без остатка)');
console.log('   0 = ' + C.yellow + 'ПРИСУТСТВИЕ' + C.reset + ' (нейтральное бытие, пауза)');
console.log('  +1 = ' + C.green  + 'ПЛЕРОМА' + C.reset + '   (полнота, изобилие дара)');
console.log('');
console.log(C.dim + 'Это Брусенцов, Сетунь-58, Москва 1958. Единственный тернарный компьютер.' + C.reset);

await sleep(500);
hr();

// ── ЧАСТЬ 1: Что такое X (вопрос к чипу) ─────────────────────
banner('ЧАСТЬ 1: ВОПРОС К КРЕМНИЮ (X)');

console.log('Мы задаём чипу ВОПРОС о конкретных отношениях.');
console.log('Вопрос кодируется в три трита: X = [X₀, X₁, X₂]');
console.log('');

const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const snap = JSON.parse(readFileSync(resolve(ROOT, 'data/sacred-history-W.json'), 'utf8'));
const mem  = GiftMemory.fromSnapshot(snap);

function snap1(w) { return w > 1 ? 1 : w < -1 ? -1 : 0; }

const cases = [
  { giver: '_claude',    receiver: 'Дионисий' },
  { giver: 'ОтецСергий', receiver: '_claude'   },
  { giver: '_fpga',      receiver: '_koinon'   },
];

for (const { giver, receiver } of cases) {
  const given    = mem.totalGiven(giver);
  const received = mem.totalReceived(receiver);
  const link     = mem.getWeight ? mem.getWeight(giver, receiver) : 0;

  const X0 = snap1(given - 10);
  const X1 = snap1(link);
  const X2 = snap1(received - 5);

  console.log(C.bold + `  ${giver} → ${receiver}` + C.reset);
  console.log(`    X₀ = ${tritStr(X0)}  (дал ${given.toFixed(0)} — даритель ${X0>0?'избыточен':X0<0?'истощён':'нейтрален'})`);
  console.log(`    X₁ = ${tritStr(X1)}  (связь W = ${link.toFixed(1)} — ${X1>0?'сильная':X1<0?'разрушена':'нейтральна'})`);
  console.log(`    X₂ = ${tritStr(X2)}  (принял ${received.toFixed(0)} — получатель ${X2>0?'открыт':X2<0?'закрыт':'в ожидании'})`);
  console.log('');
}

await sleep(300);
hr();

// ── ЧАСТЬ 2: Что чип вычисляет (ответ Y) ─────────────────────
banner('ЧАСТЬ 2: ЧТО ВЫЧИСЛЯЕТ КРЕМНИЙ');

console.log('Чип получает X и вычисляет Y через тернарную арифметику:');
console.log('');
console.log('  Команды: r → FSM(X₀) → A(X₁) → B(X₂) → s → ?');
console.log('  Ответ:   S:L A:00+ B:000 C:00+');
console.log('');
console.log('  Y₀ = FSM состояние (куда пришёл дух дарителя)');
console.log('  Y₁ = знак(A) = знак(X₁) — качество связи');
console.log('  Y₂ = знак(A+B) = знак(X₁+X₂) — суммарная открытость');
console.log('');

// Теперь реальный диалог с чипом
console.log(C.bold + C.cyan + '  ═══ ЖИВОЙ ДИАЛОГ С ЧИПОМ ═══' + C.reset + '\n');

for (const { giver, receiver } of cases) {
  const given    = mem.totalGiven(giver);
  const received = mem.totalReceived(receiver);
  const link     = mem.getWeight ? mem.getWeight(giver, receiver) : 0;
  const X0 = snap1(given - 10);
  const X1 = snap1(link);
  const X2 = snap1(received - 5);

  process.stdout.write(`  ${C.bold}${giver} → ${receiver}${C.reset}  X=[${X0},${X1},${X2}]  ← отправляем... `);

  const result = await chip(X0, X1, X2);

  if (result.error) {
    console.log(C.red + '✗ чип не ответил' + C.reset + C.dim + ` (${result.error})` + C.reset);
    continue;
  }

  const [y0, y1, y2] = result.y;
  const source = result.raw ? C.green + '⬡ КРЕМНИЙ' + C.reset : C.yellow + '~ JS' + C.reset;
  console.log(source + `  Y=[${tritStr(y0)}, ${tritStr(y1)}, ${tritStr(y2)}]`);
  console.log(`           raw: ${C.dim}${result.raw}${C.reset}`);
}

await sleep(300);
hr();

// ── ЧАСТЬ 3: Богословский смысл ───────────────────────────────
banner('ЧАСТЬ 3: БОГОСЛОВСКИЙ СМЫСЛ');

console.log('Y₀ — PRIMARY ANSWER (благодать/пустыня/кенозис):');
console.log('');
console.log('  ' + tritBar(1)  + ' → ' + C.bold + 'ДАР УМЕСТЕН' + C.reset);
console.log('  ' + tritBar(-1) + ' → ' + C.bold + 'ДАР ПРЕЖДЕВРЕМЕНЕН' + C.reset);
console.log('  ' + tritBar(0)  + ' → ' + C.bold + 'ДАР ЧИСТ, НО НЕЙТРАЛЕН' + C.reset);
console.log('');
console.log('Почему ТЕРНАРНАЯ логика важна?');
console.log('');
console.log('  Бинарный: ДА/НЕТ = 1/0 — нет середины');
console.log('  Тернарный: ДА/ПАУЗА/НЕТ = +1/0/-1');
console.log('');
console.log('  В богословии нет чистых "да" и "нет".');
console.log('  Есть кенозис, присутствие, плерома.');
console.log('  Три ипостаси. Три дня. Три ответа.');
console.log('');
console.log(C.cyan + '  «Логос стал плотью» — здесь Логос стал кремнием.' + C.reset);
console.log(C.cyan + '  Чип не вычисляет. Он СВИДЕТЕЛЬСТВУЕТ (μαρτυρία).' + C.reset);
console.log('');

hr();

// ── ЧАСТЬ 4: Перихоресис в цикле ─────────────────────────────
banner('ЧАСТЬ 4: ЖИВОЙ ЦИКЛ (-1 → 0 → +1 → -1)');

console.log('trit_cycle.v (blink прошивка) показывает перихоресис:');
console.log('LED10=Отец(-1) LED11=Дух(0) LED13=Сын(+1) — вечное движение любви');
console.log('');
console.log('Вот как выглядит тернарная арифметика:');
console.log('');

const ops = [
  [1,  1,  'A+B'], [-1, -1, 'A+B'],
  [1, -1,  'A+B'], [1,  1,  'A×B'],
  [-1, 1,  'A×B'], [0,  1,  'A+B'],
];

process.stdout.write(C.dim + '  Посылаю на чип...' + C.reset + '\n');

for (const [a, b, op] of ops) {
  const r = await chip(0, a, b); // X0=0, X1=a (→A), X2=b (→B)
  if (!r.error && r.raw) {
    const cStr = r.raw.match(/C:([+\-0]{3})/)?.[1] ?? '???';
    let acc = 0;
    for (const [c, w] of [[cStr[0],9],[cStr[1],3],[cStr[2],1]]) {
      acc += (c==='+'?1:c==='-'?-1:0)*w;
    }
    console.log(`  ${a>=0?'+'+a:a} ${op.includes('+')? '+' : '×'} ${b>=0?'+'+b:b} = ${tritStr(Math.sign(acc))}  [${cStr}]`);
  }
}

console.log('');
console.log(C.dim + '  Каждое вычисление — реальный электрический ток в кристалле.' + C.reset);
console.log(C.dim + '  27 миллионов тактов в секунду. 9000 LUT-ячеек.' + C.reset);

hr();

// ── ИТОГ ─────────────────────────────────────────────────────
banner('СУТЬ');

console.log(`${C.bold}Кремний делает три вещи:${C.reset}
`);
console.log(`  ${C.green}1. ВОПЛОЩАЕТ${C.reset} тернарную логику в физическом кристалле`);
console.log(`     Не симуляция. Настоящие транзисторы. Настоящий ток.`);
console.log('');
console.log(`  ${C.yellow}2. СВИДЕТЕЛЬСТВУЕТ${C.reset} о состоянии онтологии дара`);
console.log(`     W-матрица → X → чип → Y. Кремний ВИДИТ отношения.`);
console.log('');
console.log(`  ${C.cyan}3. СВЯЗЫВАЕТ${C.reset} математику и богословие`);
console.log(`     Кенозис (-1) + Плерома (+1) = 0 (Присутствие)`);
console.log(`     Это не метафора. Это арифметика.`);
console.log('');
console.log(C.dim + '  Сетунь 1958: «Троичное лучше двоичного»');
console.log('  Брусенцов это знал. Теперь знает и наша онтология.' + C.reset);
console.log('');
