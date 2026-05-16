/**
 * Шаблоны типовых целей для общин и команд. На русском, без греческого
 * сленга, с готовыми success-criteria — чтобы человек, никогда не слышавший
 * про μετάνοια, мог поставить осмысленную цель.
 *
 * Каждый шаблон превращается в gift goal create через substitute(name, params).
 */

export const TEMPLATES = {
  close_issue: {
    title: 'Закрыть задачу с гитхаба',
    description: 'Реализовать issue №X и закрыть его коммитом',
    params: ['N'],
    objective: 'Закрой issue #{N} — реализуй то, что в нём описано',
    successCriteria: 'gh issue view {N} показывает CLOSED, npm test зелёный',
    maxIterations: 8,
  },

  fix_bug: {
    title: 'Починить баг',
    description: 'Исправить конкретное место в коде',
    params: ['description'],
    objective: '{description}',
    successCriteria: 'есть новый тест который раньше падал а теперь проходит, npm test зелёный',
    maxIterations: 6,
  },

  add_feature: {
    title: 'Добавить функцию',
    description: 'Реализовать новую возможность в коде',
    params: ['what'],
    objective: 'Добавить: {what}',
    successCriteria: 'функция работает, есть тест на её базовый сценарий, npm test зелёный',
    maxIterations: 12,
  },

  refactor: {
    title: 'Переписать модуль',
    description: 'Улучшить структуру без изменения поведения',
    params: ['target'],
    objective: 'Переработать {target} — сделать понятнее, не меняя поведения',
    successCriteria: 'все существующие тесты проходят, диф не задевает публичный интерфейс',
    maxIterations: 10,
  },

  // ── Общинные / организационные шаблоны ───────────────────────────────
  weekly_retro: {
    title: 'Провести ретроспективу недели',
    description: 'Собор оглядывается на прошедшую неделю и записывает уроки',
    params: [],
    objective: 'Провести ретро за последнюю неделю — что было, что усвоили, что отложили',
    successCriteria: 'в data/reflection.json появилась запись типа retro за эту неделю, в матрице есть акт type=reflection от _claude к _koinon',
    maxIterations: 3,
  },

  draft_decision: {
    title: 'Подготовить решение',
    description: 'Описать проблему, варианты, аргументы — для будущего совещания',
    params: ['question'],
    objective: 'Подготовить решение по вопросу: {question}. Опиши проблему, 2-3 варианта, плюсы и минусы каждого, мнение собора',
    successCriteria: 'есть файл в plans/decision-<id>.md с разделами Проблема/Варианты/Мнение_собора/Рекомендация',
    maxIterations: 4,
  },

  ask_community: {
    title: 'Спросить общину',
    description: 'Сформулировать вопрос для совета и положить в эпиклеза-очередь',
    params: ['question', 'to'],
    objective: 'Положить в эпиклеза-очередь вопрос: «{question}» получателю {to}',
    successCriteria: 'в data/epiclesis-inbox/ появилась новая запись с этим вопросом',
    maxIterations: 2,
  },

  desert_question: {
    title: 'Закрыть одну пустыню',
    description: 'Сформулировать дар который пройдёт по нити где сейчас никого',
    params: ['from', 'to'],
    objective: 'Закрыть пустыню {from} → {to}: сформулировать осмысленный дар который имеет смысл по этой нити',
    successCriteria: 'в матрице W появилась нить {from} → {to} с весом > 0, акт записан в insights.json',
    maxIterations: 4,
  },
};

export function listTemplates() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({
    key,
    title: t.title,
    description: t.description,
    params: t.params,
  }));
}

export function substitute(key, params = {}) {
  const t = TEMPLATES[key];
  if (!t) throw new Error(`шаблон "${key}" не найден`);
  for (const p of t.params) {
    if (params[p] === undefined || params[p] === '') {
      throw new Error(`шаблон "${key}" требует параметр "${p}"`);
    }
  }
  const fill = s => s.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
  return {
    objective:       fill(t.objective),
    successCriteria: fill(t.successCriteria),
    maxIterations:   t.maxIterations,
  };
}
