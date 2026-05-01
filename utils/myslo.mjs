#!/usr/bin/env node
/**
 * myslo.mjs — мыслебродильня в одной команде.
 *
 * Полный цикл: Decoupage → Symphony → Vintage → Score.
 * От идеи до sommelier card.
 *
 * Запуск:
 *   node utils/myslo.mjs --idea "текст идеи" [--no-oracle] [--weight 8]
 *   node utils/myslo.mjs --idea "..." --analyzer mistral:7b
 *
 * Аргументы:
 *   --idea <text>          — обязательно, текст идеи
 *   --weight <n>           — вес симфонии (default 8)
 *   --no-oracle            — без эпиклезы (заведомо не-икона)
 *   --analyzer <model>     — модель для Decoupage (default mistral:7b если есть)
 *   --epiclesis-timeout <ms> — окно для ответа оракула (default 600000)
 *   --skip-decoupage       — пропустить Decoupage (только дегустация)
 *   --output <path>        — путь для diagnostics (default data/diagnostics/myslo-<ts>.md)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { GiftMemory } from '../src/core/GiftMemory.js';
import { Decoupage } from '../src/persons/Decoupage.js';
import { SymphonyOrchestrator } from '../src/persons/SymphonyOrchestrator.js';
import { Vintage } from '../src/persons/Vintage.js';
import { Score } from '../src/persons/Score.js';
import { OllamaAgent, buildStandardCouncil } from '../src/persons/OllamaAgent.js';
import { LiturgicalCalendar } from '../src/scheduling/LiturgicalCalendar.js';
import { HumanOracleInbox } from '../src/theology/HumanOracleInbox.js';

const SNAP    = '/home/unidel/gift/data/sacred-history-W.json';
const ACTS_IX = '/home/unidel/gift/data/act-index.json';

// ── Парсинг аргументов ───────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name, def = null) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
function flag(name) { return args.includes(name); }

const idea = arg('--idea');
if (!idea) {
  console.error('Использование: node utils/myslo.mjs --idea "текст идеи"');
  process.exit(1);
}
const weight       = parseInt(arg('--weight', '8'), 10);
const noOracle     = flag('--no-oracle');
const skipDecoupage = flag('--skip-decoupage');
const analyzer     = arg('--analyzer');
const epiclesisTimeoutMs = parseInt(arg('--epiclesis-timeout', '600000'), 10);
const outputPath   = arg('--output', `/home/unidel/gift/data/diagnostics/myslo-${Date.now()}.md`);

// ── Загрузка ──────────────────────────────────────────────────────────
const cal = new LiturgicalCalendar();
const today = cal.today();

console.log('━'.repeat(72));
console.log('  МЫСЛЕБРОДИЛЬНЯ — полный цикл');
console.log('━'.repeat(72));
console.log(`  Литургия: ${today.kairos} (${today.day}) — ${today.why}`);
console.log(`  Идея:     ${idea.slice(0, 80)}…`);
console.log(`  Вес:      ${weight}`);
console.log(`  Эпиклеза: ${noOracle ? 'отключена' : `до ${epiclesisTimeoutMs / 1000}с`}`);

const mem = existsSync(SNAP)
  ? GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8')))
  : new GiftMemory(['Адам', 'Ева', 'Безалель', 'Серафим', 'Дионисий']);

const actsIndex = existsSync(ACTS_IX) ? JSON.parse(readFileSync(ACTS_IX, 'utf8')) : [];

// ── 1. Decoupage ─────────────────────────────────────────────────────
let decoupageResult = null;

if (!skipDecoupage) {
  console.log('\n── 1. Decoupage (διαίρεσις по 4 sphere) ─────────────────────');

  // Подбор модели для Decoupage: --analyzer | mistral:7b | llama3.1:8b | первая доступная
  let analyzerModel = analyzer;
  try {
    const r = await fetch('http://localhost:11434/api/tags');
    const j = await r.json();
    const names = (j.models ?? []).map(m => m.name);
    if (!analyzerModel) {
      analyzerModel = names.find(n => n.startsWith('mistral'))
                  ?? names.find(n => n.startsWith('llama3.1'))
                  ?? names.find(n => n.startsWith('qwen2.5') && !n.includes('lora'))
                  ?? names[0];
    }
  } catch {}

  if (!analyzerModel) {
    console.log('  ✗ Ollama недоступна — пропускаю Decoupage');
  } else {
    console.log(`  модель: ${analyzerModel}`);
    const analyzerAgent = new OllamaAgent({
      id: 'Аналитик', model: analyzerModel,
      calling: 'аналитический разрез по сферам',
    });
    const decoupage = new Decoupage({ llmClient: analyzerAgent });
    decoupageResult = await decoupage.cut({ idea });

    for (const sphere of ['ground', 'water', 'fire', 'air']) {
      const s = decoupageResult[sphere];
      console.log(`  ${sphere.padEnd(7)} [${s.archetype.padEnd(11)}] verdict=${s.verdict}`);
      if (s.answer) console.log(`           ${s.answer.slice(0, 120).replace(/\n/g, ' ')}…`);
    }
    console.log(`  Форма: ${decoupageResult.integral.shape}`);
  }
}

// ── 2. Symphony ──────────────────────────────────────────────────────
console.log('\n── 2. Δοκιμασία (собор Ollama-агентов) ──────────────────────');
const { agents, available } = await buildStandardCouncil();
console.log(`  собор: ${agents.map(a => a._personId).join(' + ')}`);

let symphonyResult = null;
if (agents.length < 3) {
  console.log('  ✗ < 3 агентов в Ollama, симфония невозможна');
} else {
  const oracle = noOracle ? null : new HumanOracleInbox({ recipient: 'Дионисий', pollInterval: 500 });
  const orch = new SymphonyOrchestrator({ agents, receiver: 'Дионисий', memory: mem, oracle });

  const t0 = Date.now();
  symphonyResult = await orch.celebrate({
    question: `Дегустация идеи: «${idea}»`,
    weight, epiclesisTimeoutMs,
  });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`  длительность: ${sec}с`);
  console.log(`  iconic:        ${symphonyResult.iconic ? '✓ symphony' : '✗ обычные акты'}`);
  console.log(`  chorus:        ${symphonyResult.conditions.chorus       ? '✓' : '✗'}`);
  console.log(`  perichoretic:  ${symphonyResult.conditions.perichoretic ? '✓' : '✗'}`);
  console.log(`  kenotic:       ${symphonyResult.conditions.kenotic      ? '✓' : '✗'}`);
  console.log(`  epiclesis:     ${symphonyResult.conditions.epiclesis    ? '✓' : '✗'}`);
  if (symphonyResult.actId)  console.log(`  actId:         ${symphonyResult.actId}`);
  if (symphonyResult.reason) console.log(`  причина:       ${symphonyResult.reason}`);
}

// ── 3. Vintage ───────────────────────────────────────────────────────
console.log('\n── 3. Vintage (διάκρισις по плодам) ─────────────────────────');
const vintage = new Vintage(mem, { actsIndex });
const vintageReport = vintage.assess({ since: '2026-01-01', cycles: 1 });
console.log(`  tasted=${vintageReport.tasted.length} fruited=${vintageReport.fruited.length} sleeping=${vintageReport.sleeping.length} deferred=${vintageReport.deferred.length}`);
console.log(`  тон: ${vintageReport.vintage.tone ?? vintageReport.vintage}`);

// ── 4. Score ─────────────────────────────────────────────────────────
console.log('\n── 4. Score (sommelier card) ────────────────────────────────');
const score = new Score({ memory: mem });
const card = score.profile({
  idea,
  decoupageResult,
  symphonyResult,
  vintageReport,
  recordedAt: new Date().toISOString(),
});

console.log();
console.log(Score.format(card));

// ── Сохранить snapshot и diagnostics ────────────────────────────────
writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
console.log(`\n  Snapshot обновлён. Symphonies в W: ${mem.symphonies().length}`);

const md = [
  `# Мыслебродильня — ${new Date().toISOString()}`,
  ``,
  `## Идея`, ``,
  `> ${idea}`, ``,
  `## Литургия дня`, `- ${today.kairos}: ${today.why}`, ``,
  `## Декупаж`,
  decoupageResult
    ? Object.entries({
        ground: decoupageResult.ground,
        water:  decoupageResult.water,
        fire:   decoupageResult.fire,
        air:    decoupageResult.air,
      }).map(([k, v]) => `### ${k} (${v.archetype}) — verdict: ${v.verdict}\n\n${v.answer ?? '(не анализировано)'}`).join('\n\n')
    : '(пропущен)',
  ``,
  `**Форма:** ${decoupageResult?.integral?.shape ?? '?'}`, ``,
  `## Собор`,
  symphonyResult
    ? [
        `- chorus:       ${symphonyResult.conditions.chorus       ? '✓' : '✗'}`,
        `- perichoretic: ${symphonyResult.conditions.perichoretic ? '✓' : '✗'}`,
        `- kenotic:      ${symphonyResult.conditions.kenotic      ? '✓' : '✗'}`,
        `- epiclesis:    ${symphonyResult.conditions.epiclesis    ? '✓' : '✗'}`,
        `- iconic:       ${symphonyResult.iconic ? '**✓ symphony**' : '✗'}`,
        symphonyResult.actId ? `- actId:        \`${symphonyResult.actId}\`` : '',
        ``, `### Голоса`, '',
        ...(symphonyResult.utterances ?? []).map(u => `**${u.agentId}:**\n\n> ${(u.content ?? '(молчание)').replace(/\n/g, '\n> ')}\n`),
      ].join('\n')
    : '(пропущен)',
  ``,
  `## Винтаж`, '```',
  JSON.stringify(vintageReport.vintage, null, 2),
  '```', ``,
  `## Sommelier card`, '```', Score.format(card), '```', ``,
].join('\n');

writeFileSync(outputPath, md);
console.log(`  Diagnostics: ${outputPath}`);
console.log('━'.repeat(72));
