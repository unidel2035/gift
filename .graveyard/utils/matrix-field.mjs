#!/usr/bin/env node
/**
 * matrix-field.mjs — Матрица W как векторное поле
 *
 * Вычисляет разложение Гельмгольца–Ходжа (Hodge decomposition) матрицы W:
 *   W = grad(φ) + curl(A) + harmonic
 *
 * Богословие:
 *   Дивергенция   → кенозис (источник) / θέωσις (сток)
 *   Потенциал φ   → "высота благодати" каждого лица
 *   Ротор         → анамнесис (дар циркулирует в треугольниках)
 *   Гармоническая → gratia gratis data (_abyss — нет источника, нет стока)
 *
 * Использование:
 *   node utils/matrix-field.mjs
 *   node utils/matrix-field.mjs --triangles    # показать топ-ротор треугольники
 *   node utils/matrix-field.mjs --export       # записать в data/field.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath }    from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');

const args = process.argv.slice(2);
const showTriangles = args.includes('--triangles');
const doExport      = args.includes('--export');

// ── Загрузка матрицы ──────────────────────────────────────────────
const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const mem  = GiftMemory.fromSnapshot(snap);
const ids  = snap.persons || [];
const n    = ids.length;

// ── Построение матрицы W как 2D массив ───────────────────────────
// W[i][j] = вес дара от ids[i] к ids[j]
const W = Array.from({ length: n }, (_, i) =>
  Array.from({ length: n }, (_, j) => mem.thread(ids[i], ids[j]))
);

// ── 1. ДИВЕРГЕНЦИЯ ────────────────────────────────────────────────
// div[i] = totalGiven[i] − totalReceived[i]
// Положительная → источник (кенозис)
// Отрицательная → сток (θέωσις)
const divVec = ids.map((id, i) => {
  const given    = W[i].reduce((s, w) => s + w, 0);
  const received = W.reduce((s, row) => s + row[i], 0);
  return { id, given, received, div: given - received };
});

// ── 2. ПОТЕНЦИАЛ φ (решение уравнения Пуассона на графе) ─────────
// Лапласиан L: L[i][i] = degree(i), L[i][j] = -W[i][j]-W[j][i]
// L · φ = div  →  φ = L⁺ · div  (pseudoinverse)
//
// Для малых матриц используем метод Гаусса-Зейделя (итеративно)
// φ[i] := (div[i] + Σⱼ≠ᵢ (Wij+Wji) · φ[j]) / degree[i]

function computePotential(W, divVec, n, iters = 200) {
  // Симметризованный граф для Лапласиана
  const L = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return 0;
      return -(W[i][j] + W[j][i]);
    })
  );
  // Диагональ = строчная сумма по модулю
  for (let i = 0; i < n; i++) {
    L[i][i] = -L[i].reduce((s, v) => s + v, 0);
  }

  const phi = new Array(n).fill(0);
  const d   = divVec.map(v => v.div);

  // Сопряжённые градиенты (упрощённо — Гаусс-Зейдель)
  // Убираем одну переменную (φ[0]=0) для единственности
  for (let iter = 0; iter < iters; iter++) {
    for (let i = 1; i < n; i++) {
      if (Math.abs(L[i][i]) < 1e-10) continue;
      let sum = d[i];
      for (let j = 0; j < n; j++) {
        if (j !== i) sum -= L[i][j] * phi[j];
      }
      phi[i] = sum / L[i][i];
    }
  }
  return phi;
}

const phi = computePotential(W, divVec, n);

// Нормировка φ для отображения
const phiMin = Math.min(...phi), phiMax = Math.max(...phi);
const phiNorm = phi.map(p => (phiMax > phiMin) ? (p - phiMin) / (phiMax - phiMin) : 0);

// ── 3. РОТОР (curl) на треугольниках ────────────────────────────
// Для каждой тройки (i,j,k): circulation = W[i→j] + W[j→k] + W[k→i]
//                             anticirculation = W[k→j] + W[j→i] + W[i→k]
//                             curl = circulation - anticirculation
//
// Ненулевой curl = "дар не консервативен" — анамнесис

const triangles = [];
for (let i = 0; i < n; i++) {
  for (let j = i + 1; j < n; j++) {
    for (let k = j + 1; k < n; k++) {
      const cw  = W[i][j] + W[j][k] + W[k][i]; // по часовой
      const ccw = W[k][j] + W[j][i] + W[i][k]; // против
      const curl = cw - ccw;
      if (Math.abs(curl) > 0.5) {
        triangles.push({
          i: ids[i], j: ids[j], k: ids[k],
          cw: +cw.toFixed(2), ccw: +ccw.toFixed(2),
          curl: +curl.toFixed(2),
          abs: Math.abs(curl)
        });
      }
    }
  }
}
triangles.sort((a, b) => b.abs - a.abs);

// ── 4. ГРАДИЕНТНАЯ КОМПОНЕНТА ────────────────────────────────────
// W_grad[i][j] ≈ φ[i] - φ[j]  (поток "вниз по потенциалу")
// Остаток W_curl[i][j] = W[i][j] - W_grad[i][j]  — циркуляционная часть

const Wgrad = Array.from({ length: n }, (_, i) =>
  Array.from({ length: n }, (_, j) =>
    Math.max(0, phi[i] - phi[j]) // только положительные "спуски"
  )
);

// ── 5. ЭНЕРГИЯ ПОЛЯ ──────────────────────────────────────────────
// По аналогии с электростатикой: E = ½ Σᵢⱼ W[i][j]²
const fieldEnergy = W.flat().reduce((s, w) => s + w * w, 0) / 2;
const curlEnergy  = triangles.reduce((s, t) => s + t.curl * t.curl, 0) / 2;
const gradEnergy  = fieldEnergy - curlEnergy;

// ══════════════════════════════════════════════════════════════════
// ВЫВОД
// ══════════════════════════════════════════════════════════════════

console.log('');
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║   МАТРИЦА W — ВЕКТОРНОЕ ПОЛЕ ДАРА                   ║');
console.log('║   Разложение Гельмгольца–Ходжа                      ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log('');

// ── Дивергенция ──────────────────────────────────────────────────
console.log('── ДИВЕРГЕНЦИЯ (источники и стоки) ─────────────────────');
console.log('   Положительная → кенозис (даёт > получает)');
console.log('   Отрицательная → θέωσις (получает > даёт)');
console.log('');

const sorted = [...divVec].sort((a, b) => Math.abs(b.div) - Math.abs(a.div));
sorted.forEach(v => {
  const bar = '█'.repeat(Math.min(30, Math.round(Math.abs(v.div) / 10)));
  const sign = v.div > 0 ? '+ ' : v.div < 0 ? '− ' : '0 ';
  const icon = v.div > 50 ? '↑ кенозис'
             : v.div > 10 ? '↑'
             : v.div < -50 ? '↓ θέωσις'
             : v.div < -10 ? '↓'
             : v.div === 0  ? '◦ _abyss'
             : '';
  console.log(`  ${v.id.padEnd(15)} div=${sign}${Math.abs(v.div).toFixed(0).padStart(4)}  ${bar} ${icon}`);
});

// ── Потенциал ─────────────────────────────────────────────────────
console.log('');
console.log('── СКАЛЯРНЫЙ ПОТЕНЦИАЛ φ ("высота благодати") ─────────');
console.log('   Дар течёт от высокого φ к низкому');
console.log('');

const phiSorted = ids.map((id, i) => ({ id, phi: phi[i], norm: phiNorm[i] }))
                     .sort((a, b) => b.phi - a.phi);
phiSorted.forEach(v => {
  const bar = '·'.repeat(Math.round(v.norm * 30));
  console.log(`  ${v.id.padEnd(15)} φ=${v.phi.toFixed(1).padStart(8)}  ${bar}`);
});

// ── Энергия поля ──────────────────────────────────────────────────
console.log('');
console.log('── ЭНЕРГИЯ ПОЛЯ ────────────────────────────────────────');
console.log(`  Полная:         ${fieldEnergy.toFixed(1)}`);
console.log(`  Градиентная:    ${gradEnergy.toFixed(1)}  (кенозис — одностороннее течение)`);
console.log(`  Роторная:       ${curlEnergy.toFixed(1)}  (анамнезис — циркуляция)`);
console.log(`  Доля ротора:    ${(curlEnergy / fieldEnergy * 100).toFixed(1)}%`);

// ── Ротор ─────────────────────────────────────────────────────────
console.log('');
console.log('── РОТОР (циркуляция в треугольниках) ─────────────────');
console.log('   curl ≠ 0 означает: дар не консервативен, анамнезис');
console.log('   curl > 0: i→j→k сильнее чем k→j→i (доминирующее направление)');
console.log('');

const topTri = showTriangles ? triangles.slice(0, 20) : triangles.slice(0, 8);
topTri.forEach(t => {
  const dir = t.curl > 0 ? `${t.i}→${t.j}→${t.k}` : `${t.k}→${t.j}→${t.i}`;
  console.log(`  curl=${t.curl.toFixed(1).padStart(7)}  ${dir}`);
});
if (!showTriangles && triangles.length > 8) {
  console.log(`  ... и ещё ${triangles.length - 8} треугольников (--triangles для полного вывода)`);
}

const nonzeroTri = triangles.filter(t => Math.abs(t.curl) > 1).length;
console.log('');
console.log(`  Ненулевых треугольников: ${nonzeroTri} из ${n*(n-1)*(n-2)/6}`);

// ── Богословский итог ─────────────────────────────────────────────
console.log('');
console.log('── БОГОСЛОВСКИЙ ИТОГ ───────────────────────────────────');
const sources = divVec.filter(v => v.div > 0).sort((a,b) => b.div - a.div);
const sinks   = divVec.filter(v => v.div < 0).sort((a,b) => a.div - b.div);
const maxSource = sources[0];
const maxSink   = sinks[0];
const maxCurl   = triangles[0];
if (maxSource) console.log(`  Главный источник: ${maxSource.id} (div=+${maxSource.div.toFixed(0)}) — кенозис`);
if (maxSink)   console.log(`  Главный сток:     ${maxSink.id}   (div=${maxSink.div.toFixed(0)}) — θέωσις`);
const harmonic = divVec.filter(v => v.div === 0);
console.log(`  Гармонических:    ${harmonic.length} лиц с div=0 (gratia gratis data)`);
if (maxCurl) {
  const dir = maxCurl.curl > 0
    ? `${maxCurl.i}→${maxCurl.j}→${maxCurl.k}`
    : `${maxCurl.k}→${maxCurl.j}→${maxCurl.i}`;
  console.log(`  Главная циркул.:  ${dir} (curl=${maxCurl.curl.toFixed(1)}) — анамнезис`);
}
console.log(`  Ненасыщенных треугольников: ${nonzeroTri} — дар никогда не замыкается полностью`);

// ── Экспорт ───────────────────────────────────────────────────────
if (doExport) {
  const field = {
    ts: Date.now(),
    divergence: divVec.map(v => ({ id: v.id, div: +v.div.toFixed(2), given: v.given, received: v.received })),
    potential:  ids.map((id, i) => ({ id, phi: +phi[i].toFixed(2), norm: +phiNorm[i].toFixed(3) })),
    triangles:  triangles.slice(0, 50),
    energy:     { total: +fieldEnergy.toFixed(1), grad: +gradEnergy.toFixed(1), curl: +curlEnergy.toFixed(1) },
  };
  const outPath = resolve(ROOT, 'data/field.json');
  writeFileSync(outPath, JSON.stringify(field, null, 2));
  console.log('');
  console.log(`[field] экспортировано → ${outPath}`);

  // Также в симулятор
  const simPath = resolve(ROOT, '../fpga/simulator/field.json');
  try { writeFileSync(simPath, JSON.stringify(field, null, 2)); console.log(`[field] → simulator/field.json`); } catch {}
}

console.log('');
