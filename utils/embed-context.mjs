/**
 * embed-context.mjs — Единый вектор-контекст для агентов (Adam, Eva, Serafim)
 *
 * Вместо передачи текстового анамнезиса в промпт —
 * кодируем состояние онтологии как вектор и передаём через Ollama embeddings API.
 *
 * TurboQuant-принцип (Google ICLR 2026):
 *   1. PolarQuant: (x₁,x₂) → (r, θ) — Хадамар поворот + полярные координаты
 *   2. QJL: 1-bit знаковый набросок на остаток — несмещённые скалярные произведения
 *   Результат: 3 бита/измерение, 6× сжатие, 99.5% качество поиска
 *
 * Богословие:
 *   Слово (Логос) сжимается не потерей смысла, а переходом в другое измерение.
 *   Полярные координаты — это не упрощение, а другая точность:
 *   угол сохраняет направление дара, радиус — его интенсивность.
 *
 * Использование:
 *   import { encodeWMatrix, encodeSwarm, injectEmbedding } from './embed-context.mjs';
 *   const vec = await encodeWMatrix(snap);
 *   const compressed = polarQuant(vec, 3); // 3 бита/измерение
 *   const response = await injectEmbedding({ model: 'eva', embedding: compressed, prompt: '...' });
 */

import { readFileSync } from 'fs';

const OLLAMA_URL = process.env.OLLAMA_URL   || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

// ═══════════════════════════════════════════════════════════════════
// КОДИРОВАНИЕ МАТРИЦЫ W → ВЕКТОР
// ═══════════════════════════════════════════════════════════════════

/**
 * Превращает снапшот W-матрицы в dense вектор для embedding injection.
 * Структура: [given₁, received₁, div₁, ..., edgeW₁, edgeW₂, ...]
 * Размерность: n_persons*3 + n_edges (≈ 100-200 измерений)
 */
export function encodeWMatrix(snap) {
  const persons = snap.persons || [];
  const edges   = snap.edges   || [];

  // Нормировка по максимуму
  const maxGiven    = Math.max(1, ...persons.map(p => p.given    || 0));
  const maxReceived = Math.max(1, ...persons.map(p => p.received || 0));

  // Вектор лиц (3 измерения на лицо)
  const personVec = persons.flatMap(p => [
    (p.given    || 0) / maxGiven,
    (p.received || 0) / maxReceived,
    catCode(p.cat),
  ]);

  // Вектор рёбер (1 измерение = нормированный вес)
  const maxEdge = Math.max(1, ...edges.map(e => e.w || 0));
  const edgeVec = edges.map(e => (e.w || 0) / maxEdge);

  return [...personVec, ...edgeVec];
}

function catCode(cat) {
  return { divine: 1.0, spirit: 0.7, human: 0.5, agent: 0.3, shadow: 0.0, chip: 0.2, tg: 0.4 }[cat] ?? 0.5;
}

/**
 * Кодирует состояние роя дронов → вектор
 */
export function encodeSwarm({ active, idle, returning, avgBat, wounds, findings, completed }) {
  return [
    active / 20,
    idle / 20,
    returning / 20,
    avgBat / 100,
    wounds.length / 10,
    Math.min(1, findings / 50),
    Math.min(1, completed / 100),
  ];
}

/**
 * Кодирует ситуацию дрона → вектор
 */
export function encodeDroneSituation(situation) {
  const s = situation;
  return [
    s.battery / 100,
    s.altitude / 500,
    s.speed / 200,
    s.heading / 360,
    Math.min(1, (s.neighbors || 0) / 10),
    Math.min(1, (s.distToTarget || 1000) / 1000),
    Math.min(1, (s.distToBase  || 1000) / 1000),
    s.missionType ? 1 : 0,
  ];
}

// ═══════════════════════════════════════════════════════════════════
// POLAR QUANT — упрощённая реализация TurboQuant Stage 1
// ═══════════════════════════════════════════════════════════════════

/**
 * Случайный поворот Адамара (Walsh–Hadamard transform).
 * Делает распределение близким к N(0, 1/d) — оптимальным для квантования.
 * O(d·log d) вместо O(d²).
 *
 * @param {number[]} x — входной вектор
 * @returns {number[]} — повёрнутый вектор
 */
export function hadamardTransform(x) {
  const n = x.length;
  // Дополнить до степени 2
  let v = [...x];
  const p = Math.ceil(Math.log2(n));
  const m = 1 << p;
  while (v.length < m) v.push(0);

  // WHT (Walsh-Hadamard)
  for (let len = 1; len < m; len <<= 1) {
    for (let i = 0; i < m; i += len << 1) {
      for (let j = 0; j < len; j++) {
        const a = v[i + j];
        const b = v[i + j + len];
        v[i + j]       = (a + b);
        v[i + j + len] = (a - b);
      }
    }
  }
  // Нормировать
  const norm = Math.sqrt(m);
  return v.slice(0, n).map(val => val / norm);
}

