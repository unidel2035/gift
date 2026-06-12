/**
 * presence-feed — единый орган присутствия: чистые relTimeFrom и formatFeed.
 * Детерминированно, без сети/сессий (federation подаётся как данные).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relTimeFrom, formatFeed } from '../utils/presence-feed.mjs';

test('presence-feed · форматирование', async (t) => {
  const now = Date.parse('2026-06-12T22:00:00Z');

  await t.test('relTimeFrom: с/м/ч/д', () => {
    assert.equal(relTimeFrom('2026-06-12T21:59:30Z', now), '30с');
    assert.equal(relTimeFrom('2026-06-12T21:30:00Z', now), '30м');
    assert.equal(relTimeFrom('2026-06-12T20:00:00Z', now), '2ч');
    assert.equal(relTimeFrom('2026-06-10T22:00:00Z', now), '2д');
  });

  await t.test('formatFeed сводит оба притока в один текст', () => {
    const present = {
      local: {
        sessions: [{ agent: 'Дионисий', organ: 'онтология', heartbeat: now }],
        intents: [{ agent: '_claude', files: ['utils/x.mjs'] }],
        acts: [{ from: '_claude', to: 'Дионисий', type: 'code', content: 'present', ts: '2026-06-12T20:00:00Z' }],
      },
      federation: [{
        label: 'integram', repo: 'judas-priest/integram', ok: true,
        prs: [{ number: 47, title: 'объектный слой', state: 'OPEN', updatedAt: '2026-06-12T17:39:00Z' },
              { number: 9, title: 'старый', state: 'CLOSED', updatedAt: '2026-06-01T00:00:00Z' }],
        commits: [{ sha: '4dfc362abc', msg: 'docs: phase 3', date: '2026-06-12T03:00:00Z' }],
      }],
    };
    const out = formatFeed(present, { now });
    assert.match(out, /Здесь сейчас: Дионисий \[онтология\]/, 'приток 1: присутствие');
    assert.match(out, /→ _claude: utils\/x\.mjs/, 'приток 1: намерение');
    assert.match(out, /_claude→Дионисий: present/, 'приток 1: акт W');
    assert.match(out, /▸ integram/, 'приток 2: федерация');
    assert.match(out, /#47 объектный слой/, 'приток 2: открытый PR');
    assert.ok(!/#9/.test(out), 'закрытый PR не показан');
    assert.match(out, /4dfc362/, 'приток 2: коммит');
  });

  await t.test('пустое настоящее — честная пустота, не ложь', () => {
    const out = formatFeed({ local: { sessions: [], intents: [], acts: [] }, federation: [] }, { now });
    assert.match(out, /Здесь сейчас: — пусто/);
  });

  await t.test('gh недоступен по репо — честно молчит', () => {
    const out = formatFeed({ local: {}, federation: [{ label: 'x', repo: 'a/b', ok: false }] }, { now });
    assert.match(out, /gh недоступен/);
  });
});
