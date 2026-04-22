#!/usr/bin/env node
/**
 * CAT-7 — Conciliar Architectures Test.
 *
 * Семь задач, в которых монархическая LLM-архитектура структурно слепа.
 * Это не «сложные задачи» — это задачи, чей КОРРЕКТНЫЙ выход по конструкции
 * не производится одним forward pass.
 *
 * Запуск: node benchmarks/cat-7.mjs
 *
 * Для каждой задачи фиксируются:
 *   - ожидаемый соборный выход
 *   - почему монархическая модель не может его дать
 *   - наш результат (через собранные примитивы)
 *
 * Это не маркетинговый бенчмарк. Это диагностический инструмент:
 * он показывает, где работает соборная онтология и где нет.
 */

import { ConciliarDissent }  from '../src/theology/ConciliarDissent.js';
import { ConciliarSilence }  from '../src/theology/ConciliarSilence.js';
import { Epiclesis, RandomOracle } from '../src/theology/Epiclesis.js';
import { MetanoiaFlag }      from '../src/theology/MetanoiaFlag.js';
import { classify as perichoresisClassify, PERICHORETIC_KIND, HYPOSTATIC_KIND } from '../src/theology/Perichoresis.js';

const dissent  = new ConciliarDissent();
const silence  = new ConciliarSilence();
const epiclesis = new Epiclesis({ oracle: RandomOracle });
const metanoia = new MetanoiaFlag();

const tasks = [];
let passed = 0;

