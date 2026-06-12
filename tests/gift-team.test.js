/**
 * gift team — органы (ZONES) и классификатор зон. Детерминированно, без сессий/LLM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseZones, zoneOf } from '../utils/gift-team.mjs';

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
});
