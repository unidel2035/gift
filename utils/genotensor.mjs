#!/usr/bin/env node
/**
 * genotensor.mjs — W как КРОНЕКЕРОВ ТЕНЗОР жанров акта + помехоустойчивость (мост №2, Петухов).
 *
 * Петухов (матричная генетика): генетический алфавит — матрица 2×2; вся система мультиплетов —
 * семейство ТЕНЗОРНЫХ (кронекеровых) степеней P^(n) базовой матрицы; в самой матричной структуре
 * лежит ПОМЕХОУСТОЙЧИВОСТЬ (мутация-«фикция» отбраковывается порядком кода).
 *
 * Перенос на дар: базовая матрица жанров акта ⊗ себя порождает составные жанры (цепи актов) в
 * упорядоченном виде. Помехоустойчивость = наша АНТИ-ФИКТИВНОСТЬ на уровне структуры: настоящий
 * акт — это ПЕРЕНОС (кто-то даёт ровно то, что кто-то принимает) → трит-вектор акта сохраняется
 * (Σ=0: даритель −1, получатель +1, свидетели 0). Фиктивный акт (приём без дара, claim без акта)
 * нарушает Σ=0 и ловится структурой — как мутация генокодом. Кронекер сохраняет закон
 * мультипликативно: Σ(a⊗b)=Σa·Σb, значит цепь сохранных актов сохранна.
 *
 * Чистые функции + CLI. Ядро W не трогаем — это аналитический слой поверх.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Кронекерово (тензорное) произведение матриц A (m×n) и B (p×q) → (mp×nq). Чистое. */
export function kron(A, B) {
  const m = A.length, n = A[0].length, p = B.length, q = B[0].length;
  const out = Array.from({ length: m * p }, () => new Array(n * q).fill(0));
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++)
    for (let r = 0; r < p; r++) for (let c = 0; c < q; c++)
      out[i * p + r][j * q + c] = A[i][j] * B[r][c];
  return out;
}

/** Кронекерова степень: P^(n) = P ⊗ P ⊗ … (n раз). n≥1. */
export function kronPow(P, n) {
  let acc = P;
  for (let k = 1; k < n; k++) acc = kron(acc, P);
  return acc;
}

/** Кронеково произведение векторов (как 1×k матриц) → плоский вектор длины |a|·|b|. */
export function kronVec(a, b) {
  const out = [];
  for (const x of a) for (const y of b) out.push(x * y);
  return out;
}

const sum = (v) => v.reduce((s, x) => s + x, 0);

/**
 * Трит-вектор акта над списком лиц: даритель −1, получатель +1, остальные 0 (как decodeVec ядра).
 */
export function actVector(act, persons) {
  return persons.map(p => (p === act.giverId ? -1 : p === act.receiverId ? +1 : 0));
}

/**
 * Помехоустойчивость = анти-фиктивность: настоящий акт сохраняет перенос (Σ трит = 0 —
 * один даёт ровно то, что один принимает). Фиктивный (приём без дарителя / дар без получателя)
 * нарушает Σ=0 и отбраковывается структурой. Возвращает {conserved, sum, reason}.
 */
export function isConserved(vec) {
  const s = sum(vec);
  if (s === 0 && vec.some(x => x < 0) && vec.some(x => x > 0)) return { conserved: true, sum: 0 };
  if (s === 0 && vec.every(x => x === 0)) return { conserved: false, sum: 0, reason: 'пустой акт — ни дарителя, ни получателя' };
  return { conserved: false, sum: s, reason: s > 0 ? 'приём без дарителя (claim без акта)' : 'дар без получателя (выброс в пустоту)' };
}

/** Кронекер сохраняет закон: Σ(a⊗b)=Σa·Σb → цепь сохранных актов сохранна. Проверка-свидетель. */
export function chainConserved(...vecs) {
  let acc = vecs[0];
  for (let i = 1; i < vecs.length; i++) acc = kronVec(acc, vecs[i]);
  return { conserved: sum(acc) === 0, composite_sum: sum(acc) };
}

/** Базовая матрица жанров акта (2×2, по Петухову — алфавит). Метки для кронекеровых степеней. */
export function genreMatrix() {
  return [['дар', 'свидетельство'], ['отвержение', 'приём']];
}
/** P^(n) меток: компонуем жанры в составные (цепи длины n) через декартов кронекер меток. */
export function genrePowerLabels(n) {
  const flat = (M) => M.flat();
  let labels = flat(genreMatrix());
  for (let k = 1; k < n; k++) {
    const next = [];
    for (const a of labels) for (const b of flat(genreMatrix())) next.push(`${a}·${b}`);
    labels = next;
  }
  return labels; // длина 4^n
}

// ── CLI ───────────────────────────────────────────────────────────────
const C = { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', x: '\x1b[0m' };
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`${C.b}${C.y}genotensor — W как кронекеров тензор жанров + помехоустойчивость${C.x}`);
  console.log(`\n${C.b}Базовые жанры (2×2):${C.x} ${genreMatrix().flat().join(', ')}`);
  console.log(`${C.b}Составные жанры P^2 (4×4=16 цепей):${C.x}\n  ${genrePowerLabels(2).slice(0, 8).join('  ')} …`);

  // Живой тест: проверяем РЕАЛЬНЫЕ акты на сохранность (анти-фиктивность структурой)
  const AI = resolve(ROOT, 'data/act-index.json');
  if (existsSync(AI)) {
    let acts = [];
    try { const a = JSON.parse(readFileSync(AI, 'utf8')); acts = Array.isArray(a) ? a : (a.acts || a.items || []); } catch {}
    const persons = [...new Set(acts.flatMap(a => [a.from, a.to]).filter(Boolean))];
    let ok = 0, bad = 0;
    for (const a of acts.slice(-50)) {
      const v = actVector({ giverId: a.from, receiverId: a.to }, persons);
      if (isConserved(v).conserved) ok++; else bad++;
    }
    console.log(`\n${C.b}Помехоустойчивость на последних ${ok + bad} актах:${C.x} ${C.g}сохранно ${ok}${C.x} · ${bad ? C.r : C.dim}фиктивно ${bad}${C.x}`);
  }
  // демонстрация ловли фикции
  const persons = ['A', 'B', 'C'];
  console.log(`\n${C.b}Демонстрация:${C.x}`);
  console.log(`  A→B (настоящий перенос): ${isConserved(actVector({ giverId: 'A', receiverId: 'B' }, persons)).conserved ? C.g + 'сохранно' : C.r + 'нет'}${C.x}`);
  console.log(`  приём без дарителя [0,+1,0]: ${C.r}${isConserved([0, 1, 0]).reason}${C.x}`);
}
