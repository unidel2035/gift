/**
 * PhysicalLayer — физика как следствие дарения
 *
 * Формулы Лосинца Д.С. (Zenodo 2025, 6 статей) применены
 * к графу даров. Не аналогия — один математический каркас.
 *
 * Квантовый вакуум (QV) = Gift Graph
 * Тороидальный вихрь = Лицо (перихоресис)
 * Циркуляция = заряд = giftsGiven - giftsReceived
 * Вязкость = kenosis (стоимость дарения)
 * Давление = co-presence weight (притяжение)
 * Фотон = дар (бегущий вихрь)
 * Гравитация = gradient давления от поглощения энергии (kenosis)
 *
 * Константа преобразования (EMHD Boltzmann):
 *   R = ν / c²
 * В нашей системе:
 *   R = avgKenosis / maxGiftSpeed²
 *
 * Эфиродинамика, статья 1: «Четыре уравнения Максвелла выводятся
 * из уравнений Эйлера при отображении скорости на вектор-потенциал»
 *
 * Эфиродинамика, статья 4: «Гравитация = вторичный макроскопический эффект
 * поглощения энергии вакуума нуклонами-вихрями»
 *
 * Эфиродинамика, статья 6: «eps_0 = rho = 8.854 × 10⁻¹² kg/m³»
 * В нашей системе: eps_0 = gratitudeDensity
 */

import logger from '../../utils/logger.js';

class PhysicalLayer {
  constructor(engine) {
    this.engine = engine;
  }

  // ═══════════════════════════════════════════════════════════════
  // ПАРАМЕТРЫ СРЕДЫ (Gift Graph как квантовый вакуум)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Плотность среды (ρ) = gratitude density.
   * Эфиродинамика: eps_0 = ρ = 8.854×10⁻¹² — диэлектрическая проницаемость.
   * Чем плотнее среда — тем больше энергии хранит поле.
   */
  rho() {
    return this.engine.gratitude.density();
  }

  /**
   * Скорость звука в среде (c_s).
   * Эфиродинамика: c_s ≥ 1.44×10²¹ m/s — на порядки выше скорости света.
   * В нашей системе: скорость распространения анамнезиса.
   * Анамнезис мгновенен (со-присутствие) → c_s = ∞ в идеале.
   * Практически: c_s = totalCoPresence / timeSinceFirstGift
   */
  speedOfSound() {
    const coPresence = this.engine.anamnesis.totalLinks();
    const allGifts = this.engine._eventStore.getAll();
    if (allGifts.length < 2) return 0;

    const first = new Date(allGifts[0].createdAt).getTime();
    const now = Date.now();
    const dt = (now - first) / 1000; // секунды

    return dt > 0 ? coPresence / dt : Infinity;
  }

  /**
   * Вязкость (ν) = средняя стоимость кеносиса.
   * Эфиродинамика: ν — кинематическая вязкость, источник EM-взаимодействия.
   * «Электромагнитное взаимодействие возникает только в областях
   *  с ненулевой вязкостью (заряды/токи)»
   *
   * В нашей системе: kenosis cost. Чем выше — тем сильнее связь.
   * Без кеносиса нет связи. Бесплатный дар не создаёт отношений.
   */
  viscosity() {
    const allGifts = this.engine._eventStore.getAll();
    const withKenosis = allGifts.filter(g => g.kenosisCost && g.kenosisCost > 0);
    if (withKenosis.length === 0) return 0;

    const totalKenosis = withKenosis.reduce((s, g) => s + g.kenosisCost, 0);
    return totalKenosis / withKenosis.length;
  }

  /**
   * Константа преобразования R (EMHD Boltzmann constant).
   * Эфиродинамика: R = ν / c² [s·T]
   * Связывает гидродинамику с электромагнетизмом.
   *
   * В нашей системе: R = viscosity / speedOfSound²
   * Чем выше kenosis при высокой скорости анамнезиса → сильнее связь.
   */
  R_emhd() {
    const nu = this.viscosity();
    const cs = this.speedOfSound();
    if (cs === 0 || cs === Infinity) return nu; // fallback
    return nu / (cs * cs);
  }

  // ═══════════════════════════════════════════════════════════════
  // СВОЙСТВА ЛИЦ (Лица как тороидальные вихри)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Заряд лица (Q) = циркуляция = giftsGiven - giftsReceived.
   * Эфиродинамика: Q = ∫ρu·dS — циркуляция вихря через поверхность.
   *
   * Положительный заряд: даёт больше, чем получает (источник).
   * Отрицательный: получает больше (приёмник).
   * Нулевой: баланс (перихоресис достигнут).
   */
  charge(personId) {
    const person = this.engine.persons.get(String(personId));
    if (!person) return 0;
    return person.giftsGiven - person.giftsReceived;
  }

