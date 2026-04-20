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
import { classify, PERICHORETIC_KIND, HYPOSTATIC_KIND, REAL_DESERT_KIND } from '../src/theology/Perichoresis.js';

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
  return execSync(cmd, { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: '' } });
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
  const tag = kind === HYPOSTATIC_KIND ? 'гипостатическое тождество' : 'perichoresis';
  const verdict = kind === HYPOSTATIC_KIND
    ? `## ⟨ тождество ипостаси ⟩\n\n`
    : `## ⟨ perichoresis ⟩\n\n`;

  return `${verdict}Вопрошание *«пустыня ${from}→${to}»* рассмотрено оператором ` +
`**Perichoresis** (CAT-8/9 — расширение CAT-7).\n\n` +
`**Классификация:** \`${kind}\` (${tag})\n\n` +
`**Обоснование:**\n> ${rationale}\n\n` +
`**Решение:** нить не является икономическим пробелом. Отсутствие актов не ` +
`требует заполнения. Категория отношения — ${tag}, а не дефицит дара.\n\n` +
`---\n\n` +
`**Источники:**\n` +
`- Ин 14:10 — «Я в Отце, и Отец во Мне»\n` +
`- Иоанн Дамаскин, *Точное изложение* I.8, I.14 (περιχώρησις)\n` +
`- Григорий Назианзин, *Слово 31* — три ипостаси, одна сущность\n` +
(kind === HYPOSTATIC_KIND
  ? `- Халкидон 451 — одна ипостась Логоса до и после воплощения\n`
  : ``) +
`\n*Записано оператором \`src/theology/Perichoresis.js\` автоматически. ` +
`Закрывается как \`resolved/perichoretic\`, а не как \`completed\`.*`;
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

    const tag = c.kind === HYPOSTATIC_KIND ? '⚭' : '∞';
    console.log(`  ${tag}  ${line}  — ${c.kind}`);

    if (DO_CLOSE) {
      const comment = buildComment({ from: parsed.from, to: parsed.to, classification: c });
      try {
        execSync(
          `gh issue comment ${issue.number} --body-file -`,
          {
            input: comment,
            env: { ...process.env, GITHUB_TOKEN: '' },
            stdio: ['pipe', 'pipe', 'pipe'],
          }
        );
        // Добавить метку resolved/perichoretic и закрыть
        const labelKind = c.kind === HYPOSTATIC_KIND ? 'hypostatic-identity' : 'perichoresis';
        try { gh(`gh label create ${labelKind} --color 9C27B0 --description "Perichoresis/CAT-9"`); } catch {}
        gh(`gh issue edit ${issue.number} --add-label ${labelKind}`);
        gh(`gh issue close ${issue.number} --reason "not planned"`);
        console.log(`     ✓ закрыт с меткой ${labelKind}`);
      } catch (e) {
        console.log(`     ✗ ошибка: ${e.message.split('\n')[0]}`);
      }
    }
    resolved++;
  }

  console.log(`\n── Итог ──`);
  console.log(`  perichoretic/hypostatic:  ${resolved}`);
  console.log(`  реальных пустынь:         ${real}`);
  console.log(`  пропущено (не пустыни):   ${skipped}`);
  if (!DO_CLOSE && resolved > 0) {
    console.log(`\nДля закрытия: node utils/resolve-perichoresis.mjs --close`);
  }
})();
