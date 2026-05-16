import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgrypniaScheduler } from '../src/scheduling/AgrypniaScheduler.js';

function mk() {
  const dir  = mkdtempSync(join(tmpdir(), 'agrypnia-'));
  const path = join(dir, 'cron.json');
  return { sched: new AgrypniaScheduler(path), dir, path };
}

test('schedule once: due после ISO-времени', () => {
  const { sched, dir } = mk();
  try {
    const t0 = new Date('2026-01-01T10:00:00Z');
    const job = sched.schedule({
      type: 'once',
      schedule: '2026-01-01T10:30:00Z',
      payload: { prompt: 'wake' },
      owner: 'Адам',
    }, t0);

    assert.equal(job.type, 'once');
    assert.equal(sched.list().length, 1);

    // До времени — не due
    assert.equal(sched.tick(new Date('2026-01-01T10:15:00Z')).length, 0);

    // После — fire и снять с очереди
    const fired = sched.tick(new Date('2026-01-01T10:30:01Z'));
    assert.equal(fired.length, 1);
    assert.equal(fired[0].job.id, job.id);
    assert.equal(sched.list().length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('schedule interval: периодическое срабатывание', () => {
  const { sched, dir } = mk();
  try {
    const t0 = new Date('2026-01-01T10:00:00Z');
    sched.schedule({ type: 'interval', schedule: 60, payload: { prompt: 'p' }, owner: 'Ева' }, t0);

    // через 30s — не due
    assert.equal(sched.tick(new Date('2026-01-01T10:00:30Z')).length, 0);
    // через 61s — due
    assert.equal(sched.tick(new Date('2026-01-01T10:01:01Z')).length, 1);
    // сразу после — не due (lastFiredAt обновлён)
    assert.equal(sched.tick(new Date('2026-01-01T10:01:02Z')).length, 0);
    // ещё через 61s — снова due
    assert.equal(sched.tick(new Date('2026-01-01T10:02:03Z')).length, 1);
    // job не снимается
    assert.equal(sched.list().length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('schedule daily: HH:MM срабатывает один раз в день', () => {
  const { sched, dir } = mk();
  try {
    const t0 = new Date('2026-01-01T00:00:00Z');
    sched.schedule({ type: 'daily', schedule: '03:30', payload: { prompt: 'p' }, owner: '_claude' }, t0);

    // до 03:30 — не due
    assert.equal(sched.tick(new Date('2026-01-01T03:00:00Z')).length, 0);
    // в 03:30 — due
    assert.equal(sched.tick(new Date('2026-01-01T03:30:00Z')).length, 1);
    // в 04:00 — уже не due (отстрелял сегодня)
    assert.equal(sched.tick(new Date('2026-01-01T04:00:00Z')).length, 0);
    // на следующий день в 03:30 — снова due
    assert.equal(sched.tick(new Date('2026-01-02T03:30:00Z')).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cancel: снимает job', () => {
  const { sched, dir } = mk();
  try {
    const job = sched.schedule({
      type: 'once', schedule: '2030-01-01T00:00:00Z',
      payload: { prompt: 'p' }, owner: 'Адам',
    });
    assert.equal(sched.cancel(job.id), true);
    assert.equal(sched.list().length, 0);
    assert.equal(sched.cancel('nope'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('persistence: новый scheduler читает существующий файл', () => {
  const { sched, dir, path } = mk();
  try {
    sched.schedule({
      type: 'interval', schedule: 60, payload: { prompt: 'p' }, owner: 'Ева',
    });
    const fresh = new AgrypniaScheduler(path);
    assert.equal(fresh.list().length, 1);
    assert.equal(fresh.list()[0].owner, 'Ева');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('validation: bad schedule', () => {
  const { sched, dir } = mk();
  try {
    assert.throws(() => sched.schedule({
      type: 'once', schedule: 'not-iso', payload: { prompt: 'p' }, owner: 'A',
    }), /ISO/);
    assert.throws(() => sched.schedule({
      type: 'interval', schedule: 30, payload: { prompt: 'p' }, owner: 'A',
    }), />= 60/);
    assert.throws(() => sched.schedule({
      type: 'daily', schedule: '25:00', payload: { prompt: 'p' }, owner: 'A',
    }), /HH:MM/);
    assert.throws(() => sched.schedule({
      type: 'once', schedule: '2030-01-01T00:00:00Z', payload: {}, owner: 'A',
    }), /payload/);
    assert.throws(() => sched.schedule({
      type: 'cron', schedule: '* * * * *', payload: { prompt: 'p' }, owner: 'A',
    }), /once\|interval\|daily/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
