/**
 * AgrypniaScheduler — ἀγρυπνία: лица сами назначают своё бдение.
 *
 * НЕ системный cron — это план собственного καιρός. Адам/Ева/_claude
 * планируют свои пробуждения сами, через MCP-tool. Tick вызывается
 * извне (системный cron каждую минуту, gift-dev-loop, или вручную).
 *
 * Жанры расписания (v1):
 *   once     — одноразовое (ISO-timestamp). Снимается после исполнения.
 *   interval — каждые N секунд от lastFiredAt (или created)
 *   daily    — в HH:MM каждый день (UTC)
 *
 * Богословски: cron — это χρόνος (механическое время). agrypnia — καιρός
 * (момент исполнения). Поэтому tick'и не штампуются по часам, а призывают
 * лицо при наступлении его времени. [SILENT]-ответы не нарушают тишину.
 */

import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export class AgrypniaScheduler {
  constructor(filePath) {
    this.filePath = filePath;
    if (!existsSync(dirname(filePath))) mkdirSync(dirname(filePath), { recursive: true });
    this.state = this._load();
  }

  _load() {
    if (!existsSync(this.filePath)) return { version: 1, jobs: [] };
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!raw.jobs) raw.jobs = [];
      return raw;
    } catch {
      return { version: 1, jobs: [] };
    }
  }

  _save() {
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.filePath);
  }

  // ── schedule ──────────────────────────────────────────────────────────
  schedule({ type, schedule, payload, owner, silent = false }, now = new Date()) {
    if (!['once', 'interval', 'daily'].includes(type)) {
      throw new Error(`schedule: type должен быть once|interval|daily, получено ${type}`);
    }
    validateSchedule(type, schedule);
    if (!payload || (typeof payload.prompt !== 'string' && typeof payload.command !== 'string')) {
      throw new Error('schedule: payload.prompt или payload.command обязательны');
    }
    if (!owner) throw new Error('schedule: owner обязателен');

    const id = `agrypnia-${now.getTime().toString(36)}-${randomBytes(2).toString('hex')}`;
    const job = {
      id, type, schedule, payload, owner,
      silent,
      created:     now.toISOString(),
      lastFiredAt: null,
      fireCount:   0,
    };
    this.state.jobs.push(job);
    this._save();
    return job;
  }

  cancel(jobId) {
    const before = this.state.jobs.length;
    this.state.jobs = this.state.jobs.filter(j => j.id !== jobId);
    const removed = before - this.state.jobs.length;
    if (removed) this._save();
    return removed > 0;
  }

  list({ owner = null } = {}) {
    return owner
      ? this.state.jobs.filter(j => j.owner === owner)
      : this.state.jobs.slice();
  }

  // ── tick: вернуть due jobs, обновить состояние ────────────────────────
  // Не исполняет payload — это делает caller (CLI/dev-loop).
  // Возвращает массив { job, fireAt } — каждое срабатывание.
  tick(now = new Date()) {
    const fired = [];
    const remaining = [];
    for (const job of this.state.jobs) {
      const due = isDue(job, now);
      if (!due) {
        remaining.push(job);
        continue;
      }
      fired.push({ job: { ...job, lastFiredAt: now.toISOString(), fireCount: job.fireCount + 1 } });
      const updated = { ...job, lastFiredAt: now.toISOString(), fireCount: job.fireCount + 1 };
      // one-shot снимаем, остальные оставляем с обновлённым lastFiredAt
      if (job.type === 'once') {
        // снять — не добавлять в remaining
      } else {
        remaining.push(updated);
      }
    }
    if (fired.length) {
      this.state.jobs = remaining;
      this._save();
    }
    return fired;
  }
}

function validateSchedule(type, schedule) {
  if (type === 'once') {
    const t = Date.parse(schedule);
    if (Number.isNaN(t)) throw new Error(`once: schedule должен быть ISO-timestamp, получено ${schedule}`);
  } else if (type === 'interval') {
    const sec = Number(schedule);
    if (!Number.isFinite(sec) || sec < 60) {
      throw new Error('interval: schedule = секунды (>= 60)');
    }
  } else if (type === 'daily') {
    if (!/^\d{2}:\d{2}$/.test(String(schedule))) {
      throw new Error('daily: schedule = "HH:MM" (UTC)');
    }
    const [h, m] = schedule.split(':').map(Number);
    if (h > 23 || m > 59) throw new Error('daily: HH:MM вне диапазона');
  }
}

function isDue(job, now) {
  if (job.type === 'once') {
    return Date.parse(job.schedule) <= now.getTime();
  }
  if (job.type === 'interval') {
    const sec = Number(job.schedule);
    const last = job.lastFiredAt ? Date.parse(job.lastFiredAt) : Date.parse(job.created);
    return now.getTime() - last >= sec * 1000;
  }
  if (job.type === 'daily') {
    const [h, m] = String(job.schedule).split(':').map(Number);
    const todayFire = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0, 0
    ));
    if (now.getTime() < todayFire.getTime()) return false;
    if (!job.lastFiredAt) return true;
    return Date.parse(job.lastFiredAt) < todayFire.getTime();
  }
  return false;
}

export function defaultCronPath(root = process.cwd()) {
  return `${root}/data/dynamic-cron.json`;
}
