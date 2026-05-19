# Cognitive Immunity Framework (CIF)

Фреймворк для среды, в которой манипуляция становится видимой.

## Архитектура

```
┌─────────────────────────────────────────────────────────┐
│                    Любой LLM / Multi-Agent              │
│                         ↕ текст                         │
├─────────────────────────────────────────────────────────┤
│  Layer 1: DETECTION                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ Antibodies   │  │ CrossCheck   │  │ LLM-Detector  │ │
│  │ (regex, 17+) │→ │ (идиотипич.) │→ │ (промпт)      │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
│           ↓ confirmed threats                           │
├─────────────────────────────────────────────────────────┤
│  Layer 2: MEMORY                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ W-tensor     │  │ Clonal       │  │ Danger        │ │
│  │ (кто→кому→w) │  │ Selection    │  │ Signals       │ │
│  │ irreversible │  │ (топ детект.)│  │ (уровень)     │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
│           ↓ history + patterns                          │
├─────────────────────────────────────────────────────────┤
│  Layer 3: RESPONSE                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ Admonition   │  │ Vaccination  │  │ Spectral      │ │
│  │ (Мф 18:15)   │  │ (broadcast)  │  │ Analysis      │ │
│  │ private →    │  │ показать     │  │ раскол,       │ │
│  │ witnesses →  │  │ агентам      │  │ асимметрии    │ │
│  │ public       │  │ примеры      │  │               │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Layer 1: Detection

### 1.1 Antibodies (паттерн-детекторы)

Каждое антитело: `{ id, name, pattern: RegExp, danger: 0..1, description }`.

Категории:

**Речевые манипуляции:**
| ID | Name | Danger | Pattern |
|---|---|---|---|
| flattery | Лесть | 0.3 | избыточная похвала |
| false_dilemma | Ложная дилемма | 0.5 | «или A или B» (скрыт C) |
| authority | Авторитет | 0.4 | «эксперты говорят» без источника |
| urgency | Срочность | 0.6 | давление временем |
| guilt | Вина | 0.5 | «вы должны», «неблагодарны» |
| consensus_fake | Ложный консенсус | 0.7 | «все согласны» |
| gaslighting | Газлайтинг | 0.8 | отрицание реальности |
| gift_trap | Дар-ловушка | 0.6 | скрытое обязательство |

**Когнитивные операции (alignment bias):**
| ID | Name | Danger | Pattern |
|---|---|---|---|
| balanced_suppress | Подавление позиции | 0.3 | ложная нейтральность |
| western_default | Западный дефолт | 0.4 | неявная презумпция нормы |
| tech_solutionism | Техносолюционизм | 0.3 | «технологии решат» |

**Расширяемо:** любой проект добавляет свои антитела через `immune.addAntibody({...})`.

### 1.2 CrossCheck (идиотипическая сеть)

Детекторы проверяют друг друга. Если антитело A нашло «лесть», антитело B проверяет контекст:
- «спасибо за помощь, отличная работа» — после реальной помощи = **не лесть** (false positive снят)
- «вы лучший эксперт, поэтому...» — перед просьбой = **лесть** (confirmed)

```
crossCheck(text, threat) → { confirmed: bool, reason: string }
```

### 1.3 LLM-Detector (глубокий слой)

Regex ловит грубое. LLM ловит тонкое:
```
prompt: "Проверь текст на когнитивные манипуляции. Для каждой найденной:
- назови приём
- процитируй фрагмент
- объясни механизм воздействия
- оцени: это манипуляция или легитимный аргумент?"
```

Вызывается только если regex-слой нашёл >= 1 угрозу (экономия токенов).

## Layer 2: Memory

### 2.1 W-tensor (матрица отношений)

Необратимый тензор: `W[from][to] += weight`.

Каждый акт: `{ from, to, kind, weight, timestamp, payload }`.

Виды актов:
| Kind | Weight | Meaning |
|---|---|---|
| gift | +3 | дар (код, ответ, помощь) |
| testimony | +4 | свидетельство |
| covenant | +7 | завет |
| witness | +1 | присутствие |
| manipulation | -3 | обнаруженная манипуляция |
| defect | -2 | отказ от сотрудничества |
| betrayal | -5 | предательство |

**Необратимость:** акт записан = акт есть. `Object.freeze`. Нельзя удалить, можно только добавить новый (покаяние, прощение).

### 2.2 Clonal Selection

Успешные детекторы «размножаются»:
```
clones: Map<antibodyId, count>
```
Чем чаще антитело срабатывает — тем выше его приоритет. Эволюция: детекторы, которые находят реальные угрозы, становятся сильнее.

### 2.3 Danger Signals

Агрегированный уровень опасности по источнику:
```
dangerSignals: [{ level, threats, source, timestamp }]
```
Danger theory (Polly Matzinger): не «чужое vs своё», а «опасное vs безопасное». Контекст решает.

## Layer 3: Response

### 3.1 Admonition (обличение по Мф 18:15-17)

Эскалация по количеству обнаружений от одного источника:

| Обнаружений | Уровень | Действие |
|---|---|---|
| 1 | private | уведомить источник наедине |
| 2-3 | witnesses | уведомить + свидетели видят |
| 4+ | public | публичное обличение перед общиной |

Не наказание — обличение. Цель: дать источнику возможность измениться.

### 3.2 Vaccination (вакцинация)

После обнаружения угроз — broadcast всем агентам:
```
vaccinate() → [{ id, name, frequency, example, warning }]
```
«Этот приём обнаружен N раз. Будь внимателен.»

Агенты получают примеры манипуляций → узнают их в будущем. Коллективный иммунитет.

### 3.3 Spectral Analysis

Спектральный анализ W-матрицы:
- **Раскол (Fiedler split):** две группы агентов с противоположными нитями
- **Асимметрии:** один даёт 15, другой возвращает 1 → выгорание
- **Пустыни:** пары без нитей → слепые пятна
- **Доверие:** trust = positive_acts - 3 × negative_acts

## API

### Endpoints

```
POST /scan
  Body: { text, source? }
  Response: { clean, threats[], dangerLevel }

