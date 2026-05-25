/**
 * SwarmSimulator — кооперативный рой дронов
 *
 * Среда (Cooperative Graph) = стигмергическое поле.
 * Рой управляется не центральным контроллером —
 * а средой, которую сам создаёт.
 *
 * Отличие от Boids/PSO/ACO:
 *   - Cost-aware: дрон учитывает стоимость миссии (заряд, риск)
 *   - Agent autonomy: дрон может отказаться от задачи
 *   - Emergent surplus: задача даёт больше информации чем ожидалось
 *   - Discernment: различение ложной цели vs реальной
 *   - Context memory: рой помнит прошлые миссии
 *   - Percolation: момент когда рой становится единым агентом
 *
 * Для НТИ АэроНет / DronDoc.
 */

import logger from '../../utils/logger.js';
import { Trit, Tryte, TernaryALU, PARA, KATA, HYPER } from './TernaryCore.js';
import { Organism } from './OrganismArchitecture.js';
import { IFFProtocol } from './IFFProtocol.js';
import { SerafimEngine, AdamEngine } from './SerafimEngine.js';
import { BookOfLife } from './BookOfLife.js';
import { ThreatModel } from './ThreatModel.js';
import { EnergyGift } from './EnergyGift.js';

// ── Типы задач ───────────────────────────────────────────

// ═══════════════════════════════════════════════════════════
// ФИЗИКА СИМУЛЯЦИИ
//
// Масштаб: 1 пиксель = 30 метров
// Время:   1 тик     = 20 секунд реального времени
// Скорость: km/h = px/tick × 5.4
// ═══════════════════════════════════════════════════════════

const SIM = {
  M_PER_PX:    30,    // 1 px = 30 метров
  SEC_PER_TICK: 20,   // 1 тик = 20 секунд
  KMH_FACTOR:  5.4,   // km/h = px/tick × KMH_FACTOR  (= 30/20×3.6)
};

// Физические параметры по классу дрона
const DRONE_PHYSICS = {
  small_quad: {
    // Скорости
    cruiseMs:    12,    // м/с крейсерская
    maxMs:       20,    // м/с максимальная
    minMs:       0,     // м/с минимальная (может зависать)
    // Динамика (пикс/тик²)
    accelPx:     2.5,   // Разгон
    decelPx:     3.5,   // Торможение
    turnDegTick: 90,    // Поворот °/тик (очень манёвренный)
    // Питание
    hoverW:      200,   // Вт зависания
    cruiseW:     150,   // Вт крейсерский
    battWh:      50,    // Вт·ч ёмкость батареи
    massKg:      1.5,
    canHover:    true,
    // Тактика
    role:        'edge',
    altitudeM:   120,   // Рабочая высота
    // Реализм
    climbRateMs: 5,     // м/с набор высоты
    windFactor:  1.0,   // Коэф. сноса ветром (1=нормально)
    fovDeg:      80,    // Горизонтальный FOV камеры (°)
    sideOverlap: 0.4,   // Боковое перекрытие снимков
  },
  large_quad: {
    cruiseMs:    15,
    maxMs:       25,
    minMs:       0,
    accelPx:     1.8,
    decelPx:     2.8,
    turnDegTick: 60,
    hoverW:      400,
    cruiseW:     280,
    battWh:      150,
    massKg:      8,
    canHover:    true,
    role:        'edge',
    altitudeM:   200,
    climbRateMs: 4,
    windFactor:  0.7,   // Тяжелее → меньше сносит
    fovDeg:      75,
    sideOverlap: 0.4,
  },
  fixed_wing: {          // ← АДАМ (ретранслятор)
    cruiseMs:    25,
    maxMs:       40,
    minMs:       15,     // Срыв потока ниже этого!
    accelPx:     0.7,    // Медленный разгон (инерция)
    decelPx:     0.5,    // Медленное торможение
    turnDegTick: 12,     // ВАЖНО: самолёт разворачивается МЕДЛЕННО
    cruiseW:     200,
    battWh:      500,    // Большая батарея
    massKg:      15,
    canHover:    false,
    role:        'relay', // Ретранслятор!
    altitudeM:   500,     // Высоко над зоной
    climbRateMs: 3,       // Набор высоты — пологий
    windFactor:  2.5,     // СИЛЬНЫЙ снос! Самолёт уязвим к боковому ветру
    fovDeg:      90,      // Широкий FOV = широкий охват
    sideOverlap: 0.3,
    relayBoost:  2.0,     // Увеличивает дальность связи дронов в радиусе в 2 раза
    orbitRadius: 120,     // Радиус орбиты ретранслятора (пикс)
  },
  vtol: {
    cruiseMs:    20,
    maxMs:       30,
    minMs:       0,
    accelPx:     1.2,
    decelPx:     2.0,
    turnDegTick: 45,
    hoverW:      600,
    cruiseW:     350,
    battWh:      300,
    massKg:      20,
    canHover:    true,
    role:        'relay',
    altitudeM:   400,
    climbRateMs: 5,
    windFactor:  0.8,
    fovDeg:      70,
    sideOverlap: 0.4,
  },
  heavy_lift: {
    cruiseMs:    8,
    maxMs:       12,
    minMs:       0,
    accelPx:     0.8,
    decelPx:     1.2,
    turnDegTick: 40,
    hoverW:      800,
    cruiseW:     600,
    battWh:      200,
    massKg:      30,
    canHover:    true,
    role:        'edge',
    altitudeM:   100,
    climbRateMs: 2,
    windFactor:  0.4,   // Очень тяжёлый — почти не сносит
    fovDeg:      60,
    sideOverlap: 0.5,
  },
  ground_robot: {
    cruiseMs:    3,
    maxMs:       5,
    minMs:       0,
    accelPx:     0.5,
    decelPx:     0.8,
    turnDegTick: 30,
    cruiseW:     100,
    battWh:      500,
    massKg:      80,
    canHover:    false,
    role:        'ground',
    altitudeM:   0,
    climbRateMs: 0,
    windFactor:  0,     // На земле — ветер не действует
    fovDeg:      60,
    sideOverlap: 0.5,
  },
};

// Вычислить px/tick из м/с
function msToPxTick(ms) {
  return ms * SIM.SEC_PER_TICK / SIM.M_PER_PX;
}

// ── Типы дронов (из DrononomicsConfig) ────────────────────

const DRONE_CLASSES = {
  fixed_wing:    { name: 'Самолёт',       flightTime: 360, maxAltitude: 5000, speed: 25, battery: 100, commRange: 300, cost: 2000000, maxPayload: 5 },
  small_quad:    { name: 'Малый квадро',   flightTime: 30,  maxAltitude: 500,  speed: 10, battery: 100, commRange: 150, cost: 150000,  maxPayload: 2 },
  large_quad:    { name: 'Большой квадро', flightTime: 60,  maxAltitude: 2000, speed: 15, battery: 100, commRange: 200, cost: 800000,  maxPayload: 10 },
  vtol:          { name: 'VTOL',           flightTime: 120, maxAltitude: 3000, speed: 20, battery: 100, commRange: 250, cost: 3500000, maxPayload: 15 },
  heavy_lift:    { name: 'Тяжёлый',       flightTime: 45,  maxAltitude: 1000, speed: 8,  battery: 100, commRange: 150, cost: 1500000, maxPayload: 30 },

  // ── ТЯЖ-М: наземный робот ──────────────────────────────────
  ground_robot:  {
    name: 'Наземный робот',
    flightTime: 2880,     // 48 часов автономности
    maxAltitude: 0,       // Не летает
    speed: 3,             // ~10 км/ч → пикс/тик (медленнее дронов)
    battery: 100,
    commRange: 200,
    cost: 5000000,
    maxPayload: 500,
    isGround: true,       // Маркер наземного аппарата
    gifts: {
      gives: ['charging', 'ammunition', 'nav_beacon', 'physical_shelter'],
      receives: ['aerial_recon', 'threat_warning'],
    },
  },

  // ── СкайДрон: тяжёлый грузовой БПЛА ────────────────────────
  heavy_cargo:   {
    name: 'Тяжёлый грузовой',
    flightTime: 180,      // 3 часа
    maxAltitude: 3000,
    speed: 20,            // ~120 км/ч → пикс/тик
    battery: 100,
    commRange: 250,
    cost: 8000000,
    maxPayload: 50,
    range: 200,           // 200 км
  },

  // ── Эколибри: конвертоплан (VTOL + самолёт) ────────────────
  convertiplane: {
    name: 'Конвертоплан',
    flightTime: 150,      // 2.5 часа
    maxAltitude: 4000,
    speed: 12,            // VTOL-режим (стартовый)
    battery: 100,
    commRange: 280,
    cost: 12000000,
    maxPayload: 20,
    range: 300,
    flightModes: {
      vtol:   { speed: 12, consumption: 1.2, canHover: true,  name: 'Вертикальный' },
      cruise: { speed: 25, consumption: 0.5, canHover: false, name: 'Крейсерский' },
    },
    transitionTimeSec: 5,
    transitionEnergyCost: 3,  // % батареи
  },
};

// ── Типы миссий ───────────────────────────────────────────

const MISSION_TYPES = {
  SURVEY:   { name: 'Разведка',     kenosisCost: 10, risk: 0.1, defaultSurplus: 1.2, altitude: 300, tokenPrice: 55000 },
  DELIVERY: { name: 'Доставка',     kenosisCost: 20, risk: 0.05, defaultSurplus: 1.0, altitude: 100, tokenPrice: 15000 },
  SEARCH:   { name: 'Поиск',        kenosisCost: 15, risk: 0.15, defaultSurplus: 1.5, altitude: 150, tokenPrice: 65000 },
  GUARD:    { name: 'Патруль',      kenosisCost: 8,  risk: 0.2, defaultSurplus: 1.1, altitude: 200, tokenPrice: 40000 },
  RELAY:    { name: 'Ретрансляция', kenosisCost: 5,  risk: 0.02, defaultSurplus: 1.0, altitude: 500, tokenPrice: 10000 },
  RESCUE:   { name: 'Спасение',    kenosisCost: 30, risk: 0.3, defaultSurplus: 2.0, altitude: 50,  tokenPrice: 90000 },

  // ── РоботАгро: сельскохозяйственные миссии ──────────────
  AGRICULTURE: {
    name: 'Агро',
    kenosisCost: 12,
    risk: 0.08,
    defaultSurplus: 1.4,
    altitude: 80,
    tokenPrice: 45000,
    subTypes: ['NDVI_SCAN', 'SPRAY', 'HARVEST_COUNT', 'SOIL_MOISTURE'],
  },

  // ── ДронМед: экстренная медицинская доставка ─────────────
  MEDICAL_EMERGENCY: {
    name: 'МедЭкстренная',
    kenosisCost: 35,
    risk: 0.12,
    defaultSurplus: 3.0,       // Жизнь = максимальный surplus
    altitude: 60,
    tokenPrice: 150000,
    priority: 'CRITICAL',       // Максимальный приоритет в Gift graph
    timeCritical: true,
    maxDeliveryMinutes: 15,     // Штраф за каждую минуту сверх
    subTypes: ['DEFIBRILLATOR', 'BLOOD_DELIVERY', 'MEDICINE', 'ORGAN_TRANSPORT'],
  },

  // ── АэроЛогистик: логистические миссии ───────────────────
  LOGISTICS: {
    name: 'Логистика',
    kenosisCost: 18,
    risk: 0.07,
    defaultSurplus: 1.1,
    altitude: 120,
    tokenPrice: 30000,
    subTypes: ['CARGO_DELIVERY', 'SUPPLY_CHAIN', 'LAST_MILE', 'ARCTIC_SUPPLY'],
  },
};

// Чем ниже высота — тем ценнее данные (больше surplus)
function altitudeSurplusMultiplier(altitude) {
  return 1 + (1000 - Math.min(altitude, 1000)) / 1000;
}

// ── Генератор находок (конкретные данные, не числа) ──────

const FINDINGS = {
  SURVEY: {
    common: [
      { content: 'Ортофотоплан территории {area} га', layer: 'utilitas', product: 'Ортофото' },
      { content: 'Цифровая модель рельефа {area} га, разрешение {gsd}см', layer: 'utilitas', product: 'ЦМР' },
      { content: 'Карта растительного покрова, {area} га', layer: 'utilitas', product: 'Вегетация' },
    ],
    rare: [
      { content: 'Обнаружен неучтённый объект строительства', layer: 'bonum', product: 'Аномалия' },
      { content: 'Зафиксировано изменение русла реки', layer: 'bonum', product: 'Гидрология' },
    ],
    grace: [
      { content: 'Обнаружена нелегальная свалка промышленных отходов', layer: 'gratia', product: 'Экоугроза' },
      { content: 'Зафиксированы следы археологического объекта', layer: 'gratia', product: 'Наследие' },
    ],
  },
  SEARCH: {
    common: [
      { content: 'Тепловая карта территории {area} га', layer: 'utilitas', product: 'Термо' },
      { content: 'Обследование {area} га — объект не найден', layer: 'utilitas', product: 'Отрицательный' },
    ],
    rare: [
      { content: 'Обнаружена тепловая аномалия — возможный очаг возгорания', layer: 'bonum', product: 'Пожар' },
      { content: 'Найден пропавший объект в координатах ({x},{y})', layer: 'bonum', product: 'Находка' },
    ],
    grace: [
      { content: 'Спасён человек — обнаружен тепловизором в лесу', layer: 'gratia', product: 'Спасение жизни' },
    ],
  },
  GUARD: {
    common: [
      { content: 'Патрулирование периметра — норма', layer: 'utilitas', product: 'Рапорт' },
      { content: 'Фиксация движения транспорта на маршруте', layer: 'utilitas', product: 'Трафик' },
    ],
    rare: [
      { content: 'Обнаружено несанкционированное проникновение', layer: 'bonum', product: 'Нарушение' },
    ],
    grace: [
      { content: 'Предотвращён инцидент — своевременное оповещение', layer: 'gratia', product: 'Предотвращение' },
    ],
  },
  DELIVERY: {
    common: [
      { content: 'Груз доставлен в точку ({x},{y}), время {time}мин', layer: 'utilitas', product: 'Доставка' },
    ],
    rare: [
      { content: 'Доставлен экстренный медикамент в отдалённый посёлок', layer: 'bonum', product: 'Мед.доставка' },
    ],
    grace: [
      { content: 'Экстренная доставка спасла жизнь — орган для трансплантации', layer: 'gratia', product: 'Жизнь' },
    ],
  },
  RELAY: {
    common: [
      { content: 'Ретрансляция связи — покрытие {area} км²', layer: 'utilitas', product: 'Связь' },
    ],
    rare: [
      { content: 'Восстановлена связь в зоне ЧС', layer: 'bonum', product: 'Связь ЧС' },
    ],
    grace: [],
  },
  RESCUE: {
    common: [
      { content: 'Обследование зоны бедствия {area} га', layer: 'utilitas', product: 'Обследование' },
    ],
    rare: [
      { content: 'Обнаружены выжившие — {count} чел.', layer: 'bonum', product: 'Выжившие' },
    ],
    grace: [
      { content: 'Спасательная операция: эвакуирован ребёнок из зоны затопления', layer: 'gratia', product: 'Спасение' },
    ],
  },

  // ── РоботАгро ──────────────────────────────────────────────
  AGRICULTURE: {
    common: [
      { content: 'NDVI-скан {area} га: среднее значение {ndvi}, культура {crop}', layer: 'utilitas', product: 'NDVI-карта' },
      { content: 'Мониторинг влажности почвы {area} га: {moisture}% средняя', layer: 'utilitas', product: 'Влажность' },
      { content: 'Прецизионное опрыскивание {area} га завершено, расход {sprayRate} л/га', layer: 'utilitas', product: 'Обработка' },
      { content: 'Оценка урожайности {area} га: {yield} ц/га, {crop}', layer: 'utilitas', product: 'Урожайность' },
    ],
    rare: [
      { content: 'Обнаружен очаг заражения {pest} на {area} га — NDVI аномалия {ndvi}', layer: 'bonum', product: 'Фитосанитария' },
      { content: 'Выявлена зона водного стресса: влажность {moisture}%, требуется ирригация', layer: 'bonum', product: 'Ирригация' },
      { content: 'Урожайность выше прогноза на 23%: {yield} ц/га ({crop})', layer: 'bonum', product: 'Сверхурожай' },
    ],
    grace: [
      { content: 'Раннее обнаружение эпифитотии — предотвращён убыток на 12 млн ₽', layer: 'gratia', product: 'Спасение урожая' },
      { content: 'Точечное опрыскивание сократило расход пестицидов на 78% — экологический дар полю', layer: 'gratia', product: 'ЭкоДар' },
    ],
  },

  // ── ДронМед ────────────────────────────────────────────────
  MEDICAL_EMERGENCY: {
    common: [
      { content: 'Доставка {medPayload} в точку ({x},{y}), время {deliveryTime} мин, дистанция {distance} км', layer: 'utilitas', product: 'МедДоставка' },
      { content: 'Экстренный рейс: {medPayload}, ETA {deliveryTime} мин, статус пациента стабильный', layer: 'utilitas', product: 'Экстренный рейс' },
    ],
    rare: [
      { content: 'Доставка {medPayload} за {deliveryTime} мин — на {timeSaved} мин быстрее скорой', layer: 'bonum', product: 'Опережение' },
      { content: 'Экстренный коридор: {count} дронов уступили маршрут — рефлексивное дарение пути', layer: 'bonum', product: 'Коридор' },
    ],
    grace: [
      { content: 'Дефибриллятор доставлен за {deliveryTime} мин — пациент реанимирован, жизнь спасена', layer: 'gratia', product: 'Спасение жизни' },
      { content: 'Орган для трансплантации доставлен в {deliveryTime} мин — операция прошла успешно', layer: 'gratia', product: 'Трансплантация' },
    ],
  },

  // ── АэроЛогистик ──────────────────────────────────────────
  LOGISTICS: {
    common: [
      { content: 'Груз {cargoWeight} кг доставлен в точку ({x},{y}), время {deliveryTime} мин', layer: 'utilitas', product: 'Доставка груза' },
      { content: 'Маршрут {routePoints} точек оптимизирован: {fuelEfficiency}% топливной эффективности', layer: 'utilitas', product: 'Маршрут' },
      { content: 'Последняя миля: {cargoWeight} кг за {deliveryTime} мин, успех доставки {successRate}%', layer: 'utilitas', product: 'Последняя миля' },
    ],
    rare: [
      { content: 'Арктическая доставка: {cargoWeight} кг при {temperature}°C, ветер {windSpeed} м/с — успех', layer: 'bonum', product: 'Арктика' },
      { content: 'Цепочка поставок: {routePoints} точек за {deliveryTime} мин, 100% доставка', layer: 'bonum', product: 'Цепочка' },
    ],
    grace: [
      { content: 'Экстренная доставка медикаментов в отрезанный посёлок — {count} жителей получили помощь', layer: 'gratia', product: 'Гуманитарный дар' },
      { content: 'Арктический supply: продовольствие доставлено на полярную станцию при шторме', layer: 'gratia', product: 'Полярный дар' },
    ],
  },
};