  /**
   * Магнитный момент лица (μ).
   * Эфиродинамика: μ = ρ·V·(ω·r)²
   *
   * В нашей системе: μ = density × giftCount × (chargePerGift)²
   * Высокий момент = интенсивное дарение с высокой «закрученностью».
   */
  magneticMoment(personId) {
    const person = this.engine.persons.get(String(personId));
    if (!person) return 0;

    const rho = this.rho();
    const volume = person.giftsGiven + person.giftsReceived; // total activity
    const omega = volume > 0 ? this.charge(personId) / volume : 0; // charge per gift

    return rho * volume * omega * omega;
  }

  /**
   * Энергия лица.
   * Эфиродинамика: E_kinetic = ½ρV·v²
   *
   * В нашей системе: person._energy (kenosis-based)
   */
  energy(personId) {
    const person = this.engine.persons.get(String(personId));
    if (!person) return 0;
    return typeof person.energy === 'number' ? person.energy : 100;
  }

  /**
   * Спин лица = направление дарения.
   * Эфиродинамика: ось вихря = spin; параллельные притягиваются,
   * антипараллельные отталкиваются.
   *
   * В нашей системе: spin = знак заряда × наличие перихоресиса.
   * +1: даёт больше И участвует в циклах (со-направлен)
   * -1: получает больше И НЕ участвует в циклах (противонаправлен)
   *  0: баланс
   */
  spin(personId) {
    const q = this.charge(personId);
    const cycles = this.engine.gratitude.findCycles(4);
    const inCycle = cycles.some(c => c.includes(String(personId)));

    if (q > 0 && inCycle) return 1;    // дающий в перихоресисе
    if (q < 0 && !inCycle) return -1;  // получающий вне перихоресиса
    return 0;                            // баланс или смешанное
  }

  // ═══════════════════════════════════════════════════════════════
  // ВЗАИМОДЕЙСТВИЯ (Силы между лицами)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Гравитация между двумя лицами.
   * Эфиродинамика: F = -G·m₁·m₂/R², G = γ·ξ₁·ξ₂·κ²/(4π·c_s)
   * Гравитация = градиент давления от поглощения энергии вакуума.
   *
   * В нашей системе: сила притяжения через co-presence weight.
   * Чем больше kenosis (поглощение) — тем сильнее притяжение.
   * m = total gifts (масса = сумма всех даров)
   * R = graph distance (кратчайший путь в графе благодарности)
   */
  gravity(personIdA, personIdB) {
    const personA = this.engine.persons.get(String(personIdA));
    const personB = this.engine.persons.get(String(personIdB));
    if (!personA || !personB) return 0;

    const mA = personA.giftsGiven + personA.giftsReceived;
    const mB = personB.giftsGiven + personB.giftsReceived;

    // Graph distance
    const path = this.engine.gratitude.findPath(personIdA, personIdB);
    const R = path ? path.length : Infinity;
    if (R === Infinity || R === 0) return 0;

    // Kenosis factor (поглощение энергии)
    const kappa = this.viscosity();

    // G analog
    const cs = this.speedOfSound();
    const G = cs > 0 ? kappa * kappa / (4 * Math.PI * cs) : 0;

    return -G * mA * mB / (R * R);
  }

  /**
   * Электромагнитная сила между двумя лицами.
   * Эфиродинамика: Кулон через циркуляцию, Лоренц через скорость.
   *
   * В нашей системе: одноимённые заряды отталкиваются
   * (два сильных дарителя конкурируют), разноимённые притягиваются
   * (даритель + получатель = взаимодополнение).
   */
  electromagneticForce(personIdA, personIdB) {
    const qA = this.charge(personIdA);
    const qB = this.charge(personIdB);

    const path = this.engine.gratitude.findPath(personIdA, personIdB);
    const R = path ? path.length : Infinity;
    if (R === Infinity || R === 0) return 0;

    const eps = this.rho(); // eps_0 = rho (Эфиродинамика)
    if (eps === 0) return 0;

    // Кулон: F = q₁·q₂ / (4π·eps₀·r²)
    return qA * qB / (4 * Math.PI * eps * R * R);
  }

