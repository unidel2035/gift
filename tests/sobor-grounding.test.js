/**
 * Заземление вердикта собора: находка без точной ссылки не считается.
 * Рычаг лидеров BitGN (+22пп), наша анти-фиктивность. Детерминированно.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGrounded, groundFindings, groundedVerdict } from '../utils/sobor-grounding.mjs';

test('заземление вердикта', async (t) => {
  await t.test('file:line — заземлено', () => {
    assert.equal(isGrounded({ ref: 'src/a.js:42' }), true);
    assert.equal(isGrounded({ file: 'cells/save.js:2' }), true);
  });

  await t.test('путь без строки заземлён только если реально открыт (touched)', () => {
    assert.equal(isGrounded({ ref: '/proc/x.json' }), false);
    assert.equal(isGrounded({ ref: '/proc/x.json' }, { touched: ['/proc/x.json'] }), true);
  });

  await t.test('нет ссылки — не заземлено', () => {
    assert.equal(isGrounded({ why: 'звучит плохо' }), false);
    assert.equal(isGrounded({ ref: '' }), false);
  });

  await t.test('groundFindings разделяет и даёт причину отброса', () => {
    const { grounded, dropped } = groundFindings([
      { why: 'a', ref: 'x.js:1' }, { why: 'b' },
    ]);
    assert.equal(grounded.length, 1);
    assert.equal(dropped.length, 1);
    assert.match(dropped[0].dropped_reason, /без акта не считается/);
  });

  await t.test('незаземлённое не влияет на вердикт', () => {
    // только незаземлённые high → affirm (claims пустые)
    assert.equal(groundedVerdict([{ severity: 'high', why: 'нет ссылки' }]).verdict, 'affirm');
    // заземлённый high → reject
    assert.equal(groundedVerdict([{ severity: 'high', ref: 'a.js:9' }]).verdict, 'reject');
    // заземлённый med → open
    assert.equal(groundedVerdict([{ severity: 'med', ref: 'a.js:9' }]).verdict, 'open');
  });
});