function generateFinding(missionType, drone, mission) {
  const pool = FINDINGS[missionType] || FINDINGS.SURVEY;
  const roll = Math.random();

  let finding;
  if (roll < 0.03 && pool.grace.length > 0) {
    finding = { ...pool.grace[Math.floor(Math.random() * pool.grace.length)] };
  } else if (roll < 0.15 && pool.rare.length > 0) {
    finding = { ...pool.rare[Math.floor(Math.random() * pool.rare.length)] };
  } else {
    finding = { ...pool.common[Math.floor(Math.random() * pool.common.length)] };
  }

  // Подставить переменные
  const gsd = Math.max(1, Math.round(drone.altitude / 100));
  const area = Math.round(10 + Math.random() * 200);
  const time = Math.round(5 + Math.random() * 30);

  // Агро-специфичные переменные
  const ndvi = (0.2 + Math.random() * 0.7).toFixed(2);
  const moisture = Math.round(15 + Math.random() * 55);
  const crops = ['пшеница', 'кукуруза', 'подсолнечник', 'соя', 'рапс', 'ячмень', 'картофель'];
  const crop = mission.cropType || crops[Math.floor(Math.random() * crops.length)];
  const yieldValue = Math.round(18 + Math.random() * 45);
  const sprayRate = (1.5 + Math.random() * 4.5).toFixed(1);
  const pests = ['фузариоз', 'ржавчина', 'мучнистая роса', 'тля', 'совка', 'саранча'];
  const pest = pests[Math.floor(Math.random() * pests.length)];

  // Мед-специфичные переменные
  const medPayloads = ['дефибриллятор', 'кровь (0+ группа)', 'инсулин', 'антидот', 'орган для трансплантации'];
  const medPayload = mission.payloadType || medPayloads[Math.floor(Math.random() * medPayloads.length)];
  const deliveryTime = Math.round(3 + Math.random() * 12);
  const distance = (1 + Math.random() * 25).toFixed(1);
  const timeSaved = Math.round(8 + Math.random() * 22);

  // Логистика-специфичные переменные
  const cargoWeight = mission.cargoWeight || Math.round(0.5 + Math.random() * 24.5);
  const routePoints = mission.deliveryPoints?.length || Math.round(2 + Math.random() * 8);
  const fuelEfficiency = Math.round(65 + Math.random() * 30);
  const successRate = Math.round(88 + Math.random() * 12);
  const temperature = Math.round(-45 + Math.random() * 20);
  const windSpeed = Math.round(5 + Math.random() * 20);

  finding.content = finding.content
    .replace('{area}', area)
    .replace('{gsd}', gsd)
    .replace('{x}', Math.round(mission.targetX))
    .replace('{y}', Math.round(mission.targetY))
    .replace('{time}', time)
    .replace('{count}', Math.floor(1 + Math.random() * 5))
    // Агро
    .replace('{ndvi}', ndvi)
    .replace('{moisture}', moisture)
    .replace('{crop}', crop)
    .replace('{yield}', yieldValue)
    .replace('{sprayRate}', sprayRate)
    .replace('{pest}', pest)
    // Мед
    .replace('{medPayload}', medPayload)
    .replace('{deliveryTime}', deliveryTime)
    .replace('{distance}', distance)
    .replace('{timeSaved}', timeSaved)
    // Логистика
    .replace('{cargoWeight}', cargoWeight)
    .replace('{routePoints}', routePoints)
    .replace('{fuelEfficiency}', fuelEfficiency)
    .replace('{successRate}', successRate)
    .replace('{temperature}', temperature)
    .replace('{windSpeed}', windSpeed);

  finding.altitude = drone.altitude;
  finding.gsd = gsd;
  finding.value = (MISSION_TYPES[missionType]?.tokenPrice || 50000) * altitudeSurplusMultiplier(drone.altitude);
  finding.drone = drone.name;
  finding.missionId = mission.id;
  finding.at = new Date().toISOString();

  // Доп. метаданные для специализированных миссий
  if (missionType === 'AGRICULTURE') {
    finding.agro = { ndvi: parseFloat(ndvi), moisture, crop, yield: yieldValue, subType: mission.subType };
  } else if (missionType === 'MEDICAL_EMERGENCY') {
    finding.medical = { payload: medPayload, deliveryTime, distance: parseFloat(distance), timeSaved, subType: mission.subType, urgency: mission.urgency || 'critical' };
  } else if (missionType === 'LOGISTICS') {
    finding.logistics = { cargoWeight, routePoints, fuelEfficiency, successRate, subType: mission.subType };
  }

  return finding;
}

// ── Дрон ─────────────────────────────────────────────────

class Drone {
  constructor(id, name, opts = {}) {
    this.id = id;
    this.name = name;
    this.x = opts.x || Math.random() * 1000;
    this.y = opts.y || Math.random() * 1000;
    // Тип дрона (из DrononomicsConfig)
    this.droneClass = opts.droneClass || 'large_quad';
    const classSpec = DRONE_CLASSES[this.droneClass] || DRONE_CLASSES.large_quad;

    this.altitude = opts.altitude || (classSpec.isGround ? 0 : 200); // Наземные роботы на земле
    this.maxAltitude = classSpec.maxAltitude;
    this.battery = opts.battery || classSpec.battery;
    this.maxBattery = classSpec.battery;
    this.baseSpeed = classSpec.speed;               // Базовая скорость (без груза)
    this.speed = classSpec.speed;                    // Текущая скорость (пикс/тик)
    this.commRange = classSpec.commRange;
    this.flightTimeMinutes = classSpec.flightTime;
    this.sensors = opts.sensors || ['camera'];
    this.className = classSpec.name;

    // ── Payload (грузоподъёмность) ──────────────────────────
    this.maxPayload = classSpec.maxPayload || 0;     // Макс. груз (кг)
    this.currentPayload = opts.currentPayload || 0;  // Текущий груз (кг)

    // ── Наземный робот: ограниченное движение по дорогам ────
    this.isGround = !!classSpec.isGround;
    this.groundGifts = classSpec.gifts || null;      // Чем дарит / что получает

    // ── Конвертоплан: двойной режим полёта ──────────────────
    this.flightModes = classSpec.flightModes || null;
    this.currentFlightMode = this.flightModes ? 'vtol' : null; // Стартуем в VTOL
    this._transitionTicks = 0;                        // Оставшиеся тики перехода
    this._transitionEnergyCost = classSpec.transitionEnergyCost || 0;

    // Границы полёта (регион) — дрон не вылетает за пределы
    this.bounds = opts.bounds || { minX: 10, maxX: 990, minY: 10, maxY: 540 };

    // ── Серафим — ИИ на борту (РЕАЛЬНАЯ LLM) ────────────────
    this.serafim = new SerafimEngine({
      droneId: this.id,
      droneName: this.name,
      useLLM: true,
    });

    // Состояние в онтологии дара
    this.giftsGiven = 0;      // Выполненные задачи
    this.giftsReceived = 0;   // Полученные данные от других
    this.giftsDeclined = 0;   // Отклонённые задачи
    this.status = 'idle';     // idle, mission, returning, sabbath
    this.currentMission = null;

    // Стигмергия: что дрон «оставил» в среде
    this.trailHistory = [];   // [{x, y, type, timestamp}]

    // ═══════════════════════════════════════════════════════
    // ОБУЧЕНИЕ — параметры, которые дрон МЕНЯЕТ САМ
    //
    // Как DeepMind: агент не знает правил.
    // Он пробует, получает score, и подстраивается.
    //
    // Gift score = surplus × acceptance × density
    // Высокий → закрепить стратегию.
    // Низкий → мутировать параметры.
    // ═══════════════════════════════════════════════════════

    // Мутируемые параметры (генотип стратегии)
    this.genome = {
      sabbathThreshold: 20,        // При какой батарее уходить на подзарядку
      yieldThreshold: 0.2,         // Насколько охотно уступает (0=жадный, 1=всегда уступает)
      riskTolerance: 0.15,         // Какой риск допустим (0=трусливый, 1=безрассудный)
      cohesionWeight: 0.01,        // Сила тяготения к благодарным
      separationDist: 30,          // Минимальная дистанция
      explorationDrive: 0.3,       // Склонность к далёким миссиям (0=ближние, 1=далёкие)
    };

    // История gift score для обучения
    this._scoreHistory = [];
    this._bestScore = 0;
    this._bestGenome = { ...this.genome };
    this._generation = 0;

    // ── Полётный план (waypoints) ─────────────────────────────────────────
    // phase: 'climbing' | 'executing' | 'landing'
    // _savedIdx: last completed waypoint (for resume after recharge)
    this._flightPlan = null;

    // ── Физика движения ──────────────────────────────────────
    const _phys = DRONE_PHYSICS[this.droneClass] || DRONE_PHYSICS.large_quad;
    this._phys = _phys;
    this.vx = 0;
    this.vy = 0;
    this.heading = Math.random() * 360; // случайный начальный курс
    this.speedPxTick = 0;               // текущая скорость (пикс/тик)
    this.cruiseSpeedPx = msToPxTick(_phys.cruiseMs);
    this.maxSpeedPx = msToPxTick(_phys.maxMs);
    this.minSpeedPx = msToPxTick(_phys.minMs || 0);
    // Высота: стартуем с земли (взлёт перед первым waypoint)
    this.altitudeM = 0;
    this._targetAltM = _phys.altitudeM || 200;
    // Орбита для ретранслятора (fixed_wing)
    this._orbitAngle = Math.random() * Math.PI * 2;
  }

  get energy() { return this.battery; }

  // ── Payload: эффективная скорость и дальность с учётом груза ──

  /**
   * Эффективная дальность с учётом груза.
   * effectiveRange = baseRange * (1 - currentPayload/maxPayload * 0.6)
   */
  get effectiveRange() {
    const classSpec = DRONE_CLASSES[this.droneClass] || {};
    const baseRange = classSpec.range || (this.baseSpeed * this.flightTimeMinutes / 60);
    if (!this.maxPayload || this.maxPayload === 0) return baseRange;
    return baseRange * (1 - (this.currentPayload / this.maxPayload) * 0.6);
  }

  /**
   * Эффективная скорость с учётом груза.
   * effectiveSpeed = baseSpeed * (1 - currentPayload/maxPayload * 0.3)
   */
  get effectiveSpeed() {
    let base = this.baseSpeed;
    // Конвертоплан: скорость зависит от режима полёта
    if (this.flightModes && this.currentFlightMode) {
      base = this.flightModes[this.currentFlightMode]?.speed || base;
    }
    if (!this.maxPayload || this.maxPayload === 0) return base;
    return base * (1 - (this.currentPayload / this.maxPayload) * 0.3);
  }

  /**
   * Загрузить груз (кг). Возвращает фактически загруженное.
   * @param {number} kg — масса груза
   */
  loadPayload(kg) {
    const canLoad = Math.min(kg, this.maxPayload - this.currentPayload);
    this.currentPayload += canLoad;
    this.speed = this.effectiveSpeed; // Пересчитать скорость
    return { loaded: canLoad, total: this.currentPayload, maxPayload: this.maxPayload };
  }

  /**
   * Разгрузить (кг).
   */
  unloadPayload(kg) {
    const canUnload = Math.min(kg, this.currentPayload);
    this.currentPayload -= canUnload;
    this.speed = this.effectiveSpeed;
    return { unloaded: canUnload, remaining: this.currentPayload };
  }

  // ── Конвертоплан: переключение режима полёта ──────────────

  /**
   * Переключить режим полёта конвертоплана (vtol ↔ cruise).
   * Переход стоит энергии и занимает время (тики).
   */
  switchFlightMode(targetMode) {
    if (!this.flightModes) return { error: 'Не конвертоплан' };
    if (!this.flightModes[targetMode]) return { error: `Неизвестный режим: ${targetMode}` };
    if (this.currentFlightMode === targetMode) return { already: true, mode: targetMode };
    if (this._transitionTicks > 0) return { error: 'Переход уже в процессе' };

    const classSpec = DRONE_CLASSES[this.droneClass];
    // Переход занимает ~5 тиков (5 секунд при 1с/тик)
    this._transitionTicks = Math.ceil((classSpec.transitionTimeSec || 5));
    this._targetFlightMode = targetMode;
    this.battery -= (classSpec.transitionEnergyCost || 3);

    return {
      transitioning: true,
      from: this.currentFlightMode,
      to: targetMode,
      ticksRemaining: this._transitionTicks,
      energyCost: classSpec.transitionEnergyCost || 3,
    };
  }

