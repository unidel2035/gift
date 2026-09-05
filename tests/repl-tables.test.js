import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __mdTest } from '../src/agent-cli/repl.js';

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');

test('REPL: таблица стримится строками → собирается в бокс', () => {
  const out = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = d => out.push(d);
  try {
    // модель шлёт построчно, как stream_event дельты
    __mdTest.writeMdLine('Сводка:');
    __mdTest.writeMdLine('| Нить | Вес |');
    __mdTest.writeMdLine('|---|---|');
    __mdTest.writeMdLine('| _claude→Дионисий | 258 |');
    __mdTest.writeMdLine('| tg:996→Дионисий | 149 |');
    __mdTest.writeMdLine('');            // пустая строка — таблица закрыта
    __mdTest.flushMarkdown();            // конец хода
  } finally { process.stdout.write = orig; }
  const text = strip(out.join(''));
  assert.ok(text.includes('Сводка:'));
  assert.ok(text.includes('┬'), 'должен быть бокс-разделитель колонок');
  assert.ok(text.includes('_claude→Дионисий'));
  assert.ok(!/ \| Нить \|/.test(text), 'сырой markdown-хедер не должен остаться');
});

test('REPL: не-таблица (одиночная | строка) не ломает вывод', () => {
  const out = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = d => out.push(d);
  try {
    __mdTest.writeMdLine('обычный текст');
    __mdTest.writeMdLine('| без разделителя |'); // строка-кандидат без пары
    __mdTest.writeMdLine('ещё текст');
    __mdTest.flushMarkdown();
  } finally { process.stdout.write = orig; }
  const text = strip(out.join(''));
  assert.ok(text.includes('обычный текст'));
  assert.ok(text.includes('без разделителя'), 'одинокая строка с | выводится как текст');
});