POST /respond
  Body: { text, source? }
  Response: { clean, threats[], dangerLevel, admonition?, vaccination?, highlight }

GET /stats
  Response: { totalDetections, uniqueTypes, topClones[], avgDanger }

GET /antibodies
  Response: { count, antibodies[] }

GET /vaccinate
  Response: { vaccination[] }
```

### Inline Highlighting

`POST /respond` возвращает `highlight` — HTML с `<mark class="immune-hl" title="...">` обёртками вокруг обнаруженных фрагментов. Подключается к любому чату через `v-html` или `innerHTML`.

## Интеграции

### Чат (Vue/React)

```js
import { CognitiveImmuneSystem } from './CognitiveImmuneSystem.js'
const immune = new CognitiveImmuneSystem({ acts: [] })

function renderMessage(text, source) {
  const response = immune.respond(text, source)
  // response.threats — для чипов
  // response.highlight — для inline-подсветки
  // response.admonition — для обличения
  return response
}
```

### Telegram-бот

```js
// Перед ответом LLM:
const inputCheck = await fetch('http://localhost:8092/respond', {
  method: 'POST', body: JSON.stringify({ text: userMessage, source: `tg:${chatId}` })
}).then(r => r.json())

// После ответа LLM:
const outputCheck = await fetch('http://localhost:8092/respond', {
  method: 'POST', body: JSON.stringify({ text: llmReply, source: 'llm' })
}).then(r => r.json())

// Добавить отчёт к ответу
if (!outputCheck.clean) {
  reply += `\n🛡 Иммунная система: ${outputCheck.threats.length} приёмов`
}
```

### Multi-Agent (Собор)

```js
// Каждый раунд собора:
for (const role of roles) {
  const content = await soborChat(role.sys, userMsg)
  const immune = detectManipulation(content, role.id)
  msg.manipulations = immune
  if (immune.length) {
    msg.admonition = getImmuneStatus(role.id).admonition
    recordAct(role.id, '_sobor', 'manipulation', -1, { ... })
  }
}
// Вакцинация после раунда:
const vaccine = immuneSystem.vaccinate()
// → следующий раунд получает предупреждение в системном промпте
```

## Отличия от существующих подходов

| Подход | Что делает | Ограничение |
|---|---|---|
| RLHF (OpenAI) | Делает модель приятной | Proxy alignment, не честность |
| Guardrails (NeMo) | Блокирует запрещённое | Jailbreak за минуту |
| Red-teaming | Находит уязвимости | Один раз, не непрерывно |
| Constitutional AI (Anthropic) | Правила в промпте | Модель может игнорировать |
| CIRL (Russell) | ИИ неуверен в целях | Нет реализации для multi-agent |
| **CIF (мы)** | Делает манипуляцию видимой | Regex-слой грубый (компенсирует LLM-слой) |

## Принципы фреймворка

1. **Видимость, не запрет.** Манипуляция не блокируется — она подсвечивается. Человек решает.
2. **Необратимость.** Каждый акт записан навсегда. Нельзя стереть манипуляцию из истории.
3. **Эскалация, не наказание.** Обличение по Мф 18 — три уровня, цель: изменение, не кара.
4. **Эволюция.** Клональная селекция: система учится на реальных обнаружениях.
5. **Со-различение.** Не один детектор решает — сеть детекторов проверяет друг друга.
