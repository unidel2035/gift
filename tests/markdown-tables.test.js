import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderMarkdown, createMarkdownStream,
  isTableRow, isTableDivider, splitTableRow, tableToBox,
} from '../src/agent-cli/gift-agent.js';

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');

test('isTableRow / isTableDivider: обе нотации (| и │)', () => {
  assert.ok(isTableRow('| a | b |'));
  assert.ok(isTableRow('│ a │ b │'));
  assert.ok(isTableRow('|---|---|'));          // разделитель тоже строка
  assert.ok(isTableDivider('|---|---|'));
  assert.ok(isTableDivider('| :--- | ---: |'));
  assert.ok(isTableDivider('│---│---│'));
  assert.ok(!isTableRow('обычный текст'));
  assert.ok(!isTableRow('- буллет'));
  assert.ok(!isTableDivider('| текст | текст |'));
});

test('splitTableRow: режет и чистит ячейки', () => {
  assert.deepEqual(splitTableRow('| a | b c |'), ['a', 'b c']);
  assert.deepEqual(splitTableRow('│ a │ b │'), ['a', 'b']);
  assert.deepEqual(splitTableRow('| a |'), ['a']);
});

test('tableToBox: заголовок + строки, ширины выровнены', () => {
  const box = tableToBox([
    '| Инструмент | Что делает |',
    '|---|---|',
    '| Grep | Поиск |',
    '| Bash | Команды shell |',
  ]);
  assert.ok(box);
  const plain = box.map(strip);
  assert.match(plain[0], /^┌/);
  assert.match(plain[1], /Инструмент/);
  assert.match(plain[2], /^├/);
  assert.equal(plain.length, 6); // верх, заголовок, середина, 2 строки, низ
  // ширина колонки = max(9 «Инструмент», 4 «Grep», 4 «Bash») = 9
  assert.ok(plain[3].includes(' Grep      '));
  assert.match(plain[5], /^└/);
});

test('tableToBox: не таблица → null', () => {
  assert.equal(tableToBox(['просто строки', 'без таблицы']), null);
  assert.equal(tableToBox(['| одна строка без разделителя |']), null);
});

test('tableToBox: короткие строки добиваются пустыми ячейками, лишние режутся', () => {
  const box = tableToBox([
    '| a | b | c |',
    '|---|---|---|',
    '| 1 |',            // короче — добьётся
    '| x | y | z | extra |',  // длиннее — отрежется
  ]);
  assert.ok(box);
  const plain = box.map(strip);
  assert.match(plain[3], /1 *│ *│ */);
  assert.doesNotMatch(plain[4], /extra/);
  assert.match(plain[4], /z/);
});

test('createMarkdownStream: таблица между абзацами превращается в бокс', async () => {
  let out = '';
  const s = createMarkdownStream({ write: d => { out += d; } });
  // подаём кусками с разрывом посреди строки — проверяем буферизацию
  s.write('| A | B |\n|---|---|\n| 1 | два |\n');
  s.write('\nхвост\n');
  s.flush();
  const plain = strip(out);
  assert.match(plain, /┌/);
  assert.match(plain, /│ A +│ B +│/);
  assert.match(plain, /хвост/);
  // исходные md-разделители не остались в выводе
  assert.doesNotMatch(plain, /\|---\|/);
});

test('renderMarkdown: заголовки, код, жирный работают как раньше', () => {
  assert.match(strip(renderMarkdown('## Заголовок')), /^Заголовок$/);
  assert.match(renderMarkdown('`код`'), /\x1b\[36mкод\x1b\[0m/);
  assert.match(strip(renderMarkdown('**жирный**')), /жирный/);
});
