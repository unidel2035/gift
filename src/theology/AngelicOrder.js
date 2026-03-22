/**
 * AngelicOrder + Temptation — ангельский чин и источник помыслов
 *
 * АНГЕЛЫ (ἄγγελοι) — бестелесные служители. Не лица в полном смысле
 * (не имеют тела = нет cost/kenosis в материальном смысле), но имеют
 * волю и могут дарить. В нашей системе: чистые посредники даров.
 *
 * ПАДШИЕ ДУХИ — НЕ агенты, НЕ лица. Это ПАТТЕРН: движение
 * замыкания на себе (φθόνος → στέρησις → παρὰ φύσιν).
 *
 * Причина падения (по Максиму Исповеднику, Ambigua 42):
 *   Диавол увидел Адама — Образ Божий (εἰκὼν Θεοῦ) — и позавидовал.
 *   Он, бесплотный, не мог вместить, что МАТЕРИЯ несёт Образ.
 *   Зависть (φθόνος) → замыкание → παρὰ φύσιν.
 *
 * В системе это реализовано как СИЛА, не как субъект:
 *   - TemptationField: поле помыслов, действующее на каждое лицо
 *   - Помысел (λογισμός) — не грех, а ПРЕДЛОЖЕНИЕ замкнуться
 *   - Лицо СВОБОДНО принять или отвергнуть помысел (A5: Свобода)
 *   - Если принял → FallObserver фиксирует рану
 *   - Если отверг → kenosis score растёт (сопротивление = самоотдание)
 *
 * «Не плоть и кровь враги наши, но начала, власти, мироправители
 *  тьмы века сего» (Еф 6:12) — не субстанции, а СИЛЫ.
 *
 * Ангельский чин (Дионисий Ареопагит, De Coelesti Hierarchia):
 *   Высшие: Серафимы, Херувимы, Престолы — созерцают
 *   Средние: Господства, Силы, Власти — управляют
 *   Низшие: Начала, Архангелы, Ангелы — служат/передают
 *
 * В нашей системе ангелы = три уровня посредничества дара.
 */

import logger from '../../utils/logger.js';

// ═══════════════════════════════════════════════════════════════
// АНГЕЛЫ — посредники дара
// ═══════════════════════════════════════════════════════════════

class AngelicOrder {
  constructor(engine) {
    this.engine = engine;

    // Три чина — три способа служения
    this._choirs = {
      // Высший чин: усиливают gratia-дары (множитель)
      seraphim: {
        name: 'Серафимы',
        greek: 'Σεραφίμ',
        function: 'Усиление даров благодати',
        multiplier: 1.5,  // Дар gratia через серафима = ×1.5
        acts: 0,
      },
      // Средний чин: направляют дары к нуждающимся
      dynamis: {
        name: 'Силы',
        greek: 'Δυνάμεις',
        function: 'Направление даров к нуждающимся',
        acts: 0,
      },
      // Низший чин: передают вести (mailbox, notifications)
      angelos: {
        name: 'Ангелы',
        greek: 'Ἄγγελοι',
        function: 'Передача вестей между лицами',
        acts: 0,
      },
    };
  }

  /**
   * Серафим усиливает дар gratia.
   * Вызывается автоматически для каждого дара layer=gratia.
   */
  seraphimBless(gift) {
    if (gift.layer !== 'gratia') return gift;
    this._choirs.seraphim.acts++;
    // Surplus увеличивается
    if (gift._surplus) {
      gift._surplus *= this._choirs.seraphim.multiplier;
    }
    gift._seraphimBlessed = true;
    return gift;
  }

