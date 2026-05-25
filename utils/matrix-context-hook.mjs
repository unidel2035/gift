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
const ANAMNESIS_URL = process.env.ANAMNESIS_URL || 'http://173.249.2.184:8089';
const NOUS_URL      = process.env.NOUS_URL      || 'http://localhost:8089';
const OLLAMA_URL    = process.env.OLLAMA_URL     || 'http://localhost:11434';
const QDRANT_URL    = process.env.QDRANT_URL     || 'http://localhost:6333';
const EMBED_MODEL   = process.env.EMBED_MODEL    || 'nomic-embed-text';
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 минут

// ── Читаем stdin (событие от Claude Code) ─────────────────────────────────
let userPrompt = '';
try {
  const raw = readFileSync('/dev/stdin', 'utf8').trim();
  if (raw) {
    const event = JSON.parse(raw);
    userPrompt = (event.prompt || event.message || event.input || '').trim();
  }
} catch {}

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

// ── 3. Долгосрочная память: семантический retrieval + статический fallback ─
try {
  const INSIGHTS_FILE = resolve(ROOT, 'data/insights.json');
  let semanticResults = null;

  // Семантический поиск: если есть промт пользователя + Qdrant/Nous доступен
  if (userPrompt && userPrompt.length >= 10) {
    // Попытка 1: через Nous сервер (/search)
    try {
      const q = encodeURIComponent(userPrompt.slice(0, 200));
      const res = await fetch(`${NOUS_URL}/search?q=${q}&limit=5`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.results?.length) {
          semanticResults = data.results.map(r => ({
            type: r.payload?.type || 'insight',
            weight: r.payload?.weight || Math.round(r.score * 10),
            content: r.payload?.content || r.payload?.summary || '',
            score: r.score,
          })).filter(r => r.content);
        }
      }
    } catch {}

    // Попытка 2: прямой Qdrant
    if (!semanticResults) {
      try {
        const embedRes = await fetch(`${OLLAMA_URL}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000),
          body: JSON.stringify({ model: EMBED_MODEL, prompt: userPrompt.slice(0, 500) }),
        });
        if (embedRes.ok) {
          const embedData = await embedRes.json();
          const vector = embedData.embedding;
          if (vector?.length) {
            const searchRes = await fetch(`${QDRANT_URL}/collections/gift_insights/points/search`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(4000),
              body: JSON.stringify({ vector, limit: 5, with_payload: true }),
            });
            if (searchRes.ok) {
              const searchData = await searchRes.json();
              if (searchData.result?.length) {
                semanticResults = searchData.result.map(r => ({
                  type: r.payload?.type || 'insight',
                  weight: r.payload?.weight || Math.round(r.score * 10),
                  content: r.payload?.content || '',
                  score: r.score,
                })).filter(r => r.content);
              }
            }
          }
        }
      } catch {}
    }
  }

  // Если семантический retrieval удался — показываем релевантные
  if (semanticResults?.length) {
    lines.push('');
    lines.push('[Долгосрочная память — semantic retrieval:]');
    for (const m of semanticResults.slice(0, 5)) {
      lines.push(`  [${m.type}:${m.weight}] ${m.content}`);
    }
  }

  // Всегда добавляем статические аксиомы и настройки (они фундаментальны)
  if (existsSync(INSIGHTS_FILE)) {
    const insights = JSON.parse(readFileSync(INSIGHTS_FILE, 'utf8'));
    // Аксиомы и настройки — всегда релевантны
    const static_ = insights.filter(m => m.type === 'axiom' || m.type === 'setting');
    // Инсайты и факты — только если нет семантических результатов
    const dynamic = semanticResults?.length
      ? []
      : insights.filter(m => m.type !== 'axiom' && m.type !== 'setting').slice(0, 5);
    const toShow = [...static_, ...dynamic];

    if (toShow.length) {
      lines.push('');
      lines.push('[Долгосрочная память — axioms/insights/settings:]');
      for (const m of toShow.slice(0, 15)) {
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

// ── 5. Swarm: активные агенты и блокировки ────────────────────────────────
try {
  // Register session on first call in this process
  const SWARM = resolve(ROOT, 'utils/gift-swarm.mjs');
  if (existsSync(SWARM)) {
    const { listActiveSessions, detectConflicts, swarmContext, registerSession, activeSession } = await import(SWARM);

    // Auto-register if not yet registered
    const agentId = process.env.GIFT_AGENT_ID || '_claude';
    if (!activeSession()) {
      registerSession(agentId, { claudeSession: process.env.CLAUDE_SESSION_ID || '' });
    }

    const ctx = swarmContext();
    if (ctx) {
      lines.push('');
      lines.push('[Swarm — активные агенты:]');
      lines.push(ctx);
    }
  }
} catch {}

// ── 5b. Intent broadcast — кто что собрался трогать ───────────────────────
try {
  const INTENT = resolve(ROOT, 'utils/gift-swarm-intent.mjs');
  if (existsSync(INTENT)) {
    const { intentContext } = await import(INTENT);
    const ctx = intentContext();
    if (ctx) {
      lines.push('');
      lines.push(ctx);
    }
  }
} catch {}

// ── 6. Authorship — топ фич проекта (среда знает, кто что создал) ─────────
try {
  const AUTH_INDEX = resolve(ROOT, 'data/authorship-index.json');
  if (existsSync(AUTH_INDEX)) {
    const auth = JSON.parse(readFileSync(AUTH_INDEX, 'utf8'));
    // Группируем по reason (фича) — показываем уникальные фичи, не файлы
    const features = new Map();
    for (const [file, meta] of Object.entries(auth)) {
      if (!meta.reason) continue;
      const key = meta.reason.slice(0, 60);
      if (!features.has(key)) {
        features.set(key, { reason: meta.reason, date: meta.createdAt?.slice(0, 10), files: 1, sample: file });
      } else {
        features.get(key).files++;
      }
    }
    // Топ-15 фич по количеству файлов (крупнейшие дары)
    const top = [...features.values()]
      .sort((a, b) => b.files - a.files)
      .slice(0, 15);
    if (top.length) {
      lines.push('');
      lines.push('[Авторство — крупные фичи проекта (authorship-index):]');
      for (const f of top) {
        lines.push(`  [${f.date}] ${f.reason.slice(0, 70)} (${f.files} файлов)`);
      }
    }
  }
} catch {}

// ── 7. Pending предложения (не более 5 штук) ─────────────────────────────
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