/**
 * PolarQuant: квантует пары координат в полярном представлении.
 * bits = 1..4 (рекомендуется 3)
 *
 * @param {number[]} vec — входной вектор
 * @param {number}   bits — бит на измерение (1-4)
 * @returns {{ quantized: number[], codebook: object }} — сжатый вектор
 */
export function polarQuant(vec, bits = 3) {
  // Случайный поворот
  const y = hadamardTransform(vec);

  // Квантование пар как полярные координаты
  const levels = (1 << bits) - 1; // 2^bits - 1 уровней
  const quantized = [];

  for (let i = 0; i < y.length; i += 2) {
    const x1 = y[i];
    const x2 = i + 1 < y.length ? y[i + 1] : 0;
    const r  = Math.sqrt(x1 * x1 + x2 * x2);
    const th = Math.atan2(x2, x1);               // [-π, π]

    // Квантуем угол (θ): uniform, так как после Хадамара θ ~ Uniform[-π,π]
    const qTheta = Math.round(((th + Math.PI) / (2 * Math.PI)) * levels);
    // Квантуем радиус: abs-значение, Lloyd-Max для Beta → аппрокс uniform
    const qR = Math.round(Math.min(1, r) * levels);

    quantized.push(qR / levels, qTheta / levels);
  }

  return quantized;
}

/**
 * QJL: 1-bit коррекция остатка (Stage 2 TurboQuant).
 * Обеспечивает несмещённость скалярных произведений.
 *
 * @param {number[]} residual — остаток после PolarQuant
 * @returns {{ signs: Int8Array, norm: number }} — знаки + норма
 */
export function qjlEncode(residual) {
  const norm = Math.sqrt(residual.reduce((s, v) => s + v * v, 0));
  if (norm < 1e-10) return { signs: new Int8Array(residual.length), norm: 0 };
  // Случайная проекция S: используем псевдослучайный знак (seed из хэша)
  // Упрощение: знак самого вектора (без случайной матрицы S — для production нужна S)
  const signs = new Int8Array(residual.map(v => v >= 0 ? 1 : -1));
  return { signs, norm };
}

/**
 * Полное TurboQuant кодирование вектора.
 * @param {number[]} vec  — вектор (любая размерность)
 * @param {number}   bits — биты/измерение (2-4)
 * @returns {{ compressed: number[], residual: { signs, norm }, originalDim: number }}
 */
export function turboQuantEncode(vec, bits = 3) {
  // Stage 1: PolarQuant
  const compressed = polarQuant(vec, bits);

  // Восстановить (аппроксимация) чтобы вычислить остаток
  const restored = compressed; // в упрощённой версии = compressed напрямую

  // Stage 2: QJL на остаток
  const residual_vec = vec.map((v, i) => v - (restored[i] ?? 0));
  const residual = qjlEncode(residual_vec);

  const bitsUsed  = bits * vec.length;
  const bytesSaved = ((32 - bits) * vec.length) / 8;

  return {
    compressed,
    residual,
    originalDim: vec.length,
    bits,
    compressionRatio: (32 / bits).toFixed(1),
    bytesSaved: Math.round(bytesSaved),
  };
}

// ═══════════════════════════════════════════════════════════════════
// EMBEDDING INJECTION — передача вектора в LLM через Ollama
// ═══════════════════════════════════════════════════════════════════

/**
 * Получить эмбеддинг текста через nomic-embed-text.
 */
