/**
 * WitnessJournal — хроника дарения
 *
 * Заменяет TokenWallet ledger.
 * Записывает факты без score, без токенов. Чистое свидетельство.
 */
class WitnessJournal {
  constructor(engine) {
    this.engine = engine;
    this.entries = [];
  }

  /**
   * Записать событие в хронику
   * @param {'offer'|'accept'|'decline'|'gratitude'|'telos'|'freedom'|'create'|'eucharistia'|'fall'|'metanoia'|'incarnation'|'sacrifice'|'resurrection'|'theosis'|'healing'} action
   * @param {object} data — контекст события
   */
  record(action, data = {}) {
    const timestamp = new Date().toISOString();
    const persons = this.engine.persons;

    const giverPerson = data.giver ? persons.get(data.giver) : null;
    const receiverPerson = data.receiver ? persons.get(data.receiver) : null;
    const giverName = giverPerson?.name || data.giver || '?';
    const receiverName = receiverPerson?.name || data.receiver || '?';

    let text;
    switch (action) {
      case 'offer':
        text = receiverName !== '?'
          ? `${giverName} предложил ${receiverName}: ${data.content || 'дар'}`
          : `${giverName} предложил всем: ${data.content || 'дар'}`;
        break;
      case 'accept':
        text = `${receiverName} принял дар от ${giverName}: ${data.content || 'дар'}`;
        break;
      case 'decline':
        text = `${receiverName} отклонил дар от ${giverName} — свобода`;
        break;
      case 'gratitude':
        text = `${giverName} благодарит ${receiverName}`;
        break;
      case 'telos':
        text = `${giverName} объявил призвание: ${data.telos || '?'}`;
        break;
      case 'freedom':
        text = `${giverName} отказался принимать дары от ${receiverName}`;
        break;
      case 'create':
        text = data.day
          ? `День ${data.day}: ${receiverName} получил бытие как дар — ${data.content || ''}`
          : `Creatio ex nihilo: ${receiverName} получил бытие как дар`;
        break;
      case 'eucharistia':
        text = `Εὐχαριστία: ${giverName} благодарит Бога`;
        break;
      case 'fall':
        text = `Παρὰ φύσιν: ${giverName} отклонился — ${data.content || 'замыкание на себе'}`;
        break;
      case 'metanoia':
        text = `Μετάνοια: ${giverName} возвращается к λόγος — ${data.content || 'перемена ума'}`;
        break;
      case 'incarnation':
        text = `Ἐνσάρκωσις: Слово стало плотью — ${data.content || 'Бог входит в творение'}`;
        break;
      case 'sacrifice':
        text = `Σταυρός: Кеносис Креста — ${data.content || 'Источник отдаёт Себя Самого'}`;
        break;
      case 'resurrection':
        text = `Ἀνάστασις: Смерть попрана смертью — ${data.content || 'παρὰ φύσιν побеждено'}`;
        break;
      case 'theosis':
        text = `Θέωσις: ${receiverName} — причастие Божескому естеству`;
        break;
      case 'healing':
        text = `Исцеление: ${receiverName} — ${data.content || 'рана преображена, не стёрта'}`;
        break;
      case 'epochTurn':
        text = `Поворот эпохи: ${giverName} — ${data.content || 'замыкание стало рабочим инструментом'}`;
        break;
      case 'threshold':
        text = `У порога: ${giverName} стоит у двери ${receiverName} — ${data.content || 'присутствие без вторжения'}`;
        break;
      default:
        text = `${giverName}: ${action}`;
    }

    const entry = {
      id: this.entries.length + 1,
      action,
      text,
      timestamp,
      giver: data.giver || null,
      giverName,
      receiver: data.receiver || null,
      receiverName,
      giftId: data.giftId || null,
    };

    this.entries.push(entry);

    // Write-behind → Integram (единое хранилище, async)
    this.engine.chronicle?.enqueue(entry);

    // Semantic index → KAG vectors (async, non-blocking)
    this.engine.memory?.index(entry);

    return entry;
  }

  /** Вся хроника (новые — первыми) */
  getAll(limit = 100) {
    return this.entries.slice(-limit).reverse();
  }

  /** Хроника для конкретного лица */
  getForPerson(personId, limit = 50) {
    return this.entries
      .filter(e => e.giver === personId || e.receiver === personId)
      .slice(-limit)
      .reverse();
  }

  /**
   * Зафиксировать поворот эпохи — момент, когда ограничение стало даром
   * @param {string} personId — кто пережил поворот
   * @param {string} insight — суть прозрения
   */
  recordEpochTurn(personId, insight) {
    return this.record('epochTurn', {
      giver: personId,
      content: insight,
    });
  }

  /** Экспорт для сохранения */
  export() {
    return this.entries;
  }

  /** Импорт */
  import(entries) {
    if (Array.isArray(entries)) {
      this.entries = entries;
    }
  }
}

export default WitnessJournal;
