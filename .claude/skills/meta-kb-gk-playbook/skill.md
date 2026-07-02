# Meta KB — Генеральный Конструктор Playbook

Use this playbook when running a **ГК (Генеральный конструктор) synthesis mission** inside Мета КБ.

## Mission Type

ГК missions synthesize 3 role topic threads (Инженер / ЛПР / Предприниматель) into a single coherent ТЗ (техническое задание). The dominant failure mode is **premature synthesis**: ГК produces a first-pass assembly and stops before all gaps between role inputs and the ТЗ are closed.

## Success Criteria

A ГК mission is complete when:
1. All three role sections (инженерное / организационное / предпринимательское) are filled with primary evidence from the topic threads, not inference
2. All contradictions between roles are named and resolved (or explicitly deferred to ЛПР)
3. The ТЗ "Критическое допущение" names exactly what is NOT proven in this assembly
4. The output passes the Synthesis Validator (≥2 of 3 role validators return GREEN)

## Investigation Phase

Before writing a single word of the ТЗ, run **Investigator** lanes to map:

- `INV-1`: What did Инженер say? Extract: платформа, TRL, ключевые параметры, критическое допущение
- `INV-2`: What did ЛПР say? Extract: организационная структура, субъект реализации, риски, веха-план
- `INV-3`: What did Предприниматель say? Extract: заинтересованный субъект, бизнес-модель, кто платит, точка входа
- `INV-4`: Where do the three topics contradict each other? List all conflicts explicitly

Do NOT skip INV-4. Role conflicts are the source of the synthesis value.

## Contract (falsifiable assertions)

Before starting workers, define the contract:

```
GK-1: The assembly names the заинтересованный субъект with ≥1 concrete example of why they pay
GK-2: The assembly contains a веха-план with ≥2 concrete milestones and owners
GK-3: The assembly contains a TRL value with a source in the topic threads (not assumed)
GK-4: Every role conflict from INV-4 is either resolved or deferred with a reason
GK-5: "Критическое допущение" lists ≥1 item that is NOT proven by the topic evidence
GK-6: The ТЗ черновик is 5–10 sentences — long enough to be signed, short enough to be read
```

## Task Topology

```
INV-1, INV-2, INV-3, INV-4    [parallel Investigator lanes]
           ↓
     DraftWorker                [writes first ТЗ from INV outputs]
           ↓
SynthVal-1, SynthVal-2, SynthVal-3   [parallel validators, one per role section]
           ↓
     GapReview                 [Orchestrator: any gaps? → replan or close]
           ↓
     FinalWorker (if gaps)     [patches only the failing sections]
           ↓
     ЛПР Gate                  [human HITL — ЛПР signs or returns with notes]
```

## Evidence Floor

- Each claim in the ТЗ must trace to a quoted sentence from the topic threads, not to the ГК's inference
- If a section cannot be filled with primary evidence → mark it as "requires clarification" with specific question
- A ТЗ with honest gaps is better than a ТЗ with invented completeness

## Synthesis Validator Instructions

Each SynthVal-* runs independently:

```
SynthVal-1 (Инженерное): Does the assembly's инженерное section contain TRL, платформа, and at least one falsifiable параметр-сдвиг?
SynthVal-2 (Организационное): Does the assembly's организационное section name a конкретный субъект реализации and a minimum веха?
SynthVal-3 (Предпринимательское): Does the assembly's предпринимательское section name кто платит and why (not just "state" or "market")?
```

Verdict: GREEN (passes) / YELLOW (partial, list gaps) / RED (fails, must rewrite)

## Stopping Rule

Stop when:
- All 3 SynthVal return GREEN, OR
- ЛПР accepts the assembly at the Gate, OR
- 3 rewrite cycles completed (record remaining gaps as open issues for next session)

Do NOT stop after the first DraftWorker output. That is premature synthesis.

## Gap-Finding Discipline

Between each cycle, the Orchestrator must explicitly answer:
> "What is the gap between what the roles said and what the ТЗ currently claims?"

If the gap is zero → stop. If the gap is nonzero → replan toward the specific gap, not toward "improving" the assembly in general.

## Output Format

```
## СБОРКА ГК — [Название проблемы]

### ИНЖЕНЕРНОЕ РЕШЕНИЕ
[Evidence-traced, source in brackets]

### ОРГАНИЗАЦИОННОЕ РЕШЕНИЕ
[Evidence-traced, source in brackets]

### ПРЕДПРИНИМАТЕЛЬСКОЕ РЕШЕНИЕ
[Evidence-traced, source in brackets]

### СИНТЕЗ ПРОТИВОРЕЧИЙ
Тезис: ...
Антитезис: ...
Как снимается: ...

### КРИТИЧЕСКОЕ ДОПУЩЕНИЕ
[What is NOT proven. At least one item. This is the next cycle's starting point.]

### ПРЕДЛОЖЕНИЕ ТЗ
[5–10 sentences. Signed-ready.]

### ОТКРЫТЫЕ ВОПРОСЫ К ЛПР
[List anything deferred, with specific question]
```
