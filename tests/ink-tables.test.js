import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTables, tableToBox, splitTableRow } from '../src/agent-cli/gift-agent.js';

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');

test('splitTableRow: экранированные \\| не рвут колонку и раскрываются', () => {
  const cells = splitTableRow('| Прокси | gift switch [ra\\|ds\\|glm] | текущий |');
  assert.equal(cells.length, 3);
  assert.equal(cells[1], 'gift switch [ra|ds|glm]');
});

test('tableToBox: таблица с \\| в ячейках собирается в бокс', () => {
  const box = tableToBox([
    '| Раздел | Команда |',
    '|---|---|',
    '| Прокси | gift switch [ra\\|ds\\|or\\|fw\\|glm] |',
  ]);
  assert.ok(box, 'бокс собирается');
  const text = strip(box.join('\n'));
  assert.ok(text.includes('[ra|ds|or|fw|glm]'), 'пайпы внутри ячейки сохранены');
  assert.ok(text.includes('┬'), 'рамка есть');
});

test('splitTables: текст + таблица + текст → 3 сегмента', () => {
  const segs = splitTables([
    'Готово. Список:',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    'Подпись.',
  ].join('\n'));
  assert.equal(segs.length, 3);
  assert.deepEqual(segs.map(s => s.table), [false, true, false]);
  assert.ok(strip(segs[1].lines.join('\n')).includes('┬'));
  assert.ok(segs[0].lines.includes('Готово. Список:'));
  assert.ok(segs[2].lines.includes('Подпись.'));
});

test('splitTables: одиночная строка с | — не таблица, остаётся текстом', () => {
  const segs = splitTables('текст\n| без разделителя |\nещё');
  assert.ok(segs.every(s => !s.table));
  assert.ok(segs.some(s => s.lines.includes('| без разделителя |')));
});

test('splitTables: таблица в конце сообщения без хвоста', () => {
  const segs = splitTables('вот:\n| X |\n|---|\n| 1 |');
  const t = segs.find(s => s.table);
  assert.ok(t, 'таблица найдена');
  assert.ok(strip(t.lines.join('\n')).includes('│ X'));
});
