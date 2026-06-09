#!/usr/bin/env node
/**
 * sobor-loop-metakb — полный смысловой контур на живой мета-КБ.
 *
 *   генерация → турнир → заземление на корпус мета-КБ → победитель → ОБРАТНО в мета-КБ
 *
 * Co-Scientist-собор генерит кандидатов на телос, ранжирует по критерию пользы,
 * заземляет на реальные решения рабочей области integram, а лучший записывает
 * туда же новым решением (verdict: proposed) — база сама себя обогащает.
 *
 * Env: INTEGRAM_URL, INTEGRAM_DB, INTEGRAM_TOKEN (или INTEGRAM_EMAIL+PASSWORD)
 *
 *   node utils/sobor-loop-metakb.mjs "телос/тема" [--n 3] [--domain "..."] [--write]
 *
 * Без --write только показывает победителя (ничего не пишет в базу).
 */
import { coscientist, GEN_SYSTEM_ENGINEERING } from './sobor-coscientist.mjs';
import { postDecision, available, fetchCorpus } from './sobor-corpus-integram.mjs';

const args = process.argv.slice(2);
const telos = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--n' && args[args.indexOf(a) - 1] !== '--domain');
const n = Number((args[args.indexOf('--n') + 1]) || 3);
const domain = args[args.indexOf('--domain') + 1] && !args[args.indexOf('--domain') + 1].startsWith('--') ? args[args.indexOf('--domain') + 1] : 'Смыслотворение';
const write = args.includes('--write');

if (!telos) { console.log('Использование: node utils/sobor-loop-metakb.mjs "телос" [--n 3] [--domain "..."] [--write]'); process.exit(0); }
if (!available()) { console.log('Нужны INTEGRAM_URL, INTEGRAM_DB и токен/логин.'); process.exit(1); }

console.log(`Корпус мета-КБ: ${fetchCorpus().length} решений`);
console.log(`Контур · телос: «${telos}» · заземление: вкл\n`);

const res = await coscientist(telos, { n, evolveRounds: 0, ground: true, genSystem: GEN_SYSTEM_ENGINEERING });

console.log('Кандидаты (по Elo, после заземления на корпус):');
res.ranked.forEach((c, i) => console.log(`  ${i + 1}. [Elo ${Math.round(c.elo)}] ${c.text}`));
console.log(`\n🏆 Победитель: ${res.winner.text}`);

if (!write) { console.log('\n(добавь --write, чтобы записать победителя в мета-КБ)'); process.exit(0); }

const r = postDecision({
  title: res.winner.text,
  domain,
  verdict: 'proposed',
  description: 'Сгенерировано Co-Scientist-собором и заземлено на корпус мета-КБ. На рассмотрение команды.',
  weight: Math.max(0, Math.round((res.winner.elo - 1200) / 8)),
  metadata: { grounded: true, elo: Math.round(res.winner.elo), telos },
});
console.log(r.ok ? `\n✓ Записано в мета-КБ как решение #${r.id} (verdict: proposed)` : `\n✗ Не записано: ${r.error}`);
