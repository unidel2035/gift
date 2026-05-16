#!/usr/bin/env node
/**
 * myslebrodilnya-istok-demo.mjs — первое испытание мыслебродильни.
 *
 * Сюжет: пустыня рынка БАС — «нет квалифицированного применителя
 * дронов в агро» (Воронежская область, гипотетически).
 *
 * Идея для дегустации: «Пилотная программа БПЛА-агроконсультантов
 * в Воронежской области — оператор + агроном + дрон + страховщик.»
 *
 * Цикл мыслебродильни:
 *   1. Σύναξις   — идея пришла (моделируем)
 *   2. Decoupage — διαίρεσις по 4 sphere-инженериям (ground/water/fire/air)
 *   3. Δοκιμασία — собор 4-х акторов рынка БАС (производитель/оператор/
 *                  регулятор/инвестор) с эпиклезой
 *   4. Vintage   — διάκρισις по плодам (моделируем 3 цикла)
 *
 * Запуск:
 *   node utils/myslebrodilnya-istok-demo.mjs
 *   node utils/myslebrodilnya-istok-demo.mjs --no-oracle  # без эпиклезы
 */

import { GiftMemory } from '../src/core/GiftMemory.js';
import { Decoupage } from '../src/persons/Decoupage.js';
import { Vintage } from '../src/persons/Vintage.js';
import { LiturgicalCalendar } from '../src/scheduling/LiturgicalCalendar.js';
import { SymphonyOrchestrator } from '../src/persons/SymphonyOrchestrator.js';
import { HumanOracleInbox } from '../src/theology/HumanOracleInbox.js';
import { LivingMatrix } from '../src/core/LivingMatrix.js';

const noOracle = process.argv.includes('--no-oracle');

// ── Идея ─────────────────────────────────────────────────────────────
const IDEA = 'Пилотная программа БПЛА-агроконсультантов в Воронежской области: '
  + 'оператор-сертифицированный пилот + агроном + дрон Геоскан-201 + страховщик. '
  + 'Цель: заполнить пустыню «нет квалифицированного применителя» в секторе агро.';
const CONTEXT = {
  region: 'Воронежская область',
  sector: 'агро',
  desert: 'нет квалифицированного применителя',
};

// ── Mock-LLM для Decoupage (эмулирует реальный анализ через 4 sphere) ──
const sphereLlm = {
  ask: async (prompt) => {
    if (prompt.includes('ground')) return { answer:
      'Материя: дрон Геоскан-201 (отечественный), агрохимическое оборудование, ' +
      'GPS RTK, сертификация СТО Росавиации, диплом пилота категории C. ' +
      'Поле: пшеница озимая, ~5000 га, Воронежская область.' };
    if (prompt.includes('water')) return { answer:
      'Перетоки: производитель Геоскан → оператор-сертификат → агроном → агрохолдинг. ' +
      'Данные: телеметрия → ИАС БАС → страховщик. Деньги: страховой сбор → агрохолдинг → оператор.' };
    if (prompt.includes('fire')) return { answer:
      'Конкуренция: импорт DJI (запрет), наземная агрохимия (дешевле), спутниковый мониторинг ' +
      '(Sentinel-2 бесплатно, но грубее). Регуляторно: МЧС/Росавиация требуют согласование полётов.' };
    if (prompt.includes('air')) return { answer:
      'Побочные: запрос на 4G-покрытие в полях (для онлайн-телеметрии), новый класс ' +
      'агроконсультантов, дополнительный спрос на страхование БПЛА, повышение требований ' +
      'к школам пилотов в регионе.' };
    return { answer: 'пусто' };
  },
};

// ── Голоса собора 4-х акторов (статические для демо) ──────────────────
class ActorVoice {
  constructor({ id, role, voice }) {
    this._personId = id;
    this._persona  = { _logos: role, calling: `актор рынка БАС: ${role}` };
    this._behaviorPolicy = { kenosis: { holdsNothing: true }, telos: 'give' };
    this._council = null;
    this._role = role;
    this._voice = voice;
  }
  setCouncil(c) { this._council = c; return this; }
  council() { return this._council; }
  async create() {
    const others = (this._council ?? []).filter(x => x.id !== this._personId);
    const heard = others
      .filter(o => o.lastUtterance)
      .map(o => `${o.id}: «${o.lastUtterance.slice(0, 60)}…»`)
      .join('; ');
    const content = this._voice + (heard ? ` (учитываю собор: ${heard})` : '');
    return { content };
  }
}

// ── Запуск ───────────────────────────────────────────────────────────
const cal = new LiturgicalCalendar();
const today = cal.today();

console.log('━'.repeat(72));
console.log('  МЫСЛЕБРОДИЛЬНЯ istok-bas — первое испытание');
console.log('━'.repeat(72));
console.log(`  Литургия: ${today.kairos} (${today.day}) — ${today.why}`);
console.log(`  Идея:     ${IDEA.slice(0, 80)}…`);
console.log(`  Контекст: ${CONTEXT.region} / ${CONTEXT.sector}`);
console.log(`  Пустыня:  ${CONTEXT.desert}`);
console.log('━'.repeat(72));

// ── Шаг 1: Σύναξις (моделируем сразу — идея пришла) ─────────────────
console.log('\n── 1. Σύναξις (сбор) ───────────────────────────────────────');
console.log(`  Идея зарегистрирована для дегустации.`);