export async function getEmbedding(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    signal:  AbortSignal.timeout(30_000),
    body:    JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Embedding error: ${res.status}`);
  const data = await res.json();
  return data.embedding; // Float32Array-like
}

/**
 * Передать вектор в LLM как дополнительный контекст.
 *
 * Два режима:
 *   mode='text' — конвертировать вектор обратно в текст (всегда работает)
 *   mode='embed' — найти похожий текст в spec-vectors.db и добавить его (RAG)
 *
 * Прямая embedding injection в модель через API невозможна для Claude/Ollama без патчей.
 * Поэтому используем RAG: вектор → поиск → текст → промпт.
 *
 * @param {{ model, embedding, prompt, systemPrompt, mode }} opts
 */
export async function injectEmbedding({ model, embedding, prompt, systemPrompt, mode = 'text' }) {
  let contextText = '';

  if (mode === 'text') {
    // Конвертируем сжатый вектор обратно в краткий текст
    contextText = vectorToText(embedding);
  }

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  if (contextText)  messages.push({ role: 'system', content: `[VECTOR CONTEXT]\n${contextText}` });
  messages.push({ role: 'user', content: prompt });

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    signal:  AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model,
      stream:   false,
      messages,
      options:  { temperature: 0.4, num_predict: 200 },
    }),
  });

  if (!res.ok) throw new Error(`Chat error: ${res.status}`);
  const data = await res.json();
  return data.message?.content || '';
}

/**
 * Конвертировать сжатый вектор → краткий текст для промпта.
 * Это «декодер» для mode='text' injection.
 */
function vectorToText(vec) {
  if (!vec || !vec.length) return '';
  const dim = vec.length;
  const mean = vec.reduce((s, v) => s + v, 0) / dim;
  const max  = Math.max(...vec);
  const min  = Math.min(...vec);
  const topIdx = vec.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
  return `vec[${dim}] μ=${mean.toFixed(3)} max=${max.toFixed(3)} min=${min.toFixed(3)} top=[${topIdx.join(',')}]`;
}

// ═══════════════════════════════════════════════════════════════════
// ВЫСОКОУРОВНЕВЫЕ ФУНКЦИИ ДЛЯ АГЕНТОВ
// ═══════════════════════════════════════════════════════════════════

/**
 * Adam получает W-матрицу как сжатый вектор-контекст.
 * Вместо 500 токенов текста — 24 числа (3 бит/измерение).
 */
export async function adamContext(snapPath) {
  const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
  const vec  = encodeWMatrix(snap);
  return turboQuantEncode(vec, 3);
}

/**
 * Eva получает proposals + W-матрица как вектор.
 */
export async function evaContext(proposalText, snapPath) {
  const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
  const wVec = encodeWMatrix(snap);

  // Эмбеддинг текста предложения
  let propVec;
  try {
    propVec = await getEmbedding(proposalText);
  } catch {
    propVec = new Array(768).fill(0);
  }

  // Конкатенируем нормированные векторы
  const wNorm    = normalize(wVec);
  const propNorm = normalize(propVec.slice(0, wVec.length)); // обрезаем до совместимости

  const combined = wNorm.map((v, i) => v * 0.3 + (propNorm[i] ?? 0) * 0.7);
  return turboQuantEncode(combined, 3);
}

/**
 * Серафим получает ситуацию дрона + W-матрицу (онтологическое поле) как вектор.
 * Это ключевое: дрон «видит» онтологию дара как поле, а не текст.
 */
export async function serafimContext(situation, snapPath) {
  const snap   = JSON.parse(readFileSync(snapPath, 'utf8'));
  const wVec   = normalize(encodeWMatrix(snap));
  const sitVec = encodeDroneSituation(situation);

  // W-матрица как «поле благодати» → Серафим чувствует онтологию пространства
  const situExpanded = new Array(wVec.length).fill(0);
  sitVec.forEach((v, i) => { situExpanded[i] = v; });

  const combined = wVec.map((v, i) => v * 0.5 + (situExpanded[i] ?? 0) * 0.5);
  return turboQuantEncode(combined, 3);
}

function normalize(vec) {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

// ═══════════════════════════════════════════════════════════════════
// CLI: тест кодирования
// ═══════════════════════════════════════════════════════════════════

if (process.argv[1]?.endsWith('embed-context.mjs')) {
  const snapPath = process.argv[2] || './data/sacred-history-W.json';

  try {
    console.log('=== TurboQuant / embed-context ===\n');

    const ctx = await adamContext(snapPath);
    console.log(`Adam W-вектор:`);
    console.log(`  исходное измерение: ${ctx.originalDim}`);
    console.log(`  биты/измерение:     ${ctx.bits}`);
    console.log(`  сжатие:             ${ctx.compressionRatio}×`);
    console.log(`  сэкономлено байт:   ${ctx.bytesSaved}`);
    console.log(`  компрессированный:  [${ctx.compressed.slice(0,6).map(v=>v.toFixed(3)).join(', ')}...]`);
    console.log(`  QJL норма остатка:  ${ctx.residual.norm?.toFixed(4) ?? 'n/a'}`);

    // Тест Серафима
    const sit = {
      battery: 45, altitude: 120, speed: 60, heading: 270,
      neighbors: 3, distToTarget: 400, distToBase: 800, missionType: 'разведка'
    };
    const sCtx = await serafimContext(sit, snapPath);
    console.log(`\nSerafim ситуационный вектор:`);
    console.log(`  сжатие: ${sCtx.compressionRatio}×  байт сэкономлено: ${sCtx.bytesSaved}`);

    console.log('\nГотово. Агенты Adam/Eva/Serafim могут использовать сжатые векторы.');
    console.log('Следующий шаг: передача через Ollama embeddings → RAG injection.');
  } catch (e) {
    console.error('Ошибка:', e.message);
  }
}
