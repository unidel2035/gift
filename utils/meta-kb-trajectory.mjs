#!/usr/bin/env node
/**
 * meta-kb-trajectory.mjs — прототип одной траектории «риск → ТЗ».
 *
 * Сквозной прогон методики Мета-КБ: вход = риск + группа ЛПР →
 * 3 панели (ИИ-агенты на DeepSeek) → 3 гейта (человек) → заполненное ТЗ.
 * Принцип: панель вычислима (агенты), гейт — нет (человек).
 *
 *   export DEEPSEEK_API_KEY=sk-...
 *   node utils/meta-kb-trajectory.mjs --group "военные ВПК" --risk "<риск>" --auto
 *   node utils/meta-kb-trajectory.mjs            # интерактивно, с гейтами вручную
 *
 * --auto  : ЛПР-заглушка (решение логируется) — для прогонов
 * иначе   : гейты проходит человек в терминале
 */
import OpenAI from 'openai';
import readline from 'node:readline/promises';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const AUTO = args.includes('--auto');
const GROUP = opt('--group', 'военные ВПК');
const RISK = opt('--risk', 'Подавление и подмена канала управления и навигации БПЛА средствами РЭБ противника');
const OUTDIR = opt('--out', path.join(process.cwd(), 'docs', 'tz-output'));

if (!process.env.DEEPSEEK_API_KEY) { console.error('Нужен DEEPSEEK_API_KEY.'); process.exit(1); }
const client = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' });

const c = { dim: '\x1b[2m', y: '\x1b[33m', g: '\x1b[32m', cy: '\x1b[36m', r: '\x1b[0m', b: '\x1b[1m' };

// ── заземление на отраслевую базу знаний БАС (KAG) ──
const HERE = path.dirname(fileURLToPath(import.meta.url));
function kag(query, limit = 6) {
  try {
    const out = execFileSync('python3', [path.join(HERE, 'bas-knowledge.py'), query, String(limit)],
      { encoding: 'utf8', timeout: 15000 });
    const r = JSON.parse(out);
    return Array.isArray(r) ? r : [];
  } catch { return []; }
}
const factsBlock = (facts) => facts.length
  ? 'Факты из отраслевой базы знаний БАС (опирайся на них, если релевантно):\n' +
    facts.map(f => `- [${f.type}] ${f.name}: ${f.observation}`).join('\n')
  : '(База знаний не дала фактов по теме — опирайся на экспертное знание и отметь это.)';

async function panel(name, system, user) {
  process.stdout.write(`${c.cy}▸ панель «${name}» работает…${c.r}\n`);
  const res = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' }, temperature: 0.5,
  });
  return JSON.parse(res.choices[0].message.content);
}

let rl;
async function gate(label, brief, autoDecision) {
  console.log(`\n${c.y}${c.b}■ ГЕЙТ ЛПР — ${label}${c.r}`);
  console.log(brief);
  if (AUTO) {
    console.log(`${c.dim}  [авто] ЛПР: ${autoDecision}${c.r}`);
    return autoDecision;
  }
  rl = rl || readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(`${c.g}Решение ЛПР${c.r} [Enter = «${autoDecision}»]: `);
  return ans.trim() || autoDecision;
}

const J = (o) => JSON.stringify(o);

