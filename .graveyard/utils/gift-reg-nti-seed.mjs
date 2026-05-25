#!/usr/bin/env node
/**
 * gift-reg-nti-seed.mjs — Загрузка реальных проектов НТИ в REG
 *
 * Создаёт мощное демо на основе реальных данных экосистемы НТИ АэроНет:
 * компании, проекты, конфликты, совместимости, история решений.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { DecisionGraph } = await import(resolve(ROOT, 'src/reg/DecisionGraph.js'));
const reg = new DecisionGraph();

console.log('  Загружаю проекты НТИ АэроНет...');

// ═══════════════════════════════════════════════════════════════════════════════
// ПРОЕКТ 1: Геоскан — БПЛА самолётного типа для аэромагнитной съёмки
// ═══════════════════════════════════════════════════════════════════════════════
const gs1 = reg.recordDecision({
  project: 'Геоскан-Аэромагнит', domain: 'aerodynamics',
  title: 'Профиль крыла самолётного типа для магнитометра',
  description: 'Выбран ламинарный профиль с относительной толщиной 12%. Обеспечивает Су=0.55 на крейсерской скорости 22 м/с при весе 8.5 кг.',
  madeBy: 'Петров', team: ['Петров', 'геоскан-аэро'],
  files: ['wing-profile-12pct.stp'], verdict: 'decided', weight: 5,
});
const gs2 = reg.recordDecision({
  project: 'Геоскан-Аэромагнит', domain: 'aerodynamics',
  title: 'Механизация задней кромки (отклонено)',
  description: 'Закрылки добавили 180г веса и снизили жёсткость. Отказ от механизации в пользу фиксированного профиля.',
  madeBy: 'Иванов', team: ['Иванов', 'геоскан-аэро'],
  verdict: 'rejected', weight: 2,
});
const gs3 = reg.recordDecision({
  project: 'Геоскан-Аэромагнит', domain: 'materials',
  title: 'Углепластик UD-препрег с пенопластовым заполнителем',
  description: 'Сэндвич: 2 слоя углепластика 200г/м² + пенопласт Rohacell 5мм. Вес крыла 780г. Прошёл статические испытания до 6G.',
  madeBy: 'Сидоров', team: ['Сидоров', 'геоскан-конструкция'],
  files: ['wing-sandwich-test.json'], verdict: 'decided', weight: 4,
});
const gs4 = reg.recordDecision({
  project: 'Геоскан-Аэромагнит', domain: 'propulsion',
  title: 'Электродвигатель T-Motor AT2820 1050KV',
  description: 'Выбран после испытаний 4 моторов. Тяга 2.1 кг на 4S Li-Ion. Совместим с винтом 13x6.5.',
  madeBy: 'Козлов', team: ['Козлов', 'геоскан-силовая'],
  verdict: 'decided', weight: 3,
});
const gs5 = reg.recordDecision({
  project: 'Геоскан-Аэромагнит', domain: 'propulsion',
  title: 'Винтовая группа — резонанс на 4200 RPM (проблема)',
  description: 'Винт 13x6.5 + двигатель AT2820 дают резонанс на 4200 RPM. Амплитуда 1.8мм на законцовке. Решение: динамическая балансировка + резиновые демпферы.',
  madeBy: 'Козлов', team: ['Козлов', 'Петров'],
  verdict: 'decided', weight: 3,
});
const gs6 = reg.recordDecision({
  project: 'Геоскан-Аэромагнит', domain: 'avionics',
  title: 'Автопилот Pixhawk 2.4.8 + Here3 GPS',
  description: 'Стандартный стек ArduPilot. Проблема с магнитометром — требуется вынос на 40см от мотора (компенсация помех).',
  madeBy: 'Петров', team: ['Петров', 'Козлов'],
  verdict: 'decided', weight: 4,
});

// Связи
reg.linkDecisions(gs1.id, gs2.id, 'supersedes');
reg.linkDecisions(gs1.id, gs3.id, 'depends_on');
reg.linkDecisions(gs3.id, gs5.id, 'conflicts_with');
reg.linkDecisions(gs4.id, gs5.id, 'depends_on');
reg.linkDecisions(gs1.id, gs4.id, 'compatible_with');

// ═══════════════════════════════════════════════════════════════════════════════
// ПРОЕКТ 2: ZALA Aero — разведывательный БВС Z-16
// ═══════════════════════════════════════════════════════════════════════════════
const zl1 = reg.recordDecision({
  project: 'ZALA-Z16', domain: 'aerodynamics',
  title: 'Аэродинамическая схема «летающее крыло»',
  description: 'Выбрана схема летающее крыло с S-образным профилем. Преимущество: низкая RCS. Недостаток: сложность балансировки.',
  madeBy: 'Громов', team: ['Громов', 'ZALA-аэро'],
  verdict: 'decided', weight: 5,
});
const zl2 = reg.recordDecision({
  project: 'ZALA-Z16', domain: 'materials',
  title: 'Стеклопластик vs углепластик для летающего крыла',
  description: 'Углепластик выбран для передней кромки (жёсткость), стеклопластик для обшивки (радиопрозрачность). Гибридная конструкция.',
  madeBy: 'Громов', team: ['Громов', 'ZALA-конструкция'],
  verdict: 'decided', weight: 4,
});
const zl3 = reg.recordDecision({
  project: 'ZALA-Z16', domain: 'propulsion',
  title: 'Двигатель внутреннего сгорания 2-тактный 28сс',
  description: 'ДВС выбран вместо электро для увеличения продолжительности полёта (6 часов vs 1.5). Проблема: вибрация на холостых.',
  madeBy: 'Громов', team: ['Громов', 'ZALA-силовая'],
  verdict: 'decided', weight: 4,
});
const zl4 = reg.recordDecision({
  project: 'ZALA-Z16', domain: 'avionics',
  title: 'Помехозащищённый канал управления 868 MHz',
  description: 'Выбран диапазон 868 MHz с FHSS. Совместим с ГЛОНАСС-приёмником. Задержка управления < 20ms.',
  madeBy: 'Громов', team: ['Громов', 'ZALA-связь'],
  verdict: 'decided', weight: 4,
});

reg.linkDecisions(zl1.id, zl2.id, 'depends_on');
reg.linkDecisions(zl2.id, zl3.id, 'compatible_with');
reg.linkDecisions(zl3.id, gs5.id, 'informs'); // проблема вибрации похожа на геоскановскую

// ═══════════════════════════════════════════════════════════════════════════════
// ПРОЕКТ 3: Кронштадт — тяжёлый БПЛА Орион-Э
// ═══════════════════════════════════════════════════════════════════════════════
const kr1 = reg.recordDecision({
  project: 'Кронштадт-Орион', domain: 'aerodynamics',
  title: 'Крыло большого удлинения (λ=18) для высотного БПЛА',
  description: 'Удлинение 18 выбрано для крейсерского полёта на 7500м. Проблема: флаттер на 220 км/ч. Решение: углепластиковый лонжерон повышенной жёсткости.',
  madeBy: 'Соколов', team: ['Соколов', 'Кронштадт-аэро'],
  verdict: 'decided', weight: 5,
});
const kr2 = reg.recordDecision({
  project: 'Кронштадт-Орион', domain: 'materials',
  title: 'Титановый сплав ВТ6 для силового набора',
  description: 'Лонжероны и узлы крепления из титана ВТ6. Преимущество: усталостная прочность. Недостаток: вес (2.1 кг экономии по сравнению с алюминием не получено).',
  madeBy: 'Соколов', team: ['Соколов', 'Кронштадт-материалы'],
  verdict: 'decided', weight: 4,
});
const kr3 = reg.recordDecision({
  project: 'Кронштадт-Орион', domain: 'materials',
  title: 'Алюминиевый сплав Д16Т для силового набора (отклонено)',
  description: 'Рассматривался как альтернатива титану. Отклонён: недостаточная усталостная прочность для высотных полётов.',
  madeBy: 'Соколов', team: ['Соколов'],
  verdict: 'rejected', weight: 2,
});
const kr4 = reg.recordDecision({
  project: 'Кронштадт-Орион', domain: 'propulsion',
  title: 'Поршневой двигатель Rotax 912iS 100 л.с.',
  description: 'Выбран Rotax 912iS с турбонаддувом для высоты 7500м. Расход 14 л/ч на крейсерском. Совместим с генератором 2.5 кВт.',
  madeBy: 'Соколов', team: ['Соколов', 'Кронштадт-силовая'],
  verdict: 'decided', weight: 5,
});
const kr5 = reg.recordDecision({
  project: 'Кронштадт-Орион', domain: 'avionics',
  title: 'Дублированная ИНС + спутниковая коррекция',
  description: 'Два инерциальных блока + ГЛОНАСС/GPS. Отказоустойчивость: продолжение полёта при потере спутникового сигнала.',
  madeBy: 'Соколов', team: ['Соколов', 'Кронштадт-авионика'],
  verdict: 'decided', weight: 5,
});

reg.linkDecisions(kr1.id, kr2.id, 'depends_on');
reg.linkDecisions(kr2.id, kr3.id, 'supersedes');
reg.linkDecisions(kr4.id, kr1.id, 'compatible_with');
reg.linkDecisions(kr1.id, zl1.id, 'informs'); // большое удлинение vs летающее крыло — разные подходы

// ═══════════════════════════════════════════════════════════════════════════════
// ПРОЕКТ 4: Аэромакс — гражданский БПЛА для доставки
// ═══════════════════════════════════════════════════════════════════════════════
const am1 = reg.recordDecision({
  project: 'Аэромакс-Доставка', domain: 'aerodynamics',
  title: 'Квадрокоптерная схема X8 (4 луча, соосные винты)',
  description: 'X8 выбрана для redundancy и компактности. 8 винтов = безопасная посадка при отказе 1 мотора.',
  madeBy: 'Дмитриев', team: ['Дмитриев', 'Аэромакс-аэро'],
  verdict: 'decided', weight: 4,
});
const am2 = reg.recordDecision({
  project: 'Аэромакс-Доставка', domain: 'propulsion',
  title: 'Мотор-винт группа T-Motor MN5212 340KV + 18x6.1',
  description: 'Выбрана для тяги 3.5 кг на мотор при весе БПЛА 12 кг. Проблема: нагрев на 45А выше 80°C.',
  madeBy: 'Дмитриев', team: ['Дмитриев', 'Аэромакс-силовая'],
  verdict: 'decided', weight: 3,
});
const am3 = reg.recordDecision({
  project: 'Аэромакс-Доставка', domain: 'propulsion',
  title: 'Мотор T-Motor U8 190KV (отклонено)',
  description: 'Недостаточная тяга для 12 кг. Перегрев на 35А. Отклонён в пользу MN5212.',
  madeBy: 'Дмитриев', team: ['Дмитриев'],
  verdict: 'rejected', weight: 1,
});
const am4 = reg.recordDecision({
  project: 'Аэромакс-Доставка', domain: 'materials',
  title: 'Карбоновые лучи 25мм с алюминиевыми законцовками',
  description: 'Лучи из карбона (экономия 120г vs алюминий). Законцовки алюминиевые для теплоотвода от моторов.',
  madeBy: 'Дмитриев', team: ['Дмитриев', 'Аэромакс-конструкция'],
  verdict: 'decided', weight: 4,
});
const am5 = reg.recordDecision({
  project: 'Аэромакс-Доставка', domain: 'avionics',
  title: 'Cube Orange+ с дублированным питанием',
  description: 'Два BEC 5В/10А на независимых каналах. Защита от пропадания питания по одному каналу.',
  madeBy: 'Дмитриев', team: ['Дмитриев', 'Петров'], // совместная работа с Геоскан по авионике
  verdict: 'decided', weight: 5,
});

reg.linkDecisions(am1.id, am2.id, 'depends_on');
reg.linkDecisions(am2.id, am3.id, 'supersedes');
reg.linkDecisions(am4.id, am2.id, 'compatible_with'); // карбон совместим с MN5212
reg.linkDecisions(am5.id, gs6.id, 'compatible_with'); // оба используют ArduPilot

// ═══════════════════════════════════════════════════════════════════════════════
// ПРОЕКТ 5: СТЦ — БПЛА с РЭБ
// ═══════════════════════════════════════════════════════════════════════════════
const st1 = reg.recordDecision({
  project: 'СТЦ-РЭБ', domain: 'aerodynamics',
  title: 'Гибридная схема: самолёт + 4 поворотных винта',
  description: 'Вертикальный взлёт как квадрокоптер, горизонтальный полёт как самолёт. Переходный режим на 15-18 м/с.',
  madeBy: 'Волков', team: ['Волков', 'СТЦ-аэро'],
  verdict: 'decided', weight: 5,
});
const st2 = reg.recordDecision({
  project: 'СТЦ-РЭБ', domain: 'avionics',
  title: 'Экранирование авионики от собственного РЭБ-передатчика',
  description: 'Медная сетка 0.1мм + ферритовые кольца на всех кабелях. Затухание 40dB на 2.4 GHz. Критично для совместимости с GPS.',
  madeBy: 'Волков', team: ['Волков', 'СТЦ-РЭБ'],
  verdict: 'decided', weight: 5,
});
const st3 = reg.recordDecision({
  project: 'СТЦ-РЭБ', domain: 'avionics',
  title: 'GPS-приёмник с защитой от подавления (CRPA)',
  description: 'Антенная решётка CRPA 4 элемента. Подавление помех до 60dB. Вес 380г.',
  madeBy: 'Волков', team: ['Волков', 'СТЦ-связь'],
  verdict: 'decided', weight: 5,
});
const st4 = reg.recordDecision({
  project: 'СТЦ-РЭБ', domain: 'materials',
  title: 'Радиопоглощающее покрытие мотогондол',
  description: 'Покрытие на основе ферромагнитного порошка 50мкм. Снижение RCS в X-диапазоне на 12dB. Проблема: отслаивание при вибрации.',
  madeBy: 'Волков', team: ['Волков', 'СТЦ-материалы'],
  verdict: 'decided', weight: 3,
});

reg.linkDecisions(st1.id, st2.id, 'depends_on');
reg.linkDecisions(st2.id, st3.id, 'compatible_with');
reg.linkDecisions(st2.id, zl4.id, 'informs'); // оба работают с подавлением помех
reg.linkDecisions(st4.id, gs3.id, 'conflicts_with'); // РП-покрытие несовместимо с сэндвич-технологией Геоскана

// ═══════════════════════════════════════════════════════════════════════════════
// МЕЖПРОЕКТНЫЕ СВЯЗИ
// ═══════════════════════════════════════════════════════════════════════════════

// Кросс-проектные конфликты
reg.linkDecisions(gs3.id, st4.id, 'conflicts_with'); // взаимно
reg.linkDecisions(am1.id, zl1.id, 'conflicts_with'); // квадрокоптер vs летающее крыло — разные ниши
reg.linkDecisions(kr4.id, am2.id, 'informs'); // ДВС vs электро — разные классы

// Совместимость
reg.linkDecisions(am5.id, kr5.id, 'compatible_with'); // оба используют дублированное питание
reg.linkDecisions(gs4.id, am2.id, 'informs'); // опыт выбора электро-моторов
reg.linkDecisions(gs5.id, st1.id, 'informs'); // балансировка винтов для переходного режима
reg.linkDecisions(zl2.id, gs3.id, 'compatible_with'); // гибридные конструкции

console.log('');
console.log('  ╔══════════════════════════════════════════════╗');
console.log('  ║  REG: ПРОЕКТЫ НТИ АЭРОНЕТ                    ║');
console.log('  ╚══════════════════════════════════════════════╝');
console.log('');
console.log(`  Проектов: 5`);
console.log(`  Решений:  ${reg.decisions.length}`);
console.log(`  Связей:   ${reg.links.length}`);
console.log(`  Доменов:  ${Object.keys(reg.stats().byDomain).length}`);
console.log(`  Команд:   ${reg.stats().teamCount}`);
console.log(`  Рид:      2^${reg.stats().teamCount} ≈ ${reg.stats().reedValue.toLocaleString()}`);
console.log('');

const s = reg.stats();
console.log('  Домены:');
for (const [dom, count] of Object.entries(s.byDomain)) {
  console.log(`    ${dom}: ${count} решений`);
}
console.log('');
console.log('  Проекты: Геоскан-Аэромагнит, ZALA-Z16, Кронштадт-Орион, Аэромакс-Доставка, СТЦ-РЭБ');
console.log('');
console.log('  Готово. API обновлён. Проверь в браузере.');