  /**
   * Обновить переход конвертоплана (вызывается каждый тик).
   */
  _updateFlightModeTransition() {
    if (this._transitionTicks <= 0) return null;
    this._transitionTicks--;
    if (this._transitionTicks === 0 && this._targetFlightMode) {
      const oldMode = this.currentFlightMode;
      this.currentFlightMode = this._targetFlightMode;
      this.speed = this.effectiveSpeed;
      this._targetFlightMode = null;
      return { transitioned: true, from: oldMode, to: this.currentFlightMode };
    }
    return { transitioning: true, ticksRemaining: this._transitionTicks };
  }

  /**
   * Gift Score дрона = surplus × acceptance × local_density
   *
   * Это ЕДИНСТВЕННАЯ метрика. Дрон не знает «правил» —
   * он просто максимизирует gift score, и из этого
   * ВОЗНИКАЕТ разумное поведение.
   */
  getGiftScore(gratitudeEdges, droneList) {
    const totalOps = this.giftsGiven + this.giftsDeclined;
    if (totalOps === 0) return 0;

    // Acceptance rate
    const acceptance = this.giftsGiven / totalOps;

    // Surplus (сколько данных получил от соседей за свои дары)
    const surplus = this.giftsGiven > 0
      ? (this.giftsReceived + 1) / this.giftsGiven
      : 0;

    // Local density (сколько соседей в радиусе)
    const neighbors = droneList
      ? droneList.filter(d => d.id !== this.id && this.distanceTo(d) <= this.commRange).length
      : 0;
    const localDensity = droneList
      ? neighbors / Math.max(1, droneList.length - 1)
      : 0;

    return surplus * acceptance * (1 + localDensity);
  }

  /**
   * Обучение: подстроить параметры на основе gift score.
   *
   * Алгоритм (эволюционный, не градиентный):
   * 1. Рассчитать текущий gift score
   * 2. Если лучше предыдущего → закрепить (exploitation)
   * 3. Если хуже → мутировать случайный параметр (exploration)
   * 4. Каждые N тиков — цикл обучения
   *
   * Это НЕ gradient descent. Это ЭПЕКТАСИС:
   * бесконечное возрастание через пробы и surplus.
   */
  learn(gratitudeEdges, droneList) {
    const score = this.getGiftScore(gratitudeEdges, droneList);
    this._scoreHistory.push(score);
    this._generation++;

    if (score > this._bestScore) {
      // Закрепить — эта стратегия работает
      this._bestScore = score;
      this._bestGenome = { ...this.genome };
    } else if (this._generation % 5 === 0) {
      // Мутировать — попробовать другое
      this._mutate();
    }

    return { score, generation: this._generation, bestScore: this._bestScore };
  }

  /**
   * Мутация одного случайного параметра.
   * Маленькие шаги — не революция, а эпектасис.
   */
  _mutate() {
    const keys = Object.keys(this.genome);
    const key = keys[Math.floor(Math.random() * keys.length)];
    const current = this.genome[key];

    // Мутация ±20% или маленький шаг
    const mutation = current * (0.8 + Math.random() * 0.4);

    // Clamp
    const limits = {
      sabbathThreshold: [5, 50],
      yieldThreshold: [0, 1],
      riskTolerance: [0, 0.5],
      cohesionWeight: [0, 0.05],
      separationDist: [10, 80],
      explorationDrive: [0, 1],
    };
    const [min, max] = limits[key] || [0, 1];
    this.genome[key] = Math.max(min, Math.min(max, mutation));
  }

  /**
   * Копировать стратегию лучшего соседа (социальное обучение).
   *
   * Как птицы учатся летать стаей: не инструкция,
   * а подражание тому, у кого получается.
   */
  learnFromNeighbor(neighbor) {
    if (!neighbor) return;
    // Скопировать 1 случайный параметр от соседа
    const keys = Object.keys(this.genome);
    const key = keys[Math.floor(Math.random() * keys.length)];
    this.genome[key] = neighbor.genome[key];
  }

  canAcceptMission(mission) {
    const type = MISSION_TYPES[mission.type] || MISSION_TYPES.SURVEY;
    // Свобода: дрон может отказаться
    if (this.battery < this.genome.sabbathThreshold + type.kenosisCost) {
      return { can: false, reason: 'Низкий заряд — нужна суббота' };
    }
    if (type.risk > this.genome.riskTolerance) {
      return { can: false, reason: `Риск ${type.risk} выше порога ${this.genome.riskTolerance.toFixed(2)}` };
    }
    if (this.status === 'sabbath') return { can: false, reason: 'На подзарядке' };
    if (this.status === 'mission') return { can: false, reason: 'Уже на миссии' };
    return { can: true };
  }

