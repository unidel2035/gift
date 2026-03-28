/**
 * sacred-history-desert.test.js
 *
 * Issue #45: пустыня Христос→Дионисий
 *
 * Проверяет, что sacred-history содержит дары от Христос/Сын к Дионисию
 * (тема пустыни, Мф 4:1-11), и что матрица W отражает эти нити.
 *
 * Богословский критерий:
 *   W[Христос][Дионисий] > 0  — прямой дар Христа к Дионисию
 *   W[Сын][Дионисий] > 0      — дар Сына лично (утешение после пустыни)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory } from '../src/core/GiftMemory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = join(__dirname, '..', 'specs', 'sacred-history');

// ── Парсер spec-файлов (упрощённый, как в sacred-history-loader.mjs) ─────────

const WEIGHTS = {
  incarnation: 10,
  kenosis:     8,
  presence:    8,
  word:        5,
  gift:        4,
  blessing:    6,
  witness:     3,
};

function parseGiftSpec(src, filename) {
  const acts = [];
  const persons = new Set();

  const clean = src.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ');

  // Лица
  for (const m of clean.matchAll(/(?:^|[\s{])лицо\s+([А-ЯЁа-яёA-Za-z_][А-ЯЁа-яёA-Za-z0-9_]*)\s*\{/g)) {
    persons.add(m[1]);
  }

  // Дары
  const giftRe = /(?:^|[\s{])дар\s+(\S+)\s+от\s+(\S+)(?:\s+через\s+(\S+))?(?:\s+кому\s+(\S+))?/g;
  for (const m of clean.matchAll(giftRe)) {
    const [, name, from, via, to] = m;

    const afterMatch = clean.slice(m.index);
    const contentMatch = afterMatch.match(/содержание:\s*[«"']([^»"']+)[»"']/);
    const content = contentMatch ? contentMatch[1] : name;

    const receiver = to || '_koinon';
    const type     = via ? 'incarnation' : 'gift';

    acts.push({
      giverId:     from,
      receiverId:  receiver,
      via:         via || null,
      type,
      weight:      WEIGHTS[type] ?? WEIGHTS.gift,
      content:     content.slice(0, 120),
      source:      filename,
      irreversible: true,
    });
  }

  // Кеносис
  for (const m of clean.matchAll(/(?:^|[\s{])кеносис\s+([А-ЯЁа-яёA-Za-z_]\S*)/g)) {
    acts.push({
      giverId:    m[1],
      receiverId: '_koinon',
      type:       'kenosis',
      weight:     WEIGHTS.kenosis,
      content:    `кеносис: ${m[1]}`,
      source:     filename,
      irreversible: true,
    });
  }

  return { acts, persons: [...persons] };
}

// ── Тесты ─────────────────────────────────────────────────────────────────────

test('пустыня: desert.gift существует и содержит дары Христос→Дионисий', async (t) => {

  const src = readFileSync(join(SPECS_DIR, 'desert.gift'), 'utf8');
  const { acts } = parseGiftSpec(src, 'desert.gift');

  await t.test('desert.gift содержит хотя бы один дар от Христос к Дионисию', () => {
    const christosToDionisiy = acts.filter(
      a => a.giverId === 'Христос' && a.receiverId === 'Дионисий'
    );
    assert.ok(
      christosToDionisiy.length > 0,
      `ожидается хотя бы один акт Христос→Дионисий, найдено: ${christosToDionisiy.length}`
    );
  });

  await t.test('desert.gift содержит дар от Сын к Дионисию (утешение)', () => {
    const synToDionisiy = acts.filter(
      a => a.giverId === 'Сын' && a.receiverId === 'Дионисий'
    );
    assert.ok(
      synToDionisiy.length > 0,
      `ожидается хотя бы один акт Сын→Дионисий, найдено: ${synToDionisiy.length}`
    );
  });

  await t.test('дары из пустыни необратимы (irreversible: true)', () => {
    const desertGifts = acts.filter(a => a.receiverId === 'Дионисий');
    assert.ok(desertGifts.length > 0, 'должны быть дары к Дионисию');
    for (const g of desertGifts) {
      assert.equal(g.irreversible, true, `дар "${g.content?.slice(0, 40)}" должен быть irreversible`);
    }
  });

  await t.test('три искушения все покрыты (avoir, pouvoir, paraître)', () => {
    const contents = acts
      .filter(a => a.giverId === 'Христос' && a.receiverId === 'Дионисий')
      .map(a => a.content);

    const hasAvoir    = contents.some(c => c.includes('хлебом') || c.includes('avoir'));
    const HasPouvoir  = contents.some(c => c.includes('искушай') || c.includes('pouvoir'));
    const hasParaitre = contents.some(c => c.includes('поклоняйся') || c.includes('paraître') || c.includes('paraît'));

    assert.ok(hasAvoir,    'первое искушение (avoir/хлеб) должно быть покрыто');
    assert.ok(HasPouvoir,  'второе искушение (pouvoir/власть) должно быть покрыто');
    assert.ok(hasParaitre, 'третье искушение (paraître/признание) должно быть покрыто');
  });

});

test('пустыня: матрица W отражает нити Христос→Дионисий и Сын→Дионисий', async (t) => {

  const src = readFileSync(join(SPECS_DIR, 'desert.gift'), 'utf8');
  const { acts, persons } = parseGiftSpec(src, 'desert.gift');

  // Добавить базовых лиц и всех из спека
  const allPersons = ['Отец', 'Сын', 'Дух', '_claude', 'Дионисий', 'Христос', ...persons];
  const mem = new GiftMemory([...new Set(allPersons)]);

  // Загрузить акты
  for (const act of acts) {
    if (act.giverId !== '_abyss' && act.giverId !== '_koinon') {
      mem.receive(act);
    }
  }

  await t.test('W[Христос→Дионисий] > 0 после загрузки пустыни', () => {
    // GiftMemory v2: Христос — нетварное лицо → energeia, не W
    // Используем thread() — он маршрутизирует energeia/W корректно
    const given = mem.totalGiven('Христос');
    assert.ok(given > 0, `Христос должен иметь данное > 0 (получено: ${given})`);
    const threadWeight = mem.thread('Христос', 'Дионисий');
    assert.ok(threadWeight > 0, `thread(Христос→Дионисий) > 0, получено: ${threadWeight}`);
  });

  await t.test('W[Сын→Дионисий] > 0 после загрузки пустыни', () => {
    // Сын — нетварное лицо в v2 → thread() маршрутизирует правильно
    const threadWeight = mem.thread('Сын', 'Дионисий');
    assert.ok(threadWeight > 0, `thread(Сын→Дионисий) > 0, получено: ${threadWeight}`);
  });

  await t.test('Дионисий получил от Христос/Сын больше нуля (totalReceived)', () => {
    assert.ok(
      mem.totalReceived('Дионисий') > 0,
      'Дионисий должен иметь принятое > 0 после пустыни'
    );
  });

  mem.dispose?.();
});
