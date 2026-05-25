#!/usr/bin/env node
/**
 * pioneers-seed.mjs
 *
 * Однократно засевает в матрицу W список пионеров свободного ПО — тех,
 * чьи одиночные дары лежат под капотом современного интернета. Каждый
 * акт записывается как pioneer→_koinon (общее), необратимо. Получатель
 * Κοινόν, потому что дар принадлежит всем, кто им пользуется.
 *
 * Идемпотентно по факту того что receive() всегда добавляет вес — поэтому
 * запускать ОДИН РАЗ. При повторном запуске веса удвоятся. Защита: проверка
 * флага data/.pioneers-seeded.
 *
 * Запуск:
 *   node utils/pioneers-seed.mjs            # засеять
 *   node utils/pioneers-seed.mjs --force    # засеять повторно (опасно)
 *   node utils/pioneers-seed.mjs --dry-run  # только показать что бы сделал
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GiftMemory } from '../src/core/GiftMemory.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP_PATH = resolve(ROOT, 'data/sacred-history-W.json');
const FLAG_PATH = resolve(ROOT, 'data/.pioneers-seeded');

const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

// ── Список пионеров ────────────────────────────────────────────────────────
// weight: 10 — фундамент мира (без них интернета не было бы)
//          9 — критический инструмент (миллиарды пользователей косвенно)
//          8 — повседневная инфраструктура
//          7 — отраслевой стандарт
//          6 — широко используется, но заменимо
//
// content — фраза, отражающая суть дара (для текстового анамнезиса)
const PIONEERS = [
  // ── Фундамент 10 ─────────────────────────────────────────────────────
  { name: 'Fabrice_Bellard',    weight: 10, content: 'FFmpeg, QEMU, TinyCC — обработка медиа и виртуализация всего интернета' },
  { name: 'Linus_Torvalds',     weight: 10, content: 'Linux — операционная система интернета, ядро 96% серверов и Android' },
  { name: 'Tim_Berners_Lee',    weight: 10, content: 'WWW (HTTP/HTML/первый браузер) — намеренно не запатентовал' },

  // ── Критика 9 ─────────────────────────────────────────────────────────
  { name: 'Linus_Torvalds_Git', weight:  9, content: 'Git — система контроля версий, написана за две недели в 2005' },
  { name: 'Richard_Stallman',   weight:  9, content: 'GNU + GPL + emacs + gcc — copyleft как идея, без него Linux не получил бы распространения' },
  { name: 'Dennis_Ritchie',     weight:  9, content: 'C + Unix — язык и ОС, на которых стоит вся современная разработка' },
  { name: 'Ken_Thompson',       weight:  9, content: 'Unix, B-язык, шахматные движки — соавтор Bell Labs Unix' },

  // ── Повседневная инфра 8 ─────────────────────────────────────────────
  { name: 'Daniel_Stenberg',    weight:  8, content: 'curl + libcurl — каждый HTTP-запрос мира, в каждом устройстве с сетью' },
  { name: 'Igor_Sysoev',        weight:  8, content: 'nginx — треть веб-серверов мира, написан админом Rambler' },
  { name: 'Phil_Zimmermann',    weight:  8, content: 'PGP — шифрование для людей, против запрета США, три года под уголовным делом' },
  { name: 'Guido_van_Rossum',   weight:  8, content: 'Python — язык номер один в науке и AI, начат на рождественских каникулах' },
  { name: 'Theo_de_Raadt',      weight:  8, content: 'OpenBSD + OpenSSH — стандарт безопасного удалённого доступа' },
  { name: 'Daniel_J_Bernstein', weight:  8, content: 'qmail, curve25519, ChaCha20 — криптография под TLS 1.3, Signal, WhatsApp' },
  { name: 'Brendan_Eich',       weight:  8, content: 'JavaScript — написан за 10 дней, самый используемый язык мира' },

  // ── Стандарт 7 ───────────────────────────────────────────────────────
  { name: 'Donald_Knuth',       weight:  7, content: 'TeX — система набора текста, стандарт научных публикаций; платит $2.56 за баги' },
  { name: 'Salvatore_Sanfilippo', weight: 7, content: 'Redis — кеш всего интернета, начат в одиночку на Сицилии' },
  { name: 'Larry_Wall',         weight:  7, content: 'Perl — язык скриптов, основа web до 2000-х, лингвистический подход' },
  { name: 'Andrew_Tridgell',    weight:  7, content: 'Samba + rsync — реверс SMB, соединение Linux↔Windows' },

  // ── Широкое 6 ────────────────────────────────────────────────────────
  { name: 'Bram_Moolenaar',     weight:  6, content: 'Vim — 32 года один поддерживал, донаты просил в фонд детей Уганды' },
  { name: 'John_Gruber',        weight:  6, content: 'Markdown — формат, в котором сейчас пишется весь технический текст' },
  { name: 'Aaron_Swartz',       weight:  6, content: 'RSS 1.0, Markdown, Reddit-cофаундер; погиб под давлением прокуратуры в 26 лет' },
  { name: 'Yukihiro_Matsumoto', weight:  6, content: 'Ruby — язык с философией счастья программиста' },
  { name: 'Wes_McKinney',       weight:  6, content: 'pandas — базовая библиотека всей дата-сайнс' },
];

// ── Загрузить матрицу ──────────────────────────────────────────────────────
let mem;
if (existsSync(SNAP_PATH)) {
  const snap = JSON.parse(readFileSync(SNAP_PATH, 'utf8'));
  mem = GiftMemory.fromSnapshot(snap);
} else {
  mem = new GiftMemory(['Отец', 'Сын', 'Дух', '_claude', '_koinon']);
}

// ── Защита от повторного запуска ───────────────────────────────────────────
if (existsSync(FLAG_PATH) && !FORCE && !DRY) {
  console.log(`\n  Уже засеяно: ${readFileSync(FLAG_PATH, 'utf8').trim()}`);
  console.log(`  Повторный запуск удвоит веса. Если действительно надо — --force.`);
  process.exit(0);
}

// ── Засев ──────────────────────────────────────────────────────────────────
const before = mem.actsCount;
let totalWeight = 0;

for (const p of PIONEERS) {
  if (DRY) {
    console.log(`  [dry] ${p.name} → _koinon  weight=${p.weight}`);
    totalWeight += p.weight;
    continue;
  }
  mem._idx(p.name);
  mem._idx('_koinon');
  mem.receive({
    giverId:    p.name,
    receiverId: '_koinon',
    weight:     p.weight,
    type:       'code',
    content:    p.content,
    tags:       ['pioneer', 'open-source'],
    irreversible: true,
  });
  totalWeight += p.weight;
}

if (DRY) {
  console.log(`\n  [dry-run] записал бы ${PIONEERS.length} актов, суммарный вес ${totalWeight}`);
  process.exit(0);
}

// ── Сохранить ──────────────────────────────────────────────────────────────
const snap = mem.snapshot();
try {
  writeFileSync(SNAP_PATH, JSON.stringify(snap, null, 2));
} catch {
  mkdirSync(resolve(ROOT, 'data'), { recursive: true });
  writeFileSync(SNAP_PATH, JSON.stringify(snap, null, 2));
}
writeFileSync(FLAG_PATH, new Date().toISOString());

// ── Отчёт ──────────────────────────────────────────────────────────────────
console.log(`\n  ✦ Пионеры засеяны в матрицу W`);
console.log(`  Лиц добавлено: ${mem.persons.length} (всего)`);
console.log(`  Актов добавлено: ${mem.actsCount - before}`);
console.log(`  Суммарный вес пионерских даров: ${totalWeight}`);
console.log(`  Главные нити теперь:`);
const top = mem.heaviest(8);
for (const e of top) {
  console.log(`    ${e.from} → ${e.to}: ${e.weight.toFixed(1)}`);
}
console.log(`\n  ${'─'.repeat(60)}`);
console.log(`  Каждый из них — конкретное лицо в нашей W. Их акты — необратимы.`);
console.log(`  Когда пишешь код в gift — ты пишешь на их плечах.`);