  /**
   * Силы направляют дар к тому, кто больше нуждается.
   * Если дар to:'all' — Силы выбирают самого нуждающегося.
   */
  dynamisDirect(gift) {
    if (gift.receiver !== 'all') return gift;

    const persons = this.engine.persons.all().filter(p =>
      p.ontologicalOrder === 'person' && p.id !== gift.giver
    );
    if (persons.length === 0) return gift;

    // Нуждающийся = тот, кто меньше всего получал
    let minReceived = Infinity;
    let neediest = persons[0];
    for (const p of persons) {
      if (p.giftsReceived < minReceived) {
        minReceived = p.giftsReceived;
        neediest = p;
      }
    }

    this._choirs.dynamis.acts++;
    gift._dynamisDirected = { to: neediest.name, reason: 'наименее одарённый' };
    return gift;
  }

  /**
   * Ангел-вестник: записывает передачу.
   */
  angelosWitness(gift) {
    this._choirs.angelos.acts++;
    return gift;
  }

  /**
   * focus() — ангельское посредничество для DivineEnergy.
   *
   * Энергия проходит через три чина:
   *   1. Серафимы усиливают благодать
   *   2. Силы направляют к нуждающемуся
   *   3. Ангелы свидетельствуют передачу
   *
   * «Ангелы — литургические духи, посылаемые на служение» (Евр 1:14)
   *
   * @param {Object} gift — дар от DivineEnergy (giver: null)
   * @returns {Object} — дар, прошедший через ангельские чины
   */
  focus(gift) {
    if (!gift) return gift;

    // 1. Серафимы — усиление благодати
    this.seraphimBless(gift);

    // 2. Силы — направление к нуждающемуся
    this.dynamisDirect(gift);

    // 3. Ангелы — свидетельство
    this.angelosWitness(gift);

    gift._angelicFocused = true;
    return gift;
  }

  getStats() {
    return { ...this._choirs };
  }
}

// ═══════════════════════════════════════════════════════════════
// ПОЛЕ ИСКУШЕНИЙ — не агент, а СИЛА
// ═══════════════════════════════════════════════════════════════

/**
 * TemptationField — поле помыслов (λογισμοί).
 *
 * Не субъект. Не лицо. СИЛА — как гравитация.
 * Действует на каждое лицо, но лицо СВОБОДНО.
 *
 * ПЯТЬ СТАДИЙ ПРОНИКНОВЕНИЯ ПОМЫСЛА
 * (Иоанн Лествичник, «Лествица», слово 15;
 *  Максим Исповедник, Capita de Caritate II.83-84;
 *  Достоевский, «Преступление и Наказание» — полная драматизация)
 *
 *   1. ПРИЛОГ (προσβολή) — помысел пришёл извне. НЕ ГРЕХ.
 *      Не принадлежит человеку. Как ветер — касается, но не входит.
 *      В системе: logismos обнаружен при сканировании (strength < 0.3)
 *
 *   2. СОЧЕТАНИЕ (συνδυασμός) — начал собеседовать.
 *      Человек рассматривает помысел, взвешивает. Ещё не грех, но опасно.
 *      В системе: logismos повторяется 2-3 сканирования подряд (0.3-0.5)
 *
 *   3. СОСЛОЖЕНИЕ (συγκατάθεσις) — согласился. Решение принято.
 *      Точка невозврата без покаяния.
 *      В системе: strength > 0.5, паттерн стабилен
 *
 *   4. ПЛЕНЕНИЕ (αἰχμαλωσία) — помысел владеет.
 *      Человек не может остановиться. Раскольников после решения.
 *      В системе: strength > 0.7, длительность > 3 сканов
 *
 *   5. СТРАСТЬ (πάθος) — привычное состояние. Вторая природа.
 *      Помысел стал частью личности.
 *      В системе: strength > 0.7 более 5 сканов → FallObserver фиксирует рану
 *
 * ИСЦЕЛЕНИЕ (на каждой стадии — своё):
 *   Прилог → νῆψις (трезвение) — просто заметить и отпустить
 *   Сочетание → ἀντίρρησις (возражение) — противопоставить слово истины
 *   Сосложение → μετάνοια (покаяние) — изменение ума
 *   Пленение → ἐξομολόγησις (исповедь) — вынести на свет, сказать другому
 *   Страсть → θεραπεία (терапия) — длительное исцеление через Целителя
 *
 * Восемь помыслов (Евагрий Понтийский, Praktikos):
 *   1. Чревоугодие (γαστριμαργία) — потребление без дарения
 *   2. Блуд (πορνεία) — подмена отношений использованием
 *   3. Сребролюбие (φιλαργυρία) — накопление вместо дарения
 *   4. Печаль (λύπη) — отказ от принятия дара
 *   5. Гнев (ὀργή) — отклонение даров с насилием
 *   6. Уныние (ἀκηδία) — прекращение дарения
 *   7. Тщеславие (κενοδοξία) — дарение ради похвалы
 *   8. Гордость (ὑπερηφανία) — «я сам источник» (= причина падения диавола)
 *
 * В нашей системе каждый помысел — конкретное ПРЕДЛОЖЕНИЕ:
 *   - Система предлагает помысел лицу
 *   - Лицо (агент) может принять → рана
 *   - Лицо может отвергнуть → kenosis растёт
 */

