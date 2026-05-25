/**
 * GiftMesh — mesh-сеть как соборность (κοινωνία)
 *
 * Обычная сеть: пакеты маршрутизируются по минимальному пути.
 * GiftMesh: сообщения текут по нитям наибольшего surplus.
 *   Кто больше дал — тому доверяют больше.
 *
 * Богословский принцип:
 *   Соборность — не голосование большинства и не иерархия команд.
 *   Это живое единство через взаимный дар.
 *   Каждый узел знает surplus соседей и маршрутизирует через самых щедрых.
 *
 * Топология:
 *   - Нет центрального роутера
 *   - Каждый узел знает своих соседей (радио-зона видимости)
 *   - W-матрица узла: кому я доверяю и насколько
 *   - Сообщение идёт через узел с наибольшим surplus в направлении цели
 */

import { EventEmitter } from 'events';

export class GiftMesh extends EventEmitter {
  constructor(nodeId) {
    super();
    this.nodeId    = nodeId;
    this.neighbors = new Map();  // nodeId → { surplus, latency, lastSeen }
    this.routing   = new Map();  // targetId → nextHopId (кэш маршрутов)
    this.sent      = 0;
    this.received  = 0;
    this.forwarded = 0;
  }

  // Объявить соседа (обновляется по heartbeat)
  meet(neighborId, { surplus = 0, latency = 10 } = {}) {
    this.neighbors.set(neighborId, {
      surplus,
      latency,
      lastSeen: Date.now(),
      trust: Math.max(0, surplus / 10 + 0.5),  // [0, ∞] — доверие
    });
    this.routing.clear(); // сбросить кэш при изменении топологии
  }

  // Обновить surplus соседа (из heartbeat)
  updateSurplus(neighborId, surplus) {
    const n = this.neighbors.get(neighborId);
    if (n) {
      n.surplus = surplus;
      n.trust   = Math.max(0, surplus / 10 + 0.5);
      n.lastSeen = Date.now();
    }
  }

  // Живые соседи (видели < 5s назад)
  aliveNeighbors() {
    const now = Date.now();
    return [...this.neighbors.entries()]
      .filter(([, n]) => now - n.lastSeen < 5000)
      .map(([id, n]) => ({ id, ...n }));
  }

  // Следующий хоп по surplus-routing
  // Простой greedy: среди соседей выбираем того с макс. surplus
  // (в реальном рое — distance-vector с surplus вместо hop-count)
  nextHop(targetId) {
    if (this.neighbors.has(targetId)) return targetId; // прямой сосед

    const cached = this.routing.get(targetId);
    if (cached && this.neighbors.has(cached)) return cached;

    // Greedy: лучший сосед по surplus*trust
    const alive = this.aliveNeighbors();
    if (!alive.length) return null;

    const best = alive.reduce((a, b) =>
      (b.surplus * b.trust) > (a.surplus * a.trust) ? b : a
    );
    this.routing.set(targetId, best.id);
    return best.id;
  }

  // Послать сообщение
  send(targetId, payload, ttl = 8) {
    const msg = {
      from:    this.nodeId,
      to:      targetId,
      payload,
      ttl,
      path:    [this.nodeId],
      time:    Date.now(),
    };
    this.sent++;
    this._route(msg);
    return msg;
  }

  // Принять/переслать сообщение
  _route(msg) {
    if (msg.ttl <= 0) return; // умерло в пути

    if (msg.to === this.nodeId) {
      // Доставлено мне
      this.received++;
      this.emit('message', msg);
      return;
    }

    const hop = this.nextHop(msg.to);
    if (!hop) {
      this.emit('unreachable', msg);
      return;
    }

    this.forwarded++;
    this.emit('forward', { ...msg, ttl: msg.ttl - 1, path: [...msg.path, this.nodeId] }, hop);
  }

  // Heartbeat — рассказать соседям о своём surplus
  heartbeat(mySurplus) {
    for (const [neighborId] of this.neighbors) {
      this.emit('heartbeat-out', {
        to:      neighborId,
        from:    this.nodeId,
        surplus: mySurplus,
        time:    Date.now(),
      });
    }
  }

  stats() {
    return {
      node:       this.nodeId,
      neighbors:  this.neighbors.size,
      alive:      this.aliveNeighbors().length,
      sent:       this.sent,
      received:   this.received,
      forwarded:  this.forwarded,
    };
  }
}
