# Аудит: что есть под капотом SwarmChat

## Полный pipeline дара

```
1. ПОТРЕБНОСТЬ РОЕНИЯ → кто решает что нужно?
2. ПОСТАНОВКА ЗАДАЧИ → как задача превращается в мягкое сообщение?
3. ИСПОЛНЕНИЕ → человек делает / датчик записывает
4. ФИКСАЦИЯ ДАРА → куда записывается?
5. ВАЛИДАЦИЯ → кто проверяет что дар настоящий?
6. ИСПОЛЬЗОВАНИЕ → как данные попадают в SwarmBrain?
7. ЕВХАРИСТИЯ → когда начисляется SWARM?
8. АНАМНЕЗИС → как запоминается для будущего?
```

## Статус каждого шага

### 1. ПОТРЕБНОСТЬ — кто решает что нужно рою

| Компонент | Статус | Где |
|-----------|--------|-----|
| Голосование игроков (что нужно) | ⚠ UI есть, backend нет | SwarmGame.vue (фронт) |
| SwarmBrain auto-request (ИИ просит) | ❌ НЕТ | нужно: анализ gaps в данных |
| MicroTaskGenerator (список потребностей) | ✅ ЕСТЬ | SwarmChat.js (хардкод 10 needs) |
| Приоритизация по дефициту данных | ❌ НЕТ | нужно: FlightLog stats → gaps |
| Seasonal/weather потребности | ⚠ ЧАСТИЧНО | SoftChat.js (context.weather) |

**ВЫВОД: Потребности хардкожены. Нужен NeedsEngine который анализирует дефициты данных автоматически.**

### 2. ПОСТАНОВКА — задача → мягкое сообщение

| Компонент | Статус | Где |
|-----------|--------|-----|
| Жёсткие задачи (квесты) | ✅ ЕСТЬ | SwarmChat.js MicroTaskGenerator |
| Мягкие подсказки | ✅ ЕСТЬ | SoftChat.js (шаблоны, контекст) |
| Orchestrated serendipity | ✅ ЕСТЬ | SoftChat.js (nearbyPlayers) |
| Geo-aware подсказки | ⚠ ЧАСТИЧНО | context.nearbyPlayers, но нет geo API |
| Персонализация (учёт истории) | ⚠ ЧАСТИЧНО | player.messageCount, но нет анализа паттернов |

**ВЫВОД: Мягкий чат есть. Нет geo API и персонализации по паттернам.**

### 3. ИСПОЛНЕНИЕ — человек/датчик делают

| Компонент | Статус | Где |
|-----------|--------|-----|
| Голосовой ввод (Web Speech) | ✅ ЕСТЬ | SwarmChat.vue |
| Текстовый ввод | ✅ ЕСТЬ | SwarmChat.vue |
| Автоматический сбор (рекордер) | ✅ ЕСТЬ | swarm_recorder.v (Tang Nano) |
| Фото загрузка | ❌ НЕТ | нужно: upload endpoint |
| NLP парсинг отчётов | ⚠ ПРОСТОЙ | SoftChat._detectIntent (regex) |

**ВЫВОД: Базовый ввод есть. Нет загрузки файлов и ML-парсинга.**

### 4. ФИКСАЦИЯ ДАРА — куда записывается

| Компонент | Статус | Где |
|-----------|--------|-----|
| KoinonBus (append-only лог) | ✅ ЕСТЬ | gift/src/koinon/KoinonBus.js |
| GiftMemory (W-матрица) | ✅ ЕСТЬ | gift/src/core/GiftMemory.js |
| GiftEvent (типизированные события) | ✅ ЕСТЬ | gift/src/core/GiftEvent.js |
| SwarmLedger (hash chain) | ✅ ЕСТЬ | plm/swarm-ledger.js |
| FlightLog schema | ✅ ЕСТЬ | docs/DATA-BUSINESS-PROCESS.md |
| Integram persistence | ⚠ ЕСТЬ но не подключён к SwarmChat | plm + integram |
| **Gift Repository (централизованный)** | ❌ НЕТ | **нужно: единый store для всех даров** |

