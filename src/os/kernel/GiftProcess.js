/**
 * GiftProcess — процесс как лицо (πρόσωπον)
 *
 * В Unix процесс — это число (PID). Безликое. Убивается командой kill.
 * В GiftOS процесс — лицо. У него имя, история даров, surplus, призвание.
 *
 * Богословский принцип:
 *   Личность конституируется отношениями, а не субстанцией.
 *   Процесс существует поскольку даёт и принимает.
 */

export const ProcessState = {
  NASCENT:   'nascent',    // рождается
  ALIVE:     'alive',      // живёт и действует
  WAITING:   'waiting',    // ждёт ресурса или дара
  KENOTIC:   'kenotic',    // добровольно отдаёт ресурсы
  DORMANT:   'dormant',    // спит (sabbath)
  GLORIFIED: 'glorified',  // завершил миссию (θέωσις)
};

let _gid = 0;

export class GiftProcess {
  constructor({ name, mission, priority = 5, cpuShare = 1 }) {
    this.gid      = ++_gid;            // gift-id (не PID — лицо, не число)
    this.name     = name;              // имя лица
    this.mission  = mission;           // призвание (функция-генератор или async)
    this.state    = ProcessState.NASCENT;

    // Онтология лица
    this.given    = 0;     // суммарно отдано ресурсов другим
    this.received = 0;     // суммарно получено от других
    this.surplus  = 0;     // given - received

    // Планирование
    this.priority    = priority;   // 1–10 (богословская аксиома: не абсолют)
    this.cpuShare    = cpuShare;   // запрошенная доля CPU
    this.cpuGranted  = 0;          // выдано планировщиком
    this.ticks       = 0;          // сколько квантов получил
    this.yieldCount  = 0;          // сколько раз добровольно уступал

    // Коммуникация (IPC-дары)
    this.inbox    = [];            // входящие дары от других процессов
    this.outbox   = [];            // исходящие (обрабатываются ядром)

    // Анамнезис
    this.birthTime = Date.now();
    this.log       = [];           // история значимых актов
  }

  get age() { return Date.now() - this.birthTime; }

  // Получить дар от другого процесса
  receive(gift) {
    this.inbox.push(gift);
    this.received += gift.weight ?? 1;
    this.surplus   = this.given - this.received;
  }

  // Отдать дар другому процессу (через ядро)
  give(toName, payload, weight = 1) {
    const gift = {
      from:    this.name,
      to:      toName,
      payload,
      weight,
      time:    Date.now(),
    };
    this.outbox.push(gift);
    this.given  += weight;
    this.surplus = this.given - this.received;
    return gift;
  }

  // Добровольный кенозис — уступить CPU соседу
  yield(reason = '') {
    this.yieldCount++;
    this.state = ProcessState.KENOTIC;
    this.log.push({ act: 'kenosis', reason, time: Date.now() });
  }

  // Войти в покой (sabbath)
  dormant(ms) {
    this.state = ProcessState.DORMANT;
    return new Promise(r => setTimeout(() => {
      this.state = ProcessState.ALIVE;
      r();
    }, ms));
  }

  // Завершить миссию (не kill — glorification)
  glorify(summary = '') {
    this.state = ProcessState.GLORIFIED;
    this.log.push({ act: 'glorified', summary, time: Date.now() });
  }

  toJSON() {
    return {
      gid:       this.gid,
      name:      this.name,
      state:     this.state,
      surplus:   this.surplus,
      given:     this.given,
      received:  this.received,
      ticks:     this.ticks,
      yieldCount: this.yieldCount,
      age:       this.age,
    };
  }
}
