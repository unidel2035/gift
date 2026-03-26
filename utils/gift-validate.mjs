#!/usr/bin/env node
/**
 * gift-validate.mjs
 *
 * JSON Schema валидатор для .gift файлов (proposal #3).
 *
 * Парсит .gift файл → структурированный JSON → валидирует по gift-schema.json.
 * Это делает .gift файлы «исполняемыми» — буквально загружаемыми в GiftMemory.
 *
 * Запуск:
 *   node utils/gift-validate.mjs specs/theology/trinity.gift
 *   node utils/gift-validate.mjs specs/ --all         — весь каталог
 *   node utils/gift-validate.mjs --json specs/x.gift  — вывод JSON
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, statSync } from 'fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, '..');
const SCHEMA  = JSON.parse(readFileSync(join(ROOT, 'src/types/gift-schema.json'), 'utf8'));

const TRITS = new Set(['kata', 'para', 'hyper', 'incalculable']);
const ACT_TYPES = new Set([
  'gift', 'kenosis', 'grace', 'witness', 'blessing', 'incarnation',
  'presence', 'word', 'code', 'question', 'approval', 'offering',
]);

// ── Лексер .gift ───────────────────────────────────────────────────────────

/**
 * Грубый парсер .gift файла → структурированный GiftSpec.
 * Не претендует на полноту — парсит ключевые конструкции.
 */
function parseGift(src, filename = '') {
  // Убрать комментарии
  const clean = src
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\r\n/g, '\n');

  const spec = {
    persons:   [],
    gifts:     [],
    liturgies: [],
    witnesses: [],
    variables: [],
    _source:   filename,
    _parsedAt: new Date().toISOString(),
  };

  // ── persons ──────────────────────────────────────────────────────────────
  // person Name { calling: "...", energy: N, logos: trit }
  const personRe = /\bperson\s+(\S+)\s*\{([^}]*)\}/g;
  for (const m of clean.matchAll(personRe)) {
    const [, id, body] = m;
    const calling = body.match(/calling\s*:\s*"([^"]*)"/)?.[1] ?? '';
    const energyM = body.match(/energy\s*:\s*(\d+(?:\.\d+)?)/);
    const energy  = energyM ? Number(energyM[1]) : undefined;
    const logosM  = body.match(/logos\s*:\s*(\w+)/);
    const logos   = logosM && TRITS.has(logosM[1]) ? logosM[1] : undefined;

    const p = { id };
    if (calling) p.calling = calling;
    if (energy !== undefined) p.energy = energy;
    if (logos)   p.logos = logos;
    spec.persons.push(p);
  }

  // Русскоязычный вариант: лицо Имя { ... }
  const лицоRe = /\bлицо\s+(\S+)\s*\{([^}]*)\}/g;
  for (const m of clean.matchAll(лицоRe)) {
    const [, id, body] = m;
    if (spec.persons.some(p => p.id === id)) continue;
    const p = { id };
    const calling = body.match(/calling\s*:\s*"([^"]*)"/)?.[1]
                 ?? body.match(/призвание\s*:\s*"([^"]*)"/)?.[1] ?? '';
    if (calling) p.calling = calling;
    spec.persons.push(p);
  }

  // ── gifts ─────────────────────────────────────────────────────────────────
  // gift Name from Giver to Receiver { ... }
  const giftRe = /\bgift\s+(\S+)\s+from\s+(\S+)\s+to\s+(\S+)\s*\{([^}]*)\}/g;
  for (const m of clean.matchAll(giftRe)) {
    const [, id, giverId, receiverId, body] = m;

    const content   = body.match(/content\s*:\s*"([^"]*)"/)?.[1] ?? '';
    const telos     = body.match(/telos\s*:\s*"([^"]*)"/)?.[1] ?? '';
    const anamRaw   = body.match(/anamnesis\s*:\s*\[([^\]]*)\]/)?.[1] ?? '';
    const anamnesis = anamRaw
      ? anamRaw.match(/"([^"]*)"/g)?.map(s => s.replace(/"/g, '')) ?? []
      : [];

    const g = { id, giverId, receiverId, irreversible: true };
    if (content)         g.content   = content;
    if (telos)           g.telos     = telos;
    if (anamnesis.length) g.anamnesis = anamnesis;
    spec.gifts.push(g);
  }

  // ── witnesses ──────────────────────────────────────────────────────────────
  // witness "text"  or  witness incalculable "text"
  const witnessRe = /\bwitness\s+(incalculable\s+)?"([^"]*)"/g;
  for (const m of clean.matchAll(witnessRe)) {
    const [, inc, text] = m;
    spec.witnesses.push({ text, incalculable: Boolean(inc) });
  }

  // ── variables ──────────────────────────────────────────────────────────────
  // let name: trit = value
  const varRe = /\blet\s+(\w+)\s*:\s*trit\s*=\s*(\w+)/g;
  for (const m of clean.matchAll(varRe)) {
    const [, name, value] = m;
    if (TRITS.has(value)) {
      spec.variables.push({ name, value });
    }
  }

  // ── liturgies ─────────────────────────────────────────────────────────────
  // liturgy Name { telos: "...", ... }
  const liturgyRe = /\bliturgy\s+(\S+)\s*\{/g;
  for (const m of clean.matchAll(liturgyRe)) {
    const [, id] = m;
    // Extract body between matching braces
    const start = m.index + m[0].length;
    let depth = 1, i = start;
    while (i < clean.length && depth > 0) {
      if (clean[i] === '{') depth++;
      else if (clean[i] === '}') depth--;
      i++;
    }
    const body = clean.slice(start, i - 1);

    const telos = body.match(/telos\s*:\s*"([^"]*)"/)?.[1] ?? '';
    const liturgy = { id };
    if (telos) liturgy.telos = telos;
    spec.liturgies.push(liturgy);
  }

  return spec;
}