**ВЫВОД: Фиксация разбросана по 4 системам. Нужен единый GiftRepository.**

### 5. ВАЛИДАЦИЯ — проверка подлинности дара

| Компонент | Статус | Где |
|-----------|--------|-----|
| Proof-of-swarm (crypto hash) | ✅ ЕСТЬ | swarm_recorder.v |
| QC протокол (7 тестов) | ✅ ЕСТЬ | NETWORK-FACTORY.md |
| Flight log валидация | ❌ НЕТ | нужно: GPS fix? >30 сек? mesh? |
| Photo валидация | ❌ НЕТ | нужно: EXIF GPS? размер? duplicate? |
| Anti-cheat (подделка данных) | ⚠ ЧАСТИЧНО | SwarmIDS (behavioral anomaly) |

**ВЫВОД: Hardware proof есть. Software валидация flight logs — нет.**

### 6. ИСПОЛЬЗОВАНИЕ — данные → SwarmBrain

| Компонент | Статус | Где |
|-----------|--------|-----|
| Training pipeline (fit моделей) | ❌ НЕТ | описан в docs, не реализован |
| Battery model calibration | ❌ НЕТ | нужно: flight logs → curve fit |
| Wind model calibration | ❌ НЕТ | нужно: flight logs → regression |
| RF map interpolation | ❌ НЕТ | нужно: rf_samples → GeoJSON |
| Terrain DB builder | ❌ НЕТ | нужно: photos → ORB index |
| SwarmBrain v2 export | ❌ НЕТ | нужно: coefficients → swarmBrain.js |

**ВЫВОД: ГЛАВНЫЙ ПРОБЕЛ. Данные собираем, но не используем. Pipeline не реализован.**

### 7. ЕВХАРИСТИЯ — начисление SWARM

| Компонент | Статус | Где |
|-----------|--------|-----|
| SwarmToken (модель) | ✅ ЕСТЬ | plm/swarm-token.js |
| SwarmLedger (учёт) | ✅ ЕСТЬ | plm/swarm-ledger.js |
| Автоматическое начисление | ❌ НЕТ | нужно: pipeline завершён → trigger → pay |
| Задержка 1-7 дней | ❌ НЕТ | описана, не реализована |
| Уведомление игрока | ⚠ ЧАСТИЧНО | SoftChat gift_received шаблоны |
| Jubilee (каждые 100 дней) | ❌ НЕТ | описан в swarm-token.js, не реализован |

**ВЫВОД: Модель и учёт есть. Автоматический trigger "дар использован → начислить" — нет.**

### 8. АНАМНЕЗИС — память для будущего

| Компонент | Статус | Где |
|-----------|--------|-----|
| GiftMemory W-матрица | ✅ ЕСТЬ | gift/src/core/GiftMemory.js |
| LivingMatrix (живая матрица) | ✅ ЕСТЬ | gift/src/core/LivingMatrix.js |
| Player history | ✅ ЕСТЬ | SoftChat players.json |
| Cross-session memory | ✅ ЕСТЬ | KoinonBus (append-only, persistent) |
| SwarmBrain anamnesis | ✅ ЕСТЬ | swarmBrain.js (observations, gratitudeEdges) |

**ВЫВОД: Память хорошая. Это сильная сторона.**

---

## Критические пробелы (TOP-5)

1. **Training Pipeline** — собираем данные но не используем. Нет fit моделей.
2. **Gift Repository** — дары разбросаны по 4 системам. Нужен единый store.
3. **NeedsEngine** — потребности роя хардкожены. Нужен автоматический анализ дефицитов.
4. **Validation Service** — нет проверки flight logs (GPS? длительность? mesh?).
5. **Auto-Pay Trigger** — нет автоматического "данные использованы → начислить SWARM".
