/**
 * GiftScheduler — планировщик на основе surplus
 *
 * Обычный планировщик: процессы получают CPU по приоритету или Round-Robin.
 * GiftScheduler: процессы получают CPU пропорционально тому, сколько они ДАЛИ.
 *
 * Богословский принцип:
 *   "Кто хочет быть первым, пусть будет последним и слугой всем." (Мк 10:44)
 *   Но это не альтруизм-ловушка: система заботится о тех кто в дефиците,
 *   чтобы они могли снова давать. Это кенотическая экономика.
 *
 * Алгоритм:
 *   1. score(p) = surplus * α + priority * β + kenosis_bonus * γ
 *   2. Нормализуем: каждый получает квант пропорционально score
 *   3. Процессы с отрицательным surplus получают базовый минимум (χάρις)
 *   4. Процессы в кенозисе получают bonus (не штраф!)
 */

import { ProcessState } from './GiftProcess.js';

const α = 0.5;   // вес surplus
const β = 0.3;   // вес приоритета
const γ = 0.2;   // бонус за кенозис
const GRACE_MIN = 0.1;  // минимальный квант (χάρις) даже для должников

export class GiftScheduler {
  constructor(totalCPU = 1000) {
    this.totalCPU  = totalCPU;  // тиков на раунд
    this.round     = 0;
    this.history   = [];        // последние N раундов для анализа
  }

  // Вычислить score лица
  score(process) {
    const surplusNorm = Math.tanh(process.surplus / 10); // [-1, 1]
    const priorityNorm = process.priority / 10;           // [0, 1]
    const kenoticBonus = process.state === ProcessState.KENOTIC ? 1 : 0;

    return α * (surplusNorm + 1) / 2   // [0, 1]
         + β * priorityNorm
         + γ * kenoticBonus;
  }

  // Распределить CPU на раунд
  schedule(processes) {
    this.round++;

    const alive = processes.filter(p =>
      p.state === ProcessState.ALIVE    ||
      p.state === ProcessState.KENOTIC  ||
      p.state === ProcessState.WAITING
    );

    if (!alive.length) return [];

    // Считаем scores
    const scored = alive.map(p => ({ p, s: this.score(p) }));
    const total  = scored.reduce((sum, x) => sum + x.s, 0);

    // Распределяем
    const grants = scored.map(({ p, s }) => {
      const fraction = total > 0 ? s / total : 1 / alive.length;
      const granted  = Math.max(
        Math.floor(fraction * this.totalCPU),
        Math.floor(GRACE_MIN * this.totalCPU)  // минимальная благодать
      );
      return { process: p, granted };
    });

    // Применяем
    for (const { process, granted } of grants) {
      process.cpuGranted = granted;
      process.ticks     += granted;
      if (process.state === ProcessState.KENOTIC) {
        process.state = ProcessState.ALIVE;
      }
    }

    this.history.push({
      round: this.round,
      grants: grants.map(g => ({ name: g.process.name, ticks: g.granted, score: this.score(g.process) }))
    });
    if (this.history.length > 100) this.history.shift();

    return grants;
  }

  // Анализ справедливости (Джини-коэффициент даров)
  giniOfGiving(processes) {
    const vals = processes.map(p => p.given).sort((a, b) => a - b);
    const n = vals.length;
    if (!n) return 0;
    const sum = vals.reduce((s, v) => s + v, 0);
    if (!sum) return 0;
    let gini = 0;
    for (let i = 0; i < n; i++) gini += (2 * (i + 1) - n - 1) * vals[i];
    return gini / (n * sum);
  }

  report(processes) {
    return {
      round:   this.round,
      persons: processes.map(p => p.toJSON()),
      gini:    this.giniOfGiving(processes).toFixed(3),
      topGiver: processes.reduce((a, b) => a.given > b.given ? a : b, processes[0])?.name,
    };
  }
}
