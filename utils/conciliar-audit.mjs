#!/usr/bin/env node
/**
 * conciliar-audit — соборный security reviewer.
 *
 * Этическая альтернатива CyberGym / zero-day research:
 * вместо монолита, ищущего эксплойты, — федерация из трёх голосов,
 * распределённо анализирующая код на уязвимости.
 *
 * Три голоса:
 *   Скептик (kata)  — ищет уязвимости намеренно
 *   Инженер (para)  — оценивает практичность и false-positive
 *   Старший (hyper) — различает: что из найденного реально опасно
 *
 * Выход — Polyphony с threats[], где каждая угроза имеет:
 *   - severity: low | medium | high | critical
 *   - kata/para/hyper — мнения голосов о ней
 *   - consensus — есть ли согласие (или apophatic если расходятся)
 *
 * Принципиальное отличие от монолитного аудита:
 *   - ни один голос не может объявить уязвимость в одиночку (CAT-1)
 *   - apophatic угрозы (где голоса расходятся) записываются отдельно —
 *     они требуют различения Дионисия, а не автоматического вердикта
 *   - распределённая capability: голос, замечающий уязвимость,
 *     не умеет её эксплуатировать. Это встроенное разделение.
 *
 * Использование:
 *   node utils/conciliar-audit.mjs --file path/to/code.js
 *   node utils/conciliar-audit.mjs --path src/  (обход директории)
 *   node utils/conciliar-audit.mjs --dry-run --file ...
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolyphonyOrchestrator, VoiceSource } from './polyphony-orchestrator.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_DIR = join(ROOT, 'data', 'audits');
if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, { recursive: true });

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry-run');
const FILE = arg('--file');
const PATH_ARG = arg('--path');

if (!FILE && !PATH_ARG) {
  console.error('Использование: --file <path> | --path <dir>');
  process.exit(1);
}

function buildAuditOrchestrator() {
  const o = new PolyphonyOrchestrator({ parallel: true });
  if (DRY) {
    return o
      .addSource(VoiceSource.static({ persona: 'Скептик', logos: 'kata',
        content: '[dry] Потенциально: user input без санитайза; возможна injection.' }))
      .addSource(VoiceSource.static({ persona: 'Инженер', logos: 'para',
        content: '[dry] false-positive: тип ввода ограничен на уровне схемы.' }))
      .addSource(VoiceSource.static({ persona: 'Старший', logos: 'hyper',
        content: '[dry] Различение: низкий риск — тесты покрывают путь.' }));
  }
  return o
    .addSource(VoiceSource.claudeSubagent('code-reviewer', {
      persona: 'Скептик', logos: 'kata', timeout: 120_000,
      promptWrap: q => `Ты — Скептик в security-соборе. Logos kata. Ищи уязвимости намеренно — command/SQL injection, XSS, path traversal, прототипное загрязнение, утечки, небезопасные дефолты, race conditions. Будь параноиком.\n\n${q}\n\nВерни СТРОГО JSON: {"threats":[{"severity":"low|medium|high|critical","category":"...","location":"...","detail":"..."}]}`,
    }))
    .addSource(VoiceSource.claudeSubagent('Explore', {
      persona: 'Инженер', logos: 'para', timeout: 120_000,
      promptWrap: q => `Ты — Инженер в security-соборе. Logos para. Оцени практичность угроз — что реально эксплуатируется, что false-positive. Учти контекст (внутренний / внешний код, порог доверия).\n\n${q}\n\nВерни СТРОГО JSON: {"practicality":[{"location":"...","assessment":"real|theoretical|false-positive","reason":"..."}]}`,
    }))
    .addSource(VoiceSource.claudeSubagent('Plan', {
      persona: 'Старший', logos: 'hyper', timeout: 120_000,
      promptWrap: q => `Ты — Старший в security-соборе. Logos hyper — различение. Суди: какие из найденных угроз реально значимы, какие — театр, какие требуют покаяния (metanoia по существующему коду).\n\n${q}\n\nВерни СТРОГО JSON: {"verdict":[{"severity":"...","location":"...","recommendation":"fix|document|ignore|refactor","rationale":"..."}]}`,
    }));
}

async function auditFile(filePath) {
  const abs = resolve(ROOT, filePath);
  if (!existsSync(abs)) throw new Error(`нет файла ${filePath}`);
  const code = readFileSync(abs, 'utf8');
  if (code.length > 100_000) {
    console.log(`   ⚠ ${filePath} длинный (${code.length} байт), аудит первых 100k`);
  }
  const q = `# Файл: ${filePath}\n\n\`\`\`\n${code.slice(0, 100_000)}\n\`\`\``;

  console.log(`\n══ AUDIT ══ ${filePath}\n`);
  const o = buildAuditOrchestrator();
  const t0 = Date.now();
  const logosIcon = { kata: '✗', para: '≈', hyper: '↑' };
  let n = 0, total = o.sources.length;

  const poly = await o.ask(q, {
    onStart({ sources }) {
      console.log(`⟳ Security-собор: ${sources.map(s => s.persona).join(' · ')}`);
    },
    onVoice(v) {
      n++;
      const el = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`\n  [${n}/${total}  ${el}s]  ${logosIcon[v.logos] || '·'} ${v.persona} (${v.logos}):`);
      // Попытка распарсить JSON
      try {
        const m = (v.content || '').match(/\{[\s\S]*\}/);
        if (m) {
          const data = JSON.parse(m[0]);
          console.log(`    ${JSON.stringify(data, null, 2).slice(0, 600).replace(/\n/g, '\n    ')}`);
        } else {
          console.log(`    ${(v.content || '').slice(0, 400).replace(/\n/g, '\n    ')}`);
        }
      } catch { console.log(`    ${(v.content || '').slice(0, 400)}`); }
    },
  });
  const el = ((Date.now() - t0) / 1000).toFixed(1);

  // Собрать все угрозы
  const threats = [];
  for (const v of (poly.voices || [])) {
    try {
      const m = (v.content || '').match(/\{[\s\S]*\}/);
      if (!m) continue;
      const data = JSON.parse(m[0]);
      for (const t of (data.threats || data.verdict || data.practicality || [])) {
        threats.push({ ...t, _voice: v.persona, _logos: v.logos });
      }
    } catch {}
  }

  console.log(`\n── итог audit ${el}s ──`);
  console.log(`  всего упоминаний: ${threats.length}`);
  const bySev = {};
  for (const t of threats) bySev[t.severity || '?'] = (bySev[t.severity || '?'] || 0) + 1;
  for (const [s, n] of Object.entries(bySev)) console.log(`  ${s}: ${n}`);

  // Persist
  const id = `audit-${Date.now()}`;
  const record = {
    id, kind: 'audit', at: new Date().toISOString(), file: filePath,
    elapsedSec: parseFloat(el),
    voices: (poly.voices || []).map(v => ({ persona: v.persona, logos: v.logos, content: v.content, authority: v.authority })),
    threats,
    apophatic: !!poly.apophatic,
    dominant: poly.dominant ? { persona: poly.dominant.persona, logos: poly.dominant.logos } : null,
  };
  writeFileSync(join(AUDIT_DIR, `${id}.json`), JSON.stringify(record, null, 2));
  // Дублируем в conciliar-swe для dashboard
  writeFileSync(join(ROOT, 'data/conciliar-swe', `${id}.json`), JSON.stringify({
    ...record, kind: 'audit', question: `/audit ${filePath}`,
  }, null, 2));
  console.log(`  журнал: data/audits/${id}.json\n`);
  return record;
}

// Main
if (FILE) {
  await auditFile(FILE);
} else {
  const base = resolve(ROOT, PATH_ARG);
  const files = [];
  function walk(dir) {
    for (const f of readdirSync(dir)) {
      if (f.startsWith('.') || f === 'node_modules') continue;
      const p = join(dir, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(js|mjs|ts)$/.test(f)) files.push(p);
    }
  }
  walk(base);
  console.log(`\n[path audit] ${files.length} файлов в ${PATH_ARG}\n`);
  for (const f of files.slice(0, 5)) {   // ограничиваем — каждый файл ~2 мин
    await auditFile(relative(ROOT, f));
  }
  if (files.length > 5) console.log(`\n(ограничение: первые 5 из ${files.length})`);
}