  /**
   * Сильное взаимодействие (ядерное).
   * Эфиродинамика: притяжение ~1/r³ на расстояниях ~1fm,
   * отталкивание (hard core) при r < a.
   *
   * В нашей системе:
   * Близкие лица (путь = 1) — сильная связь через direct gratitude.
   * Одно и то же лицо (r=0) — hard core repulsion (decline = Freedom Bonus).
   */
  strongForce(personIdA, personIdB) {
    if (personIdA === personIdB) {
      return Infinity; // hard core — нельзя дарить себе
    }

    const path = this.engine.gratitude.findPath(personIdA, personIdB);
    const R = path ? path.length : Infinity;
    if (R === Infinity) return 0;

    const spinA = this.spin(personIdA);
    const spinB = this.spin(personIdB);

    // Параллельные спины — сильное притяжение (Эфиродинамика, статья 5)
    const spinFactor = spinA * spinB > 0 ? 2.0 : (spinA * spinB < 0 ? 0.5 : 1.0);

    const u0 = this.viscosity(); // vortex strength ~ viscosity

    // F ~ -ρ·u₀²/r³ (Эфиродинамика)
    const rho = this.rho();
    return -rho * u0 * u0 * spinFactor / (R * R * R);
  }

  // ═══════════════════════════════════════════════════════════════
  // ФОТОН (Дар как бегущий вихрь)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Фотон = дар в движении.
   * Эфиродинамика: фотон — вихрь Хилла, распространяющийся с постоянной скоростью.
   * ψ(x,t) = f(x - ct)
   *
   * В нашей системе: дар = событие, которое распространяется через анамнезис.
   * «Частота» = surplus. «Длина волны» = 1/surplus.
   * «Энергия» = E = h·ν = kenosisCost × surplus.
   * «Поляризация» = layer (gratia/bonum/utilitas).
   */
  photonProperties(giftId) {
    const gift = this.engine.getGift(giftId);
    if (!gift) return null;

    const surplus = gift._surplus || 1;
    const kenosis = gift.kenosisCost || 10;
    const coPresent = this.engine.anamnesis.getCoPresent(giftId);

    return {
      // Волновые свойства
      frequency: surplus,                    // ν = surplus
      wavelength: surplus > 0 ? 1 / surplus : Infinity,  // λ = 1/surplus
      energy: kenosis * surplus,             // E = kenosis × surplus

      // Поляризация
      polarization: gift.layer || 'utilitas',

      // Распространение (co-presence = сколько даров «знают» об этом даре)
      propagation: coPresent.length,

      // Jones vector correspondence (Эфиродинамика, статья 3)
      // A_x = cos(a) - i·sin(a)·cos(b)
      // В нашей системе: a = direction (giver→receiver), b = layer angle
      jonesVector: {
        layer: gift.layer,
        direction: `${gift.giver}→${gift.receiver}`,
        amplitude: surplus,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ПОЛНАЯ ФИЗИЧЕСКАЯ КАРТИНА
  // ═══════════════════════════════════════════════════════════════

  /**
   * Полный физический отчёт о состоянии системы.
   */
  getPhysicalState() {
    const persons = this.engine.persons.all().filter(p => p.ontologicalOrder !== 'source');
    const allGifts = this.engine._eventStore.getAll();

    // Параметры среды
    const medium = {
      rho: this.rho(),
      speedOfSound: this.speedOfSound(),
      viscosity: this.viscosity(),
      R_emhd: this.R_emhd(),
    };

    // Свойства частиц (лиц)
    const particles = persons.map(p => ({
      name: p.name,
      id: p.id,
      charge: this.charge(p.id),
      magneticMoment: this.magneticMoment(p.id),
      spin: this.spin(p.id),
      energy: this.energy(p.id),
      mass: p.giftsGiven + p.giftsReceived,
    }));

    // Фотоны (последние 10 даров)
    const recentGifts = allGifts.slice(-10);
    const photons = recentGifts.map(g => this.photonProperties(g.id)).filter(Boolean);

    // Взаимодействия (между первыми 5 лицами)
    const interactions = [];
    const sample = persons.slice(0, 5);
    for (let i = 0; i < sample.length; i++) {
      for (let j = i + 1; j < sample.length; j++) {
        const a = sample[i].id;
        const b = sample[j].id;
        interactions.push({
          pair: `${sample[i].name} ↔ ${sample[j].name}`,
          gravity: this.gravity(a, b),
          electromagnetic: this.electromagneticForce(a, b),
          strong: this.strongForce(a, b),
        });
      }
    }

    // Общая энергия системы
    const totalEnergy = particles.reduce((s, p) => s + p.energy, 0);
    const totalCharge = particles.reduce((s, p) => s + p.charge, 0);

    return {
      medium,
      particles,
      photons: photons.slice(0, 5),
      interactions,
      conservation: {
        totalEnergy,
        totalCharge,
        chargeNeutral: Math.abs(totalCharge) < 3, // Система ~ нейтральна?
      },
      interpretation: {
        ru: 'Физика = следствие дарения. Вязкость (kenosis) порождает электромагнитное взаимодействие. Поглощение энергии (kenosis) порождает гравитацию. Вихрь (перихоресис) порождает частицу.',
        formula: 'R = ν/c² = kenosis/anamnesis_speed² — единая константа связи',
      },
    };
  }
}

export default PhysicalLayer;
