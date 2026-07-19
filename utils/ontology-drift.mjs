#!/usr/bin/env node
/**
 * ontology-drift.mjs — статическая проверка согласованности TBox/ABox для GiftAct.
 *
 * Вдохновлено FLoC26 (KR/DL): схема data/gift-act.schema.json — это TBox (что дозволено),
 * а конкретные вызовы .receive({giverId, type, ...}) по всей кодовой базе — ABox (что
 * реально происходит). DL-онтология несогласованна, если ABox использует класс, которого
 * нет в TBox. Найдено вручную 19.07.2026: 7 типов (eval-winner, eval-participant, metanoia,
 * insight, oracle, conflict, direction) активно пишутся в матрицу, но отсутствуют в enum
 * схемы — то есть если через них пройдёт gift-validator.mjs, они будут признаны невалидными,
 * хотя это не ошибка данных, а неучтённые классы онтологии.
 *
 * Эвристика: ищем `type: 'X'` в окне ±WINDOW строк вокруг `giverId` в одном файле
 * (эвристика, не AST-парсер — акты создаются как обычные object-литералы, giverId/type
 * почти всегда соседствуют). Ложные срабатывания возможны при плотных многострочных
 * функциях с несвязанными giverId/type — отчёт даёт file:line, легко проверить глазами.
 *
 * CLI:
 *   node utils/ontology-drift.mjs           — отчёт (undeclared + unused типы)
 *   node utils/ontology-drift.mjs --json
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WINDOW = 6; // строк по обе стороны от giverId, где ищем соседний type:

/** Enum допустимых типов из TBox (схемы). */
export function loadSchemaTypes() {
  const schema = JSON.parse(readFileSync(resolve(ROOT, 'data/gift-act.schema.json'), 'utf8'));
  return new Set(schema.properties.type.enum);
}

/**
 * Сканирует src/ и utils/ на предмет `type: 'X'` в окне вокруг `giverId`.
 * Возвращает Map(type → Set(file:line)) — ABox использования по каждому типу.
 * Не выполняет код, только текстовый разбор — детерминированно и быстро.
 */
export function scanUsedTypes({ dirs = ['src', 'utils'], window = WINDOW } = {}) {
  const files = execSync(
    `grep -rl 'giverId' ${dirs.join(' ')} --include='*.js' --include='*.mjs' 2>/dev/null || true`,
    { cwd: ROOT, encoding: 'utf8' }
  ).trim().split('\n').filter(Boolean);

  const used = new Map(); // type -> Set(`${file}:${line}`)
  for (const f of files) {
    const lines = readFileSync(resolve(ROOT, f), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/giverId\s*[:=]/.test(lines[i])) continue;
      const start = Math.max(0, i - window), end = Math.min(lines.length, i + window);
      for (let j = start; j < end; j++) {
        const m = lines[j].match(/\btype\s*:\s*['"]([a-zA-Z_-]+)['"]/);
        if (!m) continue;
        const t = m[1];
        if (!used.has(t)) used.set(t, new Set());
        used.get(t).add(`${f}:${j + 1}`);
      }
    }
  }
  return used;
}

/** Сравнивает ABox (used) с TBox (schemaTypes). Чистая функция от двух множеств. */
export function diffOntology(used, schemaTypes) {
  const undeclared = [...used.keys()]
    .filter(t => !schemaTypes.has(t))
    .map(t => ({ type: t, sites: [...used.get(t)].sort() }));
  const unused = [...schemaTypes].filter(t => !used.has(t)).sort();
  return { undeclared, unused };
}

// ── CLI ───────────────────────────────────────────────────────────────
const C = { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m' };

if (import.meta.url === `file://${process.argv[1]}`) {
  const schemaTypes = loadSchemaTypes();
  const used = scanUsedTypes();
  const { undeclared, unused } = diffOntology(used, schemaTypes);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ undeclared, unused }, null, 2));
    process.exit(undeclared.length === 0 ? 0 : 1);
  }

  console.log(`\n${C.b}${C.y}═══ Дрейф онтологии GiftAct (TBox/ABox, FLoC26/KR-DL) ═══${C.x}`);
  console.log(`${C.dim}TBox: ${schemaTypes.size} типов в schema · ABox: ${used.size} типов встречено в коде${C.x}\n`);

  console.log(`${C.b}типы в коде, не объявленные в схеме (undeclared):${C.x} ${undeclared.length}`);
  for (const u of undeclared) {
    console.log(`  ${C.r}✗${C.x} ${C.b}${u.type}${C.x} ${C.dim}[${u.sites.slice(0, 3).join(', ')}${u.sites.length > 3 ? `, +${u.sites.length - 3}` : ''}]${C.x}`);
  }

  console.log(`\n${C.b}типы в схеме, ни разу не встреченные в коде рядом с giverId (unused):${C.x} ${unused.length}`);
  console.log(`  ${C.dim}${unused.join(', ') || '(нет)'}${C.x}`);
  console.log(`  ${C.dim}не ошибка сама по себе — эвристика текстовая, не AST; акты могли создаваться иначе (specs/*.gift, генеративно)${C.x}`);

  console.log(`\n${undeclared.length === 0 ? C.g + '✓ ABox ⊆ TBox — онтология согласована' : C.r + `✗ ${undeclared.length} необъявлен${undeclared.length === 1 ? 'ный тип' : 'ных типа(ов)'} — либо дополнить схему, либо это ошибка`}${C.x}\n`);
  process.exit(undeclared.length === 0 ? 0 : 1);
}
