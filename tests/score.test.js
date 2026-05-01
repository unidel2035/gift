import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Score } from '../src/persons/Score.js';
import { GiftMemory } from '../src/core/GiftMemory.js';

test('Score — sommelier card (16-мерный профиль)', async (t) => {
  await t.test('требует idea', () => {
    const s = new Score();
    assert.throws(() => s.profile({}), /idea/);
  });

  await t.test('пустые источники → null оси, не выдумывает данные', () => {
    const s = new Score();
    const c = s.profile({ idea: 'тест' });
    assert.equal(c.decoupage.ground, null);
    assert.equal(c.council.chorus, null);
    assert.equal(c.vintage.age_days, null);
    assert.equal(c.w.inflows, null);
  });

  await t.test('decoupage перенесён в ось', () => {
    const s = new Score();
    const dResult = {
      ground: { verdict: 'strong' },
      water:  { verdict: 'strong' },
      fire:   { verdict: 'empty' },
      air:    { verdict: 'weak' },
      integral: { shape: 'без огня' },
    };
    const c = s.profile({ idea: 'x', decoupageResult: dResult });
    assert.equal(c.decoupage.ground, 'strong');
    assert.equal(c.decoupage.fire, 'empty');
    assert.equal(c.decoupage.shape, 'без огня');
  });

  await t.test('council — symphony результат вшит', () => {
    const s = new Score();
    const sResult = {
      iconic: true,
      conditions: { chorus: true, perichoretic: true, kenotic: true, epiclesis: true },
      actId: 'sym-test-0',
    };
    const c = s.profile({ idea: 'x', symphonyResult: sResult });
    assert.equal(c.council.iconic, true);
    assert.equal(c.council.actId, 'sym-test-0');
  });

  await t.test('vintage — age_days корректный', () => {
    const s = new Score();
    const past = new Date(Date.now() - 7 * 86400_000).toISOString();
    const c = s.profile({ idea: 'x', recordedAt: past });
    assert.equal(c.vintage.age_days, 7);
  });

  await t.test('w-axis — собирает heaviest и pending', () => {
    const mem = new GiftMemory(['А', 'Б', 'В']);
    mem.receive({ giverId: 'А', receiverId: 'Б', type: 'word', weight: 5, content: 't' });
    mem.receive({ giverId: 'В', receiverId: 'Б', type: 'word', weight: 3, content: 't' });
    const s = new Score({ memory: mem });
    const c = s.profile({ idea: 'x' });
    assert.ok(c.w.threads_touched > 0);
    assert.ok(c.w.mutual_total > 0);
  });

  await t.test('integral — полная сфера + иконный собор', () => {
    const s = new Score();
    const c = s.profile({
      idea: 'x',
      decoupageResult: {
        ground: { verdict: 'strong' }, water: { verdict: 'strong' },
        fire: { verdict: 'strong' }, air: { verdict: 'strong' },
        integral: { shape: 'полная сфера' },
      },
      symphonyResult: {
        iconic: true,
        conditions: { chorus: true, perichoretic: true, kenotic: true, epiclesis: true },
      },
    });
    assert.match(c.integral, /зрелая по форме/);
    assert.match(c.integral, /иконный собор/);
    assert.equal(c.tone, 'выдержанное иконное вино');
  });

  await t.test('integral — фигура с пустотами без эпиклезы', () => {
    const s = new Score();
    const c = s.profile({
      idea: 'x',
      decoupageResult: {
        ground: { verdict: 'strong' }, water: { verdict: 'empty' },
        fire: { verdict: 'empty' }, air: { verdict: 'weak' },
        integral: { shape: 'смешанная' },
      },
      symphonyResult: {
        iconic: false,
        conditions: { chorus: true, perichoretic: true, kenotic: true, epiclesis: false },
      },
    });
    assert.match(c.integral, /пустотами/);
    assert.match(c.integral, /без эпиклезы/);
  });

  await t.test('compareProfiles — добавляет _comparison флаги', () => {
    const s = new Score();
    const a = s.profile({ idea: 'a', recordedAt: new Date(Date.now() - 10*86400_000).toISOString() });
    const b = s.profile({ idea: 'b', recordedAt: new Date(Date.now() -  2*86400_000).toISOString() });
    a.w.mutual_total = 100; b.w.mutual_total = 50;
    const r = s.compareProfiles([a, b]);
    assert.equal(r.length, 2);
    assert.ok(r[0]._comparison);
  });

  await t.test('format — текстовая карта без падений', () => {
    const s = new Score();
    const c = s.profile({
      idea: 'тестовая идея',
      decoupageResult: {
        ground: { verdict: 'strong' }, water: { verdict: 'weak' },
        fire: { verdict: 'empty' }, air: { verdict: 'unanalyzed' },
        integral: { shape: 'смешанная' },
      },
      symphonyResult: {
        iconic: false,
        conditions: { chorus: true, perichoretic: true, kenotic: false, epiclesis: false },
        actId: null,
      },
      recordedAt: new Date().toISOString(),
    });
    const txt = Score.format(c);
    assert.ok(txt.includes('ИДЕЯ:'));
    assert.ok(txt.includes('ДЕКУПАЖ'));
    assert.ok(txt.includes('СОБОР'));
    assert.ok(txt.includes('ВЫДЕРЖКА'));
    assert.ok(txt.includes('ИНТЕГРАЛ:'));
  });
});