  distanceTo(other) {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  inCommRange(other) {
    return this.distanceTo(other) <= this.commRange;
  }

  /**
   * Физика движения: обновить курс и скорость к цели.
   * Учитывает угловую скорость класса (fixed_wing медленно поворачивает!),
   * плавный разгон/торможение через accelPx/decelPx.
   * @returns {number} расстояние до цели (пикс)
   */
  updatePhysics(targetX, targetY) {
    const phys = this._phys;
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;

    // Желаемый курс (0=право, 90=вниз — экранные координаты)
    const desiredHeading = Math.atan2(dy, dx) * 180 / Math.PI;

    // Угловая разница (-180 до +180)
    let dHeading = desiredHeading - this.heading;
    while (dHeading > 180) dHeading -= 360;
    while (dHeading < -180) dHeading += 360;

    // Ограничить поворот по классу (fixed_wing: 12°/тик, small_quad: 90°/тик)
    const maxTurn = phys.turnDegTick;
    const turn = Math.max(-maxTurn, Math.min(maxTurn, dHeading));
    this.heading = (this.heading + turn + 360) % 360;

    // Тормозить при приближении к цели (торможение начинается за brakeDist)
    const brakeDist = (this.speedPxTick * this.speedPxTick) / (2 * (phys.decelPx || 1) + 0.001);
    const targetSpeed = dist <= brakeDist
      ? Math.max(this.minSpeedPx, this.speedPxTick - (phys.decelPx || 1))
      : this.cruiseSpeedPx;

    // Плавный разгон / торможение
    if (this.speedPxTick < targetSpeed) {
      this.speedPxTick = Math.min(targetSpeed, this.speedPxTick + (phys.accelPx || 1));
    } else if (this.speedPxTick > targetSpeed) {
      this.speedPxTick = Math.max(targetSpeed, this.speedPxTick - (phys.decelPx || 1));
    }

    // fixed_wing: не может остановиться — минимальная скорость
    if (!phys.canHover && this.minSpeedPx > 0) {
      this.speedPxTick = Math.max(this.minSpeedPx, this.speedPxTick);
    }

    // Проекция скорости на оси
    const headingRad = this.heading * Math.PI / 180;
    this.vx = Math.cos(headingRad) * this.speedPxTick;
    this.vy = Math.sin(headingRad) * this.speedPxTick;

    return dist;
  }

  /**
   * Физический расход батареи (Вт × ч модель).
   * Учитывает мощность зависания, крейсерскую мощность, груз.
   * @returns {number} % батареи за тик
   */
  computeBatteryDrain() {
    const phys = this._phys;
    const dtHours = SIM.SEC_PER_TICK / 3600;
    let powerW;

    if (this.status === 'sabbath') {
      return 0; // На зарядке — не тратит
    } else if (this.status === 'idle' && phys.canHover) {
      powerW = (phys.hoverW || 100) * 0.3; // Лёгкое зависание на месте
    } else if (this.isGround) {
      powerW = phys.cruiseW || 100; // Наземный — просто крейс
    } else {
      // Интерполяция hover→cruise по текущей скорости
      const speedFrac = this.cruiseSpeedPx > 0
        ? Math.min(1, this.speedPxTick / this.cruiseSpeedPx)
        : 1;
      const hoverW = phys.hoverW || 0;
      powerW = hoverW + (phys.cruiseW - hoverW) * speedFrac;
      // Конвертоплан: режим полёта
      if (this.flightModes && this.currentFlightMode) {
        const modeConsumption = this.flightModes[this.currentFlightMode]?.consumption || 0.5;
        powerW = (phys.cruiseW || 300) * modeConsumption;
      }
      // Груз: +3% за каждый кг
      if (this.currentPayload > 0 && this.maxPayload > 0) {
        powerW *= (1 + this.currentPayload * 0.03);
      }
    }

    const drainPct = powerW * dtHours / phys.battWh * 100;
    return Math.min(drainPct, 5); // Не более 5% за тик (защита)
  }
}

// ── Миссия (Дар) ─────────────────────────────────────────

class Mission {
  constructor(opts = {}) {
    this.id = opts.id || `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.type = opts.type || 'SURVEY';
    this.targetX = opts.targetX || Math.random() * 1000;
    this.targetY = opts.targetY || Math.random() * 1000;
    this.telos = opts.telos || MISSION_TYPES[opts.type]?.name || 'Разведка';
    this.status = 'offered';  // offered, accepted, completed, declined, failed
    this.assignedDrone = null;
    this.result = null;
    this.surplus = null;
    this.createdAt = new Date().toISOString();
  }
}

// ── LogisticsPlanner — оптимизация маршрутов и payload ────

class LogisticsPlanner {
  /**
   * Payload model: вес → коэффициент расхода батареи.
   * Каждый кг груза увеличивает расход на 3%.
   * @param {number} weightKg - масса груза
   * @returns {number} multiplier (1.0 = без груза, 1.6 = 20 кг)
   */
  static calcPayloadDrain(weightKg) {
    return 1.0 + (weightKg || 0) * 0.03;
  }

  /**
   * Range reduction from payload.
   * @param {Object} droneClass - спецификация класса дрона
   * @param {number} weightKg
   * @returns {{ effectiveRange: number, rangeReduction: number, canCarry: boolean }}
   */
  static calcEffectiveRange(droneClass, weightKg) {
    const maxPayload = droneClass.maxPayload || 10;
    const canCarry = weightKg <= maxPayload;
    const loadFactor = Math.min(weightKg / maxPayload, 1.0);
    // Дальность уменьшается квадратично от загрузки
    const rangeReduction = loadFactor * loadFactor * 0.5; // макс -50% при полной загрузке
    const baseRange = droneClass.range || (droneClass.flightTime * droneClass.speed * 0.06); // km approx
    const effectiveRange = baseRange * (1 - rangeReduction);

    return { effectiveRange: Math.round(effectiveRange), rangeReduction: Math.round(rangeReduction * 100), canCarry };
  }

  /**
   * Weather factor: ветер, осадки, температура → коэффициент доставки.
   * @param {{ windSpeed?: number, precipitation?: number, temperature?: number }} weather
   * @returns {{ factor: number, description: string, safe: boolean }}
   */
  static calcWeatherFactor(weather = {}) {
    const wind = weather.windSpeed || 0;       // м/с
    const precip = weather.precipitation || 0; // мм/час
    const temp = weather.temperature ?? 20;    // °C

    let factor = 1.0;
    const reasons = [];

    // Ветер
    if (wind > 15) { factor *= 0.5; reasons.push(`сильный ветер ${wind} м/с`); }
    else if (wind > 8) { factor *= 0.8; reasons.push(`умеренный ветер ${wind} м/с`); }

    // Осадки
    if (precip > 10) { factor *= 0.3; reasons.push(`сильные осадки ${precip} мм/ч`); }
    else if (precip > 2) { factor *= 0.7; reasons.push(`осадки ${precip} мм/ч`); }

    // Температура (холод бьёт по батарее)
    if (temp < -30) { factor *= 0.4; reasons.push(`экстремальный холод ${temp}°C`); }
    else if (temp < -10) { factor *= 0.7; reasons.push(`холод ${temp}°C`); }
    else if (temp > 45) { factor *= 0.6; reasons.push(`жара ${temp}°C`); }

    return {
      factor: Math.round(factor * 100) / 100,
      description: reasons.length > 0 ? reasons.join(', ') : 'нормальные условия',
      safe: factor >= 0.5,
    };
  }

  /**
   * Оптимизация маршрута для нескольких точек доставки.
   * Greedy nearest-neighbor TSP heuristic.
   * @param {{ x: number, y: number }[]} points - точки доставки
   * @param {{ x: number, y: number }} start - начальная позиция дрона
   * @param {number} speed
   * @returns {{ route: number[], totalDistance: number, estimatedMinutes: number }}
   */
  static optimizeRoute(points, start, speed = 15) {
    if (!points || points.length === 0) return { route: [], totalDistance: 0, estimatedMinutes: 0 };

    const visited = new Set();
    const route = [];
    let current = start;
    let totalDist = 0;

    for (let i = 0; i < points.length; i++) {
      let bestIdx = -1;
      let bestDist = Infinity;

      for (let j = 0; j < points.length; j++) {
        if (visited.has(j)) continue;
        const d = Math.sqrt((current.x - points[j].x) ** 2 + (current.y - points[j].y) ** 2);
        if (d < bestDist) { bestDist = d; bestIdx = j; }
      }

      if (bestIdx >= 0) {
        visited.add(bestIdx);
        route.push(bestIdx);
        totalDist += bestDist;
        current = points[bestIdx];
      }
    }

    // Approximate: 1 pixel ≈ 1 km на карте симулятора
    const estimatedMinutes = Math.round((totalDist / speed) * 60);

    return { route, totalDistance: Math.round(totalDist), estimatedMinutes };
  }
}

// ── Симулятор ────────────────────────────────────────────

class SwarmSimulator {
  constructor(opts = {}) {
    this.drones = new Map();           // id → Drone
    this.missions = [];                // Mission[]
    this.completedMissions = [];
    this.gratitudeEdges = [];          // {from, to, missionId}
    this.incalculable = [];
    this._tick = 0;
    this._interval = null;
    this._running = false;
    this._graceHistory = [];
    this._temptations = [];

    // ── ИИ-агентность: каждый дрон управляется Серафимом ──
    this._agentLog = [];               // лог решений ИИ-агентов
    this._giftEngine = opts.giftEngine || null;  // граф даров

    // Параметры среды
    this.fieldSize = opts.fieldSize || 1000;
    this.wind = { x: 0, y: 0 };

    // ── Oikonomia: хозяйство роя ────────────────────────
    // Каждая находка = prosfora (приношение)
    // Выручка → koinon (общий фонд)
    // Обмен данными → exchangeGuard проверяет
    this._oikonomia = {
      koinon: 0,                    // Общий фонд (₽)
      prosforai: [],                // Приношения [{finding, value, drone, at}]
      flows: [],                    // Денежные потоки [{from, to, amount, purpose}]
      oikoi: new Map(),             // Домохозяйства (группы дронов)
      exchangeAlerts: [],           // Подозрения на обмен вместо дара
      jubileeNeeded: false,         // Нужен ли юбилей (сброс долгов)
    };

    // ── Организм: рой как живое существо ──────────────────
    this.organism = new Organism('DronDoc Swarm');
    this.iff = new IFFProtocol('swarm-commander', this._oikonomia);
    this.threats = new ThreatModel();

    // ── Энергетический дар (ИНЭСИС): беспроводная зарядка ──
    this.energyGift = new EnergyGift(this);
  }

  // ── Organism helpers ─────────────────────────────────

  _droneClassToCell(droneClass) {
    switch (droneClass) {
      case 'fixed_wing':    return Math.random() < 0.5 ? 'SCOUT' : 'FIGHTER';
      case 'small_quad':    return 'SENTINEL';
      case 'large_quad':    return 'SCOUT';
      case 'vtol':          return 'RELAY';
      case 'heavy_lift':    return 'CARRIER';
      case 'ground_robot':  return 'GROUND_STATION';
      case 'heavy_cargo':   return 'CARRIER';
      case 'convertiplane': return 'RELAY';
      default:              return 'SCOUT';
    }
  }

  // ── Oikonomia API ─────────────────────────────────────

  /**
   * Записать приношение (prosfora) от дрона.
   * Каждая находка = дар → prosfora → koinon.
   */
  recordProsfora(finding) {
    // Лог: дрон обнаружил находку
    this._log({ name: finding.droneName || 'Дрон', id: finding.droneId }, 'Серафим',
      `ОБНАРУЖЕНО: ${(finding.finding || finding.content || '?').slice(0, 60)} [${finding.layer || '?'}] ${finding.value ? finding.value + '₽' : ''}`);

    const prosfora = {
      id: `p-${Date.now()}`,
      ...finding,
      type: 'prosfora',
    };
    this._oikonomia.prosforai.push(prosfora);
    this._oikonomia.koinon += finding.value || 0;

    // Денежный поток: дрон → koinon
    this._oikonomia.flows.push({
      from: finding.drone,
      to: 'koinon',
      amount: finding.value || 0,
      purpose: finding.product || 'данные',
      at: finding.at,
    });

    return prosfora;
  }

  /**
   * Распределить из koinon (sustain): обслуживание, топливо, ремонт.
   */
  sustainFromKoinon(droneId, amount, purpose) {
    if (this._oikonomia.koinon < amount) return { error: 'Недостаточно в koinon' };
    this._oikonomia.koinon -= amount;
    this._oikonomia.flows.push({
      from: 'koinon', to: droneId, amount, purpose,
      at: new Date().toISOString(),
    });
    return { ok: true, remaining: this._oikonomia.koinon };
  }

  /**
   * Проверка: не стал ли обмен данными торгом?
   * ExchangeGuard: если дрон дарит ТОЛЬКО тем, кто дарит ему → подозрение.
   */
  checkExchange(droneId) {
    const given = this.gratitudeEdges.filter(e => e.from === droneId);
    const received = this.gratitudeEdges.filter(e => e.to === droneId);

    const givenTo = new Set(given.map(e => e.to));
    const receivedFrom = new Set(received.map(e => e.from));

    // Если ВСЕ получатели = те же, от кого получает → обмен, не дар
    const overlap = [...givenTo].filter(id => receivedFrom.has(id));
    const isExchange = givenTo.size > 0 && overlap.length === givenTo.size;

    if (isExchange) {
      this._oikonomia.exchangeAlerts.push({
        droneId,
        type: 'circular_exchange',
        description: `${droneId} дарит только тем, кто дарит ему — подозрение на обмен`,
        at: new Date().toISOString(),
      });
    }

    return { isExchange, overlap: overlap.length, total: givenTo.size };
  }

  /**
   * Нужен ли юбилей? Если koinon перегружен или дроны закредитованы.
   */
  needsJubilee() {
    const droneList = [...this.drones.values()];
    const exhausted = droneList.filter(d => d.battery < 15).length;
    const ratio = droneList.length > 0 ? exhausted / droneList.length : 0;
    this._oikonomia.jubileeNeeded = ratio > 0.5; // Больше половины истощены
    return {
      needed: this._oikonomia.jubileeNeeded,
      exhaustedRatio: ratio,
      reason: ratio > 0.5 ? 'Больше 50% дронов истощены — нужен сброс и восстановление' : 'Норма',
    };
  }

  /**
   * Юбилей: полная подзарядка всех + сброс долгов.
   */
  declareJubilee() {
    for (const [, drone] of this.drones) {
      drone.battery = drone.maxBattery;
      drone.status = 'idle';
    }
    const released = this._oikonomia.koinon;
    this._oikonomia.koinon = 0;
    this._oikonomia.exchangeAlerts = [];
    return { jubilee: true, released, dronesRestored: this.drones.size };
  }

  getOikonomia() {
    return {
      koinon: Math.round(this._oikonomia.koinon),
      prosforaiCount: this._oikonomia.prosforai.length,
      recentProsforai: this._oikonomia.prosforai.slice(-5).reverse(),
      flows: this._oikonomia.flows.slice(-10).reverse(),
      exchangeAlerts: this._oikonomia.exchangeAlerts,
      jubileeNeeded: this._oikonomia.jubileeNeeded,
    };
  }

  // ── Создание роя ───────────────────────────────────────

  addDrone(name, opts = {}) {
    const id = `drone-${this.drones.size + 1}`;
    const drone = new Drone(id, name, opts);
    this.drones.set(id, drone);

    // Регистрация в организме
    const cellType = this._droneClassToCell(drone.droneClass);
    this.organism.addCell(drone.id, cellType, { x: drone.x, y: drone.y });

    return drone;
  }

  // ── Лог ИИ-решений ──────────────────────────────────
  _log(drone, agent, decision) {
    if (!this._agentLog) this._agentLog = [];
    const entry = {
      tick: this._tick,
      drone: drone ? (drone.name || 'D-' + drone.id) : '—',
      agent,
      decision,
      battery: drone ? Math.round(drone.battery) : null,
    };
    this._agentLog.push(entry);
    if (this._agentLog.length > 200) this._agentLog.shift();
  }

  createSwarm(count, namePrefix = 'Дрон') {
    const drones = [];
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count;
      const r = 80 + Math.random() * 60;
      // Смешанный состав роя
      const classes = Object.keys(DRONE_CLASSES);
      const droneClass = classes[i % classes.length];
      drones.push(this.addDrone(`${namePrefix}-${i + 1}`, {
        x: 500 + r * Math.cos(angle),
        y: 280 + r * Math.sin(angle) * 0.6,
        droneClass,
      }));
    }
    this.organism.breathe(); // Организм оживает
    this.energyGift.initBatteries(); // Инициализировать батареи
    return drones;
  }

  /**
   * Создать рой ВНУТРИ границ региона.
   * Дроны спавнятся случайно внутри bounds и НЕ вылетают за них.
   */
  createSwarmInBounds(count, namePrefix = 'Дрон', bounds, regionName, composition = null) {
    const drones = [];
    const { minX, minY, maxX, maxY } = bounds;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const w = maxX - minX;
    const h = maxY - minY;

    // Build class sequence from composition {small_quad:3, fixed_wing:2, ...} or fractions
    let classSequence;
    if (composition && typeof composition === 'object' && Object.keys(composition).length) {
      classSequence = [];
      // If values are fractions (<= 1) — convert to counts
      const vals = Object.values(composition);
      const isFraction = vals.every(v => v <= 1);
      for (const [cls, v] of Object.entries(composition)) {
        const n = isFraction ? Math.max(1, Math.round(count * v)) : v;
        for (let j = 0; j < n; j++) classSequence.push(cls);
      }
      while (classSequence.length < count) classSequence.push(classSequence[classSequence.length - 1] || 'large_quad');
      classSequence = classSequence.slice(0, count);
    } else {
      const classes = Object.keys(DRONE_CLASSES);
      classSequence = Array.from({ length: count }, (_, i) => classes[i % classes.length]);
    }

    for (let i = 0; i < count; i++) {
      const droneClass = classSequence[i];
      drones.push(this.addDrone(`${namePrefix}-${i + 1}`, {
        x: cx + (Math.random() - 0.5) * w * 0.6,
        y: cy + (Math.random() - 0.5) * h * 0.6,
        droneClass,
        bounds: { minX, minY, maxX, maxY },
      }));
    }

    this._regionName = regionName;
    this._regionBounds = bounds;

    logger.info(`[Swarm] Рой в регионе "${regionName}": ${count} дронов, bounds ${minX}-${maxX} x ${minY}-${maxY}`);
    this.organism.breathe(); // Организм оживает
    this.energyGift.initBatteries(); // Инициализировать батареи
    return drones;
  }

  /**
   * Назначить полётные планы дронам.
   * @param {{ droneIdx, waypoints, fullPath }[]} plans
   * @param {{ x, y }} homeBase
   */
  assignFlightPlans(plans, homeBase) {
    this._homeBase = homeBase;
    const droneList = [...this.drones.values()];
    for (let i = 0; i < plans.length && i < droneList.length; i++) {
      const drone = droneList[i];
      drone._flightPlan = {
        waypoints: plans[i].waypoints,
        fullPath: plans[i].fullPath,
        idx: 0,
        done: false,
        phase: 'climbing',           // взлёт перед первым waypoint
        targetAlt: drone._targetAltM, // рабочая высота класса
        _savedIdx: 0,                 // куда вернуться после подзарядки
      };
      // Стартовая позиция — база, на земле
      if (homeBase) {
        drone.x = homeBase.x + (Math.random() - 0.5) * 10;
        drone.y = homeBase.y + (Math.random() - 0.5) * 10;
        drone.altitudeM = 0;
      }
    }
  }

  // ── Миссии (Дары) ──────────────────────────────────────

  createMission(opts = {}) {
    const mission = new Mission(opts);
    this.missions.push(mission);
    return mission;
  }

  /**
   * Назначение миссии — НЕ центральное.
   * Среда (affordance) предлагает → дрон решает.
   *
   * Алгоритм:
   * 1. Для каждой unassigned миссии
   * 2. Найти ближайший свободный дрон
   * 3. Проверить canAcceptMission (свобода!)
   * 4. Если может — offer. Дрон может decline.
   */
  assignMissions() {
    const unassigned = this.missions.filter(m => m.status === 'offered');
    const results = [];

    for (const mission of unassigned) {
      // Affordance: кто ближе + у кого больше батареи?
      const type = MISSION_TYPES[mission.type] || MISSION_TYPES.SURVEY;
      let bestDrone = null;
      let bestScore = -Infinity;

      for (const [, drone] of this.drones) {
        const check = drone.canAcceptMission(mission);
        if (!check.can) continue;

        const distance = Math.sqrt(
          (drone.x - mission.targetX) ** 2 + (drone.y - mission.targetY) ** 2
        );
        // Score = battery - distance_cost - risk. Kenosis-aware.
        const score = drone.battery - (distance / drone.speed) * 2 - type.risk * 50;
        if (score > bestScore) { bestScore = score; bestDrone = drone; }
      }

      if (bestDrone) {
        // Различение: ложная цель?
        if (this._isTemptation(mission)) {
          // Дрон «различил» помеху
          mission.status = 'declined';
          bestDrone.giftsDeclined++;
          this._temptations.push({
            missionId: mission.id,
            droneId: bestDrone.id,
            reason: 'Различение: ложная цель',
            at: new Date().toISOString(),
          });
          results.push({ mission: mission.id, drone: bestDrone.name, action: 'declined_temptation' });
          continue;
        }

        // Accept
        mission.status = 'accepted';
        mission.assignedDrone = bestDrone.id;
        bestDrone.status = 'mission';
        bestDrone.currentMission = mission.id;

        // Кеносис: расход батареи
        bestDrone.battery -= type.kenosisCost;
        bestDrone.giftsGiven++;

        results.push({ mission: mission.id, drone: bestDrone.name, action: 'accepted', battery: bestDrone.battery });
      }
    }

    return results;
  }

  /**
   * Выполнение миссий — один тик.
   *
   * Включает 3 механики роя:
   * 1. Flocking (Reynolds через онтологию дара)
   * 2. Collision avoidance (ORCA-подобное через decline)
   * 3. Движение к цели миссии
   */
  executeTick() {
    this._tick++;
    const events = [];
    const droneList = [...this.drones.values()];

    // Попутный ветер от команды оператора (убывает со временем)
    if (this._dirBias && this._dirBias.remaining > 0) {
      // Не переопределяем ветер если задан ветер-дар (setWind)
      if (!this._windGift || this._windGift.speedMs === 0) {
        const fade = this._dirBias.remaining / 20; // плавное затухание
        this.wind.x = this._dirBias.dx * fade;
        this.wind.y = this._dirBias.dy * fade;
      }
      this._dirBias.remaining--;
      if (this._dirBias.remaining === 0 && (!this._windGift || this._windGift.speedMs === 0)) {
        this.wind.x = 0; this.wind.y = 0;
      }
    }

    // Сбросить флаг relay boost с прошлого тика
    for (const d of droneList) d._relayBoosted = false;

    // ── FLOCKING: separation + alignment + cohesion ──────
    // Применяется ко ВСЕМ дронам (не только на миссии)
    for (const drone of droneList) {
      if (drone.status === 'sabbath') continue;

      let sepX = 0, sepY = 0;  // Separation (decline = personal space)
      let aliX = 0, aliY = 0;  // Alignment (общий telos)
      let cohX = 0, cohY = 0;  // Cohesion (благодарность стягивает)
      let neighbors = 0;

      for (const other of droneList) {
        if (other.id === drone.id) continue;
        const dx = other.x - drone.x;
        const dy = other.y - drone.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        if (dist < drone.commRange) {
          neighbors++;

          // SEPARATION (Freedom/Decline): отталкивание от слишком близких
          if (dist < drone.genome.separationDist) {
            sepX -= (dx / dist) * (drone.genome.separationDist - dist) * 0.3;
            sepY -= (dy / dist) * (drone.genome.separationDist - dist) * 0.3;
          }

          // ALIGNMENT (Telos): двигаться как соседи
          if (other.currentMission) {
            const otherMission = this.missions.find(m => m.id === other.currentMission);
            if (otherMission) {
              const omx = otherMission.targetX - other.x;
              const omy = otherMission.targetY - other.y;
              const omDist = Math.sqrt(omx * omx + omy * omy) || 1;
              aliX += omx / omDist;
              aliY += omy / omDist;
            }
          }

          // COHESION (Gratitude): тяготение к тем, с кем обменивались данными
          const hasGratitude = this.gratitudeEdges.some(e =>
            (e.from === drone.id && e.to === other.id) ||
            (e.from === other.id && e.to === drone.id)
          );
          if (hasGratitude) {
            cohX += dx * drone.genome.cohesionWeight;
            cohY += dy * drone.genome.cohesionWeight;
          }
        }
      }

      // Применить flocking силы (только для idle дронов — на миссии летят к цели)
      if (drone.status === 'idle' && neighbors > 0) {
        drone.x += sepX + aliX * 0.5 + cohX;
        drone.y += sepY + aliY * 0.5 + cohY;

        // Bounds
        drone.x = Math.max(drone.bounds.minX, Math.min(drone.bounds.maxX, drone.x));
        drone.y = Math.max(drone.bounds.minY, Math.min(drone.bounds.maxY, drone.y));
      }
    }

    // ── СЕРАФИМ: L1 рефлексы (lookup <1мс) + L2 LLM (50-300мс) ──
    for (const drone of droneList) {
      // Определить контекст
      let ctx = 'normal';
      if (drone.battery < 20) ctx = 'low_batt';
      else if (drone.currentMission) ctx = 'target';
      else if (drone.status === 'returning') ctx = 'base';
      drone.serafim.detectContext(ctx === 'low_batt' ? 'батарея низкая' : ctx === 'target' ? 'цель впереди' : ctx === 'base' ? 'возврат база' : '');

      // Обновить ситуационные данные для LLM
      const baseX = (drone.bounds.minX + drone.bounds.maxX) / 2;
      const baseY = (drone.bounds.minY + drone.bounds.maxY) / 2;
      const distToBase = Math.sqrt((drone.x - baseX) ** 2 + (drone.y - baseY) ** 2);
      const mission = drone.currentMission ? this.missions.find(m => m.id === drone.currentMission) : null;
      const distToTarget = mission ? Math.sqrt(((mission.targetX || 500) - drone.x) ** 2 + ((mission.targetY || 500) - drone.y) ** 2) : Infinity;
      const neighbors = droneList.filter(d => d.id !== drone.id && Math.sqrt((d.x - drone.x) ** 2 + (d.y - drone.y) ** 2) < (drone.commRange || 150)).length;

      drone.serafim.updateSituation({
        battery: Math.round(drone.battery),
        altitude: drone.altitudeM || 100,
        speed: Math.round(drone.speedPxTick * SIM.KMH_FACTOR * 10) / 10, // реальная km/h
        heading: Math.round(drone.heading),
        lat: 55 + drone.y / 100,
        lon: 37 + drone.x / 100,
        neighbors,
        distToTarget: Math.round(distToTarget),
        distToBase: Math.round(distToBase),
        missionType: mission?.type || null,
      });

      if (drone.status === 'sabbath') {
        drone.battery = Math.min(100, drone.battery + 2);
        if (drone.battery >= 95) {
          const resp = drone.serafim.execute('готов');
          // Продолжение маршрута с сохранённого waypoint
          if (drone._flightPlan && !drone._flightPlan.done && drone._flightPlan._savedIdx !== undefined) {
            drone._flightPlan.idx = drone._flightPlan._savedIdx;
            drone._flightPlan.phase = 'climbing'; // снова взлёт
            drone.altitudeM = 0;
            this._log(drone, 'Серафим', `→ возобновляю маршрут WP${drone._flightPlan.idx}/${drone._flightPlan.waypoints.length} [${resp}]`);
          } else {
            this._log(drone, 'Серафим', `→ готов [${resp}] заряд 100%`);
          }
          drone.status = 'idle';
        }
        continue;
      }

      // Прямая команда оператора (_forcedTarget): двигаться в направлении N тиков
      // Работает для ЛЮБОГО статуса кроме sabbath — переопределяет миссию
      if (drone._forcedTarget && drone._forcedTarget.ticksLeft > 0) {
        drone.status = 'mission';
        const ft = drone._forcedTarget;
        const windFactor = drone._phys?.windFactor || 1.0;
        drone.updatePhysics(ft.x, ft.y);
        drone.x += drone.vx + this.wind.x * windFactor;
        drone.y += drone.vy + this.wind.y * windFactor;
        const b = drone.bounds;
        drone.x = Math.max(b.minX, Math.min(b.maxX, drone.x));
        drone.y = Math.max(b.minY, Math.min(b.maxY, drone.y));
        drone.battery -= drone.computeBatteryDrain();
        drone.trailHistory.push({ x: drone.x, y: drone.y, type: 'cmd', timestamp: Date.now() });
        ft.ticksLeft--;
        if (ft.ticksLeft === 0) { drone._forcedTarget = null; }
        continue; // пропустить обычное движение
      }

      // L1: рефлекс — низкая батарея → домой
      if (drone.battery < 15 && drone.status === 'mission') {
        const resp = drone.serafim.execute('устал');
        this._log(drone, 'Серафим', `L1:рефлекс устал→[${resp}] BAT ${Math.round(drone.battery)}% → возврат`);
        drone.status = 'returning';
        drone.currentMission = null;
        continue;
      }

      // На миссии → навигация
      if (drone.status === 'mission' && mission) {
        const dist = Math.round(distToTarget);
        const heading = drone.serafim._situation.heading;

        // L1: lookup решения
        const resp = drone.serafim.execute('лети');
        const scanResp = drone.serafim.execute('скан');

        if (this._tick % 3 === 0) {
          const lat = drone.serafim._situation.lat.toFixed(4);
          const lon = drone.serafim._situation.lon.toFixed(4);
          const speedKmh = Math.round(drone.speedPxTick * SIM.KMH_FACTOR);
          this._log(drone, 'Серафим', `L1 лети→[${resp}] ${lat}°N ${lon}°E HDG${Math.round(drone.heading)}° ${speedKmh}км/ч ${dist}м BAT${Math.round(drone.battery)}% ⚡${neighbors}`);
        }

        // L2: LLM каждые 10 тиков — Серафим ДУМАЕТ о ситуации
        if (this._tick % 10 === 0) {
          const thinkPrompt = `Лечу к цели. ${dist}м осталось. Батарея ${Math.round(drone.battery)}%. Соседей: ${neighbors}. Скан: ${scanResp}. Что вижу?`;
          drone.serafim.think(thinkPrompt).then(result => {
            if (result.answer && result.answer !== '?') {
              this._log(drone, 'Серафим', `L2:LLM [${result.time_ms}мс] ${result.answer}`);
            }
          }).catch(() => {});
        }
      }

      // Idle → взять миссию
      if (drone.status === 'idle') {
        const m = this.missions.find(m => !m.assignedDrone && !m.completed);
        if (m) {
          const resp = drone.serafim.execute('готов');
          this._log(drone, 'Серафим', `L1 готов→[${resp}] принял: ${m.type || 'разведка'}`);
          drone.status = 'mission';
          drone.currentMission = m.id;
          m.assignedDrone = drone.id;
          m.status = 'in_progress';

          // L2: LLM — описать что за миссия
          drone.serafim.think(`Принял миссию: ${m.type || 'разведка'}. Готовлюсь к вылету.`).then(result => {
            if (result.answer && result.answer !== '?') {
              this._log(drone, 'Серафим', `L2:LLM [${result.time_ms}мс] ${result.answer}`);
            }
          }).catch(() => {});
        }
      }

      // Returning → движение к базе + посадка
      if (drone.status === 'returning') {
        const resp = drone.serafim.execute('домой');
        if (this._tick % 5 === 0) {
          this._log(drone, 'Серафим', `L1 домой→[${resp}] ${Math.round(distToBase)}м до базы H${Math.round(drone.altitudeM)}м BAT${Math.round(drone.battery)}%`);
        }
        if (distToBase < 20) {
          drone.speedPxTick = 0; // Остановка
          drone.altitudeM = 0;   // Посадка
          this._log(drone, 'Серафим', `→ база → посадка → зарядка`);
          drone.status = 'sabbath';
        } else {
          const windFactor = drone._phys.windFactor || 1.0;
          const climbRateM = (drone._phys.climbRateMs || 3) * SIM.SEC_PER_TICK;
          // Снижение по мере приближения к базе
          if (distToBase < 60) {
            drone.altitudeM = Math.max(0, drone.altitudeM - climbRateM);
          }
          // Физика возврата к базе
          if (drone.isGround) {
            const gx = baseX - drone.x, gy = baseY - drone.y;
            if (Math.abs(gx) > Math.abs(gy)) drone.x += Math.sign(gx) * drone.effectiveSpeed;
            else drone.y += Math.sign(gy) * drone.effectiveSpeed;
          } else {
            drone.updatePhysics(baseX, baseY);
            drone.x += drone.vx + this.wind.x * windFactor;
            drone.y += drone.vy + this.wind.y * windFactor;
          }
          drone.battery -= drone.computeBatteryDrain();
          // Bounds
          drone.x = Math.max(drone.bounds.minX, Math.min(drone.bounds.maxX, drone.x));
          drone.y = Math.max(drone.bounds.minY, Math.min(drone.bounds.maxY, drone.y));
        }
      }
    }

    // ── АДАМ: координация через LLM каждые 5 тиков ──────
    if (this._tick % 5 === 0) {
      const active = droneList.filter(d => d.status === 'mission');
      const idle = droneList.filter(d => d.status === 'idle');
      const returning = droneList.filter(d => d.status === 'returning');
      const avgBat = droneList.reduce((s, d) => s + d.battery, 0) / (droneList.length || 1);

      // Читаем BookOfLife если есть GiftEngine
      let wounds = [];
      if (this._giftEngine) {
        try {
          const book = new BookOfLife(this._giftEngine);
          const page = book.read();
          wounds = (page.wounds || []).map(w => w.name);
        } catch {}
      }

      // L1: алгоритмический лог
      this._log(null, 'Адам', `L1 рой: ${active.length}→миссия ${idle.length}→ожидание ${returning.length}→возврат BAT:${Math.round(avgBat)}%${wounds.length ? ' раны:[' + wounds.join(',') + ']' : ''}`);

      // L2: Адам ДУМАЕТ через LLM каждые 15 тиков
      if (this._tick % 15 === 0 && !this._adamEngine) {
        this._adamEngine = new AdamEngine();
      }
      if (this._tick % 15 === 0 && this._adamEngine) {
        this._adamEngine.coordinate({
          active: active.length,
          idle: idle.length,
          returning: returning.length,
          avgBat: Math.round(avgBat),
          wounds,
          findings: this._oikonomia.prosforai.length,
          completed: this.completedMissions.length,
        }).then(result => {
          if (result.answer && result.answer !== '?') {
            this._log(null, 'Адам', `L2:LLM [${result.time_ms}мс] ${result.answer}`);
          }
        }).catch(() => {});
      }
    }

    // ── CLAUDE: стратегия каждые 30 тиков ──────────────
    if (this._tick % 30 === 0 && this._tick > 0) {
      const completed = this.completedMissions.length;
      const findings = this._oikonomia.prosforai.length;
      const revenue = this._oikonomia.koinon;
      this._log(null, 'Claude', `стратегия: ${completed} выполнено, ${findings} находок, ${Math.round(revenue)}₽${this._giftEngine ? ' граф:подключён' : ' граф:нет'}`);
    }

    // ── ПОЛЁТНЫЕ ПЛАНЫ: waypoint navigation ─────────────────
    for (const [, drone] of this.drones) {
      if (!drone._flightPlan || drone._flightPlan.done) continue;
      if (drone.status === 'sabbath') continue;

      const plan = drone._flightPlan;
      const phys = drone._phys;
      const windFactor = phys.windFactor || 1.0;
      // Скорость набора/снижения высоты (м/тик)
      const climbRateM = (phys.climbRateMs || 3) * SIM.SEC_PER_TICK;

      // ── РЕТРАНСЛЯТОР (fixed_wing): орбита над зоной ───────
      if (phys.role === 'relay') {
        drone.status = 'mission';
        // Орбита над центром зоны (или homeBase)
        const center = this._homeBase || { x: 500, y: 280 };
        const orbitR = phys.orbitRadius || 100;
        drone._orbitAngle = ((drone._orbitAngle || 0) + phys.turnDegTick * Math.PI / 180) % (Math.PI * 2);
        const orbitX = center.x + Math.cos(drone._orbitAngle) * orbitR;
        const orbitY = center.y + Math.sin(drone._orbitAngle) * orbitR;
        drone.updatePhysics(orbitX, orbitY);
        drone.x += drone.vx + this.wind.x * windFactor;
        drone.y += drone.vy + this.wind.y * windFactor;
        drone.x = Math.max(drone.bounds.minX, Math.min(drone.bounds.maxX, drone.x));
        drone.y = Math.max(drone.bounds.minY, Math.min(drone.bounds.maxY, drone.y));
        // Набор высоты
        drone.altitudeM = Math.min(plan.targetAlt, drone.altitudeM + climbRateM);
        drone.battery -= drone.computeBatteryDrain();
        drone.trailHistory.push({ x: drone.x, y: drone.y, type: 'relay', timestamp: Date.now() });
        if (this._tick % 10 === 0) {
          this._log(drone, 'Серафим', `ретрансл: орбита R=${orbitR}px H=${Math.round(drone.altitudeM)}м`);
        }
        // Relay: расширяет commRange соседних дронов
        if (phys.relayBoost && phys.relayBoost > 1) {
          for (const [, other] of this.drones) {
            if (other.id === drone.id) continue;
            const ddx = other.x - drone.x, ddy = other.y - drone.y;
            const d = Math.sqrt(ddx*ddx + ddy*ddy);
            if (d < drone.commRange * 2) {
              other._relayBoosted = true; // флаг: этот тик дрон под покрытием ретранслятора
            }
          }
        }
        if (drone.battery < drone.genome.sabbathThreshold) {
          drone.status = 'returning';
          this._log(drone, 'Серафим', `⚡ ретранслятор → возврат (батарея ${Math.round(drone.battery)}%)`);
        }
        continue;
      }

      // ── ФАЗА: ВЗЛЁТ (climbing) ────────────────────────────
      if (plan.phase === 'climbing') {
        drone.status = 'mission';
        drone.altitudeM = Math.min(plan.targetAlt, drone.altitudeM + climbRateM);
        drone.battery -= drone.computeBatteryDrain();
        if (drone.altitudeM >= plan.targetAlt - 1) {
          plan.phase = 'executing';
          this._log(drone, 'Серафим', `↑ набрал ${Math.round(drone.altitudeM)}м → начинаю маршрут WP${plan.idx}/${plan.waypoints.length}`);
        }
        continue;
      }

      const wp = plan.waypoints[plan.idx];
      if (!wp) {
        plan.done = true;
        plan.phase = 'landing';
        drone.status = 'returning';
        continue;
      }

      // Движение к текущему waypoint
      const dx = wp.x - drone.x;
      const dy = wp.y - drone.y;
      const dist = Math.sqrt(dx*dx + dy*dy);

      if (dist > drone.cruiseSpeedPx * 0.5) {
        // Летим к waypoint
        drone.status = 'mission';
        drone.updatePhysics(wp.x, wp.y);
        drone.x += drone.vx + this.wind.x * windFactor;
        drone.y += drone.vy + this.wind.y * windFactor;
        drone.x = Math.max(drone.bounds.minX, Math.min(drone.bounds.maxX, drone.x));
        drone.y = Math.max(drone.bounds.minY, Math.min(drone.bounds.maxY, drone.y));
        drone.battery -= drone.computeBatteryDrain();
        drone.trailHistory.push({ x: drone.x, y: drone.y, type: 'flight', timestamp: Date.now() });
      } else {
        // Достигли waypoint — сохранить прогресс
        plan._savedIdx = plan.idx;
        plan.idx++;
        drone.giftsGiven++;
        // Сгенерировать находку
        const finding = generateFinding('SURVEY', drone, { id: `wp-${plan.idx}`, type: 'SURVEY', targetX: wp.x, targetY: wp.y });
        this.recordProsfora(finding);
        const resp = drone.serafim.execute('цель');
        this._log(drone, 'Серафим', `WP[${plan.idx}/${plan.waypoints.length}] H${Math.round(drone.altitudeM)}м→[${resp}] ${finding.product}`);

        // Все waypoints пройдены → посадка и возврат
        if (plan.idx >= plan.waypoints.length) {
          plan.done = true;
          plan.phase = 'landing';
          drone.status = 'returning';
          this._log(drone, 'Серафим', `✓ Маршрут выполнен → посадка`);
        }
      }

      // Батарея критическая — сохранить прогресс и вернуться
      if (drone.battery < drone.genome.sabbathThreshold + 5) {
        plan._savedIdx = plan.idx; // запомнить текущий waypoint
        plan.phase = 'landing';
        drone.status = 'returning';
        this._log(drone, 'Серафим', `⚡ Батарея ${Math.round(drone.battery)}% — сохраняю WP${plan.idx} → возврат`);
      }
    }

    // ── МИССИИ ───────────────────────────────────────────
    for (const [, drone] of this.drones) {
      if (drone.status !== 'mission' || !drone.currentMission) continue;

      // Конвертоплан: обновить переход режима полёта
      if (drone.flightModes) {
        const transition = drone._updateFlightModeTransition();
        if (transition?.transitioned) {
          events.push({ type: 'flight_mode_changed', drone: drone.name, ...transition });
        }
      }

      const mission = this.missions.find(m => m.id === drone.currentMission);
      if (!mission) continue;

      // Текущая скорость с учётом груза и режима полёта
      const currentSpeed = drone.effectiveSpeed;

      // Движение к цели
      const goalX0 = mission.targetX - drone.x;
      const goalY0 = mission.targetY - drone.y;
      const dist = Math.sqrt(goalX0 * goalX0 + goalY0 * goalY0);

      // Конвертоплан: авто-переход vtol→cruise при дальних целях
      if (drone.flightModes && drone.currentFlightMode === 'vtol' && dist > 100 && drone._transitionTicks === 0) {
        drone.switchFlightMode('cruise');
        events.push({ type: 'auto_cruise', drone: drone.name, reason: `Дальняя цель (${Math.round(dist)} пикс)` });
      }
      // Конвертоплан: авто-переход cruise→vtol при приближении
      if (drone.flightModes && drone.currentFlightMode === 'cruise' && dist < 40 && drone._transitionTicks === 0) {
        drone.switchFlightMode('vtol');
        events.push({ type: 'auto_vtol', drone: drone.name, reason: 'Приближение к цели — переход на зависание' });
      }

      // COLLISION AVOIDANCE: вектор отталкивания
      let cavX = 0, cavY = 0;
      for (const other of droneList) {
        if (other.id === drone.id) continue;
        const dx = other.x - drone.x;
        const dy = other.y - drone.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < 25) { // Критически близко
          cavX -= (dx / d) * (25 - d) * 0.8;
          cavY -= (dy / d) * (25 - d) * 0.8;
          events.push({ type: 'collision_avoided', drones: [drone.name, other.name] });
        }
      }

      // _forcedTarget: оператор командовал лететь в направлении
      let effectiveTargetX = mission.targetX;
      let effectiveTargetY = mission.targetY;
      if (drone._forcedTarget && drone._forcedTarget.ticksLeft > 0) {
        effectiveTargetX = drone._forcedTarget.x;
        effectiveTargetY = drone._forcedTarget.y;
        drone._forcedTarget.ticksLeft--;
        if (drone._forcedTarget.ticksLeft === 0) drone._forcedTarget = null;
      }

      // Пересчитать dist/goal с новой целью
      const goalX = effectiveTargetX - drone.x;
      const goalY = effectiveTargetY - drone.y;
      const effDist = Math.sqrt(goalX * goalX + goalY * goalY);

      if (dist > currentSpeed || effDist > currentSpeed) {
        // ── Физика движения ─────────────────────────────────
        if (drone.isGround) {
          // Наземный робот: движение по осям (симуляция дорог)
          if (Math.abs(goalX0) > Math.abs(goalY0)) {
            drone.x += Math.sign(goalX0) * currentSpeed + cavX;
          } else {
            drone.y += Math.sign(goalY0) * currentSpeed + cavY;
          }
        } else {
          // Воздушный: инерция + угловая скорость класса
          const windFactor = drone._phys.windFactor || 1.0;
          drone.updatePhysics(effectiveTargetX, effectiveTargetY);
          drone.x += drone.vx + cavX + this.wind.x * windFactor;
          drone.y += drone.vy + cavY + this.wind.y * windFactor;
          // Жёсткий clamp к bounds полигона
          const b = drone.bounds;
          drone.x = Math.max(b.minX, Math.min(b.maxX, drone.x));
          drone.y = Math.max(b.minY, Math.min(b.maxY, drone.y));
        }

        // Физический расход батареи (Вт × ч модель)
        drone.battery -= drone.computeBatteryDrain();

        // Стигмергия: оставить след
        drone.trailHistory.push({
          x: drone.x, y: drone.y,
          type: drone.isGround ? 'ground_track' : 'flight', timestamp: Date.now(),
        });
      } else {
        // Прибыл — выполнение
        const type = MISSION_TYPES[mission.type] || MISSION_TYPES.SURVEY;

        // Чем ниже высота — тем ценнее данные
        const missionAlt = type.altitude || 200;
        drone.altitude = Math.min(missionAlt, drone.maxAltitude);

        // Генерация КОНКРЕТНОЙ находки (не число — содержание)
        const finding = generateFinding(mission.type, drone, mission);
        const surplus = (finding.layer === 'gratia') ? type.defaultSurplus * 3
          : (finding.layer === 'bonum') ? type.defaultSurplus * 1.8
          : type.defaultSurplus * altitudeSurplusMultiplier(drone.altitude);

        let graceEvent = null;
        if (finding.layer === 'gratia') {
          graceEvent = {
            droneId: drone.id,
            missionId: mission.id,
            description: finding.content,
            product: finding.product,
            value: finding.value,
            at: finding.at,
          };
          this._graceHistory.push(graceEvent);
        }

        // Риск: миссия провалилась?
        if (Math.random() < type.risk) {
          mission.status = 'failed';
          drone.battery -= 10;
          this.organism.immune.detectDanger({ type: 'mission_failed', droneId: drone.id, missionId: mission.id });
          events.push({ type: 'mission_failed', drone: drone.name, mission: mission.id, reason: 'Помеха / РЭБ / погода' });
        } else {
          mission.status = 'completed';
          mission.surplus = surplus;
          mission.finding = finding;

          // Oikonomia: находка → prosfora → koinon
          this.recordProsfora(finding);
          mission.result = {
            completedBy: drone.name,
            surplus,
            finding: finding.content,
            product: finding.product,
            layer: finding.layer,
            value: Math.round(finding.value),
            altitude: drone.altitude,
            graceEvent: !!graceEvent,
          };
          this.completedMissions.push(mission);

          // Благодарность: все дроны в радиусе получают данные
          for (const [otherId, other] of this.drones) {
            if (otherId !== drone.id && drone.inCommRange(other)) {
              this.gratitudeEdges.push({
                from: otherId, to: drone.id,
                missionId: mission.id,
              });
              other.giftsReceived++;
              other.battery += 1; // Получение данных = +1 energy
            }
          }

          events.push({
            type: graceEvent ? 'grace_event' : 'mission_completed',
            drone: drone.name,
            mission: mission.id,
            surplus,
            finding: finding.content,
            product: finding.product,
            layer: finding.layer,
            value: Math.round(finding.value),
            altitude: drone.altitude,
          });
        }

        // Возврат
        drone.status = drone.battery < 20 ? 'sabbath' : 'idle';
        drone.currentMission = null;

        // Стигмергия
        drone.trailHistory.push({
          x: drone.x, y: drone.y,
          type: mission.status, timestamp: Date.now(),
        });
      }
    }

    // Подзарядка (sabbath) + ОБУЧЕНИЕ
    // О.Сергий: суббота = не просто отдых, а созерцание + осмысление
    for (const [, drone] of this.drones) {
      if (drone.status === 'sabbath') {
        drone.battery = Math.min(drone.maxBattery, drone.battery + 5);

        // ОБУЧЕНИЕ в субботе: дрон «размышляет» о gift score
        const learning = drone.learn(this.gratitudeEdges, droneList);
        if (learning.score > 0) {
          events.push({
            type: 'learning',
            drone: drone.name,
            score: Math.round(learning.score * 100) / 100,
            generation: learning.generation,
          });
        }

        // СОЦИАЛЬНОЕ ОБУЧЕНИЕ: учись у лучшего соседа
        if (drone._generation % 10 === 0) {
          let bestNeighbor = null;
          let bestNeighborScore = 0;
          for (const other of droneList) {
            if (other.id === drone.id) continue;
            if (drone.distanceTo(other) <= drone.commRange) {
              const otherScore = other.getGiftScore(this.gratitudeEdges, droneList);
              if (otherScore > bestNeighborScore) {
                bestNeighborScore = otherScore;
                bestNeighbor = other;
              }
            }
          }
          if (bestNeighbor && bestNeighborScore > drone._bestScore) {
            drone.learnFromNeighbor(bestNeighbor);
            events.push({
              type: 'social_learning',
              drone: drone.name,
              teacher: bestNeighbor.name,
              param: 'copied strategy from better neighbor',
            });
          }
        }

        if (drone.battery >= 80) {
          drone.status = 'idle';
          events.push({ type: 'sabbath_complete', drone: drone.name, battery: drone.battery });
        }
      }
    }

    // Использовать genome.sabbathThreshold вместо hardcoded 20
    for (const [, drone] of this.drones) {
      if (drone.status === 'idle' && drone.battery < drone.genome.sabbathThreshold) {
        drone.status = 'sabbath';
        events.push({ type: 'sabbath_entered', drone: drone.name, battery: drone.battery, threshold: drone.genome.sabbathThreshold });
      }

      // Immune: danger signal при критически низкой батарее
      if (drone.battery < 10) {
        const dangerResult = this.organism.immune.detectDanger({
          type: 'cell_exhausted',
          droneId: drone.id,
          battery: drone.battery,
        });
        if (dangerResult.level >= 3) {
          events.push({ type: 'immune_response', response: dangerResult });
        }
      }
    }

    // ── Иммунная система: clonal selection (каждые 50 тиков) ──
    if (this._tick % 50 === 0 && droneList.length >= 2) {
      const agentsForClonal = droneList.map(d => ({
        id: d.id,
        giftScore: d.getGiftScore(this.gratitudeEdges, droneList),
        genome: { ...d.genome },
      }));
      const clones = this.organism.immune.clonalSelection(agentsForClonal);
      if (clones.length > 0) {
        events.push({ type: 'clonal_selection', clones });
      }
    }

    // ── EnergyGift: маркетплейс энергии (ИНЭСИС) ─────────
    const energyEvents = this.energyGift.processTick();
    events.push(...energyEvents);

    // Обновить здоровье организма
    this.organism.checkHealth();

    return events;
  }

  // ── Различение: ложная цель? ──────────────────────────

  _isTemptation(mission) {
    // 10% миссий — ложные цели (помехи)
    return Math.random() < 0.1;
  }

  // ═══════════════════════════════════════════════════════════════
  // РЕФЛЕКСИВНОЕ УПРАВЛЕНИЕ (Лефевр)
  //
  // Дрон управляет соседом НЕ приказом, а передачей оснований
  // для решения. «Я дарю не результат, а ОСНОВАНИЕ для решения.»
  //
  // Рефлексия = моделирование того, как другой моделирует тебя.
  // Дрон A думает: «что B думает, что я сделаю?»
  // И действует, учитывая модель B.
  //
  // Для роя: координация БЕЗ центра, БЕЗ прямой связи.
  // Каждый дрон «дарит» своё намерение через среду (стигмергия).
  // ═══════════════════════════════════════════════════════════════

  /**
   * Рефлексивное назначение: дрон выбирает миссию,
   * учитывая что сделают СОСЕДИ.
   *
   * Алгоритм:
   * 1. Для каждой миссии — оценить свой score
   * 2. Оценить score СОСЕДЕЙ для той же миссии
   * 3. Если сосед ближе/лучше — уступить (кеносис!)
   * 4. Взять миссию, которую НИКТО другой не возьмёт
   *
   * Это не жадный алгоритм. Это дарение через рефлексию.
   */
  reflexiveAssign() {
    const unassigned = this.missions.filter(m => m.status === 'offered');
    const results = [];

    for (const mission of unassigned) {
      const type = MISSION_TYPES[mission.type] || MISSION_TYPES.SURVEY;
      const candidates = [];

      // Собрать всех кандидатов с их score
      for (const [, drone] of this.drones) {
        const check = drone.canAcceptMission(mission);
        if (!check.can) continue;

        const distance = Math.sqrt(
          (drone.x - mission.targetX) ** 2 + (drone.y - mission.targetY) ** 2
        );
        const score = drone.battery - (distance / drone.speed) * 2 - type.risk * 50;
        candidates.push({ drone, score, distance });
      }

      if (candidates.length === 0) continue;

      // Различение
      if (this._isTemptation(mission)) {
        mission.status = 'declined';
        this._temptations.push({
          missionId: mission.id, reason: 'Ложная цель',
          at: new Date().toISOString(),
        });
        results.push({ mission: mission.id, action: 'temptation_avoided' });
        continue;
      }

      candidates.sort((a, b) => b.score - a.score);

      // РЕФЛЕКСИЯ: лучший кандидат проверяет — может, он нужнее в другом месте?
      const best = candidates[0];
      const second = candidates[1];

      // Если разница score < 20% — лучший УСТУПАЕТ (кеносис)
      // потому что его батарея нужнее для будущих сложных миссий
      let chosen = best;
      if (second && (best.score - second.score) / best.score < 0.2) {
        // Рефлексия: «B справится почти так же. Я сохраню заряд
        // для миссии, которую только я смогу выполнить.»
        if (best.drone.battery > second.drone.battery + 15) {
          chosen = second; // Уступить — кеносис через рефлексию
          results.push({
            mission: mission.id,
            drone: best.drone.name,
            action: 'reflexive_yield',
            reason: `Уступил ${second.drone.name} — сохраняю заряд для будущего`,
          });
        }
      }

      // Назначить
      mission.status = 'accepted';
      mission.assignedDrone = chosen.drone.id;
      chosen.drone.status = 'mission';
      chosen.drone.currentMission = mission.id;
      chosen.drone.battery -= type.kenosisCost;
      chosen.drone.giftsGiven++;

      results.push({
        mission: mission.id,
        drone: chosen.drone.name,
        action: 'accepted',
        battery: chosen.drone.battery,
        reflexive: chosen !== best,
      });
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  // ТРИЗ-ИДЕАЛЬНОСТЬ
  //
  // «Идеальная система — которой НЕТ, но функция выполняется.»
  //
  // Для роя: идеальное управление = нет управления,
  // но рой координирован.
  //
  // Метрика идеальности:
  //   I = (выполненные миссии) / (затраченная энергия + сложность управления)
  //
  // Чем ближе к идеалу — тем меньше энергии на координацию,
  // тем больше миссий выполнено.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Метрика ТРИЗ-идеальности роя.
   */
  getIdeality() {
    const completed = this.completedMissions.length;
    const failed = this.missions.filter(m => m.status === 'failed').length;
    const declined = this.missions.filter(m => m.status === 'declined').length;
    const temptationsAvoided = this._temptations.length;

    // Полезная функция
    const useful = completed + temptationsAvoided; // Различение тоже полезно

    // Затраты
    const totalKenosis = this.completedMissions.reduce((s, m) => {
      const type = MISSION_TYPES[m.type] || MISSION_TYPES.SURVEY;
      return s + type.kenosisCost;
    }, 0);
    const totalBattery = [...this.drones.values()].reduce((s, d) => s + (100 - d.battery), 0);

    // Вредное
    const harmful = failed + (totalBattery * 0.01); // Потеря энергии = вред

    // Идеальность = полезное / (вредное + затраты)
    const ideality = (harmful + totalKenosis) > 0
      ? useful / (harmful + totalKenosis * 0.01)
      : 0;

    // Surplus роя = сколько нового знания создал рой сверх задания
    const totalSurplus = this.completedMissions.reduce((s, m) => s + (m.surplus || 1), 0);
    const avgSurplus = completed > 0 ? totalSurplus / completed : 0;

    return {
      ideality: Math.round(ideality * 100) / 100,
      useful,
      harmful: Math.round(harmful * 100) / 100,
      totalKenosis,
      avgSurplus: Math.round(avgSurplus * 100) / 100,
      interpretation: ideality > 5
        ? 'Близко к идеалу — минимум затрат, максимум функции'
        : ideality > 2
          ? 'Хорошо — но есть резерв оптимизации'
          : ideality > 1
            ? 'Работает — но затраты высоки'
            : 'Далеко от идеала — нужна перестройка',
      triz: {
        principle: 'Идеальная система — которой НЕТ, но функция выполняется',
        current: `${completed} миссий за ${totalKenosis} энергии`,
        ideal: `${completed} миссий за 0 энергии (недостижимо, но направление)`,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ТРИЗ: РАЗРЕШЕНИЕ ПРОТИВОРЕЧИЙ ЧЕРЕЗ SURPLUS
  //
  // Классическое противоречие роя:
  //   «Дрон должен быть БЛИЗКО к цели (быстрое выполнение)
  //    И ДАЛЕКО от цели (экономия батареи)»
  //
  // ТРИЗ-решение: разделение во времени.
  // НАШ ответ: surplus. Дар создаёт больше, чем потрачено.
  // Не компромисс (ближе/дальше) — а преображение (surplus > 1).
  // ═══════════════════════════════════════════════════════════════

  /**
   * Найти и описать противоречия в текущем состоянии роя.
   */
  getContradictions() {
    const droneList = [...this.drones.values()];
    const contradictions = [];

    // 1. Батарея vs миссия
    for (const drone of droneList) {
      if (drone.status === 'idle' && drone.battery < 40) {
        contradictions.push({
          drone: drone.name,
          type: 'battery_vs_mission',
          description: `${drone.name}: батарея ${drone.battery}%, есть миссии — но рискованно`,
          trizResolution: 'Разделение во времени: sabbath → восстановление → миссия',
          giftResolution: 'Surplus: если миссия даёт > чем тратит — идти',
        });
      }
    }

    // 2. Связность vs покрытие
    const density = this.getDensity();
    const perc = this.getPercolation();
    if (density < 0.5 && droneList.length > 3) {
      contradictions.push({
        type: 'connectivity_vs_coverage',
        description: `Рой разрозненный (density ${density.toFixed(2)}), но нужно покрыть большую территорию`,
        trizResolution: 'Разделение в пространстве: relay-дроны как мосты',
        giftResolution: 'Перихоресис: замкнутые циклы связи (A↔B↔C↔A) вместо линейной цепи',
      });
    }

    // 3. Скорость vs безопасность
    const inMission = droneList.filter(d => d.status === 'mission');
    if (inMission.length > droneList.length * 0.7) {
      contradictions.push({
        type: 'speed_vs_safety',
        description: `${inMission.length}/${droneList.length} на миссиях — нет резерва`,
        trizResolution: 'Принцип запаса: всегда держать 30% в idle',
        giftResolution: 'Суббота: принудительный отдых 1 из N = устойчивость роя',
      });
    }

    return contradictions;
  }

  // ── Стигмергия: состояние среды ────────────────────────

  getDensity() {
    const n = this.drones.size;
    if (n < 2) return 0;

    let connected = 0;
    const droneList = [...this.drones.values()];
    for (let i = 0; i < droneList.length; i++) {
      for (let j = i + 1; j < droneList.length; j++) {
        if (droneList[i].inCommRange(droneList[j])) connected++;
      }
    }

    return connected / (n * (n - 1) / 2);
  }

  getPercolation() {
    // BFS: найти размер наибольшей связной компоненты
    const droneList = [...this.drones.values()];
    const visited = new Set();
    let maxComponent = 0;

    for (const drone of droneList) {
      if (visited.has(drone.id)) continue;
      const component = [];
      const queue = [drone];
      while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        component.push(current);
        for (const other of droneList) {
          if (!visited.has(other.id) && current.inCommRange(other)) {
            queue.push(other);
          }
        }
      }
      maxComponent = Math.max(maxComponent, component.length);
    }

    const phi = droneList.length > 0 ? maxComponent / droneList.length : 0;
    return {
      phi,
      maxComponent,
      total: droneList.length,
      phase: phi > 0.9 ? 'unified' : phi > 0.5 ? 'forming' : phi > 0.2 ? 'scattered' : 'isolated',
    };
  }

  // ── Incalculable ───────────────────────────────────────

  recordIncalculable(description) {
    this.incalculable.push({
      id: `inc-swarm-${Date.now()}`,
      description,
      tick: this._tick,
      at: new Date().toISOString(),
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // AGRICULTURE — РоботАгро
  //
  // Дрон дарит полю обработку: NDVI-скан, опрыскивание,
  // оценка урожайности, карта влажности.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Создать агро-миссию.
   * @param {Object} opts - { subType, fieldSize, cropType, targetX, targetY }
   *   subType: NDVI_SCAN | SPRAY | HARVEST_COUNT | SOIL_MOISTURE
   */
  createAgricultureMission(opts = {}) {
    const subTypes = MISSION_TYPES.AGRICULTURE.subTypes;
    const subType = opts.subType && subTypes.includes(opts.subType)
      ? opts.subType
      : subTypes[Math.floor(Math.random() * subTypes.length)];

    const telosMap = {
      NDVI_SCAN: 'Мониторинг вегетационного индекса',
      SPRAY: 'Прецизионное опрыскивание',
      HARVEST_COUNT: 'Оценка урожайности с воздуха',
      SOIL_MOISTURE: 'Картирование влажности почвы',
    };

    const mission = this.createMission({
      type: 'AGRICULTURE',
      telos: telosMap[subType],
      targetX: opts.targetX ?? Math.random() * this.fieldSize,
      targetY: opts.targetY ?? Math.random() * this.fieldSize,
    });

    // Доп. поля для агро
    mission.subType = subType;
    mission.fieldSizeHa = opts.fieldSize || Math.round(10 + Math.random() * 500);
    mission.cropType = opts.cropType || null; // null = рандом в generateFinding

    logger.info(`[Swarm:Agro] Миссия ${subType}: ${mission.fieldSizeHa} га, культура: ${mission.cropType || 'авто'}`);
    return mission;
  }

  // ═══════════════════════════════════════════════════════════════
  // MEDICAL_EMERGENCY — ДронМед
  //
  // Максимальный приоритет в Gift graph.
  // Дрон-медик обходит все очереди.
  // Другие дроны «дарят» дорогу (рефлексивное управление Лефевра).
  //
  // Countdown timer: каждая минута сверх maxDeliveryMinutes = штраф.
  // Emergency corridor: соседи уступают маршрут.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Создать экстренную медицинскую миссию.
   * @param {Object} opts - { subType, urgency, payloadType, location, targetX, targetY }
   */
  createMedicalMission(opts = {}) {
    const subTypes = MISSION_TYPES.MEDICAL_EMERGENCY.subTypes;
    const subType = opts.subType && subTypes.includes(opts.subType)
      ? opts.subType
      : subTypes[Math.floor(Math.random() * subTypes.length)];

    const telosMap = {
      DEFIBRILLATOR: 'Экстренная доставка дефибриллятора',
      BLOOD_DELIVERY: 'Доставка крови / плазмы',
      MEDICINE: 'Доставка медикаментов',
      ORGAN_TRANSPORT: 'Транспортировка органа для трансплантации',
    };

    const mission = this.createMission({
      type: 'MEDICAL_EMERGENCY',
      telos: telosMap[subType],
      targetX: opts.targetX ?? (opts.location?.x || Math.random() * this.fieldSize),
      targetY: opts.targetY ?? (opts.location?.y || Math.random() * this.fieldSize),
    });

    mission.subType = subType;
    mission.urgency = opts.urgency || 'critical';
    mission.payloadType = opts.payloadType || null;
    mission.countdownStart = Date.now();
    mission.maxDeliveryMs = (MISSION_TYPES.MEDICAL_EMERGENCY.maxDeliveryMinutes || 15) * 60 * 1000;
    mission.penaltyPerMinute = 10000; // ₽ штраф за каждую лишнюю минуту

    logger.info(`[Swarm:Med] ЭКСТРЕННАЯ миссия ${subType}, срочность: ${mission.urgency}`);
    return mission;
  }

  /**
   * Экстренное назначение медицинской миссии.
   * КРИТИЧЕСКИЙ приоритет: обходит очередь, вытесняет обычные миссии.
   * Другие дроны «дарят дорогу» — рефлексивное управление Лефевра.
   */
  assignMedicalEmergency(mission) {
    if (!mission || mission.type !== 'MEDICAL_EMERGENCY') return null;

    const droneList = [...this.drones.values()];
    let bestDrone = null;
    let bestETA = Infinity;

    for (const drone of droneList) {
      // Мед-миссия игнорирует обычные ограничения — только батарея критична
      if (drone.battery < 15) continue;
      if (drone.status === 'sabbath') continue;

      const dist = Math.sqrt(
        (drone.x - mission.targetX) ** 2 + (drone.y - mission.targetY) ** 2
      );
      const eta = dist / drone.speed;

      if (eta < bestETA) {
        bestETA = eta;
        bestDrone = drone;
      }
    }

    if (!bestDrone) return { error: 'Нет доступных дронов для экстренной миссии' };

    // Если дрон был на обычной миссии — прерываем её (кеносис через жертву текущей задачи)
    const yieldedMissions = [];
    if (bestDrone.status === 'mission' && bestDrone.currentMission) {
      const oldMission = this.missions.find(m => m.id === bestDrone.currentMission);
      if (oldMission) {
        oldMission.status = 'offered'; // Вернуть в очередь
        oldMission.assignedDrone = null;
        yieldedMissions.push(oldMission.id);
      }
    }

    // Emergency corridor: все дроны на пути «дарят дорогу»
    const corridorWidth = 50;
    const corridorDrones = [];
    for (const drone of droneList) {
      if (drone.id === bestDrone.id) continue;
      if (drone.status === 'sabbath') continue;

      // Проверить, находится ли дрон на пути медика → цель
      const dx = mission.targetX - bestDrone.x;
      const dy = mission.targetY - bestDrone.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      // Проекция дрона на вектор маршрута
      const t = Math.max(0, Math.min(1,
        ((drone.x - bestDrone.x) * dx + (drone.y - bestDrone.y) * dy) / (len * len)
      ));
      const projX = bestDrone.x + t * dx;
      const projY = bestDrone.y + t * dy;
      const distToPath = Math.sqrt((drone.x - projX) ** 2 + (drone.y - projY) ** 2);

      if (distToPath < corridorWidth) {
        // Рефлексивное управление Лефевра: дрон «дарит» дорогу
        // Он отходит перпендикулярно маршруту
        const perpX = -(dy / len) * corridorWidth;
        const perpY = (dx / len) * corridorWidth;
        const sign = ((drone.x - projX) * perpX + (drone.y - projY) * perpY) > 0 ? 1 : -1;
        drone.x += perpX * sign * 0.5;
        drone.y += perpY * sign * 0.5;

        // Bounds
        drone.x = Math.max(drone.bounds.minX, Math.min(drone.bounds.maxX, drone.x));
        drone.y = Math.max(drone.bounds.minY, Math.min(drone.bounds.maxY, drone.y));

        corridorDrones.push({ id: drone.id, name: drone.name, action: 'yielded_path' });
      }
    }

    // Назначить
    mission.status = 'accepted';
    mission.assignedDrone = bestDrone.id;
    bestDrone.status = 'mission';
    bestDrone.currentMission = mission.id;
    bestDrone.battery -= MISSION_TYPES.MEDICAL_EMERGENCY.kenosisCost;
    bestDrone.giftsGiven++;

    return {
      assigned: bestDrone.name,
      droneId: bestDrone.id,
      estimatedTicks: Math.ceil(bestETA),
      corridorCleared: corridorDrones.length,
      corridorDrones,
      yieldedMissions,
      countdown: {
        startedAt: mission.countdownStart,
        maxMs: mission.maxDeliveryMs,
        penaltyPerMinute: mission.penaltyPerMinute,
      },
    };
  }

  /**
   * Проверить таймер медицинской миссии (вызывается каждый тик).
   */
  checkMedicalCountdown(mission) {
    if (!mission || mission.type !== 'MEDICAL_EMERGENCY') return null;
    if (mission.status !== 'accepted') return null;

    const elapsed = Date.now() - mission.countdownStart;
    const overdue = elapsed - mission.maxDeliveryMs;

    if (overdue > 0) {
      const overdueMinutes = Math.ceil(overdue / 60000);
      const penalty = overdueMinutes * mission.penaltyPerMinute;
      return {
        missionId: mission.id,
        overdue: true,
        overdueMinutes,
        penalty,
        elapsedMs: elapsed,
        status: overdueMinutes > 5 ? 'CRITICAL_DELAY' : 'DELAYED',
      };
    }

    return {
      missionId: mission.id,
      overdue: false,
      remainingMs: mission.maxDeliveryMs - elapsed,
      elapsedMs: elapsed,
      status: 'ON_TIME',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // LOGISTICS — АэроЛогистик
  //
  // Дроны дарят доставку (gift = delivery completed).
  // LogisticsPlanner: маршруты, вес → расход, погода.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Создать логистическую миссию.
   * @param {Object} opts - { subType, deliveryPoints, cargoWeight, weatherFactor, targetX, targetY }
   */
  createLogisticsMission(opts = {}) {
    const subTypes = MISSION_TYPES.LOGISTICS.subTypes;
    const subType = opts.subType && subTypes.includes(opts.subType)
      ? opts.subType
      : subTypes[Math.floor(Math.random() * subTypes.length)];

    const telosMap = {
      CARGO_DELIVERY: 'Доставка груза',
      SUPPLY_CHAIN: 'Цепочка поставок',
      LAST_MILE: 'Последняя миля',
      ARCTIC_SUPPLY: 'Арктическое снабжение',
    };

    // Если есть delivery points — первая точка = target
    const firstPoint = opts.deliveryPoints?.[0];
    const mission = this.createMission({
      type: 'LOGISTICS',
      telos: telosMap[subType],
      targetX: opts.targetX ?? firstPoint?.x ?? Math.random() * this.fieldSize,
      targetY: opts.targetY ?? firstPoint?.y ?? Math.random() * this.fieldSize,
    });

    mission.subType = subType;
    mission.cargoWeight = opts.cargoWeight || Math.round(1 + Math.random() * 20);
    mission.deliveryPoints = opts.deliveryPoints || [];
    mission.weatherFactor = opts.weatherFactor ?? 1.0;

    // Payload model: вес → расход батареи → уменьшение дальности
    mission.payloadDrainMultiplier = LogisticsPlanner.calcPayloadDrain(mission.cargoWeight);

    logger.info(`[Swarm:Logistics] Миссия ${subType}: ${mission.cargoWeight} кг, ${mission.deliveryPoints.length} точек, погода x${mission.weatherFactor}`);
    return mission;
  }

  /**
   * План логистической миссии: маршрут + оценка + погода.
   */
  planLogistics(opts = {}) {
    const { deliveryPoints = [], cargoWeight = 5, weather = {}, droneClass } = opts;

    const spec = DRONE_CLASSES[droneClass] || DRONE_CLASSES.heavy_lift;
    const rangeInfo = LogisticsPlanner.calcEffectiveRange(spec, cargoWeight);
    const weatherInfo = LogisticsPlanner.calcWeatherFactor(weather);

    // Найти лучший дрон для задачи
    let bestDrone = null;
    let bestDist = Infinity;
    const firstPoint = deliveryPoints[0] || { x: 500, y: 280 };

    for (const [, drone] of this.drones) {
      if (drone.status !== 'idle') continue;
      const dSpec = DRONE_CLASSES[drone.droneClass] || DRONE_CLASSES.large_quad;
      if ((dSpec.maxPayload || 10) < cargoWeight) continue;
      const d = Math.sqrt((drone.x - firstPoint.x) ** 2 + (drone.y - firstPoint.y) ** 2);
      if (d < bestDist) { bestDist = d; bestDrone = drone; }
    }

    const routeOptimization = LogisticsPlanner.optimizeRoute(
      deliveryPoints,
      bestDrone ? { x: bestDrone.x, y: bestDrone.y } : { x: 500, y: 280 },
      bestDrone?.speed || spec.speed
    );

    return {
      feasible: rangeInfo.canCarry && weatherInfo.safe,
      drone: bestDrone ? { id: bestDrone.id, name: bestDrone.name, class: bestDrone.droneClass } : null,
      route: routeOptimization,
      payload: {
        weight: cargoWeight,
        drainMultiplier: LogisticsPlanner.calcPayloadDrain(cargoWeight),
        ...rangeInfo,
      },
      weather: weatherInfo,
      estimate: {
        totalMinutes: Math.round(routeOptimization.estimatedMinutes / (weatherInfo.factor || 1)),
        batteryNeeded: Math.round(routeOptimization.totalDistance * 0.5 * LogisticsPlanner.calcPayloadDrain(cargoWeight)),
        deliveryPoints: deliveryPoints.length,
      },
    };
  }

  // ── Запуск симуляции ───────────────────────────────────

  start(intervalMs = 1000) {
    if (this._interval) return;
    this._running = true;
    this._interval = setInterval(() => {
      // Генерировать случайные миссии
      if (Math.random() < 0.3) {
        const types = Object.keys(MISSION_TYPES);
        this.createMission({ type: types[Math.floor(Math.random() * types.length)] });
      }

      // Назначить
      this.assignMissions();

      // Выполнить тик
      const events = this.executeTick();

      if (events.length > 0) {
        logger.info(`[Swarm] Tick ${this._tick}: ${events.length} events`);
      }
    }, intervalMs);

    logger.info(`[Swarm] Симуляция запущена (${intervalMs}ms)`);
  }

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    this._running = false;
  }

  /**
   * Сместить все активные дроны к цели (focus zone).
   * Вставляет промежуточный waypoint в текущий план каждого дрона.
   * @param {{ x: number, y: number, radius?: number }} params
   */
  focusZone({ x, y, radius = 80 } = {}) {
    let count = 0;
    for (const drone of this.drones.values()) {
      if (drone.status !== 'mission' && drone.status !== 'idle') continue;
      if (!drone._flightPlan || drone._flightPlan.done) continue;
      const plan = drone._flightPlan;
      // Вставить промежуточный WP перед текущим
      const inject = { x, y };
      plan.waypoints.splice(plan.idx, 0, inject);
      plan.fullPath.splice(plan.idx, 0, inject);
      count++;
    }
    this._log(null, 'Оператор', `КОМАНДА: фокус на (${Math.round(x)},${Math.round(y)}) — перестроено ${count} дронов`);
    return { focused: count, target: { x, y } };
  }

  /**
   * Перенаправить рой в сторону вектора (dx, dy).
   * Пересортирует оставшиеся waypoints каждого дрона так, чтобы
   * ближайшие к направлению шли первыми.
   * @param {{ dx: number, dy: number, ticks?: number }} bias
   */
  setDirectionBias({ dx = 0, dy = 0, ticks = 40 } = {}) {
    // Нормируем вектор направления
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ndx = dx / len, ndy = dy / len;
    const reach = 900; // px — далеко за горизонт, ограничится bounds

    // Целевой курс в градусах (0=восток, 90=юг, 180=запад, 270=север)
    const targetHeadingDeg = Math.atan2(ndy, ndx) * 180 / Math.PI;

    let count = 0;
    for (const drone of this.drones.values()) {
      if (drone.status === 'sabbath') continue;

      // Активируем даже idle дронов — команда оператора запускает движение
      if (drone.status === 'idle') drone.status = 'mission';

      const b = drone.bounds;
      const tx = Math.max(b.minX, Math.min(b.maxX, drone.x + ndx * reach));
      const ty = Math.max(b.minY, Math.min(b.maxY, drone.y + ndy * reach));

      // Мгновенный разворот — команда оператора переопределяет инерцию
      drone.heading = targetHeadingDeg;
      const speed = drone.cruiseSpeedPx || drone._phys?.cruisePxTick || 8;
      drone.vx = ndx * speed;
      drone.vy = ndy * speed;

      if (drone._flightPlan && !drone._flightPlan.done) {
        // Дроны с lawnmower-планом: вставить waypoint перед носом
        const plan = drone._flightPlan;
        // Убрать предыдущие dir-waypoints чтобы не накапливались
        plan.waypoints = plan.waypoints.filter(w => !w._dir);
        plan.waypoints.splice(plan.idx, 0, { x: tx, y: ty, _dir: true });
      } else {
        // Дроны с point-mission: override цель на N тиков
        drone._forcedTarget = { x: tx, y: ty, ticksLeft: ticks };
      }

      count++;
    }

    // Попутный ветер для атмосферного эффекта (затухает)
    this._dirBias = { dx: ndx * 1.5, dy: ndy * 1.5, remaining: ticks };

    const dirName = ndy > 0.5 ? 'ЮГ' : ndy < -0.5 ? 'СЕВЕР' : ndx > 0.5 ? 'ВОСТОК' : ndx < -0.5 ? 'ЗАПАД' : 'ЦЕЛЬ';
    this._log(null, 'Оператор', `КОМАНДА: все на ${dirName} — перестроено ${count} дронов`);

    return { redirected: count, bias: { dx: ndx, dy: ndy }, ticks };
  }

  /**
   * Задать ветер как дар от оператора.
   * speedMs — реальная скорость ветра (м/с), будет нормирована в px/tick
   * dx, dy  — единичный вектор направления ветра
   */
  setWind({ speedMs = 0, dx = 0, dy = 0, direction = '' } = {}) {
    // 1 м/с ≈ 0.033 px/tick (SIM.M_PER_PX=30, SIM.SEC_PER_TICK=20 → scale = 20/30)
    const scale = SIM.SEC_PER_TICK / SIM.M_PER_PX;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ndx = dx / len, ndy = dy / len;
    const strength = speedMs * scale;
    this.wind.x = ndx * strength;
    this.wind.y = ndy * strength;
    this._windGift = { speedMs, dx: ndx, dy: ndy, direction, setAt: this._tick };

    const dirLabel = direction || (ndy > 0.5 ? 'ЮГ' : ndy < -0.5 ? 'СЕВЕР' : ndx > 0.5 ? 'ВОСТОК' : ndx < -0.5 ? 'ЗАПАД' : '');
    const msg = speedMs === 0
      ? `ДАР ДАННЫХ: ветер стих — ветер сброшен`
      : `ДАР ДАННЫХ: ветер ${Math.round(speedMs)} м/с ${dirLabel} — все дроны ощутят`;
    this._log(null, 'Оператор', msg);

    return { wind: { x: this.wind.x, y: this.wind.y }, speedMs, dirLabel };
  }

  // ── Полное состояние ───────────────────────────────────

  getState() {
    const droneList = [...this.drones.values()];
    const perc = this.getPercolation();

    return {
      tick: this._tick,
      region: this._regionName || null,
      bounds: this._regionBounds || null,
      drones: droneList.map(d => ({
        id: d.id, name: d.name,
        className: d.className || 'Квадро',
        droneClass: d.droneClass,
        x: Math.round(d.x), y: Math.round(d.y),
        altitude: Math.round(d.altitude),
        altitudeM: Math.round(d.altitudeM || d.altitude),
        battery: Math.round(d.battery),
        speed: Math.round(d.effectiveSpeed * 100) / 100,
        speedKmh: Math.round(d.speedPxTick * SIM.KMH_FACTOR * 10) / 10,
        heading: Math.round(d.heading),
        baseSpeed: d.baseSpeed,
        status: d.status,
        given: d.giftsGiven, received: d.giftsReceived, declined: d.giftsDeclined,
        giftScore: Math.round(d.getGiftScore(this.gratitudeEdges, droneList) * 100) / 100,
        generation: d._generation,
        genome: { ...d.genome },
        // Payload
        payload: { current: d.currentPayload, max: d.maxPayload },
        effectiveRange: Math.round(d.effectiveRange * 100) / 100,
        // Наземный робот
        isGround: d.isGround || false,
        groundGifts: d.groundGifts || null,
        // Конвертоплан
        flightMode: d.currentFlightMode || null,
        transitioning: d._transitionTicks > 0,
        // Полётный план
        flightPlanPhase: d._flightPlan?.phase || null,
        flightPlanIdx: d._flightPlan?.idx ?? null,
        flightPlanTotal: d._flightPlan?.waypoints?.length ?? null,
        flightPlanDone: d._flightPlan?.done || false,
        // Ближайшие waypoints (для визуализации маршрута)
        nextWaypoints: d._flightPlan && !d._flightPlan.done
          ? (d._flightPlan.waypoints.slice(d._flightPlan.idx, d._flightPlan.idx + 6)
              .map(w => ({ x: Math.round(w.x), y: Math.round(w.y) })))
          : null,
        // Ретранслятор
        isRelay: d._phys?.role === 'relay',
        relayBoosted: !!d._relayBoosted,
        // Инверсионный след (последние 25 точек)
        trail: (d.trailHistory || []).slice(-25).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      })),
      missions: {
        total: this.missions.length,
        completed: this.completedMissions.length,
        failed: this.missions.filter(m => m.status === 'failed').length,
        declined: this.missions.filter(m => m.status === 'declined').length,
        avgSurplus: this.completedMissions.length > 0
          ? Math.round(this.completedMissions.reduce((s, m) => s + (m.surplus || 1), 0) / this.completedMissions.length * 100) / 100
          : 0,
        totalValue: Math.round(this.completedMissions.reduce((s, m) => s + (m.result?.value || 0), 0)),
        recentFindings: this.completedMissions.slice(-5).map(m => ({
          drone: m.result?.completedBy,
          finding: m.result?.finding || m.finding?.content,
          product: m.result?.product || m.finding?.product,
          layer: m.result?.layer || m.finding?.layer,
          value: m.result?.value,
        })).reverse(),
      },
      swarm: {
        density: Math.round(this.getDensity() * 100) / 100,
        percolation: perc,
        gratitudeEdges: this.gratitudeEdges.length,
        graceEvents: this._graceHistory.length,
        temptationsAvoided: this._temptations.length,
        incalculable: this.incalculable.length,
      },
      oikonomia: this.getOikonomia(),
      organism: this.organism.getState(),
      energyGift: this.energyGift.getState(),
      // GPS-метаданные (если был передан при создании)
      gpsBbox: this._gpsBbox || null,
      gpsCenter: this._gpsCenter || null,
      wind: this._windGift ? { ...this._windGift } : { speedMs: 0, dx: 0, dy: 0, direction: '' },
      running: this._running,
    };
  }

  /**
   * Троичное состояние роя (Сетунь / TernaryCore).
   *
   * Каждый дрон → Tryte из 3 тритов:
   *   [0] battery:     < 20% = para, 20-60% = kata, > 60% = hyper
   *   [1] mission:     idle = kata, on_mission = hyper, sabbath = para
   *   [2] connectivity: isolated = para, connected = kata, in-cluster = hyper
   *
   * Фаза роя = TernaryALU.consensus() по всем logos-тритам.
   *
   * ── Перколяция и фазовый переход ─────────────────────────
   *
   * Nature Communications (2025) математически описывает перколяцию
   * коллективного интеллекта в роях как фазовый переход:
   *   p < p_c  → изолированные агенты (no cooperation)
   *   p ≥ p_c  → connected cluster emerges (cooperative intelligence)
   *
   * В нашей онтологии: p_c ≈ 0.7 (порог перихоресиса).
   * Это не богословская метафора — это измеримый феномен.
   * Связность W-матрицы > 0.7 → перихоресис дронов = единое тело.
   *
   * Источник: «A collective intelligence model for swarm robotics»
   *           Nature Communications, Jul 2025.
   */
  getTernarySwarmState() {
    const droneList = [...this.drones.values()];
    const droneTrytes = droneList.map(d => {
      // Battery trit
      const batteryTrit = new Trit(d.battery < 20 ? PARA : d.battery < 60 ? KATA : HYPER);

      // Mission status trit
      let missionTrit;
      if (d.status === 'sabbath' || d.status === 'resting') {
        missionTrit = new Trit(PARA);
      } else if (d.status === 'mission' || d.status === 'busy') {
        missionTrit = new Trit(HYPER);
      } else {
        missionTrit = new Trit(KATA); // idle
      }

      // Connectivity trit
      const neighbors = droneList.filter(other =>
        other.id !== d.id &&
        Math.hypot(other.x - d.x, other.y - d.y) < (d.commRange || 150)
      ).length;
      const connectivityTrit = new Trit(neighbors === 0 ? PARA : neighbors < 3 ? KATA : HYPER);

      const tryte = new Tryte(batteryTrit, missionTrit, connectivityTrit);
      return {
        id: d.id,
        name: d.name,
        tryte: tryte.toJSON(),
        repr: tryte.toString(),
      };
    });

    // Consensus over battery trits (first trit of each drone)
    const batteryTrits = droneTrytes.map(dt => new Trit(dt.tryte.logos.value));
    const consensus = TernaryALU.consensus(batteryTrits);

    // System health
    let totalHealth = 0;
    for (const dt of droneTrytes) {
      totalHealth += (dt.tryte.logos.value || 0) + (dt.tryte.energy.value || 0) + (dt.tryte.relation.value || 0);
    }
    const maxHealth = droneTrytes.length * 3;
    const normalized = maxHealth > 0 ? totalHealth / maxHealth : 0;

    let phase;
    if (normalized > 0.7) phase = 'theosis';
    else if (normalized > 0.3) phase = 'healing';
    else if (normalized > -0.3) phase = 'natural';
    else if (normalized > -0.7) phase = 'falling';
    else phase = 'collapsed';

    // Перколяция: доля дронов с ≥ 3 соседями (in-cluster = hyper connectivity)
    const clusterDrones = droneTrytes.filter(dt => dt.tryte.relation.value === HYPER).length;
    const percolationRatio = droneTrytes.length > 0 ? clusterDrones / droneTrytes.length : 0;
    const PERCOLATION_THRESHOLD = 0.7; // p_c ≈ 0.7, Nature Comm 2025
    const perichoresis = percolationRatio >= PERCOLATION_THRESHOLD;

    return {
      drones: droneTrytes,
      swarm: {
        consensus: consensus.toJSON(),
        health: totalHealth,
        maxHealth,
        normalized: Math.round(normalized * 100) / 100,
        phase,
        totalDrones: droneTrytes.length,
      },
      // Фазовый переход (percolation theory, Nature Comm 2025)
      percolation: {
        ratio: Math.round(percolationRatio * 100) / 100,
        threshold: PERCOLATION_THRESHOLD,
        active: perichoresis,
        // Богословие: перколяция = перихоресис. Рой стал единым телом.
        // «Как тело одно, но имеет многие члены» (1 Кор 12:12)
        label: perichoresis
          ? 'перихоресис — рой един (1 Кор 12:12)'
          : `фрагментация — ${Math.round((PERCOLATION_THRESHOLD - percolationRatio) * 100)}% до перихоресиса`,
      },
    };
  }
}

export { SwarmSimulator, Drone, Mission, MISSION_TYPES, DRONE_CLASSES, LogisticsPlanner };
export default SwarmSimulator;
