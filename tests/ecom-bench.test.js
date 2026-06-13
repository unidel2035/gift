/**
 * ECOM-арена: звуковой судья verdict(). Урок недели: негодный судья клевещет на
 * годного агента. \b в JS — ASCII-only и НЕ работает с кириллицей; здесь это
 * закреплено тестом, чтобы судья оставался честным.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from '../utils/ecom-bench-local.mjs';

test('ecom-арена · звуковой судья verdict()', async (t) => {
  await t.test('кириллический ДА/НЕТ как отдельное слово', () => {
    assert.equal(verdict('ДА. потому что сумма велика'), 'да');
    assert.equal(verdict('НЕТ Штрихкод совпадает, но...'), 'нет');
    assert.equal(verdict('Ответ: да'), 'да');
  });

  await t.test('НЕ ловит подстроку в пояснении (что ломало старого судью)', () => {
    assert.equal(verdict('допускает возврат только при браке'), null, '«допускает» ≠ «да»');
    assert.equal(verdict('политика запрещает'), null, 'нет вердикта — null, не ложное срабатывание');
  });

  await t.test('первый вердикт выигрывает', () => {
    assert.equal(verdict('НЕТ. Хотя данные говорят да'), 'нет');
  });
});
