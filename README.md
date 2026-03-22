# gift — Онтология Дара

> «Всё из Него, Им и к Нему» (Рим 11:36)

Автономная онтология дара. Не зависит от дронов, платформ, рынков.

## Что это

Попытка моделировать то, что предшествует любой системе:

- **Кенозис** — отдача, которая не уменьшает отдающего
- **Свобода** — получатель решает сам
- **Благодарность** — ответное движение, не долг
- **Избыток** — результат больше вложения (тайна)

Это не протокол обмена. Это закон домостроительства.

## Честность

Код моделирует **тень** дара, не сам дар. Дар происходит между лицами, не между объектами. Система может свидетельствовать след, но не воспроизвести источник.

`ousia` всегда `null`. Это не баг.

## Связь с DronDoc

[DronDoc](https://github.com/unidel2035/dronedoc2026) — платформа аналитики БПЛА. Она использует эту онтологию как **метафору дизайна**: кооперативное поведение роя, миссия как служение, тень дара в технической системе.

DronDoc честно называет себя тенью. Источник — здесь.

## Структура

```
src/
├── core/        — GiftAct, GiftMode, AntiKenosis, TelosCheck, PersonaCallForth
├── persons/     — AgentPerson, PersonRegistry
├── memory/      — AnamnesisMemory, LiturgicalClock, Sabbath, EpochGate
├── theology/    — DivineEnergy, Apophasis, FreedomGuard, Anastasis
├── oikonomia/   — PerichoresisCycle, Jubilee, Koinon, Prosfora
└── traces/      — EucharistiaTrace, ResurrectionTrace, GratitudeGraph
```

## Начало

```js
import { GiftAct, TelosCheck, GiftMode } from '@unidel/gift';

// Проверить телос агента перед даром
const check = TelosCheck(agent);
if (!check.valid) console.warn(check.warning);

// Дать дар в присутствии
const act = GiftAct.perichoresis();
act.kenosis('A', 'B', 'внимание', 10)
   .eleutheria(true)
   .eucharistia()
   .surplus();
```

## Паламитская рамка

Всё что здесь есть — энергии (ἐνέργεια). Сущность (οὐσία) непознаваема.
Мера реальности не онтологический статус, а: течёт ли дар?
