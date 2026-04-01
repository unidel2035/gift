/**
 * GiftKernel — ядро GiftOS
 *
 * Аналог ядра Linux, но:
 *   - spawn()  вместо fork()     — рождение лица
 *   - give()   вместо write()    — IPC как дар
 *   - glorify() вместо kill()    — завершение миссии
 *   - sabbath() вместо sleep()   — покой
 *
 * Ядро управляет:
 *   1. Реестром лиц (процессов)
 *   2. Планировщиком (GiftScheduler)
 *   3. IPC-шиной (дары между процессами)
 *   4. W-матрицей ядра (кто кому что дал)
 *   5. Событийным анамнезисом
 */

import { EventEmitter } from 'events';
import { GiftProcess, ProcessState } from './GiftProcess.js';
import { GiftScheduler } from './GiftScheduler.js';

export class GiftKernel extends EventEmitter {
  constructor({ tickMs = 100, cpuPerRound = 1000 } = {}) {
    super();
    this.processes  = new Map();    // name → GiftProcess
    this.scheduler  = new GiftScheduler(cpuPerRound);
    this.tickMs     = tickMs;
    this.running    = false;
    this.tick       = 0;

    // Ядерная W-матрица: кто кому дал (суммарно)
    this.W          = new Map();    // `${from}→${to}` → weight
    this.anamnesis  = [];           // лента актов ядра
  }

  // ── Управление лицами ────────────────────────────────────────────────

  // Породить новое лицо
  spawn(name, missionFn, options = {}) {
    if (this.processes.has(name)) throw new Error(`Лицо '${name}' уже существует`);
    const proc = new GiftProcess({ name, mission: missionFn, ...options });
    this.processes.set(name, proc);
    proc.state = ProcessState.ALIVE;
    this._log('spawn', `Рождено лицо: ${name}`);
    this.emit('spawn', proc);
    return proc;
  }

  // Завершить миссию лица (не kill)
  glorify(name, summary = '') {
    const proc = this.processes.get(name);
    if (!proc) return;
    proc.glorify(summary);
    this._log('glorify', `${name}: ${summary}`);
    this.emit('glorify', proc);
  }

  // ── IPC: дары между процессами ───────────────────────────────────────

  // Передать дар от одного лица другому
  give(fromName, toName, payload, weight = 1) {
    const giver    = this.processes.get(fromName);
    const receiver = this.processes.get(toName);
    if (!giver || !receiver) return null;

    const gift = giver.give(toName, payload, weight);
    receiver.receive({ ...gift, weight });

    // Обновить W-матрицу ядра
    const key = `${fromName}→${toName}`;
    this.W.set(key, (this.W.get(key) ?? 0) + weight);

    this._log('give', `${fromName} → ${toName} (w=${weight})`);
    this.emit('give', gift);
    return gift;
  }

  // Широковещательный дар всем живым
  broadcast(fromName, payload, weight = 0.5) {
    for (const [name] of this.processes) {
      if (name !== fromName) this.give(fromName, name, payload, weight);
    }
  }

  // ── Цикл ядра ────────────────────────────────────────────────────────

  async boot() {
    this.running = true;
    this._log('boot', 'GiftOS booted. Соборность активна.');
    this.emit('boot');

    while (this.running) {
      await this._runTick();
      await new Promise(r => setTimeout(r, this.tickMs));
    }
  }

  shutdown() {
    this.running = false;
    this._log('shutdown', 'GiftOS shutdown. Память сохранена.');
    this.emit('shutdown');
  }

  async _runTick() {
    this.tick++;

    const procs = [...this.processes.values()];

    // 1. Планировщик распределяет CPU
    const grants = this.scheduler.schedule(procs);

    // 2. Запускаем миссии живых процессов
    for (const { process, granted } of grants) {
      if (process.state === ProcessState.ALIVE && process.mission) {
        try {
          // Передаём контекст ядра в миссию
          await process.mission(this._ctx(process), granted);
        } catch (e) {
          this._log('error', `${process.name}: ${e.message}`);
          this.emit('error', { process, error: e });
        }
      }
    }

    // 3. Обработать исходящие подарки
    for (const proc of procs) {
      while (proc.outbox.length) {
        const gift = proc.outbox.shift();
        const target = this.processes.get(gift.to);
        if (target) target.receive(gift);
      }
    }

    // 4. Почистить прославленных
    for (const [name, proc] of this.processes) {
      if (proc.state === ProcessState.GLORIFIED) {
        this.processes.delete(name);
        this.emit('removed', proc);
      }
    }

    this.emit('tick', { tick: this.tick, processes: procs.length });
  }

  // Контекст который получает миссия процесса
  _ctx(proc) {
    return {
      self:      proc,
      kernel:    this,
      give:      (to, payload, w) => this.give(proc.name, to, payload, w),
      broadcast: (payload, w)     => this.broadcast(proc.name, payload, w),
      read:      ()               => proc.inbox.shift(),
      peek:      ()               => proc.inbox[0],
      dormant:   (ms)             => proc.dormant(ms),
      yield:     (reason)         => proc.yield(reason),
      glorify:   (summary)        => proc.glorify(summary),
      processes: ()               => [...this.processes.values()].map(p => p.toJSON()),
      surplus:   (name)           => this.processes.get(name)?.surplus ?? 0,
    };
  }

  // ── Диагностика ──────────────────────────────────────────────────────

  _log(type, msg) {
    const entry = { tick: this.tick, type, msg, time: Date.now() };
    this.anamnesis.push(entry);
    if (this.anamnesis.length > 1000) this.anamnesis.shift();
  }

  status() {
    const procs = [...this.processes.values()];
    return {
      tick:       this.tick,
      persons:    procs.length,
      alive:      procs.filter(p => p.state === ProcessState.ALIVE).length,
      report:     this.scheduler.report(procs),
      topGiver:   procs.sort((a, b) => b.given - a.given)[0]?.name,
      topReceiver:procs.sort((a, b) => b.received - a.received)[0]?.name,
    };
  }

  // Топ нитей W-матрицы ядра
  heaviestLinks(n = 5) {
    return [...this.W.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([link, w]) => ({ link, weight: w }));
  }
}