async function main() {
  console.log(`${c.y}${c.b}─── траектория: ${GROUP} · риск ───${c.r}`);
  console.log(`${c.dim}${RISK}${c.r}`);

  // заземление: факты из отраслевой базы знаний БАС
  const facts = kag(RISK);
  console.log(`${c.dim}база знаний БАС: фактов по теме — ${facts.length}${facts.length ? ' (' + facts.map(f => f.name).slice(0, 4).join(', ') + '…)' : ''}${c.r}`);

  // ── Этап 1: панель «Ситуация» ──
  const p1 = await panel('Ситуация',
    `Ты аналитическая панель в области БАС (беспилотные авиационные системы). Разбери риск для группы ЛПР «${GROUP}».
Верни JSON: {"factors":["..."],"severity":<1-10>,"why_matters":"<почему важно именно для этой группы>"}`,
    `Риск: ${RISK}\n\n${factsBlock(facts)}`);
  console.log(`  severity ${p1.severity}/10 · факторов: ${p1.factors.length}`);
  const telos = await gate('значимость риска',
    `  Факторы: ${p1.factors.join('; ')}\n  Значимость: ${p1.severity}/10 — ${p1.why_matters}`,
    `риск значим, цель — снизить «${RISK}» до приемлемого для группы «${GROUP}»`);

  // ── Этап 2: панель «Прогноз» ──
  const p2 = await panel('Прогноз',
    `Ты панель прогноза в области БАС. Для риска оцени, что закрывают СУЩЕСТВУЮЩИЕ решения и где разрыв.
Верни JSON: {"existing":[{"name":"...","covers":"...","gap":"..."}],"residual_risk":"...","needs_niokr":<true|false>}`,
    `Риск: ${RISK}\nФакторы: ${J(p1.factors)}\nГруппа: ${GROUP}\n\n${factsBlock(facts)}`);
  console.log(`  существующих решений: ${p2.existing.length} · нужен НИР: ${p2.needs_niokr}`);
  const needNir = await gate('приемлемость остаточного риска',
    `  Существующие: ${p2.existing.map(e => e.name + ' (разрыв: ' + e.gap + ')').join('; ')}\n  Остаточный риск: ${p2.residual_risk}`,
    p2.needs_niokr ? 'остаточный риск неприемлем — нужен перспективный НИР' : 'остаточный риск приемлем');

  // ── Этап 3: панель «Стратегия» — несколько голосов, спор удерживается до гейта ──
  const lenses = [
    { id: 'Прорывной', stance: 'Максимальный эффект, готов принять высокий риск самого НИР ради качественного снятия угрозы.' },
    { id: 'Надёжный', stance: 'Минимум риска НИР, опора на зрелые технологии и развитие существующего, пусть эффект скромнее.' },
    { id: 'Асимметричный', stance: 'Нестандартный обходной путь, делающий саму угрозу неприменимой, а не противодействующий ей в лоб.' },
  ];
  console.log(`${c.cy}▸ панель «Стратегия»: ${lenses.length} голоса спорят…${c.r}`);
  const proposals = await Promise.all(lenses.map(async (l) => {
    const o = await panel(`Стратег·${l.id}`,
      `Ты стратег в области БАС с установкой: «${l.stance}». Предложи ОДИН вариант перспективного НИОКР, снимающего остаточный риск, по двум дорожкам: (A) железо+софт, (B) орг. средства внедрения.
Верни JSON: {"title":"...","track_hw_sw":{"package":"...","ttx":"...","stages":"...","acceptance":"..."},"track_org":{"who":"...","ip":"...","retention":"..."},"removes_risk_how":"...","effort":"...","nir_risk":"..."}`,
      `Риск: ${RISK}\nОстаточный риск: ${p2.residual_risk}\nГруппа: ${GROUP}`);
    o.lens = l.id; return o;
  }));
  // перемешиваем порядок — позиция в списке не должна нести сигнал «рекомендации»
  for (let i = proposals.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [proposals[i], proposals[j]] = [proposals[j], proposals[i]]; }
  // различитель НЕ выбирает и НЕ оценивает — он точно предъявляет разногласие
  const dissent = await panel('Различитель',
    `Ты различитель в соборной панели. Запрещено: выбирать вариант, рекомендовать, использовать оценочные слова («лучше», «оптимальный», «предпочтительно»). Твоя задача — не снять разногласие, а точно его предъявить.
Верни JSON: {"agreement":"<что общего у всех>","tension":"<по какой ОДНОЙ оси варианты несоизмеримы, напр. риск НИР против эффекта>","what_lpr_must_weigh":"<какую именно ставку берёт на себя человек, выбирая>"}`,
    proposals.map((p, i) => `[${i}] (${p.lens}) ${p.title}: ${p.removes_risk_how}; трудоёмкость ${p.effort}; риск НИР ${p.nir_risk}`).join('\n'));
  console.log(`  голосов: ${proposals.length} · разногласие удержано (различитель не выбирал)`);

  const gate3brief = proposals.map((p, i) => `  [${i}] (${p.lens}) ${p.title} — ${p.removes_risk_how}\n        трудоёмкость: ${p.effort} · риск НИР: ${p.nir_risk}`).join('\n')
    + `\n  ── Согласие голосов: ${dissent.agreement}\n  ── Принципиальное расхождение: ${dissent.tension}\n  ── Что взвешивает ЛПР: ${dissent.what_lpr_must_weigh}`;
  let chosenIdx;
  console.log(`\n${c.y}${c.b}■ ГЕЙТ ЛПР — выбор направления и подпись ТЗ${c.r}`);
  console.log(gate3brief);
  if (AUTO) {
    chosenIdx = 0;
    console.log(`${c.dim}  [авто] ЛПР берёт ставку на вариант #0 «${proposals[0].title}» (порядок перемешан — #0 не рекомендация; в реальной сессии выбор человека)${c.r}`);
  } else {
    rl = rl || readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(`${c.g}Ставка ЛПР${c.r} [0/1/2, Enter=0]: `);
    chosenIdx = [0, 1, 2].includes(Number(ans.trim())) ? Number(ans.trim()) : 0;
  }
  const chosen = `ставка на вариант #${chosenIdx}: «${proposals[chosenIdx].title}» (${proposals[chosenIdx].lens})`;
  const o = proposals[chosenIdx];
  const now = new Date().toISOString().slice(0, 10);
  const tz = `# ТЗ на НИОКР: ${o.title}

**Группа ЛПР:** ${GROUP}
**Дата:** ${now} · **Версия:** 1

## 1. Основание и снимаемый риск
- **Риск:** ${RISK}
- **Значимость (severity):** ${p1.severity}/10 — ${p1.why_matters}
- **Факторы риска:** ${p1.factors.join('; ')}

## 2. Чего не закрывают существующие решения
${p2.existing.map(e => `- **${e.name}:** закрывает ${e.covers}; разрыв — ${e.gap}`).join('\n')}
- **Остаточный риск:** ${p2.residual_risk}

## 3. Цель НИР
${o.removes_risk_how}

### Дорожка А — Железо и софт
- **Технологический пакет:** ${o.track_hw_sw.package}
- **Ключевые ТТХ:** ${o.track_hw_sw.ttx}
- **Этапы и контрольные точки:** ${o.track_hw_sw.stages}
- **Критерии приёмки:** ${o.track_hw_sw.acceptance}

### Дорожка Б — Внедрение (организационные средства)
- **Кто внедряет и через какой институт:** ${o.track_org.who}
- **Стратегия по интеллектуальной собственности:** ${o.track_org.ip}
- **Удержание в эксплуатации:** ${o.track_org.retention}

## Разногласие панели «Стратегия» (удержано до решения ЛПР)
${proposals.map((p, i) => `- **[${i}] ${p.lens} — ${p.title}:** ${p.removes_risk_how} (трудоёмкость ${p.effort}; риск НИР ${p.nir_risk})`).join('\n')}
- **Согласие голосов:** ${dissent.agreement}
- **Принципиальное расхождение:** ${dissent.tension}
- **Что взвешивал ЛПР:** ${dissent.what_lpr_must_weigh}

## 4. Ресурсы, сроки, риски самого НИР
- **Трудоёмкость:** ${o.effort}
- **Риски НИР:** ${o.nir_risk}

## 5. Утверждение
- **Постановка цели (гейт 1):** ${telos}
- **Решение о НИР (гейт 2):** ${needNir}
- **Выбор направления (гейт 3):** ${chosen}
- **ЛПР:** _________________________   **Дата:** ${now}
${facts.length ? `
## Источники (отраслевая база знаний БАС)
${facts.map(f => `- ${f.name} (${f.type})`).join('\n')}
` : ''}
---
*Сформировано прототипом траектории Мета-КБ. Панели — ИИ-агенты; решения на гейтах — человек. Факты этапов 1–2 заземлены на отраслевую базу знаний БАС.*
`;

  fs.mkdirSync(OUTDIR, { recursive: true });
  const fname = `ТЗ_${GROUP.replace(/\s+/g, '-')}_${now}.md`;
  const fpath = path.join(OUTDIR, fname);
  fs.writeFileSync(fpath, tz);
  console.log(`\n${c.g}${c.b}✓ ТЗ сформировано:${c.r} ${fpath}`);
  if (rl) rl.close();
}

main().catch(e => { console.error('Ошибка:', e.message); if (rl) rl.close(); process.exit(1); });
