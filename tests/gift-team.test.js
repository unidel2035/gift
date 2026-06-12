/**
 * gift team — органы (ZONES) и классификатор зон. Детерминированно, без сессий/LLM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseZones, zoneOf, relTimeFrom, summarizePresent } from '../utils/gift-team.mjs';

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');

const ZONES = `# ZONES
## Органы
- src/core/, src/theology/ → ОтецСергий
- utils/sobor-, bin/, utils/gift-team → _claude
- data/ → _koinon
`;

test('gift team · органы и зоны', async (t) => {
  await t.test('parseZones читает префиксы и владельцев', () => {
    const z = parseZones(ZONES);
    assert.equal(z.length, 3);
    assert.deepEqual(z[0].prefixes, ['src/core/', 'src/theology/']);
    assert.equal(z[0].owner, 'ОтецСергий');
  });

  await t.test('zoneOf находит владельца по префиксу', () => {
    const z = parseZones(ZONES);
    assert.equal(zoneOf('utils/sobor-trial-judge.mjs', z).owner, '_claude');
    assert.equal(zoneOf('src/core/GiftMemory.js', z).owner, 'ОтецСергий');
    assert.equal(zoneOf('data/insights.json', z).owner, '_koinon');
  });

  await t.test('самый длинный префикс выигрывает (специфичность)', () => {
    const z = parseZones('- src/ → A\n- src/core/ → B\n');
    assert.equal(zoneOf('src/core/x.js', z).owner, 'B', 'более точная зона побеждает');
    assert.equal(zoneOf('src/other/x.js', z).owner, 'A');
  });

  await t.test('файл вне органов — без владельца', () => {
    const z = parseZones(ZONES);
    assert.equal(zoneOf('README.md', z).owner, null);
  });

  await t.test('relTimeFrom: секунды/минуты/часы/дни', () => {
    const now = Date.parse('2026-06-12T22:00:00Z');
    assert.equal(relTimeFrom('2026-06-12T21:59:30Z', now), '30с');
    assert.equal(relTimeFrom('2026-06-12T21:30:00Z', now), '30м');
    assert.equal(relTimeFrom('2026-06-12T20:00:00Z', now), '2ч');
    assert.equal(relTimeFrom('2026-06-10T22:00:00Z', now), '2д');
  });

  await t.test('summarizePresent: PR и коммиты в строки', () => {
    const now = Date.parse('2026-06-12T22:00:00Z');
    const lines = summarizePresent({
      label: 'integram',
      prs: [{ number: 47, title: 'объектный слой', state: 'OPEN', updatedAt: '2026-06-12T17:39:00Z' },
            { number: 9, title: 'старый', state: 'CLOSED', updatedAt: '2026-06-01T00:00:00Z' }],
      commits: [{ sha: '4dfc362abc', msg: 'docs: phase 3', date: '2026-06-12T03:00:00Z' }],
    }, now).map(strip);
    assert.ok(lines.some(l => l.includes('Открытые PR (1)')), 'считает только OPEN');
    assert.ok(lines.some(l => l.includes('#47') && l.includes('объектный слой')), 'PR показан');
    assert.ok(!lines.some(l => l.includes('#9')), 'закрытый PR не показан');
    assert.ok(lines.some(l => l.includes('4dfc362')), 'коммит показан');
  });

  await t.test('summarizePresent: gh недоступен → честно молчит', () => {
    const lines = summarizePresent({ label: 'x', ok: false }).map(strip);
    assert.ok(lines.some(l => l.includes('недоступен')));
  });
});
