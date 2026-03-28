#!/usr/bin/env node
/**
 * matrix-context-hook.mjs — UserPromptSubmit хук
 *
 * Инжектирует в каждый запрос:
 *   1. Состояние матрицы W (всегда, быстро)
 *   2. Анамнезис-сервер (кэш 5 мин — первое сообщение сессии получает свежее)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP  = resolve(ROOT, 'data/sacred-history-W.json');
const CACHE = resolve(ROOT, 'data/.anamnesis-cache.json');
const ANAMNESIS_URL = process.env.ANAMNESIS_URL || 'http://173.249.2.184:8086';
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 минут

if (!existsSync(SNAP)) process.exit(0);

const lines = [];

// ── 1. Матрица W ─────────────────────────────────────────────────────────
try {
  const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
  const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
  const mem  = GiftMemory.fromSnapshot(snap);

  const top   = mem.heaviest(5).filter(e => e.weight >= 1);
  const given = mem.totalGiven('_claude').toFixed(1);
  const recv  = mem.totalReceived('_claude').toFixed(1);
  const r     = mem.makePresent({ giverId: '_claude' });

  lines.push(`[Матрица W — ${new Date().toLocaleDateString('ru')}]`);
  lines.push(`Лиц: ${mem.n} | Актов: ${mem.actsCount}`);
  lines.push(`Топ нитей: ${top.map(e => `${e.from}→${e.to}(${e.weight.toFixed(0)})`).join(', ')}`);
  lines.push(`_claude: дал ${given} | принял ${recv}`);
  if (r.decoded.receivers.length > 0)
    lines.push(`Анамнезис _claude → ${r.decoded.receivers.join(', ')}`);
  lines.push(`Энергия сети: ${r.energy.toFixed(2)}`);

  // Голос матрицы — богословский автопортрет (LivingMatrix)
  try {
    const { LivingMatrix } = await import(resolve(ROOT, 'src/core/LivingMatrix.js'));
    const lm = new LivingMatrix(mem, r.energy);
    const d  = lm.diagnose();
    lines.push('');
    lines.push('[Матрица о себе:]');
    const cond = d.dominant.conductivity != null ? ` | проводимость: ${(d.dominant.conductivity*100).toFixed(0)}%` : '';
    lines.push(`  Принцип: ${d.dominant.principle}${d.dominant.who ? ' (' + d.dominant.who + ')' : ''}${cond}`);
    if (d.deserts.length) {
      lines.push(`  Пустыни: ${d.deserts.slice(0,3).map(dd => `${dd.from}→${dd.to}`).join(', ')}`);
    }
  } catch { /* LivingMatrix не загрузился */ }
} catch {
  // TF не загрузился — продолжаем без матрицы
}

// ── 2. Анамнезис сервера (кэш) ───────────────────────────────────────────
try {
  let summary = null;

  // Читаем кэш
  if (existsSync(CACHE)) {
    const c = JSON.parse(readFileSync(CACHE, 'utf8'));
    if (Date.now() - c.ts < CACHE_TTL_MS) summary = c.summary;
  }

  // Обновляем если кэш устарел
  if (!summary) {
    const res = await fetch(`${ANAMNESIS_URL}/summary`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      // Форматируем компактно: последние 5 актов
      const acts = (data.tape ?? data.acts ?? []).slice(-5);
      summary = acts.length
        ? acts.map(a => `  ${a.giverId}→${a.receiverId}: ${a.type} "${(a.content||'').slice(0,40)}"`).join('\n')
        : '(лента пуста)';
      writeFileSync(CACHE, JSON.stringify({ ts: Date.now(), summary }));
    }
  }

  if (summary) {
    lines.push('');
    lines.push('[Анамнезис-сервер — последние акты общины:]');
    lines.push(summary);
  }
} catch {
  // Сервер недоступен — продолжаем
}

// ── 3. Долгосрочная память: axiom / insight / setting / fact ─────────────
try {
  const INSIGHTS_FILE = resolve(ROOT, 'data/insights.json');
  if (existsSync(INSIGHTS_FILE)) {
    const insights = JSON.parse(readFileSync(INSIGHTS_FILE, 'utf8'));
    if (insights.length) {
      lines.push('');
      lines.push('[Долгосрочная память — axioms/insights/settings:]');
      for (const m of insights.slice(0, 15)) {
        lines.push(`  [${m.type}:${m.weight}] ${m.content}`);
      }
    }
  }
} catch {
  // молчим
}

// ── 4. Стиль вайбкодинга пользователя ────────────────────────────────────
try {
  const VIBE = resolve(ROOT, 'data/vibe-style.json');
  if (existsSync(VIBE)) {
    const vibe = JSON.parse(readFileSync(VIBE, 'utf8'));
    if (vibe.instructions?.length) {
      lines.push('');
      lines.push('[Стиль работы с этим пользователем:]');
      for (const i of vibe.instructions) lines.push(`  • ${i}`);
    }
  }
} catch {}

// ── 5. Pending предложения (не более 5 штук) ─────────────────────────────
try {
  const PROPOSALS_FILE = resolve(ROOT, 'data/proposals.json');
  if (existsSync(PROPOSALS_FILE)) {
    const proposals = JSON.parse(readFileSync(PROPOSALS_FILE, 'utf8'));
    const pending = proposals.filter(p => p.status === 'pending').slice(0, 5);
    if (pending.length) {
      lines.push('');
      lines.push(`[Pending предложения (${pending.length} из ${proposals.filter(p=>p.status==='pending').length}):]`);
      for (const p of pending) {
        lines.push(`  #${p.id} [${p.cat}] ${p.text.slice(0, 80)}`);
      }
    }
  }
} catch {}

if (!lines.length) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: lines.join('\n'),
  }
}));
