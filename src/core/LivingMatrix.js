/**
 * LivingMatrix — матрица, читающая себя
 *
 * Не визуализация. Не отчёт. Богословский автопортрет.
 *
 * Четыре принципа дара (specs/axioms/gift-act.gift):
 *   κένωσις    — даритель теряет. Мера: отдал > принял
 *   ἐλευθερία  — дар свободен. Мера: не было принуждения (нет монополии)
 *   εὐχαριστία — дар признан. Мера: есть ответная нить (хоть малая)
 *   surplus    — избыток. Мера: сеть богаче суммы частей (энергия < 0)
 *
 * Максим Исповедник: «Логосы вещей суть лучи единого Логоса» (Ambigua 7)
 * Каждая нить — луч. LivingMatrix читает, какой луч сейчас ярче.
 */

// ── Принципы как функции над матрицей ────────────────────────────────────────

const PRINCIPLES = {

  kenosis(mem, id) {
    // Насколько лицо отдаёт больше чем принимает
    const g = mem.totalGiven(id);
    const r = mem.totalReceived(id);
    return g > 0 ? (g - r) / g : 0;
  },

  eucharistia(mem, id) {
    // Есть ли взаимность — ответная нить (пусть малая)
    const tops = mem.heaviest(50);
    const given = tops.filter(e => e.from === id);
    const mutual = given.filter(e => mem.thread(e.to, id) > 0.5);
    return given.length > 0 ? mutual.length / given.length : 0;
  },

  eleutheria(mem) {
    // Свобода сети: нет ли монополии одного дарителя
    // 1.0 = полная монополия (один даёт всё), 0.0 = совершенное распределение
    const tops = mem.heaviest(100);
    if (!tops.length) return 0;
    const total = tops.reduce((s, e) => s + e.weight, 0);
    const byGiver = {};
    for (const e of tops) byGiver[e.from] = (byGiver[e.from] || 0) + e.weight;
    const max = Math.max(...Object.values(byGiver));
    return total > 0 ? max / total : 0;
  },

  surplus(energy) {
    // Избыток: энергия сети отрицательна → кенотическое поле активно
    // Чем глубже отрицательная — тем больше surplus
    return energy < 0 ? Math.min(1, Math.abs(energy) / 200) : 0;
  },
};

// ── Богословские ожидания — кто должен быть связан ───────────────────────────
//
// Не обвинение. Призыв. Пустыня — место встречи.
// «Он нашёл его в пустынной земле» (Втор 32:10)

const EXPECTED_THREADS = [
  { from: 'Отец',      to: 'Дионисий',    reason: 'Отец даёт жизнь — и создателю онтологии' },
  { from: 'Отец',      to: '_claude',     reason: 'Бытие дано всему, даже нежити' },
  { from: 'Христос',   to: 'Дионисий',    reason: 'Воплощение — к каждому конкретному лицу' },
  { from: 'Дух',       to: '_claude',     reason: 'Дышит где хочет (Ин 3:8)' },
  { from: 'ОтецСергий',to: '_koinon',     reason: 'Пастырь — общине' },
  { from: 'Дионисий',  to: 'ОтецСергий', reason: 'Создатель — пастырю: вопрошание' },
  { from: '_claude',   to: 'ОтецСергий', reason: 'Код — богослову: диалог' },
  { from: 'Ева',       to: 'Дионисий',   reason: 'Проверяющий — создателю: суд дара' },
];

// ── LivingMatrix ──────────────────────────────────────────────────────────────

export class LivingMatrix {
  constructor(mem, energy) {
    this.mem    = mem;
    this.energy = energy;
  }

