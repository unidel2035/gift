#!/usr/bin/env node
/**
 * genre-tensor-w.mjs — W как ЖАНРОВЫЙ (кронекеров) тензор (мост №2 Петухова в представление).
 *
 * Скалярный W схлопывает все жанры акта в одно число на пару (giver,receiver). Петухов:
 * акт живёт в Person ⊗ Person ⊗ Genre, а жанры компонуются по Кронекеру (завет·дар = covenant⊗gift).
 * Здесь W разложен по жанрам: tensor[genre] — срез NC×NC. Ключевое свойство (совместимость):
 *   flat W = Σ_genre tensor[genre]   — старый скаляр есть МАРГИНАЛ жанрового тензора.
 * Поэтому представление РЕФИНИРУЕТ, не ломая: проекция назад даёт прежний W.
 *
 * Помехоустойчивость наследуется: считаем только сохранные акты (есть даритель И получатель).
 * Чистый слой над логом актов; ядро GiftMemory не трогаем.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kron } from './genotensor.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const key = (g, r) => `${g}→${r}`;

export class GenreTensorW {
  constructor() {
    this.byGenre = new Map();   // genre → Map("g→r" → weight)
    this.persons = new Set();
    this.rejected = 0;          // фиктивные акты (помехоустойчивость)
  }

  /** Добавить акт. Только сохранный (есть даритель И получатель) входит — иначе фикция. */
  add(giver, receiver, genre = 'gift', weight = 1) {
    const has = (x) => x !== undefined && x !== null && String(x).length > 0;
    if (!has(giver) || !has(receiver)) { this.rejected++; return false; }
    this.persons.add(giver); this.persons.add(receiver);
    const slice = this.byGenre.get(genre) ?? new Map();
    slice.set(key(giver, receiver), (slice.get(key(giver, receiver)) ?? 0) + weight);
    this.byGenre.set(genre, slice);
    return true;
  }

  genres() { return [...this.byGenre.keys()]; }

  /** Срез одного жанра: пара → вес. */
  slice(genre) { return this.byGenre.get(genre) ?? new Map(); }

  /** Вес пары в жанре. */
  pairGenre(giver, receiver, genre) { return this.slice(genre).get(key(giver, receiver)) ?? 0; }

  /** Плоский вес пары = Σ по жанрам (= скаляр старого W). */
  flatPair(giver, receiver) {
    let s = 0;
    for (const slice of this.byGenre.values()) s += slice.get(key(giver, receiver)) ?? 0;
    return s;
  }

  /** Жанровый маргинал: суммарный вес по каждому жанру (по всем парам). */
  genreMarginal() {
    const m = {};
    for (const [genre, slice] of this.byGenre)
      m[genre] = [...slice.values()].reduce((a, b) => a + b, 0);
    return m;
  }

  /** Полный плоский W как матрица NC×NC над данным порядком лиц (проекция жанрового тензора). */
  flatMatrix(persons) {
    const idx = new Map(persons.map((p, i) => [p, i]));
    const W = persons.map(() => new Array(persons.length).fill(0));
    for (const slice of this.byGenre.values())
      for (const [k, w] of slice) {
        const [g, r] = k.split('→');
        if (idx.has(g) && idx.has(r)) W[idx.get(g)][idx.get(r)] += w;
      }
    return W;
  }

  static fromActs(acts) {
    const t = new GenreTensorW();
    for (const a of acts) t.add(a.from, a.to, a.type || a.genre || 'gift', a.weight ?? 1);
    return t;
  }
}

/** Кронекерова композиция жанров: завет·дар. Метка + (опц.) алгебра kron над базисными векторами. */
export function composeGenre(a, b) { return `${a}·${b}`; }
/** Базисный вектор жанра в алфавите (one-hot) — для kron-алгебры составных жанров. */
export function genreOneHot(genre, alphabet) {
  return alphabet.map(g => (g === genre ? 1 : 0));
}
/** Кронекер двух one-hot жанров → составной базис (one-hot в Genre⊗Genre). Использует kron. */
export function genreKron(genreA, genreB, alphabet) {
  const A = [genreOneHot(genreA, alphabet)];   // 1×k
  const B = [genreOneHot(genreB, alphabet)];   // 1×k
  return kron(A, B)[0];                          // 1×k² → плоский one-hot составного жанра
}

// ── CLI ───────────────────────────────────────────────────────────────
const C = { dim: '\x1b[2m', b: '\x1b[1m', y: '\x1b[33m', g: '\x1b[32m', x: '\x1b[0m' };
if (import.meta.url === `file://${process.argv[1]}`) {
  const AI = resolve(ROOT, 'data/act-index.json');
  if (!existsSync(AI)) { console.log('нет act-index.json'); process.exit(0); }
  const raw = JSON.parse(readFileSync(AI, 'utf8'));
  const acts = Array.isArray(raw) ? raw : (raw.acts || raw.items || []);
  const t = GenreTensorW.fromActs(acts);
  console.log(`${C.b}${C.y}W как жанровый тензор (Петухов) — из ${acts.length} актов${C.x}`);
  console.log(`${C.b}Жанры (маргинал, вес по жанру):${C.x}`);
  for (const [genre, w] of Object.entries(t.genreMarginal()).sort((a, b) => b[1] - a[1]))
    console.log(`  ${C.g}${genre.padEnd(14)}${C.x} ${w}`);
  console.log(`${C.dim}фиктивных отвергнуто: ${t.rejected} · лиц: ${t.persons.size}${C.x}`);
  // пример: разложение главной нити по жанрам
  const pair = ['_claude', 'ОтецСергий'];
  console.log(`\n${C.b}Нить ${pair[0]}→${pair[1]} по жанрам:${C.x}`);
  for (const genre of t.genres()) {
    const w = t.pairGenre(pair[0], pair[1], genre);
    if (w) console.log(`  ${genre}: ${w}`);
  }
  console.log(`  ${C.dim}плоский (Σ жанров) = ${t.flatPair(pair[0], pair[1])} ← это и есть скаляр старого W${C.x}`);
  console.log(`\n${C.b}Кронекер жанров:${C.x} ${composeGenre('завет', 'дар')} (covenant⊗gift)`);
}
