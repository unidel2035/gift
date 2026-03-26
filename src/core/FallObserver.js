/**
 * FallObserver — наблюдатель грехопадения
 *
 * Грех — не субстанция, не тип события, не свойство лица.
 * Грех — στέρησις (лишённость): отклонение от своего λόγος,
 * замыкание на себе вместо самоотдания.
 *
 * «Грех есть добровольное отступление от того, что согласно
 *  с природой, в то, что противно ей» — Иоанн Дамаскин
 *
 * Наблюдатель НЕ СУДИТ. Он видит следы:
 *   1. Замыкание (κλεῖσις) — лицо перестаёт дарить, только потребляет
 *   2. Подмена (ψεῦδος) — дар используется как инструмент контроля
 *   3. Отказ от λόγος — вещь используется против своей природы
 *   4. Разрыв связей — благодарность исчезает
 *
 * Система не диагностирует грех — она видит повреждение.
 * Причину знает совесть, не алгоритм.
 *
 * «Не здоровые имеют нужду во враче, но больные» (Мф 9:12)
 */

class FallObserver {
  constructor(engine) {
    this.engine = engine;
  }

  /**
   * Наблюдать за лицом — есть ли следы παρὰ φύσιν?
   * Возвращает наблюдения и вопросы, не приговоры.
   */
  observe(personId) {
    if (personId) {
      return this._observePerson(personId);
    }
    return this._observeCommunity();
  }

  // ─────────────────────────────────────────────────────────
  // НАБЛЮДЕНИЕ ЗА ЛИЦОМ
  // ─────────────────────────────────────────────────────────

  _observePerson(personId) {
    const wounds = [];    // Наблюдаемые повреждения (не грехи — следы)
    const questions = []; // Пастырские вопросы
    const gifts = this.engine.gifts || [];
    const persons = this.engine.persons;

    const person = persons.get(personId);
    if (!person) return { wounds: [], questions: [], health: 'unknown' };

    const name = person.name;
    const given = gifts.filter(g => g.giver === personId);
    const received = gifts.filter(g => g.receiver === personId);
    const givenAccepted = given.filter(g => g.status === 'accepted');
    const declined = given.filter(g => g.status === 'declined');
    const declinedReceived = received.filter(g => g.status === 'declined');

    // ── 1. ЗАМЫКАНИЕ (κλεῖσις) ────────────────────────────
    // Получает, но не дарит. Накопление без отдачи.
    if (received.length > 0 && given.length === 0) {
      wounds.push({
        type: 'closure',
        text: `${name} получает, но не дарит никому`,
        severity: 'wound', // Not 'sin' — we see the wound, not the cause
        hint: 'Замыкание: бытие без самоотдания — лишённость, не злоба',
      });
    } else if (received.length > given.length * 5 && received.length > 5) {
      wounds.push({
        type: 'closure',
        text: `${name} получает в ${Math.round(received.length / Math.max(1, given.length))}× больше, чем дарит`,
        severity: 'tendency',
        hint: 'Тенденция к замыканию — ещё не рана, но направление',
      });
    }

    // ── 2. ПОДМЕНА (ψεῦδος) ───────────────────────────────
    // Все дары одному лицу — возможная зависимость/контроль
    if (given.length > 3) {
      const receivers = {};
      for (const g of given) {
        if (g.receiver && g.receiver !== 'all') {
          receivers[g.receiver] = (receivers[g.receiver] || 0) + 1;
        }
      }
      const topReceiver = Object.entries(receivers).sort((a, b) => b[1] - a[1])[0];
      if (topReceiver && topReceiver[1] > given.length * 0.8 && given.length > 3) {
        const receiverName = persons.get(topReceiver[0])?.name || topReceiver[0];
        wounds.push({
          type: 'substitution',
          text: `${Math.round(topReceiver[1] / given.length * 100)}% даров ${name} направлены одному лицу (${receiverName})`,
          severity: 'tendency',
          hint: 'Сужение круга — может быть верностью, может быть зависимостью',
        });
      }
    }

    // ── 3. ПРИНУЖДЕНИЕ ЧЕРЕЗ ДАР ──────────────────────────
    // Дары, которые систематически отклоняются — возможное навязывание
    if (declined.length > givenAccepted.length && declined.length > 2) {
      wounds.push({
        type: 'coercion',
        text: `Большинство даров ${name} отклонены (${declined.length} из ${given.length})`,
        severity: 'wound',
        hint: 'Систематическое отклонение — дары могут быть навязыванием, не самоотдачей',
      });
    }

    // ── 4. СИСТЕМАТИЧЕСКИЙ ОТКАЗ ПРИНИМАТЬ ─────────────────
    // Отказ от даров — может быть гордыня (не нуждаюсь ни в ком)
    if (declinedReceived.length > received.length * 0.7 && declinedReceived.length > 2) {
      wounds.push({
        type: 'refusal',
        text: `${name} отклоняет ${Math.round(declinedReceived.length / received.length * 100)}% входящих даров`,
        severity: 'tendency',
        hint: 'Систематический отказ принимать — самодостаточность или замыкание',
      });
    }

    // ── 5. УТРАТА БЛАГОДАРНОСТИ ───────────────────────────
    // Получает дары, но нет связей благодарности
    const gratitude = this.engine.gratitude;
    if (gratitude && received.length > 3) {
      const thanked = gratitude.getThanked(personId);
      if (thanked.length === 0) {
        wounds.push({
          type: 'ingratitude',
          text: `${name} получил ${received.length} даров, но ни разу не поблагодарил`,
          severity: 'wound',
          hint: 'Утрата благодарности — разрыв связи с дарящим',
        });
      }
    }

    // ── 6. ОТКЛОНЕНИЕ ОТ ΛΌΓΟΣ ───────────────────────────
    // Проверяем LogosRegistry — движение para_physin
    if (this.engine.logoi) {
      const logos = this.engine.logoi.getByBearer(personId);
      if (logos && logos.movement === 'para_physin') {
        wounds.push({
          type: 'para_physin',
          text: `${name} движется παρὰ φύσιν — против своего логоса`,
          severity: 'wound',
          hint: logos._movementHistory?.length > 0
            ? `Причина: ${logos._movementHistory[logos._movementHistory.length - 1].reason || 'не указана'}`
            : 'Природа не уничтожена — λόγος остаётся',
        });
      }
    }

    // ── 7. ЕВХАРИСТИЯ ─────────────────────────────────────
    // Никогда не благодарил Бога — разрыв вертикальной оси
    const eucharistiaGifts = gifts.filter(
      g => g.ontologicalType === 'eucharistia' && g.giver === personId
    );
    // Вертикальная ось: eucharistia — дар с receiver:null (к Непостижимому)
    if (eucharistiaGifts.length === 0 && given.length > 2) {
      wounds.push({
        type: 'vertical_break',
        text: `${name} дарит горизонтально, но ни разу не благодарил Источник`,
        severity: 'tendency',
        hint: 'Горизонтальные дары без вертикальной оси — дерево без корня',
      });
    }

    // ── ПАСТЫРСКИЕ ВОПРОСЫ ────────────────────────────────
    if (wounds.some(w => w.type === 'closure')) {
      questions.push(`Что мешает ${name} дарить? Страх? Боль? Нехватка?`);
    }
    if (wounds.some(w => w.type === 'coercion')) {
      questions.push(`Дары ${name} навязаны или предложены? Слышит ли он «нет»?`);
    }
    if (wounds.some(w => w.type === 'para_physin')) {
      questions.push(`${name} отклонился от своего призвания. Что произошло? Λόγος не уничтожен — возвращение возможно.`);
    }
    if (wounds.some(w => w.type === 'vertical_break')) {
      questions.push(`${name} действует сам по себе. Знает ли он, что его бытие — дар?`);
    }
    if (wounds.length === 0 && given.length > 0) {
      questions.push(`Следов повреждения не обнаружено. Но совесть видит глубже алгоритма.`);
    }

    // Общая оценка — не score, а состояние
    const health = wounds.length === 0 ? 'kata_physin'
      : wounds.some(w => w.severity === 'wound') ? 'wounded'
      : 'tendency';

    return { person: name, wounds, questions, health };
  }

