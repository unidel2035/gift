import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSpace, collectSpace } from '../utils/gift-space.mjs';

const NOW = 1_700_000_000_000;

function sampleSpace(over = {}) {
  return {
    now: NOW,
    present: [{ agent: 'Дионисий', organ: 'agent-logic', heartbeat: NOW - 3000 }],
    stale: 1,
    intents: [{ agent: 'Дима', files: ['src/core/x.js'] }],
    conflicts: [{ file: 'utils/y.mjs', agents: ['Дионисий', 'Дима'] }],
    zones: [{ prefixes: ['src/core/'], owner: 'ОтецСергий' }],
    acts: [{ from: '_claude', to: 'Дионисий', content: 'дар кода', ts: new Date(NOW - 60000).toISOString() }],
    federation: [],
    ...over,
  };
}

test('renderSpace: показывает все пять систем тела', () => {
  const out = renderSpace(sampleSpace(), { color: false });
  assert.match(out, /Пространство кентавров/);
  assert.match(out, /Здесь сейчас \(1\)/);          // присутствие
  assert.match(out, /Дионисий/);
  assert.match(out, /agent-logic/);                  // орган присутствующего
  assert.match(out, /Намерения/);                    // нервная
  assert.match(out, /Дима: src\/core\/x\.js/);
  assert.match(out, /Конфликты/);                    // нервная: конфликт
  assert.match(out, /utils\/y\.mjs/);
  assert.match(out, /Органы/);                       // органы
  assert.match(out, /ОтецСергий/);
  assert.match(out, /Свежие дары/);                  // память
  assert.match(out, /_claude→Дионисий/);
  assert.match(out, /Иммунитет/);                    // иммунитет
});

test('renderSpace: намерение в чужом органе помечается владельцем', () => {
  // Дима трогает src/core/ — орган ОтецСергий → предупреждение
  const out = renderSpace(sampleSpace(), { color: false });
  assert.match(out, /орган ОтецСергий/);
});

test('renderSpace: своё намерение в своём органе не помечается', () => {
  const sp = sampleSpace({
    intents: [{ agent: 'ОтецСергий', files: ['src/core/x.js'] }],
  });
  const out = renderSpace(sp, { color: false });
  assert.doesNotMatch(out, /орган ОтецСергий/);   // сам владелец — без предупреждения
});

test('renderSpace: пустое поле не падает и зовёт войти', () => {
  const out = renderSpace({ now: NOW, present: [], stale: 0, intents: [], conflicts: [], zones: [], acts: [], federation: [] }, { color: false });
  assert.match(out, /Здесь сейчас \(0\)/);
  assert.match(out, /gift team join/);
  assert.doesNotMatch(out, /Конфликты/);          // нет конфликтов — секции нет
});

test('renderSpace: федерация — PR и тишина', () => {
  const sp = sampleSpace({
    federation: [
      { label: 'integram', repo: 'org/integram', ok: true, prs: [{ number: 48, title: 'object-grounding', state: 'OPEN', updatedAt: new Date(NOW - 7200000).toISOString() }], commits: [] },
      { label: 'plm', repo: 'org/plm', ok: true, prs: [], commits: [] },
    ],
  });
  const out = renderSpace(sp, { color: false });
  assert.match(out, /integram \(org\/integram\)/);
  assert.match(out, /PR #48 object-grounding/);
  assert.match(out, /plm[\s\S]*— тихо/);
});

test('renderSpace: gh недоступен — мягко', () => {
  const sp = sampleSpace({ federation: [{ label: 'integram', repo: 'org/integram', ok: false }] });
  assert.match(renderSpace(sp, { color: false }), /gh недоступен/);
});

test('collectSpace: возвращает структуру всех систем без сети', async () => {
  const sp = await collectSpace({ withFederation: false, withCoop: false });
  for (const k of ['present', 'stale', 'intents', 'conflicts', 'zones', 'acts', 'federation', 'coop']) {
    assert.ok(k in sp, `нет поля ${k}`);
  }
  assert.ok(Array.isArray(sp.present));
  assert.equal(sp.coop, false);          // поле выключено
  assert.deepEqual(sp.federation, []);   // без сети — пусто
});

test('renderSpace: удалённый кентавр помечен машиной', () => {
  const sp = sampleSpace({
    coop: true,
    present: [
      { agent: 'Дионисий', organ: 'agent-logic', heartbeat: NOW - 2000, local: true, machine: 'thinkpad' },
      { agent: 'Дима', organ: 'infra', heartbeat: NOW - 4000, local: false, machine: 'server-2' },
    ],
  });
  const out = renderSpace(sp, { color: false });
  assert.match(out, /общее поле/);          // тег общего поля
  assert.match(out, /Дима.*@server-2/);     // удалённый помечен машиной
  assert.doesNotMatch(out, /Дионисий.*@/);  // свой (local) — без метки машины
});