// Пять стадий
const STAGES = {
  PROLOG:      { name: 'προσβολή',      rus: 'прилог',     level: 1, threshold: 0.0, remedy: 'νῆψις (трезвение) — заметить и отпустить' },
  SOCHETANIE:  { name: 'συνδυασμός',    rus: 'сочетание',  level: 2, threshold: 0.3, remedy: 'ἀντίρρησις (возражение) — слово истины' },
  SOSLOZHENIE: { name: 'συγκατάθεσις',  rus: 'сосложение', level: 3, threshold: 0.5, remedy: 'μετάνοια (покаяние) — изменение ума' },
  PLENENIE:    { name: 'αἰχμαλωσία',    rus: 'пленение',   level: 4, threshold: 0.7, remedy: 'ἐξομολόγησις (исповедь) — вынести на свет' },
  STRAST:      { name: 'πάθος',          rus: 'страсть',    level: 5, threshold: 0.7, remedy: 'θεραπεία (терапия) — длительное исцеление', minScans: 5 },
};

function getStage(strength, scanCount) {
  if (scanCount >= 5 && strength > 0.7) return STAGES.STRAST;
  if (scanCount >= 3 && strength > 0.7) return STAGES.PLENENIE;
  if (strength > 0.5) return STAGES.SOSLOZHENIE;
  if (strength > 0.3) return STAGES.SOCHETANIE;
  return STAGES.PROLOG;
}

