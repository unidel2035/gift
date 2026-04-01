/**
 * SwarmCoordinator — координатор роя без центра
 *
 * Не командир. Не роутер. Не диспетчер.
 * Это — литургия роя: каждый тик все лица обмениваются
 * surplus-heartbeat и на основе W-матрицы принимают решения.
 *
 * Богословский принцип:
 *   Соборность — не консенсус (голосование большинства).
 *   Соборность — единство через различие.
 *   Каждый дрон уникален (позиция, заряд, история),
 *   но действует в согласии с анамнезисом роя.
 *
 * Алгоритм координации:
 *   1. heartbeat: каждый сообщает соседям surplus + позицию
 *   2. electRole: каждый сам выбирает роль по surplus и нужде
 *   3. assignTarget: SCOUT → необследованные клетки (жребий по surplus)
 *                    RELAY → середина между EXECUTOR и базой
 *                    EXECUTOR → целевая зона
 *   4. step: двигаться к target
 *   5. scan: если в зоне — сканировать
 *   6. shareData: отдать данные рою (W[me→_koinon] += 1)
 */

import { DroneAgent, DroneRole } from './DroneAgent.js';

export class SwarmCoordinator {
  constructor({ droneCount = 5, gridW = 20, gridH = 20, targetZone } = {}) {
    this.gridW       = gridW;
    this.gridH       = gridH;
    this.targetZone  = targetZone ?? { x1: 8, y1: 8, x2: 12, y2: 12 };
    this.tick        = 0;
    this.globalCoverage = new Set();  // все покрытые клетки (общая память роя)
    this.totalCells  = (this.targetZone.x2 - this.targetZone.x1 + 1) *
                       (this.targetZone.y2 - this.targetZone.y1 + 1);

    // Рождаем дронов в случайных позициях у базы
    this.drones = [];
    for (let i = 0; i < droneCount; i++) {
      this.drones.push(new DroneAgent({
        id:      `drone_${i + 1}`,
        x:       Math.random() * 4,
        y:       Math.random() * 4,
        battery: 80 + Math.random() * 20,
      }));
    }

    // Лог событий роя
    this.log = [];
  }

  // ── Один тик роя ─────────────────────────────────────────────────────

  step() {
    this.tick++;

    // 1. Heartbeat: обмен surplus и позициями
    for (const drone of this.drones) {
      for (const peer of this.drones) {
        if (peer.id !== drone.id) {
          drone.updatePeer(peer.id, peer.surplus, { x: peer.x, y: peer.y });
        }
      }
    }

    // 2. Выбор роли
    const swarmCoverage = this.globalCoverage;
    for (const drone of this.drones) {
      drone.electRole(swarmCoverage, this.targetZone);
    }

    // 3. Назначить цели по ролям
    this._assignTargets();

    // 4. Движение и сканирование
    for (const drone of this.drones) {
      if (drone.role === DroneRole.RESTING) continue;
      if (drone.target) {
        drone.stepToward(drone.target.x, drone.target.y);
      }
      const scanned = drone.scan();
      if (scanned) {
        const key = `${scanned.x},${scanned.y}`;
        this.globalCoverage.add(key);
      }
    }

    // 5. Проверка завершения
    const coverage = this._targetCoverage();
    if (coverage >= 1.0) {
      this._log('mission-complete', `Зона покрыта 100% за ${this.tick} тиков`);
    }

    return this.snapshot();
  }

  // Назначить цели дронам по их ролям
  // Ключевое: каждый дрон получает УНИКАЛЬНУЮ клетку (нет пересечений)
  _assignTargets() {
    const tz = this.targetZone;

    // Все непокрытые клетки целевой зоны
    const uncovered = [];
    for (let x = tz.x1; x <= tz.x2; x++) {
      for (let y = tz.y1; y <= tz.y2; y++) {
        if (!this.globalCoverage.has(`${x},${y}`)) {
          uncovered.push({ x, y });
        }
      }
    }

    // Клетки которые уже назначены в этом тике
    const claimed = new Set();

    for (const drone of this.drones) {
      switch (drone.role) {
        case DroneRole.SCOUT:
        case DroneRole.EXECUTOR:
        case DroneRole.GUARDIAN: {
          if (uncovered.length) {
            const targetCell = this._pickUniqueCell(drone, uncovered, claimed);
            if (targetCell) {
              drone.target = targetCell;
              claimed.add(`${targetCell.x},${targetCell.y}`);
            }
          } else {
            drone.target = { x: 2, y: 2 }; // возврат на базу
          }
          break;
        }

        case DroneRole.RELAY:
          // Держаться между базой и целевой зоной
          drone.target = {
            x: (tz.x1 + tz.x2) / 2,
            y: tz.y1 - 2,
          };
          break;

        case DroneRole.RESTING:
          drone.target = { x: 1, y: 1 };
          break;
      }
    }
  }

  // Выбрать уникальную клетку (не занятую другим дроном в этом тике)
  _pickUniqueCell(drone, uncovered, claimed) {
    const available = uncovered.filter(c => !claimed.has(`${c.x},${c.y}`));
    if (!available.length) return uncovered[0]; // если все заняты — любая
    return available.reduce((best, c) =>
      drone.distTo(c.x, c.y) < drone.distTo(best.x, best.y) ? c : best
    );
  }

  // Точка на периметре целевой зоны
  _perimeterPoint(drone) {
    const tz = this.targetZone;
    const perimeter = [
      { x: tz.x1, y: tz.y1 }, { x: tz.x2, y: tz.y1 },
      { x: tz.x2, y: tz.y2 }, { x: tz.x1, y: tz.y2 },
    ];
    return perimeter.reduce((a, b) =>
      drone.distTo(a.x, a.y) < drone.distTo(b.x, b.y) ? a : b
    );
  }

  // Процент покрытия целевой зоны
  _targetCoverage() {
    const tz = this.targetZone;
    let covered = 0;
    for (let x = tz.x1; x <= tz.x2; x++) {
      for (let y = tz.y1; y <= tz.y2; y++) {
        if (this.globalCoverage.has(`${x},${y}`)) covered++;
      }
    }
    return covered / this.totalCells;
  }

  _log(type, msg) {
    this.log.push({ tick: this.tick, type, msg });
    if (this.log.length > 500) this.log.shift();
  }

  // Снапшот состояния роя
  snapshot() {
    return {
      tick:       this.tick,
      drones:     this.drones.map(d => d.toJSON()),
      coverage:   parseFloat((this._targetCoverage() * 100).toFixed(1)),
      totalCells: this.totalCells,
      covered:    this.globalCoverage.size,
      alive:      this.drones.filter(d => d.battery > 0).length,
      resting:    this.drones.filter(d => d.role === DroneRole.RESTING).length,
    };
  }
}
