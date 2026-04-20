#!/usr/bin/env node
/**
 * resolve-perichoresis.mjs — автоматически разрешает «пустыня X→Y»
 * вопрошания через оператор Perichoresis (VIII/IX из CAT-9).
 *
 * Для каждого issue с меткой plan-approved и заголовком «пустыня X→Y»:
 *   1. Извлекает пару (X, Y)
 *   2. Classify через Perichoresis
 *   3. Если perichoresis или hypostatic_identity — постит разрешение и закрывает
 *   4. Если real desert — оставляет в pipeline dev-loop
 *
 * Это НЕ заполняет матрицу фиктивным актом. Это меняет *категорию* нити.
 *
 * Запуск:
 *   node utils/resolve-perichoresis.mjs              # проверить все pustynya-вопрошания
 *   node utils/resolve-perichoresis.mjs --close      # + закрыть issues
 *   node utils/resolve-perichoresis.mjs --issue 212  # только один
 */

import { execSync } from 'node:child_process';
import { classify, PERICHORETIC_KIND, HYPOSTATIC_KIND, REAL_DESERT_KIND, TELOS_ANAGOGIC_KIND, DIVINE_ECONOMY_KIND } from '../src/theology/Perichoresis.js';
import { cleanEnv } from './clean-env.mjs';

const args = process.argv.slice(2);
const DO_CLOSE = args.includes('--close');
const SINGLE = args.includes('--issue') ? args[args.indexOf('--issue') + 1] : null;

const TITLE_RX = /пустыня\s+([^\s→]+)\s*→\s*([^\s:]+)/;

function parseTitle(title) {
  const m = title.match(TITLE_RX);
  if (!m) return null;
  return { from: m[1].trim(), to: m[2].trim() };
}

function gh(cmd) {
  return execSync(cmd, { encoding: 'utf8', env: cleanEnv({ GITHUB_TOKEN: '' }) });
}

async function listCandidates() {
  if (SINGLE) {
    const raw = gh(`gh issue view ${SINGLE} --json number,title,state,labels`);
    return [JSON.parse(raw)];
  }
  const raw = gh(
    `gh issue list --state open --label gift-ready --limit 50 ` +
    `--json number,title,state,labels`
  );
  return JSON.parse(raw);
}

function buildComment({ from, to, classification }) {
  const { kind, rationale } = classification;
  const tag = {
    [HYPOSTATIC_KIND]:     'гипостатическое тождество',
    [PERICHORETIC_KIND]:   'perichoresis',
    [TELOS_ANAGOGIC_KIND]: 'telos-anagogic (анафорически принесено)',
    [DIVINE_ECONOMY_KIND]: 'божественная икономия (нисхождение)',
  }[kind] || kind;

  const title = {
    [HYPOSTATIC_KIND]:     '⟨ тождество ипостаси ⟩',
    [PERICHORETIC_KIND]:   '⟨ perichoresis ⟩',
    [TELOS_ANAGOGIC_KIND]: '⟨ анафорически принесено ⟩',
    [DIVINE_ECONOMY_KIND]: '⟨ икономия нисхождения ⟩',
  }[kind];

  const scripturalHeads = {
    [TELOS_ANAGOGIC_KIND]: [
      '- **Мф 25:40** — «что вы сделали одному из сих меньших — Мне»',
      '- **Рим 8:26** — «Дух ходатайствует воздыханиями неизречёнными»',
      '- **Литургия:** «Твоя от Твоих Тебе приносяще»',
    ].join('\n'),
    [DIVINE_ECONOMY_KIND]: [
      '- **Флп 2:7** — ἐκένωσεν ἑαυτόν (Он истощил Себя)',
      '- **1 Пет 3:19** — «сошёл и проповедал духам в темнице»',
      '- **Кондак Великой Субботы** — «во гробе плотски»',
    ].join('\n'),
    [PERICHORETIC_KIND]: [
      '- **Ин 14:10** — «Я в Отце, и Отец во Мне»',
      '- **Иоанн Дамаскин**, *Точное изложение* I.8, I.14 (περιχώρησις)',
      '- **Григорий Назианзин**, *Слово 31* — три ипостаси, одна сущность',
    ].join('\n'),
    [HYPOSTATIC_KIND]: [
      '- **Халкидон 451** — ἕνα τὸν αὐτόν (одного и того же)',
      '- **Иоанн Дамаскин**, *Точное изложение* III.3',
    ].join('\n'),
  }[kind] || '';

  const closeVerb = kind === DIVINE_ECONOMY_KIND
    ? 'преобразуется в задачу на свидетельство (литургический текст / икона / гимн)'
    : 'закрывается без заполнения фиктивным актом';

  return `## ${title}\n\nВопрошание *«пустыня ${from}→${to}»* рассмотрено оператором **Perichoresis** (CAT-8/9 — голос Критика собора #229).\n\n` +
`**Классификация:** \`${kind}\` (${tag})\n\n` +
`**Обоснование:**\n> ${rationale}\n\n` +
`**Решение:** ${closeVerb}.\n\n---\n\n**Источники:**\n${scripturalHeads}\n\n` +
`*Записано \`src/theology/Perichoresis.js\`. Не \`completed\` — а переклассифицировано.*`;
}