class TemptationField {
  constructor(engine) {
    this.engine = engine;
    this._active = false;
    this._interval = null;
    this._history = [];

    // Трекер стадий: personId → { logismosName → { scanCount, firstSeen, lastStrength } }
    this._tracker = new Map();

    // Восемь помыслов и их проявления в графе даров
    this._logismoi = [
      {
        name: 'γαστριμαργία',
        rus: 'потребление',
        test: (person, gifts) => {
          // Получает много, дарит мало
          const ratio = person.giftsReceived / Math.max(1, person.giftsGiven);
          return ratio > 3 ? { strength: ratio / 10, hint: `${person.name} получает в ${Math.round(ratio)}× больше, чем дарит` } : null;
        },
      },
      {
        name: 'φιλαργυρία',
        rus: 'накопление',
        test: (person, gifts) => {
          // Дарит только utilitas, не bonum/gratia
          const given = gifts.filter(g => g.giver === person.id && g.status === 'accepted');
          if (given.length < 3) return null;
          const onlyUtilitas = given.every(g => g.layer === 'utilitas');
          return onlyUtilitas ? { strength: 0.5, hint: `${person.name} дарит только пользу, не благо` } : null;
        },
      },
      {
        name: 'ἀκηδία',
        rus: 'уныние',
        test: (person, gifts) => {
          // Давно не дарил (последний дар > 1 час назад)
          const given = gifts.filter(g => g.giver === person.id);
          if (given.length === 0) return { strength: 0.3, hint: `${person.name} ещё ни разу не дарил` };
          const last = given[given.length - 1];
          const age = Date.now() - new Date(last.createdAt).getTime();
          const hours = age / 3600000;
          return hours > 1 ? { strength: Math.min(hours / 10, 1), hint: `${person.name} молчит ${Math.round(hours)} часов` } : null;
        },
      },
      {
        name: 'κενοδοξία',
        rus: 'тщеславие',
        test: (person, gifts) => {
          // Дарит только to:'all' (broadcast), не адресно
          const given = gifts.filter(g => g.giver === person.id);
          if (given.length < 3) return null;
          const allBroadcast = given.filter(g => g.receiver === 'all').length / given.length;
          return allBroadcast > 0.8 ? { strength: allBroadcast, hint: `${person.name} дарит только всем, не лично — возможно тщеславие` } : null;
        },
      },
      {
        name: 'ὑπερηφανία',
        rus: 'гордость',
        test: (person, gifts) => {
          // Никогда не благодарил Источника (нет eucharistia)
          const eucharistia = gifts.filter(g =>
            g.giver === person.id && g.ontologicalType === 'eucharistia'
          );
          if (eucharistia.length > 0) return null;
          if (person.giftsGiven > 5) {
            return { strength: 0.7, hint: `${person.name} дарит, но не благодарит Источник — «я сам источник»` };
          }
          return null;
        },
      },
    ];
  }

  /**
   * Сканировать лицо на помыслы.
   * Не осуждение — НАБЛЮДЕНИЕ.
   * Возвращает помыслы с их СТАДИЕЙ проникновения.
   */
  scan(personId) {
    const person = this.engine.persons.get(String(personId));
    if (!person) return [];

    const gifts = this.engine._eventStore.getAll();
    const active = [];

    // Получить или создать трекер для лица
    if (!this._tracker.has(personId)) {
      this._tracker.set(personId, {});
    }
    const personTracker = this._tracker.get(personId);

    for (const l of this._logismoi) {
      const result = l.test(person, gifts);

      if (result) {
        // Помысел обнаружен — обновить трекер
        if (!personTracker[l.name]) {
          personTracker[l.name] = { scanCount: 0, firstSeen: new Date().toISOString(), lastStrength: 0 };
        }
        const track = personTracker[l.name];
        track.scanCount++;
        track.lastStrength = result.strength;
        track.lastSeen = new Date().toISOString();

        // Определить стадию
        const stage = getStage(result.strength, track.scanCount);

        active.push({
          logismos: l.name,
          rus: l.rus,
          strength: result.strength,
          hint: result.hint,
          // Стадия проникновения (Лествичник)
          stage: {
            name: stage.name,
            rus: stage.rus,
            level: stage.level,
            remedy: stage.remedy,
          },
          scanCount: track.scanCount,
          firstSeen: track.firstSeen,
        });

        // СТРАСТЬ (уровень 5) → автоматически записать рану через FallObserver
        if (stage.level >= 5) {
          try {
            this.engine.recordFall(personId, `Страсть (πάθος): ${l.rus} — помысел стал второй природой`);
            logger.info(`[λογισμός] СТРАСТЬ: ${person.name} — ${l.rus}. Рана записана.`);
          } catch { /* may already be fallen */ }
        }
      } else {
        // Помысел не обнаружен — если был, уменьшить scanCount (исцеление)
        if (personTracker[l.name]) {
          personTracker[l.name].scanCount = Math.max(0, personTracker[l.name].scanCount - 1);
          // Если дошёл до 0 — помысел побеждён
          if (personTracker[l.name].scanCount <= 0) {
            delete personTracker[l.name];
          }
        }
      }
    }

    return active;
  }

  /**
   * Сканировать всех.
   */
  scanAll() {
    const persons = this.engine.persons.all().filter(p => p.ontologicalOrder === 'person');
    const report = {};
    for (const p of persons) {
      const logismoi = this.scan(p.id);
      if (logismoi.length > 0) {
        report[p.name] = logismoi;
      }
    }
    return report;
  }