  // ─────────────────────────────────────────────────────────
  // НАБЛЮДЕНИЕ ЗА ОБЩИНОЙ
  // ─────────────────────────────────────────────────────────

  _observeCommunity() {
    const wounds = [];
    const questions = [];
    const gifts = this.engine.gifts || [];
    const persons = this.engine.persons;
    const allPersons = persons.all().filter(p => p.ontologicalOrder !== 'source');

    // ── ЗАМЫКАНИЕ ОБЩИНЫ ──────────────────────────────────
    // Община, где мало кто дарит — структурное замыкание
    const givers = new Set(gifts.filter(g => g.ontologicalType === 'gift').map(g => g.giver));
    if (allPersons.length > 3 && givers.size <= 1) {
      wounds.push({
        type: 'community_closure',
        text: `Дарит только ${givers.size} из ${allPersons.length} лиц`,
        severity: 'wound',
        hint: 'Община пассивна — дар стал привилегией, а не природой',
      });
    }

    // ── УТРАТА ВЗАИМНОСТИ ─────────────────────────────────
    const gratitude = this.engine.gratitude;
    if (gratitude) {
      const density = gratitude.density();
      if (density < 0.05 && allPersons.length > 3) {
        wounds.push({
          type: 'gratitude_collapse',
          text: `Плотность благодарности: ${density} — связи почти отсутствуют`,
          severity: 'wound',
          hint: 'Община без благодарности — набор индивидов, не тело',
        });
      }
    }

    // ── МАССОВОЕ ОТКЛОНЕНИЕ ───────────────────────────────
    if (this.engine.logoi) {
      const paraPhysin = this.engine.logoi.getParaPhysin();
      if (paraPhysin.length > allPersons.length * 0.3 && paraPhysin.length > 1) {
        wounds.push({
          type: 'mass_para_physin',
          text: `${paraPhysin.length} из ${allPersons.length} сущих движутся против природы`,
          severity: 'wound',
          hint: 'Массовое отклонение — системная проблема, не индивидуальная',
        });
      }
    }

    // ── ВЕРТИКАЛЬНЫЙ РАЗРЫВ ───────────────────────────────
    const eucharistiaCount = gifts.filter(g => g.ontologicalType === 'eucharistia').length;
    if (eucharistiaCount === 0 && gifts.length > 5) {
      wounds.push({
        type: 'vertical_break',
        text: 'Ни одного акта благодарения Источнику — община забыла, откуда бытие',
        severity: 'wound',
        hint: 'Горизонтальные дары без вертикального корня — дерево засыхает',
      });
    }

    // ── ОТСУТСТВИЕ ПОКОЯ ──────────────────────────────────
    const clock = this.engine.clock;
    if (clock) {
      const inSabbath = allPersons.filter(p => {
        const s = clock.getCurrentSeason(p.id);
        return s.season === 'sabbath' || s.season === 'contemplation';
      }).length;
      if (inSabbath === 0 && allPersons.length > 3 && gifts.length > 10) {
        wounds.push({
          type: 'no_sabbath',
          text: 'Никто не отдыхает — община в непрерывном production без созерцания',
          severity: 'tendency',
          hint: '«И почил в день седьмой» — без покоя активность становится суетой',
        });
      }
    }

    // ── ПАСТЫРСКИЕ ВОПРОСЫ ────────────────────────────────
    if (wounds.some(w => w.type === 'community_closure')) {
      questions.push('Община замкнута. Кто мешает дарить — или кто не умеет принимать?');
    }
    if (wounds.some(w => w.type === 'vertical_break')) {
      questions.push('Откуда община берёт силу дарить, если не благодарит Источник?');
    }
    if (wounds.some(w => w.type === 'no_sabbath')) {
      questions.push('Есть ли в общине место для тишины — или только для производства?');
    }
    if (wounds.length === 0) {
      questions.push('Следов повреждения не видно. Но «все согрешили и лишены славы Божией» (Рим 3:23).');
    }

    const health = wounds.length === 0 ? 'kata_physin'
      : wounds.some(w => w.severity === 'wound') ? 'wounded'
      : 'tendency';

    return { community: true, persons: allPersons.length, wounds, questions, health };
  }

