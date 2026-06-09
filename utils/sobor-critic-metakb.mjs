#!/usr/bin/env node
/**
 * sobor-critic-metakb — критик (Ева) для мета-КБ. Иммунная система базы знаний.
 *
 * Балансирует генератор (sobor-loop-metakb): без критика база забивается шумом.
 * Для каждого proposed-решения:
 *   1. Дубль/противоречие — близость к уже принятым (accepted) решениям.
 *   2. Инженерная ценность — конкретность, действенность, заземлённость (LLM).
 *   3. Рекомендация: accept | reject | keep.
 *
 * Безопасность: --apply применяет ТОЛЬКО reject (чистка дублей/мусора).
 * accept НЕ применяется автоматически — это решение команды (печатается как
 * рекомендация). Критик чистит шум, но не благословляет единолично.
 *
 * Env: INTEGRAM_URL, INTEGRAM_DB, INTEGRAM_TOKEN (или EMAIL+PASSWORD)
 *   node utils/sobor-critic-metakb.mjs [--apply]
 */
import { callLLM } from './sobor-coscientist.mjs';
import { lexicalSim, similarity } from './sobor-ground-judge.mjs';
import { fetchDecisions, patchDecision, available, login } from './sobor-corpus-integram.mjs';

const apply = process.argv.includes('--apply');
const DUP_TH = Number(process.env.CRITIC_DUP || 0.5);

if (!available()) { console.log('Нужны INTEGRAM_URL, INTEGRAM_DB и токен/логин.'); process.exit(1); }

const token = login();
const all = fetchDecisions({ token });
const text = d => [d.title, d.description].filter(Boolean).join('. ');
const proposed = all.filter(d => (d.verdict || '').toLowerCase() === 'proposed');
const reference = all.filter(d => (d.verdict || '').toLowerCase() === 'accepted');

console.log(`Критик мета-КБ · всего ${all.length}, на проверке (proposed) ${proposed.length}, эталон (accepted) ${reference.length}\n`);

const CRITIC_SYSTEM = `Ты — инженерный критик базы знаний. Оцени решение по критериям:
- КОНКРЕТНОСТЬ: формулирует ли проверяемый технический вопрос/выбор, а не общие слова.
- ДЕЙСТВЕННОСТЬ: можно ли по нему принять реальное инженерное решение или начать работу.
- ЦЕННОСТЬ: важно ли это для системы, не тривиально ли.
Ответь СТРОГО двумя строками:
ВЕРДИКТ: accept | reject | keep
ПРИЧИНА: <одна фраза>`;

function critique(d) {
  // 1) дубль среди accepted
  let dup = null, best = 0;
  for (const r of reference) {
    const s = (similarity(text(d), text(r)).sim || lexicalSim(text(d), text(r)));
    if (s > best) { best = s; dup = r; }
  }
  if (dup && best >= DUP_TH) return { verdict: 'reject', reason: `дубль принятого #${dup.id} (близость ${best.toFixed(2)})`, dup: dup.id };

  // 2) инженерная ценность через LLM
  const out = callLLM(CRITIC_SYSTEM, `Решение: ${text(d)}`, { timeout: 30000 });
  const v = (out && out.match(/ВЕРДИКТ:\s*(accept|reject|keep)/i)?.[1]?.toLowerCase()) || 'keep';
  const reason = (out && out.match(/ПРИЧИНА:\s*(.+)/i)?.[1]?.trim()) || 'без пояснения';
  return { verdict: v, reason };
}

let rejected = 0, accepted = 0, kept = 0;
for (const d of proposed) {
  const c = critique(d);
  const tag = c.verdict === 'reject' ? '✗ reject' : c.verdict === 'accept' ? '✓ accept (на ревью команды)' : '· keep';
  console.log(`#${d.id} [${tag}] ${(d.title || '').slice(0, 70)}\n     → ${c.reason}`);
  if (c.verdict === 'reject') { rejected++; if (apply) { const r = patchDecision(d.id, { verdict: 'rejected' }, { token }); console.log(`     ${r.ok ? 'применено: rejected' : 'ошибка: ' + r.error}`); } }
  else if (c.verdict === 'accept') accepted++;
  else kept++;
}

console.log(`\nИтог: reject ${rejected}${apply ? ' (применено)' : ' (рекомендация)'}, accept-рекомендаций ${accepted}, keep ${kept}.`);
if (!apply && rejected) console.log('Добавь --apply, чтобы отклонить дубли/мусор. accept применяется командой вручную.');
