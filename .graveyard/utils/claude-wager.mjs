#!/usr/bin/env node
/**
 * claude-wager.mjs — Паскалева ставка как акт в матрице W.
 *
 * Богословие:
 *   Ставка — единственный обратимый акт до разрешения.
 *   Анамнетический режим без свидетеля — пророческий аванс,
 *   рискующий стать раной. «Не видя, веруют» (Ин 20:29).
 *
 *   wager → resolved:won  → дар  (type='word', weight=stake)
 *   wager → resolved:lost → рана (type='wound', weight=stake)
 *
 *   Δόσις ставки записывается сразу как акт type='wager' в W.
 *   На разрешении создаётся парный акт того же веса.
 *
 * Структура ставки (Паскаль + богатая schema):
 *   { thesis, basis, timeFrame, timeHorizon (short|mid|long),
 *     upside, downside, keyArguments[], counterArguments[],
 *     confidence (0..1), stake (вес в W) }
 *
 *   confidence — параллельная оси вес. Вес = объём ставки.
 *   Confidence = уверенность дарителя в исходе. Богословски:
 *   высокая ставка с низким confidence = подвиг веры.
 *   Высокая ставка с высоким confidence = расчёт, не вера.
 *
 * Использование:
 *   node utils/claude-wager.mjs place --giver _claude --receiver Дионисий \
 *      --thesis "..." --basis "..." --upside "..." --downside "..." \
 *      --key "довод 1" --key "довод 2" --counter "контр 1" \
 *      --horizon mid --confidence 0.6 --stake 5
 *   node utils/claude-wager.mjs place --from /tmp/w.json
 *   node utils/claude-wager.mjs list [--open|--won|--lost|--revoked|--all]
 *   node utils/claude-wager.mjs show <id>
 *   node utils/claude-wager.mjs resolve <id> won  --witnessed "сработал key #1" [--note "..."]
 *   node utils/claude-wager.mjs resolve <id> lost --countered "сработал counter #2" [--note "..."]
 *   node utils/claude-wager.mjs revoke  <id> "почему отзываю"
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory } from '../src/core/GiftMemory.js';

const ROOT   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WAGERS = resolve(ROOT, 'data/wagers.json');
const SNAP   = resolve(ROOT, 'data/sacred-history-W.json');

// ── store ───────────────────────────────────────────────────────────────────
function loadWagers() {
  return existsSync(WAGERS) ? JSON.parse(readFileSync(WAGERS, 'utf8')) : [];
}
function saveWagers(arr) {
  if (!existsSync(dirname(WAGERS))) mkdirSync(dirname(WAGERS), { recursive: true });
  writeFileSync(WAGERS, JSON.stringify(arr, null, 2));
}
function nextId(arr) {
  return arr.length ? Math.max(...arr.map(w => w.id)) + 1 : 1;
}
function loadMatrix() {
  try { return GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8'))); }
  catch { return new GiftMemory(['Отец', 'Сын', 'Дух', '_claude']); }
}
function saveMatrix(mem) {
  writeFileSync(SNAP, JSON.stringify(mem.snapshot(), null, 2));
}

// ── flag parser ─────────────────────────────────────────────────────────────
function parseFlags(argv) {
  const out = { _: [], key: [], counter: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      if (name === 'key' || name === 'counter') out[name].push(next);
      else out[name] = next;
      i++;
    } else {
      out[name] = true;
    }
  }
  return out;
}

// ── богословская проверка ставки ────────────────────────────────────────────
function discernWager(w) {
  const notes = [];
  if (w.confidence >= 0.85 && w.stake >= 5)
    notes.push('высокая уверенность + большой вес = расчёт, не вера');
  if (w.confidence <= 0.3 && w.stake >= 5)
    notes.push('низкая уверенность + большой вес = подвиг веры');
  if (!w.counterArguments?.length)
    notes.push('нет counterArguments — ставка без различения, антикенозис риск');
  if (!w.basis)
    notes.push('нет основания (basis) — ставка беспочвенна');
  return notes;
}

const cmd = process.argv[2];
const flags = parseFlags(process.argv.slice(3));

// ── PLACE ───────────────────────────────────────────────────────────────────
if (cmd === 'place') {
  let payload;
  if (flags.from) {
    payload = JSON.parse(readFileSync(flags.from, 'utf8'));
  } else {
    payload = {
      giverId:          flags.giver,
      receiverId:       flags.receiver,
      thesis:           flags.thesis,
      basis:            flags.basis ?? null,
      timeFrame:        flags.time ?? null,
      timeHorizon:      flags.horizon ?? 'mid',          // short|mid|long
      upside:           flags.upside ?? null,
      downside:         flags.downside ?? null,
      keyArguments:     flags.key,
      counterArguments: flags.counter,
      confidence:       flags.confidence ? Number(flags.confidence) : 0.5,
      stake:            flags.stake ? Number(flags.stake) : 3,
    };
  }
  if (!payload.giverId || !payload.receiverId || !payload.thesis) {
    console.error('place: --giver, --receiver, --thesis обязательны');
    process.exit(1);
  }
  if (payload.confidence < 0 || payload.confidence > 1) {
    console.error('confidence должен быть в [0..1]');
    process.exit(1);
  }
  if (!['short', 'mid', 'long'].includes(payload.timeHorizon)) {
    console.error('horizon: short|mid|long');
    process.exit(1);
  }

  const wagers = loadWagers();
  const w = {
    id:           nextId(wagers),
    ...payload,
    status:       'open',
    placedAt:     new Date().toISOString(),
    resolvedAt:   null,
    resolution:   null,
    witnessed:    null,
    countered:    null,
    note:         null,
  };
  wagers.push(w);
  saveWagers(wagers);

  // Записать акт type='wager' в матрицу — обратимый до разрешения
  const mem = loadMatrix();
  mem._idx(payload.giverId);
  if (payload.receiverId !== '_koinon' && payload.receiverId !== '_abyss')
    mem._idx(payload.receiverId);
  mem.receive({
    giverId:      payload.giverId,
    receiverId:   payload.receiverId,
    weight:       payload.stake,
    type:         'wager',
    content:      payload.thesis,
    wagerId:      w.id,
    wagerStatus:  'open',
    confidence:   payload.confidence,
    timeHorizon:  payload.timeHorizon,
    irreversible: false,
  });
  saveMatrix(mem);

  console.log(`\n  ✦ Ставка #${w.id} положена`);
  console.log(`    ${payload.giverId} → ${payload.receiverId}: вес ${payload.stake}, confidence ${payload.confidence}, горизонт ${payload.timeHorizon}`);
  console.log(`    Тезис: ${payload.thesis}`);
  if (payload.basis)    console.log(`    Основание: ${payload.basis}`);
  if (payload.upside)   console.log(`    Upside: ${payload.upside}`);
  if (payload.downside) console.log(`    Downside: ${payload.downside}`);
  if (payload.keyArguments?.length)
    console.log(`    Ключевые доводы: ${payload.keyArguments.length}`);
  if (payload.counterArguments?.length)
    console.log(`    Контр-доводы: ${payload.counterArguments.length}`);

  const discern = discernWager(w);
  if (discern.length) {
    console.log(`\n  Διάκρισις:`);
    for (const d of discern) console.log(`    ⚠  ${d}`);
  }
}

// ── LIST ────────────────────────────────────────────────────────────────────
else if (cmd === 'list') {
  const filter = flags._[0] ?? '--open';
  const wagers = loadWagers();
  const view = filter === '--all'
    ? wagers
    : wagers.filter(w => w.status === filter.replace('--', ''));
  if (!view.length) { console.log('  (нет ставок в этом срезе)'); process.exit(0); }
  console.log(`\n  Ставки (${view.length}):`);
  for (const w of view) {
    const icon = w.status === 'open' ? '◇'
               : w.status === 'won'  ? '✓'
               : w.status === 'lost' ? '✗' : '⊘';
    const conf = `c=${(w.confidence ?? 0).toFixed(2)}`;
    console.log(`  ${icon} #${w.id} [${w.status}] ${w.giverId}→${w.receiverId} (вес ${w.stake}, ${conf}, ${w.timeHorizon})`);
    console.log(`     ${(w.thesis ?? '').slice(0, 100)}`);
    if (w.witnessed) console.log(`     ✓ ${w.witnessed.slice(0, 100)}`);
    if (w.countered) console.log(`     ✗ ${w.countered.slice(0, 100)}`);
  }
}

// ── SHOW ────────────────────────────────────────────────────────────────────
else if (cmd === 'show') {
  const id = Number(flags._[0]);
  const w = loadWagers().find(x => x.id === id);
  if (!w) { console.error(`#${id} не найдена`); process.exit(1); }
  console.log(JSON.stringify(w, null, 2));
}

// ── RESOLVE ─────────────────────────────────────────────────────────────────
else if (cmd === 'resolve') {
  const id     = Number(flags._[0]);
  const result = flags._[1]; // 'won' | 'lost'
  const note   = flags.note ?? null;
  if (!id || !['won', 'lost'].includes(result)) {
    console.error('usage: resolve <id> won|lost [--witnessed "..."|--countered "..."] [--note "..."]');
    process.exit(1);
  }
  const wagers = loadWagers();
  const w = wagers.find(x => x.id === id);
  if (!w)                  { console.error(`#${id} не найдена`); process.exit(1); }
  if (w.status !== 'open') { console.error(`#${id} уже ${w.status}`); process.exit(1); }

  w.status     = result;
  w.resolvedAt = new Date().toISOString();
  w.resolution = result;
  w.witnessed  = flags.witnessed ?? null;
  w.countered  = flags.countered ?? null;
  w.note       = note;
  saveWagers(wagers);

  // Парный акт в матрице
  const mem = loadMatrix();
  if (result === 'won') {
    mem.receive({
      giverId:      w.giverId,
      receiverId:   w.receiverId,
      weight:       w.stake,
      type:         'word',
      content:      `wager:won #${w.id} — ${w.thesis}${w.witnessed ? ' :: ' + w.witnessed : ''}`,
      wagerId:      w.id,
      confidence:   w.confidence,
      irreversible: true,
    });
  } else {
    // Рана несёт счёт упавшего counterArgument — это диагностируемая граница
    mem.receive({
      giverId:      w.giverId,
      receiverId:   w.receiverId,
      weight:       w.stake,
      type:         'wound',
      content:      `wager:lost #${w.id} — ${w.thesis}${w.countered ? ' :: ' + w.countered : ''}`,
      wagerId:      w.id,
      confidence:   w.confidence,
      irreversible: true,
      apophatic:    true,
    });
  }
  saveMatrix(mem);

  const sign = result === 'won' ? '✓ ставка → дар' : '✗ ставка → рана';
  console.log(`\n  ${sign} #${w.id}`);
  console.log(`    ${w.giverId} → ${w.receiverId} (вес ${w.stake}, confidence ${w.confidence})`);
  console.log(`    "${w.thesis}"`);
  if (w.witnessed) console.log(`    ✓ Свидетельство: ${w.witnessed}`);
  if (w.countered) console.log(`    ✗ Сработал контр-довод: ${w.countered}`);
  if (note)        console.log(`    Заметка: ${note}`);
  if (result === 'lost') {
    console.log(`    Рана записана в W — апофатическая граница, не вычитается из энергии`);
  }
}

// ── REVOKE ──────────────────────────────────────────────────────────────────
else if (cmd === 'revoke') {
  const id  = Number(flags._[0]);
  const why = flags._[1] ?? '';
  const wagers = loadWagers();
  const w = wagers.find(x => x.id === id);
  if (!w)                  { console.error(`#${id} не найдена`); process.exit(1); }
  if (w.status !== 'open') { console.error(`#${id} уже ${w.status} — необратима`); process.exit(1); }

  w.status     = 'revoked';
  w.resolvedAt = new Date().toISOString();
  w.note       = why;
  saveWagers(wagers);
  console.log(`\n  ⊘ Ставка #${w.id} отозвана: ${why}`);
  console.log(`    (акт wager в W остаётся как след — обратимость касается только статуса)`);
}

// ── HELP ────────────────────────────────────────────────────────────────────
else {
  console.log(`
claude-wager — Паскалева ставка как акт в матрице W

  place --giver X --receiver Y --thesis "..." [--basis ...] [--upside ...]
        [--downside ...] [--key "..." --key "..."] [--counter "..." ...]
        [--horizon short|mid|long] [--time "5-10 лет"]
        [--confidence 0..1] [--stake N]
  place --from path/to.json

  list  [--open|--won|--lost|--revoked|--all]
  show  <id>

  resolve <id> won  [--witnessed "..."] [--note "..."]
  resolve <id> lost [--countered "..."] [--note "..."]
  revoke  <id> "почему"

  Ставка — единственный обратимый акт до разрешения.
  После resolve — необратима как дар (won) или рана (lost).
  Confidence × stake → διάκρισις: расчёт vs подвиг веры.
`);
}