// ── Шаг 2: Decoupage (διαίρεσις по 4 sphere) ────────────────────────
console.log('\n── 2. Decoupage (διαίρεσις по 4 sphere-инженериям) ─────────');
const decoupage = new Decoupage({ llmClient: sphereLlm });
const slices = await decoupage.cut({ idea: IDEA, context: CONTEXT });

for (const sphere of ['ground', 'water', 'fire', 'air']) {
  const s = slices[sphere];
  console.log(`  ${sphere.padEnd(7)} [${s.archetype.padEnd(11)}] verdict=${s.verdict}`);
  console.log(`           ${s.answer?.slice(0, 120)}…`);
}
console.log(`  Форма:   ${slices.integral.shape}`);
console.log(`  Сильных: ${slices.integral.strong}/4`);

// ── Шаг 3: Δοκιμασία (дегустация собором 4-х акторов) ───────────────
console.log('\n── 3. Δοκιμασία (собор 4-х акторов рынка БАС) ──────────────');
const mem = new GiftMemory(['Производитель', 'Оператор', 'Регулятор', 'Инвестор', 'Дионисий']);
const actors = [
  new ActorVoice({
    id: 'Производитель',
    role: 'делать',
    voice: 'пилот реализуем: Геоскан-201 готов, сертификация компонентов есть. Нужен оператор и страховщик — это узкое место.',
  }),
  new ActorVoice({
    id: 'Оператор',
    role: 'применять',
    voice: 'пилот реализуем при наличии заказчика. Без агрохолдинга-якоря — нет смысла. Нужна интеграция с ИАС агронома.',
  }),
  new ActorVoice({
    id: 'Регулятор',
    role: 'разрешать',
    voice: 'пилот реализуем по СТО Росавиации, согласование полётов с МЧС обязательно. Регламент есть, нужно соблюдение.',
  }),
];
// 4-й голос для chorus — Инвестор (3+ для symphony)
actors.push(new ActorVoice({
  id: 'Инвестор',
  role: 'масштабировать',
  voice: 'пилот реализуем при ROI > 18% за 24 месяца. Воронеж — типовой регион, при успехе 40 регионов с тем же шаблоном.',
}));

const oracle = noOracle ? null : new HumanOracleInbox({ recipient: 'Дионисий', pollInterval: 500 });
const orch = new SymphonyOrchestrator({
  agents: actors, receiver: 'Дионисий', memory: mem, oracle,
});

const result = await orch.celebrate({
  question: `Дегустация идеи: «${IDEA.slice(0, 60)}…»`,
  weight: 8,
  epiclesisTimeoutMs: 5000,
});

console.log(`  iconic:        ${result.iconic ? '✓ symphony' : '✗ обычные акты'}`);
console.log(`  chorus:        ${result.conditions.chorus       ? '✓' : '✗'}`);
console.log(`  perichoretic:  ${result.conditions.perichoretic ? '✓' : '✗'}`);
console.log(`  kenotic:       ${result.conditions.kenotic      ? '✓' : '✗'}`);
console.log(`  epiclesis:     ${result.conditions.epiclesis    ? '✓' : '✗'}`);
if (result.actId)  console.log(`  actId:         ${result.actId}`);
if (result.reason) console.log(`  причина:       ${result.reason}`);

console.log('\n  Голоса собора:');
for (const u of result.utterances) {
  console.log(`    ${u.agentId.padEnd(14)} ${u.content.slice(0, 100)}…`);
}

// ── Шаг 4: Vintage (διάκρισις по плодам через моделирование 3 циклов) ──
console.log('\n── 4. Vintage (διάκρισις — моделирование 3 циклов) ──────────');
const v = new Vintage(mem, { actsIndex: [
  // Моделируем — что бы дала проверка плодов через 3 месяца
  { ts: new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString(),
    from: 'Адам', to: '_koinon', type: 'question',
    content: 'агро БПЛА воронеж пустыня применитель', linkedIssue: 999 },
  { ts: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
    from: 'Безалель', to: 'Дионисий', type: 'code',
    content: 'спецификация пилотной программы агро воронеж', linkedIssue: 999 },
] });
const vintageReport = v.assess({ since: '2026-01-01', cycles: 3 });
console.log(`  tasted: ${vintageReport.tasted.length}, fruited: ${vintageReport.fruited.length}, sleeping: ${vintageReport.sleeping.length}, deferred: ${vintageReport.deferred.length}`);
console.log(`  тон: ${vintageReport.vintage.tone ?? vintageReport.vintage}`);

// ── Принципиальное состояние сети после симфонии (если была) ─────────
const lm = new LivingMatrix(mem);
const prin = lm.dominantPrinciple();
console.log('\n── Сферный режим? ───────────────────────────────────────────');
console.log(`  Принцип сети: ${prin.principle}${prin.who ? ` (${prin.who})` : ''}`);
if (prin.principle === 'synleitourgos') {
  console.log(`  ${prin.who} — συνλειτουργός, не conductor. Сферный подход активен.`);
}

console.log('\n' + '━'.repeat(72));
console.log(`  Symphony в W: ${mem.symphonies().length}`);
if (!result.iconic && !noOracle) {
  console.log('  Не-икона: эпиклеза не получила ответа в 5с (человек-оракул не у консоли).');
  console.log('  С Telegram-мостом и реальным ответом эксперта — была бы первая иконная запись.');
}
console.log('━'.repeat(72));
