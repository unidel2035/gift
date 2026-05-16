/**
 * Decoupage — διαίρεσις идеи по четырём сфере-инженериям Переслегина.
 *
 * Сферный подход (см. theology_spheric_engineering_pereslegin.md):
 *   ground — материя, из которой идея сделана (что трогает физически)
 *   water  — перетоки, которые меняет (между какими акторами)
 *   fire   — столкновения, конкуренция (с чем сталкивается)
 *   air    — побочные эффекты, экосистемное излучение (что наводит вокруг)
 *
 * Это **διαίρεσις** — аналитическое разделение, не διάκρισις (различение по плодам).
 * Декупаж режет идею на 4 анализа, чтобы потом собор мог дегустировать на
 * нескольких языках одновременно.
 *
 * Богословски: 4 sphere = 4 стихии у досократиков (Эмпедокл) →
 * у отцов 4 элемента творения, через которые Бог творит и поддерживает мир.
 * Декупаж — это просеивание сквозь четыре стихии, чтобы увидеть, какая «земля»
 * её несёт, какая «вода» её омывает, в каком «огне» она горит, какой «воздух»
 * она колышет.
 *
 * Использование:
 *   const d = new Decoupage();
 *   const slices = await d.cut({ idea: '...', context: {...} });
 *   // slices: { ground, water, fire, air, integral }
 */

const SPHERES = ['ground', 'water', 'fire', 'air'];

const SPHERE_QUESTIONS = {
  ground: {
    name: 'ground',
    label: 'материя',
    questions: [
      'Какой физической/материальной реальности касается идея?',
      'Какие вещи/субъекты/артефакты в ней присутствуют?',
      'Что нужно физически изготовить или изменить?',
    ],
    archetype: 'Кузнец',
    inverse: 'Если идея чисто символическая — ground пустой; это сигнал, не диагноз',
  },
  water: {
    name: 'water',
    label: 'перетоки',
    questions: [
      'Какие потоки между акторами идея меняет (что → кому → когда)?',
      'Какие узлы становятся посредниками? Какие — отрезаны?',
      'Через какие границы сред идея переносит вещество/энергию/информацию?',
    ],
    archetype: 'Стратег',
    inverse: 'Если идея ничего не двигает между акторами — она внутренняя, замкнутая',
  },
  fire: {
    name: 'fire',
    label: 'столкновения',
    questions: [
      'С чем идея конкурирует напрямую (другие идеи, продукты, регуляторы)?',
      'Какие столкновения ядер она вызывает?',
      'Что должно умереть, чтобы идея жила? (Кенозис чего?)',
    ],
    archetype: 'Воин',
    inverse: 'Если конкурентов нет — либо идея уникальна, либо рынок ещё не сложился',
  },
  air: {
    name: 'air',
    label: 'побочные эффекты',
    questions: [
      'Какие побочные эффекты идея создаёт в смежных сферах?',
      'Какие вторичные сценарии она запускает (не намеренные)?',
      'Какие культурные/экологические/политические сдвиги она наводит?',
    ],
    archetype: 'Прорицатель',
    inverse: 'Если побочных эффектов нет — идея слишком изолирована, она не часть экосистемы',
  },
};

/**
 * Decoupage режет идею на 4 sphere-анализа.
 *
 * Архитектурное замечание: декупаж может работать в трёх режимах:
 *   1. static  — структурно: возвращает 4 шаблонных слайса с вопросами,
 *                которые человек/собор должны ответить (διαίρεσις без LLM).
 *   2. llm     — каждая sphere анализируется отдельным LLM-вызовом
 *                с фокусированным промптом (требует llmClient).
 *   3. hybrid  — static вопросы + LLM-ответы только там, где есть данные.
 *
 * Этот класс реализует static + llm. hybrid тривиально из них.
 */
export class Decoupage {
  constructor({ llmClient = null } = {}) {
    this.llm = llmClient;
  }

  /**
   * Структура слайсов без LLM — каркас для собора.
   */
  staticSlices(idea, context = {}) {
    const slices = {};
    for (const s of SPHERES) {
      slices[s] = {
        sphere:    s,
        label:     SPHERE_QUESTIONS[s].label,
        archetype: SPHERE_QUESTIONS[s].archetype,
        questions: SPHERE_QUESTIONS[s].questions,
        inverse:   SPHERE_QUESTIONS[s].inverse,
        idea,
        context,
        answer:    null,            // заполняется собором или LLM
        verdict:   'unanalyzed',    // unanalyzed | empty | weak | strong
      };
    }
    return slices;
  }