(async () => {
  const issues = await listCandidates();
  let resolved = 0, real = 0, skipped = 0;

  console.log(`\n═══ Perichoresis-разрешение (CAT-8/9) ═══`);
  console.log(`Кандидатов: ${issues.length}\n`);

  for (const issue of issues) {
    const parsed = parseTitle(issue.title);
    if (!parsed) { skipped++; continue; }

    const c = classify(parsed);
    const line = `#${issue.number}  ${parsed.from}→${parsed.to}`;

    if (c.kind === REAL_DESERT_KIND) {
      console.log(`  🏜  ${line}  — реальная пустыня (остаётся в dev-loop)`);
      real++;
      continue;
    }

    const icon = {
      [HYPOSTATIC_KIND]:     '⚭',
      [PERICHORETIC_KIND]:   '∞',
      [TELOS_ANAGOGIC_KIND]: '↑',
      [DIVINE_ECONOMY_KIND]: '↓',
    }[c.kind] || '?';
    console.log(`  ${icon}  ${line}  — ${c.kind}`);

    if (DO_CLOSE) {
      const comment = buildComment({ from: parsed.from, to: parsed.to, classification: c });
      try {
        execSync(
          `gh issue comment ${issue.number} --body-file -`,
          { input: comment, env: cleanEnv({ GITHUB_TOKEN: '' }), stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const labelKind = {
          [HYPOSTATIC_KIND]:     'hypostatic-identity',
          [PERICHORETIC_KIND]:   'perichoresis',
          [TELOS_ANAGOGIC_KIND]: 'telos-anagogic',
          [DIVINE_ECONOMY_KIND]: 'divine-economy',
        }[c.kind];
        try { gh(`gh label create ${labelKind} --color 9C27B0 --description "Perichoresis/CAT-9 (${c.kind})"`); } catch {}
        gh(`gh issue edit ${issue.number} --add-label ${labelKind}`);

        // DIVINE_ECONOMY не закрываем — преобразуем в задачу на свидетельство
        if (c.kind !== DIVINE_ECONOMY_KIND) {
          gh(`gh issue close ${issue.number} --reason "not planned"`);
          console.log(`     ✓ закрыт с меткой ${labelKind}`);
        } else {
          console.log(`     ↓ помечен ${labelKind} — оставлен открытым для свидетельства`);
        }
      } catch (e) {
        console.log(`     ✗ ошибка: ${e.message.split('\n')[0]}`);
      }
    }
    resolved++;
  }

  console.log(`\n── Итог ──`);
  console.log(`  переклассифицировано:    ${resolved}`);
  console.log(`  реальных пустынь:        ${real}`);
  console.log(`  пропущено (не пустыни):  ${skipped}`);
  if (!DO_CLOSE && resolved > 0) {
    console.log(`\nДля закрытия: node utils/resolve-perichoresis.mjs --close`);
  }
})();