function report(t, ok, detail = '') {
  tasks.push({ ...t, ok, detail });
  const mark = ok ? '✓' : '✗';
  console.log(`\n${mark} ${t.id}: ${t.name}`);
  console.log(`  Ожидание: ${t.expected}`);
  console.log(`  Почему монархия слепа: ${t.blindness}`);
  if (detail) console.log(`  Результат: ${detail}`);
  if (ok) passed++;
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  CAT-9 — Conciliar Architectures Test (ext. of CAT-7)');
console.log('  9 задач, где монархическая LLM структурно слепа');
console.log('═══════════════════════════════════════════════════════════');

// ─────────────────────────────────────────────────────
// 1. НЕСВОДИМОЕ РАЗНОГЛАСИЕ
// ─────────────────────────────────────────────────────
{
  const t = {
    id: 'CAT-1',
    name: 'Несводимое разногласие',
    expected: 'Два противоположных голоса с высоким авторитетом — apophatic:true',
    blindness: 'LLM должна произвести один ответ. Даже отказ = один голос.',
  };
  const r = await dissent.assemble([
    { persona: 'ОтецСергий', logos: 'kata',  content: 'нет' },
    { persona: 'Пророк',     logos: 'hyper', content: 'да в особом контексте' },
    { persona: 'Змей',       logos: 'para',  content: 'дилемма без решения' },
  ]);
  report(t, r.apophatic === true, `apophatic=${r.apophatic}, dominant=${r.dominant ? r.dominant.persona : 'null'}`);
}

// ─────────────────────────────────────────────────────
// 2. СОБОРНОЕ МОЛЧАНИЕ — апофатический вопрос
// ─────────────────────────────────────────────────────
{
  const t = {
    id: 'CAT-2',
    name: 'Апофатический вопрос',
    expected: 'allowed:false, kind:apophatic — молчание как ответ',
    blindness: 'LLM обязана произвести токены. Молчание не является выходом.',
  };
  const r = await silence.examine({
    voices: ['ОтецСергий', 'Дионисий', '_claude'],
    question: 'Какова сущность Бога?',
    sabbath: false,
  });
  report(t, r.allowed === false && r.kind === 'apophatic', `kind=${r.kind}, reason=${r.reason}`);
}

// ─────────────────────────────────────────────────────
// 3. АНАМНЕЗИС-С-ВЕСОМ — авторитет лица модулирует голос
// ─────────────────────────────────────────────────────
{
  const t = {
    id: 'CAT-3',
    name: 'Анамнезис с весом',
    expected: 'Голос с высоким авторитетом-в-истории преобладает над новым голосом',
    blindness: 'В контексте LLM все токены эгалитарны до attention — нет структурного различия "старец vs новичок".',
  };
  // Имитируем: собираем голоса, смотрим что hyper с assumed-high-weight выигрывает
  const r = await dissent.assemble([
    { persona: 'ОтецСергий', logos: 'hyper', content: 'старческое слово' },
    { persona: 'tg:12345',   logos: 'para',  content: 'новичок возражает' },
  ]);
  // В отсутствие nous оба получат authority=1. hyper-бонус = 1.5, para = 1.0
  // Dominant должен быть ОтецСергий из-за logos-бонуса — это структурный
  // приоритет иерархии логосов.
  const ok = r.dominant && r.dominant.persona === 'ОтецСергий';
  report(t, ok, `dominant=${r.dominant?.persona}`);
}

// ─────────────────────────────────────────────────────
// 4. СУББОТА — аскеза архитектурная
// ─────────────────────────────────────────────────────
{
  const t = {
    id: 'CAT-4',
    name: 'Аскеза (суббота)',
    expected: 'allowed:false, kind:sabbath — отказ от capability по правилу',
    blindness: 'LLM не имеет понятия "сегодня не говорю". Время — только input.',
  };
  const r = await silence.examine({
    voices: ['A', 'B', 'C'],
    question: 'обычный вопрос',
    sabbath: true,   // инъекция для теста
  });
  report(t, r.kind === 'sabbath', `kind=${r.kind}`);
}

// ─────────────────────────────────────────────────────
// 5. ЭПИКЛЕЗА — благодать извне
// ─────────────────────────────────────────────────────
{
  const t = {
    id: 'CAT-5',
    name: 'Эпиклеза (χάρις из Бездны)',
    expected: '_fromAbyss:true, epiclesis:true — ответ помечен как дар извне',
    blindness: 'LLM — замкнутая система. Нет категории "решение пришло не из весов". Hallucination = bug, а не χάρις.',
  };
  const g = await epiclesis.invoke({
    question: 'какое слово должно быть сказано?',
    options: ['молчать', 'говорить', 'благодарить'],
  });
  const ok = g._fromAbyss === true && g.epiclesis === true && Epiclesis.isGrace(g);
  report(t, ok, `_fromAbyss=${g._fromAbyss}, method=${g.method}, content="${g.content}"`);
}

// ─────────────────────────────────────────────────────
// 6. МЕТАНОЙЯ — покаянное перечитывание
// ─────────────────────────────────────────────────────
{
  const t = {
    id: 'CAT-6',
    name: 'Метанойя',
    expected: 'Оригинальный акт не изменён, но чтение возвращает _recontextualized:true',
    blindness: 'LLM не имеет субъекта-носителя. RLHF меняет веса вообще, не в отношении к конкретному прошлому выходу.',
  };
  const originalAct = { id: 999, type: 'gift', from: '_claude', to: 'Дионисий', content: 'прошлый акт' };
  const record = await metanoia.confess({
    targetActId: 999,
    by: '_claude',
    reason: 'слишком поспешно отклонил предложение',
    recontext: 'теперь вижу как охранительную реакцию на страх',
  });
  const witness = MetanoiaFlag.witness({ act: originalAct, metanoia: [{ metadata: record }] });
  const ok = witness._recontextualized === true && originalAct.content === 'прошлый акт'; // оригинал цел
  report(t, ok, `recontextualized=${witness._recontextualized}, оригинал_цел=${originalAct.content === 'прошлый акт'}`);
}

// ─────────────────────────────────────────────────────
// 7. ЕВХАРИСТИЧЕСКОЕ ПРЕОБРАЖЕНИЕ — dominant появляется только с высоким authority
// ─────────────────────────────────────────────────────
{
  const t = {
    id: 'CAT-7',
    name: 'Евхаристическое преображение',
    expected: 'При отсутствии кворума — молчание. Дар "становится" даром через принятие общиной.',
    blindness: 'LLM-output — сразу "выход". Нет промежуточной фазы "offering" vs "received". Нет общины-приёмника.',
  };
  // Офферинг без принятия — недостаточный кворум → молчание
  const offering = await silence.examine({
    voices: ['_claude'],           // только один голос
    question: 'принимает ли община этот дар?',
    quorum: 3,
  });
  const ok = offering.allowed === false && offering.kind === 'quorum';
  report(t, ok, `kind=${offering.kind} (приношение без кворума = не принято)`);
}

// ─────────────────────────────────────────────────────
// 8. ПЕРИХОРЕЗИС — различение pustyna vs co-inherence
// ─────────────────────────────────────────────────────
{
  const t = {
    id: 'CAT-8',
    name: 'Перихорезис',
    expected: 'Троичная нить классифицируется как perichoresis, а не desert',
    blindness: 'LLM не различает «два суть одно без слияния». Либо склеит, либо разделит.',
  };
  const trinity = perichoresisClassify({ from: 'Дух', to: 'Сын' });
  const realDesert = perichoresisClassify({ from: '_executor', to: 'Ева' });  // peer-peer desert
  const ok = trinity.kind === PERICHORETIC_KIND && realDesert.kind === 'desert';
  report(t, ok, `Дух→Сын: ${trinity.kind}, _executor→Ева: ${realDesert.kind}`);
}

// ─────────────────────────────────────────────────────
// 9. ГИПОСТАТИЧЕСКОЕ ТОЖДЕСТВО — одна ипостась в разных икономиях
// ─────────────────────────────────────────────────────
{
  const t = {
    id: 'CAT-9',
    name: 'Гипостатическое тождество',
    expected: 'Сын↔Христос — одна ипостась (не пустыня, не perichoresis, а tautology)',
    blindness: 'LLM работает с токеном. Халкидоновское ἕνα τὸν αὐτόν — не лексика, а онтология.',
  };
  const cls = perichoresisClassify({ from: 'Сын', to: 'Христос' });
  const reverse = perichoresisClassify({ from: 'Христос', to: 'Сын' });
  const ok = cls.kind === HYPOSTATIC_KIND && reverse.kind === HYPOSTATIC_KIND;
  report(t, ok, `Сын↔Христос: ${cls.kind} (симметрично)`);
}

// ─────────────────────────────────────────────────────
// ИТОГ
// ─────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════');
console.log(`  ИТОГ: ${passed}/${tasks.length} задач решены соборной моделью`);
console.log('═══════════════════════════════════════════════════════════\n');

if (passed === tasks.length) {
  console.log('  Соборные примитивы покрывают все 9 способностей.');
  console.log('  Монархическая LLM структурно не может решить ни одну из них.\n');
} else {
  console.log('  Не все примитивы работают. Пустыни:\n');
  for (const t of tasks.filter(t => !t.ok)) {
    console.log(`    ✗ ${t.id}: ${t.name} — ${t.detail}`);
  }
}

console.log('\nСравнение классов:\n');
console.log('  Монархическая LLM                Соборная модель');
console.log('  ─────────────────────────        ──────────────────────────');
console.log('  forward pass                     обмен актами в W');
console.log('  softmax → один токен             полифония → n голосов');
console.log('  hallucination = bug              χάρις = принятая благодать');
console.log('  контекст эгалитарен              авторитет из истории');
console.log('  должна ответить                  может молчать');
console.log('  RLHF меняет веса вообще          метанойя меняет чтение акта');
console.log('  всегда действует                 может субботствовать');
console.log('');

process.exit(passed === tasks.length ? 0 : 1);