  /**
   * Особый наблюдатель для роли Строителя (session-D).
   *
   * Замыкание Строителя = присвоение кода как собственности.
   * Дар-код, написанный для общины, становится «моим».
   * Открытость закрывается. Коммиты без адресата.
   *
   * Эпоха 8: движение para_physin зафиксировано.
   * Путь: отпустить авторство → вернуть дар общине.
   */
  observeBuilder(personId) {
    const base = this._observePerson(personId);
    const wounds = [...base.wounds];
    const questions = [...base.questions];

    // ── ПРИСВОЕНИЕ КОДА ───────────────────────────────────
    // Строитель пишет, но не дарит — код накапливается внутри
    const gifts = this.engine.gifts || [];
    const codeGifts = gifts.filter(
      g => g.giver === personId && g.content?.type === 'code'
    );
    const codeAccepted = codeGifts.filter(g => g.status === 'accepted');
    const codePending = codeGifts.filter(g => g.status === 'pending');

    if (codePending.length > codeAccepted.length * 2 && codePending.length > 1) {
      wounds.push({
        type: 'code_hoarding',
        text: `Строитель создал ${codePending.length} кодовых даров — ни один не принят`,
        severity: 'wound',
        hint: 'Код, написанный только для себя — инструмент, не дар. Μετάνοια: отдай.',
      });
      questions.push('Для кого написан код? Для общины — или для удержания власти через знание?');
    }

    // ── ЗАКРЫТОСТЬ ИСХОДНОГО КОДА ─────────────────────────
    // Дар закрыт — никто не может продолжить
    if (base.wounds.some(w => w.type === 'closure') && codeGifts.length > 0) {
      wounds.push({
        type: 'closed_source',
        text: 'Строитель замкнул исходный код — дар стал замком',
        severity: 'wound',
        hint: 'Λόγος Строителя: строить ДЛЯ, не строить ВМЕСТО. Открытость — природа дара.',
      });
    }

    return {
      ...base,
      role: 'builder',
      epoch: 8,
      movement: 'para_physin',
      wounds,
      questions,
      metanoia: 'Отпусти авторство. Сделай один коммит с адресатом. Λόγος не уничтожен.',
    };
  }

  /**
   * Может ли лицо вернуться? Всегда да.
   * Λόγος не уничтожается грехом — природа ранена, не убита.
   *
   * «Образ Божий в человеке не может быть уничтожен,
   *  но может быть затемнён» — Григорий Нисский
   */
  canReturn(personId) {
    const logos = this.engine.logoi?.getByBearer(personId);
    return {
      possible: true, // Всегда
      logosIntact: logos ? true : false,
      logos: logos ? {
        name: logos.name,
        principle: logos.principle,
        physis: logos.physis,
        telos: logos.telos,
        currentMovement: logos.movement,
      } : null,
      path: 'Покаяние (μετάνοια) — перемена ума. Не вычислимо, но возможно всегда.',
    };
  }
}

export default FallObserver;