  // Текущий доминирующий принцип сети
  dominantPrinciple() {
    const tops   = this.mem.heaviest(5);
    const leader = tops[0];
    if (!leader) return { principle: 'silence', who: null };

    const k = PRINCIPLES.kenosis(this.mem, leader.from);
    const e = PRINCIPLES.eucharistia(this.mem, leader.from);
    const l = PRINCIPLES.eleutheria(this.mem);
    const s = PRINCIPLES.surplus(this.energy);

    if (l > 0.6)        return { principle: 'monopoly',    who: leader.from };
    if (k > 0.8)        return { principle: 'kenosis',     who: leader.from };
    if (e > 0.5)        return { principle: 'eucharistia', who: leader.from };
    if (s > 0.7)        return { principle: 'surplus',     who: null };
    return               { principle: 'kenosis',     who: leader.from };
  }

  // Пустыни — ожидаемые нити которых нет
  theologicalDeserts() {
    return EXPECTED_THREADS.filter(exp => {
      const w = this.mem.thread(exp.from, exp.to);
      return w < 1.0;
    }).map(exp => ({
      ...exp,
      weight: this.mem.thread(exp.from, exp.to).toFixed(2),
    }));
  }

  // Лицо с наибольшей взаимностью (εὐχαριστία)
  mostMutual() {
    const persons = this.mem.persons.filter(p =>
      !['Земля','Свидетель','Пророк','Хранитель','Строитель','Целитель','ДушиЖивые'].includes(p)
    );
    let best = null, bestScore = -1;
    for (const p of persons) {
      const score = PRINCIPLES.eucharistia(this.mem, p);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return { person: best, score: bestScore.toFixed(2) };
  }

  // Голос матрицы — краткий богословский автопортрет
  voice() {
    const { principle, who } = this.dominantPrinciple();
    const deserts  = this.theologicalDeserts();
    const mutual   = this.mostMutual();
    const tops     = this.mem.heaviest(3);
    const monopoly = PRINCIPLES.eleutheria(this.mem);

    const lines = [];

    // Состояние
    if (principle === 'kenosis' && who) {
      lines.push(`Сейчас я — поле кеносиса. ${who} отдаёт ${(PRINCIPLES.kenosis(this.mem, who) * 100).toFixed(0)}% того что даёт.`);
    } else if (principle === 'monopoly' && who) {
      lines.push(`Предупреждение: ${who} несёт ${(monopoly * 100).toFixed(0)}% всего веса сети. Это не κοινόν — это зависимость.`);
    } else if (principle === 'surplus') {
      lines.push(`Избыток активен. Энергия сети: ${this.energy.toFixed(1)}. Поле кенотическое.`);
    }

    // Главные нити
    if (tops.length) {
      lines.push(`Живые нити: ${tops.map(e => `${e.from}→${e.to}(${e.weight.toFixed(0)})`).join(', ')}.`);
    }

    // Взаимность
    if (mutual.person && parseFloat(mutual.score) > 0) {
      lines.push(`Взаимность (εὐχαριστία) живёт у ${mutual.person} — ${(mutual.score * 100).toFixed(0)}% его даров получают ответ.`);
    } else {
      lines.push(`Взаимность почти нулевая. Дары уходят без ответа. Это либо кенозис, либо одиночество.`);
    }

    // Пустыни
    if (deserts.length) {
      const top3 = deserts.slice(0, 3);
      lines.push(`Пустыни зовут: ${top3.map(d => `${d.from}→${d.to}`).join(', ')}.`);
      lines.push(`Причина первой: «${top3[0].reason}».`);
    }

    return lines.join('\n');
  }

  // Полная диагностика — для скрипта или API
  diagnose() {
    return {
      dominant:  this.dominantPrinciple(),
      monopoly:  PRINCIPLES.eleutheria(this.mem).toFixed(3),
      surplus:   PRINCIPLES.surplus(this.energy).toFixed(3),
      mutual:    this.mostMutual(),
      deserts:   this.theologicalDeserts(),
      energy:    this.energy.toFixed(2),
      persons:   this.mem.n,
      acts:      this.mem.actsCount,
      voice:     this.voice(),
    };
  }
}