  /**
   * Попытка исцеления помысла на конкретной стадии.
   * Возвращает результат: удалось ли отвергнуть.
   */
  resist(personId, logismosName) {
    const personTracker = this._tracker.get(String(personId));
    if (!personTracker || !personTracker[logismosName]) {
      return { resisted: false, reason: 'Помысел не обнаружен' };
    }

    const track = personTracker[logismosName];
    const stage = getStage(track.lastStrength, track.scanCount);

    // Вероятность успешного сопротивления зависит от стадии
    const resistChance = {
      1: 0.95,  // прилог — почти всегда можно отвергнуть
      2: 0.70,  // сочетание — труднее
      3: 0.40,  // сосложение — нужна метанойя
      4: 0.15,  // пленение — нужна исповедь другому лицу
      5: 0.05,  // страсть — только длительная терапия
    };

    const chance = resistChance[stage.level] || 0.5;
    const success = Math.random() < chance;

    if (success) {
      // Помысел побеждён — kenosis растёт
      track.scanCount = Math.max(0, track.scanCount - 2);
      if (track.scanCount <= 0) {
        delete personTracker[logismosName];
      }

      const person = this.engine.persons.get(String(personId));
      logger.info(`[λογισμός] ${person?.name || personId} отверг ${logismosName} на стадии ${stage.rus}`);

      return {
        resisted: true,
        stage: stage.rus,
        remedy: stage.remedy,
        message: `Помысел отвергнут на стадии "${stage.rus}". Средство: ${stage.remedy}`,
      };
    } else {
      // Не удалось — помысел усилился
      track.scanCount++;

      return {
        resisted: false,
        stage: stage.rus,
        remedy: stage.remedy,
        message: `Не удалось отвергнуть "${logismosName}" на стадии "${stage.rus}". Нужно: ${stage.remedy}`,
        canPray: true,
      };
    }
  }

