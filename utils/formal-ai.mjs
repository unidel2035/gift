#!/usr/bin/env node
/**
 * formal-ai.mjs — нейросимвольный мост к движку Кости (github.com/link-assistant/formal-ai).
 *
 * Костя сделал 100% символический ДЕТЕРМИНИРОВАННЫЙ ассистент без нейросети: тот же вход →
 * побитово тот же выход, с трейсом «почему». Это вторая половина нашего grounding: где LLM
 * плавает (счёт, проценты, валюта, формат) — отдаём детерминированному движку, а семантику
 * оставляем LLM. LLM предлагает, символический слой располагает (нейросимвол).
 *
 * Принцип сессии: не доверяй модели там, где есть детерминированный ответ — заземли кодом.
 *
 * Использование:
 *   import { looksDeterministic, askFormal, route } from './formal-ai.mjs';
 *   route("What is 8% of $50?", { llm: async p => '...' })  → { answer, source: 'formal-ai'|'llm' }
 * CLI:
 *   node utils/formal-ai.mjs "What is 8% of $50?"
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const BIN = process.env.FORMAL_AI_BIN || '/home/unidel/formal-ai/target/release/formal-ai';

export function formalAvailable() { return existsSync(BIN); }

/**
 * Эвристика маршрутизации: вопрос детерминированно-символический (счёт/процент/валюта/
 * арифметика), т.е. кандидат на formal-ai, а не на LLM. Чистая функция.
 */
export function looksDeterministic(prompt = '') {
  const p = String(prompt).toLowerCase();
  // NB: без \b — ASCII-граница слова не работает с кириллицей (урок сессии);
  // для routing-эвристики подстрочного совпадения достаточно.
  return (
    /\d+\s*%/.test(p) ||                                          // проценты: 8%
    /%\s*of/.test(p) ||                                           // 8% of ...
    /(percent|процент)/.test(p) ||
    /[$€₽£]/.test(p) ||                                           // символы валют
    /(usd|eur|rub|руб|доллар|евро)/.test(p) ||                    // валюта словами
    /(конвертир|convert|посчитай|вычисли|calculate|сколько будет)/.test(p) ||
    /\d+\s*[+\-*/×÷]\s*\d+/.test(p)                               // арифметика 2+2
  );
}

/** Спросить детерминированный движок Кости. Возвращает строку-ответ или null (graceful). */
export function askFormal(prompt) {
  if (!formalAvailable()) return null;
  try {
    const r = spawnSync(BIN, ['chat', '--prompt', String(prompt)], { encoding: 'utf8', timeout: 15000 });
    if (r.status !== 0) return null;
    const out = (r.stdout || '').trim();
    return out || null;
  } catch { return null; }
}

/**
 * Нейросимвольный маршрут: детерминированный вопрос → formal-ai (заземлённо, воспроизводимо,
 * бесплатно); иначе → LLM. opts.llm — async (prompt)=>string. Возвращает {answer, source}.
 */
export async function route(prompt, { llm } = {}) {
  if (looksDeterministic(prompt) && formalAvailable()) {
    const a = askFormal(prompt);
    if (a) return { answer: a, source: 'formal-ai', deterministic: true };
  }
  if (typeof llm === 'function') return { answer: await llm(prompt), source: 'llm', deterministic: false };
  return { answer: null, source: 'none', deterministic: false };
}

// ── CLI ───────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const prompt = process.argv.slice(2).join(' ');
  if (!prompt) { console.log('node utils/formal-ai.mjs "<вопрос>"'); process.exit(0); }
  if (!formalAvailable()) { console.log(`formal-ai не собран (нет ${BIN}). См. reference_formalai_kostya.`); process.exit(0); }
  const det = looksDeterministic(prompt);
  const a = askFormal(prompt);
  console.log(`${det ? '⚙ детерминированный' : '… общий'} вопрос`);
  console.log(a ?? '(нет ответа от formal-ai)');
}
