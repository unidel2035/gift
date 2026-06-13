import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePresence } from '../utils/coop-presence.mjs';
import { createCoopServer, upsert, present, _reset } from '../utils/coop-sync-server.mjs';

// ── Чистое слияние ───────────────────────────────────────────────────
test('mergePresence: локальная + удалённая машины не двоят агента', () => {
  const local = [{ agent: 'Дионисий', metadata: { organ: 'logic' }, heartbeat: 100, stale: false }];
  const remote = [
    { agent: 'Дионисий', machine: 'thinkpad', organ: 'logic', heartbeat: 90 }, // эхо своей же машины
    { agent: 'Дима', machine: 'server-2', organ: 'infra', heartbeat: 95 },      // другой кентавр
  ];
  const merged = mergePresence(local, remote, { machine: 'thinkpad' });
  const names = merged.map(m => `${m.agent}@${m.machine}`);
  assert.deepEqual(names.sort(), ['Дима@server-2', 'Дионисий@thinkpad']); // Дионисий один раз
  assert.equal(merged.find(m => m.agent === 'Дионисий').local, true);
  assert.equal(merged.find(m => m.agent === 'Дима').local, false);
});

test('mergePresence: тот же агент на двух машинах — две записи', () => {
  const local = [{ agent: 'Клод', heartbeat: 100, stale: false }];
  const remote = [{ agent: 'Клод', machine: 'server-2', heartbeat: 99 }];
  const merged = mergePresence(local, remote, { machine: 'laptop' });
  assert.equal(merged.length, 2); // Клод@laptop и Клод@server-2 — разные присутствия
});

test('mergePresence: пустые входы не падают', () => {
  assert.deepEqual(mergePresence(), []);
  assert.deepEqual(mergePresence([], []), []);
});

// ── Сервер: единицы ──────────────────────────────────────────────────
test('upsert/present: TTL подметает протухших', () => {
  _reset();
  upsert({ agent: 'A', organ: 'x' }, 1000);
  upsert({ agent: 'B' }, 1000);
  assert.equal(present(1000).length, 2);
  // A молчит дольше TTL (120с) → подметён; B свежий
  upsert({ agent: 'B' }, 200000);
  const live = present(200000);
  assert.equal(live.length, 1);
  assert.equal(live[0].agent, 'B');
  _reset();
});

// ── Сервер: end-to-end по HTTP (два кентавра видят друг друга) ────────
test('relay end-to-end: два кентавра в одном поле видят друг друга', async () => {
  _reset();
  const server = createCoopServer();
  await new Promise(r => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    // кентавр 1 (машина thinkpad)
    const r1 = await fetch(`${url}/heartbeat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'Дионисий', organ: 'logic', machine: 'thinkpad' }),
    }).then(r => r.json());
    assert.equal(r1.ok, true);

    // кентавр 2 (машина server-2)
    await fetch(`${url}/heartbeat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'Дима', organ: 'infra', machine: 'server-2' }),
    });

    // любой видит обоих
    const field = await fetch(`${url}/present`).then(r => r.json());
    const agents = field.present.map(p => p.agent).sort();
    assert.deepEqual(agents, ['Дима', 'Дионисий']);

    // health
    const h = await fetch(`${url}/health`).then(r => r.json());
    assert.equal(h.ok, true);
    assert.equal(h.count, 2);

    // уход
    await fetch(`${url}/leave`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'Дима' }),
    });
    const after = await fetch(`${url}/present`).then(r => r.json());
    assert.deepEqual(after.present.map(p => p.agent), ['Дионисий']);
  } finally {
    await new Promise(r => server.close(r));
    _reset();
  }
});
