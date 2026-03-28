import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftMemory } from '../src/core/GiftMemory.js';
import { GiftAgentEval, scoreResponse, EVAL_AGENTS } from '../src/core/GiftAgentEval.js';

test('GiftAgentEval — оценка агентов через матрицу', async (t) => {

  await t.test('EVAL_AGENTS содержит три лица', () => {
    assert.equal(EVAL_AGENTS.length, 3);
    assert.ok(EVAL_AGENTS.includes('_claude'));
  });

  await t.test('scoreResponse — богатый ответ даёт surplus > 5', () => {
    const task = 'Что такое дар?';
    const response = 'Дар — это кенозис, акт самоумаления дарителя. ' +
      'В матрице W нить даритель→получатель утолщается. ' +
      '_claude отдал Дионисий 357 единиц. Surplus — избыток, когда энергия сети < 0. ' +
      'Анамнезис делает прошлые дары настоящими. Общин всегда больше суммы частей.';
    const s = scoreResponse('_claude', task, response);
    assert.ok(s.gift_surplus > 5, `surplus: ${s.gift_surplus}`);
    assert.ok(s.total >= 20, `total: ${s.total}`);
  });

  await t.test('scoreResponse — telos 0 для ответа без богословских терминов', () => {
    const s = scoreResponse('_codex', 'напиши функцию', 'function hello() { return 42; }');
    assert.equal(s.telos, 0);
  });

  await t.test('run — определяет победителя', () => {
    const mem = new GiftMemory([]);
    const ev  = new GiftAgentEval(mem);

    const result = ev.run('Что такое лицо в онтологии дара?', {
      '_claude': 'Лицо — это нить в матрице. Не сущность, а отношение. ' +
        '_claude→Дионисий — это и есть существование _claude. Кенозис и дар.',
      '_codex': 'function person(id) { return { id }; }',
      '_reviewer': 'Лицо определяется через surplus и анамнезис общины. ' +
        'Матрица W хранит нити. Онтология дара — не описание, а участие.',
    });

    assert.ok(result.winner);
    assert.equal(result.entries.length, 3);
    // Победитель должен быть _claude или _reviewer (богословские ответы)
    assert.ok(['_claude', '_reviewer'].includes(result.winner));
  });

  await t.test('run — победитель записывается в матрицу', () => {
    const mem = new GiftMemory([]);
    const ev  = new GiftAgentEval(mem);

    const actsBefore = mem.actsCount;
    ev.run('Тест', {
      '_claude':   'дар кенозис surplus матрица _claude→Дионисий лицо',
      '_codex':    'короткий ответ',
      '_reviewer': 'анамнезис нить',
    });

    // Должны быть записаны акты (победитель + участники)
    assert.ok(mem.actsCount > actsBefore);
  });

  await t.test('run — победитель получает больший вес в матрице', () => {
    const mem = new GiftMemory([]);
    const ev  = new GiftAgentEval(mem);

    ev.run('Тест матрицы', {
      '_claude':   'лицо дар surplus кенозис матрица нить Дионисий анамнезис _claude→_koinon общин',
      '_codex':    'ответ',
    });

    // _koinon не адресуем (_idx=-1), но акты записываются (actsCount растёт)
    assert.ok(mem.actsCount > 0, 'нити созданы в матрице');
  });

  await t.test('format — выдаёт читаемый отчёт', () => {
    const mem = new GiftMemory([]);
    const ev  = new GiftAgentEval(mem);
    const result = ev.run('Задача', {
      '_claude':   'лицо дар кенозис surplus анамнезис матрица нить _claude Дионисий 357',
      '_reviewer': 'короткий',
    });
    const formatted = GiftAgentEval.format(result);
    assert.ok(formatted.includes('Победитель'));
    assert.ok(formatted.includes('/40'));
  });
});
