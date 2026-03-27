import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAbyssKoinonAct,
  serializeForApi,
  ABYSS_KOINON_TYPE,
} from '../src/core/AbyssKoinonAct.js';

test('AbyssKoinonAct — merge в main порождает акт _abyss→_koinon', async (t) => {

  await t.test('createAbyssKoinonAct — базовая структура', () => {
    const act = createAbyssKoinonAct({
      sha: 'abc1234def',
      commitMessage: 'gift(Дионисий): тест кенозиса',
      repo: 'unidel2035/gift',
    });

    assert.equal(act.giverId,      '_abyss');
    assert.equal(act.receiverId,   '_koinon');
    assert.equal(act.type,         ABYSS_KOINON_TYPE);
    assert.equal(act.trigger,      'merge');
    assert.equal(act.irreversible, true);
    assert.equal(typeof act.weight, 'number');
    assert.ok(act.weight > 0);
  });

  await t.test('irreversible — акт заморожен (Object.freeze)', () => {
    const act = createAbyssKoinonAct({ sha: 'abc1234' });
    assert.throws(
      () => { act.irreversible = false; },
      /Cannot assign to read only property/,
    );
  });

  await t.test('content — берётся из commitMessage (не более 80 символов)', () => {
    const longMsg = 'a'.repeat(200);
    const act = createAbyssKoinonAct({ commitMessage: longMsg });
    assert.ok(act.content.length <= 80);
    assert.equal(act.content, 'a'.repeat(80));
  });

  await t.test('content — fallback при отсутствии commitMessage', () => {
    const act = createAbyssKoinonAct({ sha: 'deadbeef' });
    assert.ok(act.content.length > 0);
    assert.ok(act.content.includes('deadbee'));
  });

  await t.test('sha — усекается до 7 символов', () => {
    const act = createAbyssKoinonAct({ sha: 'fullsha1234567890' });
    assert.equal(act.sha, 'fullsha');
  });

  await t.test('repo — сохраняется если передан', () => {
    const act = createAbyssKoinonAct({ repo: 'unidel2035/gift' });
    assert.equal(act.repo, 'unidel2035/gift');
  });

  await t.test('без аргументов — не бросает исключение', () => {
    assert.doesNotThrow(() => createAbyssKoinonAct());
  });

  await t.test('serializeForApi — валидный JSON с обязательными полями', () => {
    const act  = createAbyssKoinonAct({ sha: 'abc1234', commitMessage: 'test' });
    const json = serializeForApi(act);
    const obj  = JSON.parse(json);

    assert.equal(obj.giverId,      '_abyss');
    assert.equal(obj.receiverId,   '_koinon');
    assert.equal(obj.type,         ABYSS_KOINON_TYPE);
    assert.equal(obj.trigger,      'merge');
    assert.equal(obj.irreversible, true);
    assert.equal(typeof obj.weight, 'number');
  });

  await t.test('ABYSS_KOINON_TYPE — константа содержит "abyss" и "koinon"', () => {
    assert.ok(ABYSS_KOINON_TYPE.includes('abyss'));
    assert.ok(ABYSS_KOINON_TYPE.includes('koinon'));
  });
});
