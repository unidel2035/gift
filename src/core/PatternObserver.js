/**
 * PatternObserver — наблюдатель паттернов дарения
 *
 * Заменяет: ClosureDetector, KenosisMetrics, TheosisEngine
 * Принцип: вычисляет ratio/count внутри, наружу отдаёт прозу. Никаких score.
 */
class PatternObserver {
  constructor(engine) {
    this.engine = engine;
  }

  /**
   * Наблюдает паттерны для конкретного лица или всей общины
   * @param {string} [personId] — если не указан, наблюдает за всей общиной
   * @returns {{ observations: Array<{type: string, text: string}>, questions: string[] }}
   */
  observe(personId) {
    if (personId) {
      return this._observePerson(personId);
    }
    return this._observeCommunity();
  }

  _observePerson(personId) {
    const observations = [];
    const questions = [];
    const gifts = this.engine.gifts || [];
    const persons = this.engine.persons;

    const person = persons.get(personId);
    if (!person) return { observations: [{ type: 'error', text: `Лицо ${personId} не найдено` }], questions: [] };

    const name = person.name;

    // Подсчёт дарений
    const given = gifts.filter(g => g.giver === personId);
    const received = gifts.filter(g => g.receiver === personId);
    const givenAccepted = given.filter(g => g.status === 'accepted');
    const receivedAccepted = received.filter(g => g.status === 'accepted');
    const declined = given.filter(g => g.status === 'declined');

    observations.push({
      type: 'giving',
      text: `${name} предложил ${given.length} даров, получил ${received.length}`
    });

    if (givenAccepted.length > 0 || receivedAccepted.length > 0) {
      observations.push({
        type: 'acceptance',
        text: `Принято: ${givenAccepted.length} отданных, ${receivedAccepted.length} полученных`
      });
    }

    if (declined.length > 0) {
      observations.push({
        type: 'declined',
        text: `${declined.length} даров ${name} были отклонены`
      });
    }

    // Тишина — нет активности за последние 14 дней
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recentActivity = gifts.filter(g =>
      (g.giver === personId || g.receiver === personId) &&
      new Date(g.offeredAt || g.createdAt).getTime() > twoWeeksAgo
    );
    if (recentActivity.length === 0 && (given.length > 0 || received.length > 0)) {
      observations.push({
        type: 'silence',
        text: `${name} не участвует более 2 недель`
      });
    }

    // Взаимность
    const gratitude = this.engine.gratitude;
    if (gratitude) {
      const mutualPairs = gratitude.getMutualPairs();
      const hasMutual = mutualPairs.some(p => p.persons[0] === personId || p.persons[1] === personId);
      if (!hasMutual && given.length > 2) {
        observations.push({
          type: 'mutuality',
          text: `Нет взаимных связей благодарности ни с кем`
        });
      }
    }

    // Безличность — все дары «всем» (receiver === 'all' или пустой)
    const impersonal = given.filter(g => !g.receiver || g.receiver === 'all');
    if (impersonal.length > 0 && impersonal.length === given.length && given.length > 2) {
      observations.push({
        type: 'impersonal',
        text: `Все дары безличные (без конкретного получателя)`
      });
    }

    // Вопросы (пастырские)
    if (received.length > given.length * 3 && received.length > 3) {
      questions.push(`${name} получает значительно больше, чем дарит. Нужна ли поддержка?`);
    }
    if (given.length > received.length * 3 && given.length > 3) {
      questions.push(`${name} дарит значительно больше, чем получает. Не истощение ли это?`);
    }
    if (impersonal.length === given.length && given.length > 2) {
      questions.push(`Все дары безличные. Есть ли возможность личного дарения?`);
    }
    if (declined.length > givenAccepted.length && declined.length > 2) {
      questions.push(`Большинство даров ${name} отклонены. Что стоит за этим?`);
    }

    return { observations, questions };
  }

  _observeCommunity() {
    const observations = [];
    const questions = [];
    const gifts = this.engine.gifts || [];
    const persons = this.engine.persons;

    const totalPersons = persons.count();
    const totalGifts = gifts.length;
    const accepted = gifts.filter(g => g.status === 'accepted').length;
    const declined = gifts.filter(g => g.status === 'declined').length;
    const offered = gifts.filter(g => g.status === 'offered').length;

    observations.push({
      type: 'community',
      text: `Община: ${totalPersons} лиц, ${totalGifts} даров (${accepted} принято, ${declined} отклонено, ${offered} ожидают)`
    });

    // Активные дарители
    const givers = new Set(gifts.map(g => g.giver));
    const receivers = new Set(gifts.filter(g => g.receiver && g.receiver !== 'all').map(g => g.receiver));
    const onlyGivers = [...givers].filter(g => !receivers.has(g));
    const onlyReceivers = [...receivers].filter(r => !givers.has(r));

    if (onlyGivers.length > 0) {
      const names = onlyGivers.map(id => persons.get(id)?.name || id).join(', ');
      observations.push({
        type: 'asymmetry',
        text: `Только дарят (не получают): ${names}`
      });
    }
    if (onlyReceivers.length > 0) {
      const names = onlyReceivers.map(id => persons.get(id)?.name || id).join(', ');
      observations.push({
        type: 'asymmetry',
        text: `Только получают (не дарят): ${names}`
      });
    }

    // Плотность благодарности
    const gratitude = this.engine.gratitude;
    if (gratitude) {
      const density = gratitude.density();
      if (density < 0.1 && totalPersons > 2) {
        observations.push({
          type: 'gratitude',
          text: `Плотность благодарности низкая — мало взаимных связей`
        });
      }
    }

    // Тишина в общине
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentGifts = gifts.filter(g => new Date(g.offeredAt || g.createdAt).getTime() > oneWeekAgo);
    if (recentGifts.length === 0 && totalGifts > 0) {
      observations.push({
        type: 'silence',
        text: `Нет новых даров за последнюю неделю`
      });
    }

    // Вопросы
    if (declined > accepted && totalGifts > 5) {
      questions.push('Больше даров отклонено, чем принято. Что мешает принятию?');
    }
    if (offered > accepted + declined && offered > 3) {
      questions.push('Много даров ожидают ответа. Община замерла?');
    }
    if (totalPersons > 3 && givers.size <= 1) {
      questions.push('Дарит только один человек. Община пассивна?');
    }

    return { observations, questions };
  }
}

export default PatternObserver;