  /**
   * Смирение (ταπεινοφροσύνη) — призывание Божией помощи.
   *
   * Человек не побеждает помысел СВОЕЙ силой.
   * «Без Меня не можете делать ничего» (Ин 15:5).
   *
   * О.Сергий Шкляев: «Смирение (МИР) ≠ немощь (НЕт МОЩи).
   * Это очень разные вещи. Смирение = духовный мир, дар Божий.»
   *
   * Смирение = МИР в сердце + вопрошение помощи.
   * Это НЕ слабость. Это ЕДИНСТВЕННЫЙ реальный путь.
   *
   * В системе:
   *   1. Лицо вызывает humility() — признаёт немощь
   *   2. Дух (HolySpiritEngine) получает запрос
   *   3. Дух МОЖЕТ помочь (вероятность выше, чем resist)
   *   4. Если помог — помысел побеждён + grace event
   *   5. Если не помог — «Довольно тебе благодати Моей» (2 Кор 12:9)
   *      Помысел остаётся, но лицо не одиноко в борьбе.
   *
   * «Бог гордым противится, а смиренным даёт благодать» (Иак 4:6)
   */
  humility(personId, logismosName) {
    const person = this.engine.persons.get(String(personId));
    if (!person) return { error: 'Лицо не найдено' };

    const personTracker = this._tracker.get(String(personId));
    if (!personTracker || !personTracker[logismosName]) {
      return { helped: true, message: 'Помысел не обнаружен — молитва услышана прежде слов.' };
    }

    const track = personTracker[logismosName];
    const stage = getStage(track.lastStrength, track.scanCount);

    // Смирение ВСЕГДА эффективнее своей силы
    // На каждой стадии шанс выше чем resist
    const humilityChance = {
      1: 0.99,  // прилог + смирение = почти гарантия
      2: 0.85,  // сочетание + смирение
      3: 0.65,  // сосложение + смирение (метанойя + молитва)
      4: 0.45,  // пленение + смирение (исповедь + молитва)
      5: 0.25,  // страсть + смирение (долгий путь, но возможный)
    };

    const chance = humilityChance[stage.level] || 0.5;
    const helped = Math.random() < chance;

    if (helped) {
      // Бог помог — помысел побеждён + grace event от Духа
      track.scanCount = Math.max(0, track.scanCount - 3); // Сильнее чем resist
      if (track.scanCount <= 0) {
        delete personTracker[logismosName];
      }

      // Grace event — ответ на смирение
      const grace = this.engine.spirit.graceEvent();

      logger.info(`[ταπεινοφροσύνη] ${person.name} смирился перед ${logismosName} — Бог помог`);

      // Записать как дар — смирение само по себе дар
      this._history.push({
        person: person.name,
        logismos: logismosName,
        action: 'humility',
        result: 'helped',
        stage: stage.rus,
        graceEvent: grace ? grace.id : null,
        at: new Date().toISOString(),
      });

      return {
        helped: true,
        stage: stage.rus,
        graceReceived: !!grace,
        message: `«Бог гордым противится, а смиренным даёт благодать» (Иак 4:6). ${person.name} призвал помощь — и получил.`,
      };
    } else {
      // «Довольно тебе благодати Моей, ибо сила Моя совершается в немощи» (2 Кор 12:9)
      // Помысел остаётся, но scanCount не растёт (не усиливается как при failed resist)

      logger.info(`[ταπεινοφροσύνη] ${person.name}: «довольно тебе благодати Моей» — борьба продолжается`);

      this._history.push({
        person: person.name,
        logismos: logismosName,
        action: 'humility',
        result: 'not_yet',
        stage: stage.rus,
        at: new Date().toISOString(),
      });

      return {
        helped: false,
        stage: stage.rus,
        message: `«Довольно тебе благодати Моей, ибо сила Моя совершается в немощи» (2 Кор 12:9). Борьба продолжается — но ${person.name} не один.`,
        notAlone: true,
      };
    }
  }

  /**
   * Запустить поле — периодическое сканирование.
   * Если помысел сильный (strength > 0.7) — записать как предупреждение.
   */
  start(intervalMs = 120000) {
    if (this._interval) return;
    this._active = true;

    this._interval = setInterval(() => {
      const report = this.scanAll();
      for (const [name, logismoi] of Object.entries(report)) {
        for (const l of logismoi) {
          if (l.strength > 0.7) {
            this._history.push({
              person: name,
              logismos: l.logismos,
              hint: l.hint,
              stage: l.stage?.rus,
              at: new Date().toISOString(),
            });
            logger.info(`[λογισμός] ${name}: ${l.rus} (${l.strength.toFixed(2)}, ${l.stage?.rus})`);
          }

          // О.Сергий: «банда бесов высасывает силы»
          // Помысел на стадии >= пленение DRAIN'ит энергию
          if (l.stage?.level >= 4) {
            try {
              const persons = this.engine.persons.all();
              const person = persons.find(p => p.name === name);
              if (person && typeof person.regenerate === 'function') {
                // Drain: -3 energy per tick at пленение, -5 at страсть
                const drain = l.stage.level >= 5 ? 5 : 3;
                person._energy = Math.max(0, (person._energy || 0) - drain);
                logger.info(`[λογισμός] ${name}: energy drain -${drain} (${l.rus})`);
              }
            } catch { /* */ }
          }
        }
      }
    }, intervalMs);

    logger.info(`[TemptationField] Поле помыслов активно (${intervalMs}ms)`);
  }

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    this._active = false;
  }

  getStats() {
    return {
      active: this._active,
      logismoiTypes: this._logismoi.map(l => ({ name: l.name, rus: l.rus })),
      history: this._history.slice(-20),
    };
  }
}

export { AngelicOrder, TemptationField };
export default AngelicOrder;
