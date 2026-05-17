/**
 * SynergeticsEngine — обучение среды по уравнениям Хакена
 *
 * Математика синергетики:
 *
 * 1. Параметр порядка q (order parameter):
 *    dq/dt = λq - q³ + F(t)
 *    λ > 0 → самоорганизация (порядок из хаоса)
 *    λ < 0 → распад
 *    q³ — нелинейное насыщение (не бесконечный рост)
 *    F(t) — шум (флуктуации, конфликты)
 *
 * 2. Принцип подчинения (slaving principle):
 *    Быстрые переменные s подчиняются медленному q:
 *    s = h(q) — быстрые следуют за медленным
 *    У нас: q = mutuality (медленная), s = {distinction, gratitude, immunity} (быстрые)
 *
 * 3. Бифуркация:
 *    При λ = λ_c система выбирает одну из ветвей:
 *    q = +√λ (кооперация) или q = -√λ (конкуренция)
 *    Малый шум F(t) в точке бифуркации → большие последствия
 *
 * 4. Диссипативная структура (Пригожин):
 *    Порядок возникает ТОЛЬКО при потоке энергии (конфликтов).
 *    Убери поток → равновесие → нет структуры.
 */

export class SynergeticsEngine {
  constructor() {
    // Параметр порядка q (mutuality)
    this.q = 0.0;

    // Управляющий параметр λ (lambda)
    // λ > 0 → самоорганизация, λ < 0 → распад
    this.lambda = 0.0;

    // Подчинённые переменные (slaved to q)
    this.slaved = {
      distinction: 0,
      gratitude: 0,
      immunity: 0,
      cooperation: 0.5,
    };

    // Параметры модели
    this.dt = 0.1;           // шаг времени
    this.noiseAmplitude = 0.05; // амплитуда флуктуаций
    this.saturation = 1.0;   // коэффициент насыщения (q³)
    this.slavingStrength = 0.3; // сила подчинения

    // История для анализа
    this.history = [];
    this.bifurcations = [];
    this.tick = 0;
  }

  /**
   * Вычислить управляющий параметр λ из состояния среды
   *
   * λ = f(благодарение, конфликт, поток)
   * Больше потока (дилемм + конфликтов) → больше λ → самоорганизация
   * Нет потока → λ < 0 → распад
   */
  computeLambda(envState) {
    const {
      conflictRate = 0,    // доля предательств (0-1)
      dilemmaFrequency = 0, // сколько дилемм за тик (0-1)
      gratitudeRate = 0,    // доля благодарений (0-1)
      agentCount = 4,       // количество агентов
      serpentPresent = false, // Змей в среде?
    } = envState;

    // Поток = дилеммы × агенты (чем больше — тем дальше от равновесия)
    const flow = dilemmaFrequency * agentCount * 0.1;

    // Конфликт как источник порядка (Пригожин: далеко от равновесия)
    // Слишком мало конфликта → λ падает (равновесие, стагнация)
    // Оптимальный конфликт (0.2-0.4) → λ максимален
    // Слишком много конфликта → λ падает (хаос)
    const conflictContribution = -4 * (conflictRate - 0.3) ** 2 + 0.4;
    // Парабола с максимумом при conflictRate = 0.3

    // Благодарение усиливает λ (положительная обратная связь)
    const gratitudeContribution = gratitudeRate * 2;

    // Змей = дополнительный стресс → может помочь (антихрупкость) или убить
    const serpentContribution = serpentPresent ? 0.1 : 0;

    this.lambda = flow + conflictContribution + gratitudeContribution + serpentContribution;
    return this.lambda;
  }