// ── Валидатор (минимальный, без external библиотеки) ──────────────────────

function validate(spec) {
  const errors = [];

  // Required arrays
  if (!Array.isArray(spec.persons)) errors.push('persons должен быть массивом');
  if (!Array.isArray(spec.gifts))   errors.push('gifts должен быть массивом');

  // Persons
  const personIds = new Set();
  for (const p of spec.persons ?? []) {
    if (!p.id) errors.push('person без id');
    else personIds.add(p.id);
    if (p.logos && !TRITS.has(p.logos)) errors.push(`person ${p.id}: logos "${p.logos}" не валидный trit`);
    if (p.energy !== undefined && (p.energy < 0 || isNaN(p.energy)))
      errors.push(`person ${p.id}: energy должна быть >= 0`);
  }

  // Gifts
  for (const g of spec.gifts ?? []) {
    if (!g.id)         errors.push('gift без id');
    if (!g.giverId)    errors.push(`gift ${g.id}: нет giverId`);
    if (!g.receiverId) errors.push(`gift ${g.id}: нет receiverId`);
    if (g.type && !ACT_TYPES.has(g.type))
      errors.push(`gift ${g.id}: тип "${g.type}" не в схеме`);
    if (g.weight !== undefined && g.weight < 0)
      errors.push(`gift ${g.id}: weight < 0`);
  }

  // Witnesses
  for (const w of spec.witnesses ?? []) {
    if (!w.text) errors.push('witness без текста');
  }

  // Variables
  for (const v of spec.variables ?? []) {
    if (!v.name) errors.push('variable без имени');
    if (!TRITS.has(v.value)) errors.push(`variable ${v.name}: "${v.value}" не валидный trit`);
  }

  return errors;
}

// ── Загрузить в GiftMemory (исполняемость) ─────────────────────────────────

export function loadGiftSpec(filePath) {
  const src  = readFileSync(filePath, 'utf8');
  const spec = parseGift(src, filePath);
  const errors = validate(spec);
  return { spec, errors };
}

// ── CLI ───────────────────────────────────────────────────────────────────

function collectFiles(target) {
  if (statSync(target).isDirectory()) {
    const files = [];
    function walk(dir) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (extname(full) === '.gift') files.push(full);
      }
    }
    walk(target);
    return files;
  }
  return [target];
}

const args    = process.argv.slice(2).filter(a => !a.startsWith('--'));
const asJson  = process.argv.includes('--json');
const all     = process.argv.includes('--all');

if (!args[0]) {
  console.error('Использование: node utils/gift-validate.mjs <file.gift|dir/> [--json] [--all]');
  process.exit(1);
}

const targets = args[0] ? collectFiles(args[0]) : [];

if (targets.length === 0) {
  console.error('Нет .gift файлов для валидации');
  process.exit(1);
}

let totalErrors = 0;
let totalFiles  = 0;

for (const file of targets) {
  const { spec, errors } = loadGiftSpec(file);
  totalFiles++;

  if (asJson) {
    console.log(JSON.stringify(spec, null, 2));
    continue;
  }

  const rel = file.replace(ROOT + '/', '');
  if (errors.length === 0) {
    const ps = spec.persons.length;
    const gs = spec.gifts.length;
    const ls = spec.liturgies.length;
    const ws = spec.witnesses.length;
    console.log(`✓ ${rel}  (лиц:${ps} даров:${gs} литург:${ls} свидет:${ws})`);
  } else {
    console.log(`✗ ${rel}:`);
    for (const e of errors) console.log(`   — ${e}`);
    totalErrors += errors.length;
  }
}

if (!asJson && targets.length > 1) {
  console.log(`\nИтого: ${totalFiles} файлов, ${totalErrors} ошибок.`);
}

if (totalErrors > 0) process.exit(1);