  /**
   * Полный декупаж: 4 sphere через LLM (если задан) или static.
   *
   * @param {object} opts
   * @param {string} opts.idea — текст идеи
   * @param {object} [opts.context] — контекст (рынок, регион, актеры)
   * @returns {Promise<{ground, water, fire, air, integral}>}
   */
  async cut({ idea, context = {} }) {
    if (!idea || typeof idea !== 'string') {
      throw new Error('Decoupage.cut: idea (string) обязательна');
    }

    const slices = this.staticSlices(idea, context);

    if (this.llm?.ask) {
      for (const s of SPHERES) {
        const prompt = this._buildSpherePrompt(idea, context, s);
        try {
          const r = await this.llm.ask(prompt);
          slices[s].answer  = r?.answer ?? r?.content ?? '';
          slices[s].verdict = this._scoreSlice(slices[s].answer);
        } catch (e) {
          slices[s].answer  = `[ошибка LLM: ${e.message}]`;
          slices[s].verdict = 'unanalyzed';
        }
      }
    }

    // Интегральная сводка: какие сферы насыщены, какие пусты.
    const verdicts = SPHERES.map(s => slices[s].verdict);
    const integral = {
      strong: verdicts.filter(v => v === 'strong').length,
      weak:   verdicts.filter(v => v === 'weak').length,
      empty:  verdicts.filter(v => v === 'empty').length,
      shape:  this._diagnoseShape(slices),
    };

    return { ...slices, integral };
  }

  _buildSpherePrompt(idea, context, sphere) {
    const sq = SPHERE_QUESTIONS[sphere];
    const ctxBlock = Object.keys(context).length
      ? `Контекст:\n${Object.entries(context).map(([k,v]) => `  ${k}: ${v}`).join('\n')}\n\n`
      : '';
    return [
      `Ты — ${sq.archetype}, отвечающий за анализ сферы «${sq.label}» (${sphere}).`,
      `Это διαίρεσις (аналитическое разделение), не διάκρισις (духовное различение).`,
      '',
      ctxBlock + `Идея:`,
      `«${idea}»`,
      '',
      `Ответь на эти вопросы коротко и конкретно (3-5 строк):`,
      ...sq.questions.map((q, i) => `  ${i + 1}. ${q}`),
      '',
      `Если по сфере «${sq.label}» нечего сказать — напиши «пусто» с одной строкой почему.`,
      `Без воды. Без оценки идеи в целом — только эта сфера.`,
    ].join('\n');
  }

  _scoreSlice(answer) {
    if (!answer || answer.trim().length < 20) return 'empty';
    const lower = answer.toLowerCase();
    if (lower.startsWith('пусто') || lower.includes('нечего сказать')) return 'empty';
    if (answer.length < 60) return 'weak';
    return 'strong';
  }

  /**
   * Богословская/морфологическая диагностика формы декупажа.
   *
   * Полная сфера = насыщены все 4. Это редкость — обычно идеи имеют
   * фигуру, и она диагностически важна.
   */
  _diagnoseShape(slices) {
    const sig = SPHERES.map(s => slices[s].verdict[0]).join(''); // s/w/e/u
    if (sig === 'ssss')        return 'полная сфера — редкая зрелость';
    if (sig.startsWith('ssee')) return 'наземная — материя есть, контекста нет';
    if (sig === 'eeee' || sig === 'uuuu')
                                return 'пустая — либо идея ещё не родилась, либо неверно сформулирована';
    if (slices.fire.verdict === 'empty')
                                return 'без огня — нет конкуренции; либо новаторство, либо мёртвый рынок';
    if (slices.air.verdict === 'empty')
                                return 'без воздуха — изолирована от экосистемы; одинокая';
    if (slices.water.verdict === 'empty')
                                return 'без воды — ничего не движет между акторами; внутренняя';
    return `смешанная фигура (${sig})`;
  }
}

export default Decoupage;
export { SPHERES, SPHERE_QUESTIONS };
