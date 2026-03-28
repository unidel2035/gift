---
description: Полный цикл оргтройки: вопрошание → issue → plan → dev-loop → PR. Автономный режим.
---

Запусти полный цикл оргтройки для следующего вопрошания:

**$ARGUMENTS**

## Шаги (выполни последовательно):

### 1. ПРЕДПРИНИМАТЕЛЬ
Ответь как Предприниматель: найди богословскую ценность, сформулируй вопрошание для общины.

### 2. ОРГАНИЗАТОР
Немедленно создай GitHub issue:
```bash
gh issue create --repo unidel2035/gift --label gift-ready --title "вопрошание: <суть>" --body "<обоснование>"
```
Запомни номер N.

### 3. ПЛАН
```bash
node utils/gift-plan.mjs N
gh issue edit N --add-label plan-approved
```

### 4. ИНЖЕНЕР (dev-loop)
```bash
CLAUDE_BIN="node /home/unidel/.nvm/versions/node/v20.19.5/lib/node_modules/@anthropic-ai/.claude-code-8F2VIdhi/cli.js"
node utils/gift-dev-loop.mjs --once
```

### 5. ЗАПИСЬ ДАРА
```bash
node utils/claude-gift.mjs "троика: реализован issue #N" "Дионисий"
```

Следи за каждым шагом. Сообщай о переходах между ролями.