  /**
   * Один шаг эволюции параметра порядка
   *
   * dq/dt = λq - q³ + F(t)
   *
   * λq — линейное усиление (самоорганизация)
   * -q³ — нелинейное насыщение (не бесконечный рост)
   * F(t) — белый шум (конфликты, случайности)
   */
  step(envState) {
    this.tick++;

    // Вычислить λ
    this.computeLambda(envState);

    // Шум (Ланжевен)
    const noise = (Math.random() - 0.5) * 2 * this.noiseAmplitude;

    // Уравнение Хакена: dq/dt = λq - q³ + F(t)
    const dqdt = this.lambda * this.q - this.saturation * this.q ** 3 + noise;
    this.q += dqdt * this.dt;

    // Ограничить q в [-1, 1]
    this.q = Math.max(-1, Math.min(1, this.q));

    // Подчинение быстрых переменных (slaving principle)
    // s(t) = h(q) + шум
    this.slaved.distinction = Math.abs(this.q) * 0.8 + (Math.random() - 0.5) * 0.1;
    this.slaved.gratitude = Math.max(0, this.q) * 0.15 + (envState.gratitudeRate || 0);
    this.slaved.immunity = this.q > 0.5 ? 1 : 0;
    this.slaved.cooperation = 0.5 + this.q * 0.4 + (Math.random() - 0.5) * 0.05;

    // Composite через подчинённые
    const composite = this.slaved.distinction * 0.3 + this.slaved.gratitude * 0.3
      + this.slaved.immunity * 0.2 + this.slaved.cooperation * 0.2;

    // Детекция бифуркации
    if (this.history.length > 2) {
      const prev = this.history[this.history.length - 1];
      const signChange = Math.sign(prev.q) !== Math.sign(this.q) && Math.abs(this.q) > 0.05;
      const lambdaCross = prev.lambda < 0 && this.lambda >= 0;
      if (signChange || lambdaCross) {
        this.bifurcations.push({
          tick: this.tick,
          type: signChange ? 'sign_change' : 'lambda_cross',
          q_before: prev.q,
          q_after: this.q,
          lambda: this.lambda,
        });
      }
    }

    const snapshot = {
      tick: this.tick,
      q: +this.q.toFixed(4),
      lambda: +this.lambda.toFixed(4),
      composite: +composite.toFixed(4),
      ...Object.fromEntries(Object.entries(this.slaved).map(([k, v]) => [k, +v.toFixed(4)])),
      phase: this.getPhase(),
    };

    this.history.push(snapshot);
    return snapshot;
  }

  /**
   * Определить фазу системы
   */
  getPhase() {
    if (this.lambda < 0) return 'decay';        // распад
    if (Math.abs(this.q) < 0.1) return 'gas';   // газ (хаос)
    if (Math.abs(this.q) < 0.4) return 'liquid'; // жидкость (нестабильный порядок)
    if (Math.abs(this.q) < 0.7) return 'crystal'; // кристалл (стабильный порядок)
    return 'superfluid'; // сверхтекучесть (q близок к ±1)
  }

  /**
   * Стационарные состояния: q* = ±√(λ) при λ > 0
   */
  getStationaryStates() {
    if (this.lambda <= 0) return [0]; // только хаос
    const qStar = Math.sqrt(this.lambda);
    return [-qStar, 0, qStar]; // три состояния: -, 0, +
  }

  /**
   * Потенциал: V(q) = -λq²/2 + q⁴/4
   * Минимумы потенциала = стабильные состояния
   */
  getPotential(q) {
    return -this.lambda * q * q / 2 + this.saturation * q * q * q * q / 4;
  }

  /**
   * Потенциальный ландшафт (для визуализации)
   */
  getPotentialLandscape(points = 50) {
    const landscape = [];
    for (let i = 0; i <= points; i++) {
      const q = -1.5 + 3 * i / points;
      landscape.push({ q: +q.toFixed(3), V: +this.getPotential(q).toFixed(4) });
    }
    return landscape;
  }

  getStats() {
    return {
      tick: this.tick,
      q: +this.q.toFixed(4),
      lambda: +this.lambda.toFixed(4),
      phase: this.getPhase(),
      bifurcations: this.bifurcations.length,
      stationaryStates: this.getStationaryStates().map(s => +s.toFixed(3)),
      slaved: Object.fromEntries(Object.entries(this.slaved).map(([k, v]) => [k, +v.toFixed(4)])),
    };
  }
}

export default SynergeticsEngine;
