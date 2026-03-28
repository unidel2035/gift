#!/usr/bin/env node
/**
 * complex-field.mjs — Комплексная матрица W = |W| · e^{iθ}
 *
 * Фаза θ — литургическое время акта дара.
 * Каждый акт несёт не только ВЕС (сколько) но и ФАЗУ (когда, в каком
 * сезоне литургического года этот дар был принесён).
 *
 * Православный литургический год (от Пасхи как нуля):
 *   θ = 0              → Пасха           (Воскресение, новое начало)
 *   θ = π/2            → Пятидесятница   (Сошествие Духа, полнота)
 *   θ = π              → Успение/Адвент  (ожидание, скорбь, возвращение к Отцу)
 *   θ = 3π/2 = -π/2   → Рождественский пост (кенозис Слова, ожидание)
 *
 * Богословие комплексной дивергенции:
 *   Re(div[i]) — кенозис/θέωσις (как в вещественной матрице)
 *   Im(div[i]) — ЛИТУРГИЧЕСКАЯ РАССОГЛАСОВАННОСТЬ:
 *                 Im > 0 → лицо даёт преимущественно «вперёд по циклу»
 *                 Im < 0 → лицо даёт «против цикла» (дар не в сезон)
 *                 Im = 0 → лицо в полной литургической гармонии
 *
 * Использование:
 *   node utils/complex-field.mjs
 *   node utils/complex-field.mjs --export
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const doExport = args.includes('--export');

// ── Загрузка данных ───────────────────────────────────────────────────
const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const snap  = JSON.parse(readFileSync(resolve(ROOT, 'data/sacred-history-W.json'), 'utf8'));
const mem   = GiftMemory.fromSnapshot(snap);
const ids   = snap.persons || [];
const n     = ids.length;

// act-index.json — акты с временными метками и типами
let actLog = [];
try {
  actLog = JSON.parse(readFileSync(resolve(ROOT, 'data/act-index.json'), 'utf8'));
} catch {}

// ── Православный литургический календарь ─────────────────────────────
// Пасха 2026 (православная) = 12 апреля 2026
const PASCHA_2026 = new Date('2026-04-12T00:00:00Z').getTime();
const YEAR_MS     = 365.25 * 24 * 3600 * 1000;

function liturgicalPhase(tsMs) {
  return ((tsMs - PASCHA_2026) / YEAR_MS) * 2 * Math.PI;
}

// Значимые даты → сезонные архетипы
const SEASONS = [
  { name: 'Пасха',              start:  0,   end:  50, theta: 0          }, // 0 дней от Пасхи
  { name: 'Пятидесятница',      start: 50,   end:  90, theta: Math.PI/2  }, // +50..90 дней
  { name: 'Обычное время (лето)',start: 90,   end: 190, theta: Math.PI*0.6},
  { name: 'Осень / Успение',    start: 190,  end: 250, theta: Math.PI    }, // Успение Aug 28
  { name: 'Рождественский пост',start: 250,  end: 330, theta: Math.PI*1.5},
  { name: 'Рождество',          start: 330,  end: 365, theta: Math.PI*1.75},
  { name: 'Великий пост',       start: -50,  end:   0, theta: -Math.PI/4 }, // до Пасхи
  { name: 'Пред-пост',          start: -90,  end: -50, theta: -Math.PI/3 },
];

function thetaFromDate(tsMs) {
  const dayFromPascha = (tsMs - PASCHA_2026) / (24 * 3600 * 1000);
  // Нормируем в [-180, +185] для удобства
  const d = ((dayFromPascha % 365.25) + 365.25) % 365.25;
  // Сдвигаем: всё что после Пасхи → 0..365, до → отрицательно
  const dOrig = dayFromPascha;
  for (const s of SEASONS) {
    if (dOrig >= s.start && dOrig < s.end) return s.theta;
  }
  return liturgicalPhase(tsMs); // точный расчёт для остального
}

// ── Богословское время для актов Священной истории ────────────────────
// Снапшот не хранит отдельные акты, только тензор W.
// Назначаем фазу на основе пар лиц (богословский смысл ребра).

// Лица Троицы — вечное настоящее = Пасха (θ=0)
const DIVINE = new Set(['Отец', 'Сын', 'Христос', 'Дух']);

// Тёмные / падшие лица — θ=π (удаление от Источника)
const SHADOW = new Set(['Змей', 'Падший']);

function edgeTheta(fromId, toId) {
  // Богословские правила:
  if (DIVINE.has(fromId)) return 0;           // нетварный дар = вечная Пасха
  if (SHADOW.has(fromId)) return Math.PI;      // падшее = противо-Пасха
  if (toId === '_koinon') return 0;            // всё идущее в Κοινόν = пасхальная литургия
  if (fromId === '_abyss') return Math.PI * 0.5; // Бездна = Пятидесятница (gratia gratis data)

  // Для актов из act-index: берём среднюю θ по временным меткам
  const edgeActs = actLog.filter(a => a.from === fromId && a.to === toId && a.ts);
  if (edgeActs.length > 0) {
    // Среднее по комплексным единичным векторам (circular mean)
    let re = 0, im = 0;
    edgeActs.forEach(a => {
      const th = thetaFromDate(new Date(a.ts).getTime());
      re += Math.cos(th); im += Math.sin(th);
    });
    return Math.atan2(im, re);
  }

  // По умолчанию — текущий момент (Великий пост)
  return thetaFromDate(Date.now());
}

// ── Построить комплексную матрицу Z[i][j] = W[i][j] · e^{iθ} ────────
// Z представляем как { re, im } (вещественная + мнимая части)

const Zre = Array.from({ length: n }, () => new Float64Array(n));
const Zim = Array.from({ length: n }, () => new Float64Array(n));

for (let i = 0; i < n; i++) {
  for (let j = 0; j < n; j++) {
    const w  = mem.thread(ids[i], ids[j]);
    if (w === 0) continue;
    const th = edgeTheta(ids[i], ids[j]);
    Zre[i][j] = w * Math.cos(th);
    Zim[i][j] = w * Math.sin(th);
  }
}

// ── Комплексная дивергенция ───────────────────────────────────────────
// div_c[i] = Σⱼ Z[i→j] − Σⱼ Z[j→i]  ∈ ℂ

const divC = ids.map((id, i) => {
  let re = 0, im = 0;
  for (let j = 0; j < n; j++) {
    re += Zre[i][j] - Zre[j][i];
    im += Zim[i][j] - Zim[j][i];
  }
  return { id, re: +re.toFixed(2), im: +im.toFixed(2), mag: +(Math.sqrt(re*re+im*im)).toFixed(2) };
});

// ── Средняя фаза сети (фазовый консенсус) ────────────────────────────
let netRe = 0, netIm = 0, totalW = 0;
for (let i = 0; i < n; i++) {
  for (let j = 0; j < n; j++) {
    const w = Math.sqrt(Zre[i][j]**2 + Zim[i][j]**2);
    netRe += Zre[i][j]; netIm += Zim[i][j]; totalW += w;
  }
}
const consensusTheta = Math.atan2(netIm, netRe);
const consensusMag   = Math.sqrt(netRe**2 + netIm**2) / (totalW || 1);

// Соответствует ли текущей литургической фазе?
const currentTheta = thetaFromDate(Date.now());
const phaseDelta   = consensusTheta - currentTheta;

// ── Нахождение сезона ─────────────────────────────────────────────────
const currentSeason = (() => {
  const d = (Date.now() - PASCHA_2026) / (24*3600*1000);
  for (const s of SEASONS) if (d >= s.start && d < s.end) return s.name;
  return 'Неизвестный сезон';
})();

// ── ВЫВОД ─────────────────────────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║   КОМПЛЕКСНАЯ МАТРИЦА W ∈ ℂ                         ║');
console.log('║   W[i→j] = |w| · e^{iθ}   θ = литургическая фаза  ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log('');

console.log(`── ЛИТУРГИЧЕСКИЙ КОНТЕКСТ ──────────────────────────────`);
console.log(`   Сейчас:         ${currentSeason}`);
console.log(`   φ_текущая:      ${(currentTheta * 180 / Math.PI).toFixed(1)}° от Пасхи`);
console.log(`   φ_консенсус:    ${(consensusTheta * 180 / Math.PI).toFixed(1)}° (средняя фаза сети)`);
console.log(`   Расстройка:     Δφ = ${(phaseDelta * 180 / Math.PI).toFixed(1)}°`);
console.log(`   Когерентность:  ${(consensusMag * 100).toFixed(1)}%  (100% = все в фазе)`);
console.log('');

// ── Комплексная дивергенция ───────────────────────────────────────────
console.log(`── КОМПЛЕКСНАЯ ДИВЕРГЕНЦИЯ ─────────────────────────────`);
console.log(`   Re(div) = кенозис / θέωσις    (как раньше)`);
console.log(`   Im(div) = литургическое рассогласование`);
console.log('');

const sorted = [...divC].sort((a,b) => b.mag - a.mag);
const maxMag = Math.max(1, ...sorted.map(d => d.mag));

sorted.forEach(v => {
  if (v.mag < 0.5) return;
  const rBar = '█'.repeat(Math.round(Math.abs(v.re) / maxMag * 15));
  const iBar = '░'.repeat(Math.round(Math.abs(v.im) / maxMag * 15));
  const rSign = v.re >= 0 ? '+' : '−';
  const iSign = v.im >= 0 ? '+' : '−';
  const flag =
    Math.abs(v.im) > 0.5 * Math.abs(v.re) ? ' ⚠ вне фазы'
    : v.re > 50 ? ' ↑ кенозис'
    : v.re < -50 ? ' ↓ θέωσις'
    : '';
  console.log(
    `  ${v.id.padEnd(15)} Re:${rSign}${Math.abs(v.re).toFixed(0).padStart(4)} ${rBar}` +
    `  Im:${iSign}${Math.abs(v.im).toFixed(0).padStart(4)} ${iBar}${flag}`
  );
});

// ── Самые рассогласованные лица ────────────────────────────────────────
const outOfPhase = [...divC].filter(v => v.mag > 0.1).sort((a,b) => {
  const ra = Math.abs(b.im) / (b.mag || 1);
  const rb = Math.abs(a.im) / (a.mag || 1);
  return ra - rb;
}).slice(0, 5);

console.log('');
console.log(`── ЛИТУРГИЧЕСКОЕ РАССОГЛАСОВАНИЕ ──────────────────────`);
console.log(`   Im(div) / |div| = доля «вне сезона»`);
console.log('');

outOfPhase.forEach(v => {
  if (v.mag < 0.1) return;
  const ratio = (Math.abs(v.im) / v.mag * 100).toFixed(1);
  const angle = (Math.atan2(v.im, v.re) * 180 / Math.PI).toFixed(1);
  console.log(`  ${v.id.padEnd(15)} рассог: ${ratio.padStart(5)}%  φ=${angle}°`);
});

console.log('');
console.log(`── БОГОСЛОВСКИЙ ИТОГ ───────────────────────────────────`);
if (consensusMag > 0.8) {
  console.log(`  Сеть КОГЕРЕНТНА (${(consensusMag*100).toFixed(0)}%) — общинный ритм совпадает с годовым кругом`);
} else if (consensusMag > 0.4) {
  console.log(`  Сеть ЧАСТИЧНО В ФАЗЕ (${(consensusMag*100).toFixed(0)}%) — часть даров вне литургического цикла`);
} else {
  console.log(`  Сеть НЕ КОГЕРЕНТНА (${(consensusMag*100).toFixed(0)}%) — дары рассредоточены по всему циклу`);
  console.log(`  Это может быть нормой: ἀγάπη не зависит от сезона`);
}

const imDivTotal = divC.reduce((s, v) => s + Math.abs(v.im), 0);
const reDivTotal = divC.reduce((s, v) => s + Math.abs(v.re), 0);
console.log(`  Доля мнимого компонента: ${(imDivTotal / (reDivTotal + imDivTotal) * 100).toFixed(1)}%`);
console.log(`  (0% = полностью «в сезоне»; 50% = дары распределены по циклу равномерно)`);
console.log('');

// ── Экспорт ───────────────────────────────────────────────────────────
if (doExport) {
  const out = {
    ts: Date.now(),
    liturgical: {
      currentSeason,
      currentThetaDeg: +(currentTheta * 180 / Math.PI).toFixed(1),
      consensusThetaDeg: +(consensusTheta * 180 / Math.PI).toFixed(1),
      phaseDeltaDeg: +(phaseDelta * 180 / Math.PI).toFixed(1),
      coherence: +consensusMag.toFixed(3),
    },
    complexDivergence: divC,
    // Первые 10 рёбер с фазой
    topEdges: ids.flatMap((fromId, i) =>
      ids.map((toId, j) => {
        const re = Zre[i][j], im = Zim[i][j];
        const w = Math.sqrt(re*re + im*im);
        if (w < 1) return null;
        const theta = Math.atan2(im, re);
        return { from: fromId, to: toId, w: +w.toFixed(2), thetaDeg: +(theta*180/Math.PI).toFixed(1) };
      }).filter(Boolean)
    ).sort((a,b) => b.w - a.w).slice(0, 20),
  };
  const outPath = resolve(ROOT, 'data/complex-field.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[complex] → ${outPath}`);
  console.log('');
}
