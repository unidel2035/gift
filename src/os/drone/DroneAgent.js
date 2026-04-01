/**
 * DroneAgent — дрон как лицо в матрице
 *
 * Дрон — не узел сети. Дрон — лицо (πρόσωπον).
 * У него позиция, заряд батареи, роль в рое — и surplus в W-матрице.
 *
 * Координация происходит не через командира,
 * а через анамнезис: "что я уже дал рою, что должен дать сейчас?"
 *
 * Роли дрона (динамические, меняются по surplus):
 *   SCOUT    — разведчик, летит вперёд, собирает данные
 *   RELAY    — ретранслятор, держит связь
 *   EXECUTOR — исполнитель, выполняет задачу в целевой зоне
 *   GUARDIAN — охрана, прикрывает слабых
 *   RESTING  — sabbath, экономит заряд
 */

export const DroneRole = {
  SCOUT:    'scout',
  RELAY:    'relay',
  EXECUTOR: 'executor',
  GUARDIAN: 'guardian',
  RESTING:  'resting',
};

export class DroneAgent {
  constructor({ id, x = 0, y = 0, battery = 100, role = DroneRole.SCOUT }) {
    this.id       = id;
    this.x        = x;
    this.y        = y;
    this.battery  = battery;   // 0–100%
    this.role     = role;
    this.speed    = 1.0;       // м/тик
    this.sensors  = {};        // данные с сенсоров

    // Данные от роя (W-матрица в памяти дрона)
    this.peerSurplus = new Map();  // peerId → surplus
    this.coverage    = new Set();  // клетки которые этот дрон уже покрыл

    // Миссия
    this.target   = null;      // { x, y } — текущая цель
    this.tasks    = [];        // очередь задач от роя
    this.given    = 0;         // данных/ресурсов отдано рою
    this.received = 0;         // получено от роя
  }

  get surplus() { return this.given - this.received; }

  // Дистанция до точки
  distTo(x, y) {
    return Math.sqrt((this.x - x) ** 2 + (this.y - y) ** 2);
  }

  // Шаг к цели
  stepToward(x, y) {
    const d = this.distTo(x, y);
    if (d < 0.5) return false; // достигли
    const speed = Math.min(this.speed, d);
    this.x += (x - this.x) / d * speed;
    this.y += (y - this.y) / d * speed;
    this.battery -= 0.1; // расход
    return true;
  }

  // Покрыть текущую позицию (сканирование)
  scan(gridSize = 1) {
    const cx = Math.round(this.x / gridSize);
    const cy = Math.round(this.y / gridSize);
    const key = `${cx},${cy}`;
    if (!this.coverage.has(key)) {
      this.coverage.add(key);
      this.given++;  // дар рою: новая данные
      return { x: cx, y: cy, data: this.sensors };
    }
    return null;
  }

  // Обновить информацию о сопилоте (heartbeat не считается как received)
  updatePeer(peerId, surplus, position) {
    this.peerSurplus.set(peerId, surplus);
    // heartbeat — общение, не дар ресурса. Surplus = данные/задачи, не пинги.
  }

  // Выбрать роль по surplus и состоянию роя
  // Богословски: роль — не статус, а служение. Меняется по нужде.
  electRole(swarmCoverage, targetZone) {
    if (this.battery < 20) {
      this.role = DroneRole.RESTING;
      return;
    }

    // Считаем кто уже покрывает зону
    const myCoverageInTarget = [...this.coverage]
      .filter(k => {
        const [cx, cy] = k.split(',').map(Number);
        return cx >= targetZone.x1 && cx <= targetZone.x2 &&
               cy >= targetZone.y1 && cy <= targetZone.y2;
      }).length;

    // Ранг среди всех (включая себя) по surplus
    const allSurplus = [...this.peerSurplus.entries(), [this.id, this.surplus]]
      .sort((a, b) => b[1] - a[1]);
    const myRank = allSurplus.findIndex(([id]) => id === this.id);
    const n      = allSurplus.length;

    if (myRank === 0) {
      this.role = DroneRole.EXECUTOR;  // наибольший surplus — исполнитель
    } else if (myRank === 1 && n > 3) {
      this.role = DroneRole.RELAY;     // второй — держит связь
    } else if (myCoverageInTarget < 4) {
      this.role = DroneRole.SCOUT;     // не покрыл достаточно — разведчик
    } else if (myRank === n - 1) {
      this.role = DroneRole.RESTING;   // наименьший surplus — sabbath
    } else {
      this.role = DroneRole.GUARDIAN;  // остальные — охрана
    }
  }

  toJSON() {
    return {
      id:       this.id,
      x:        parseFloat(this.x.toFixed(1)),
      y:        parseFloat(this.y.toFixed(1)),
      battery:  parseFloat(this.battery.toFixed(1)),
      role:     this.role,
      surplus:  this.surplus,
      given:    this.given,
      received: this.received,
      covered:  this.coverage.size,
    };
  }
}
