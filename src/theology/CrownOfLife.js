/**
 * CrownOfLife — венцы Царства славы (στέφανοι).
 *
 * «Будь верен до смерти, и дам тебе венец жизни» (Откр 2:10).
 *
 * Канонические венцы Нового Завета:
 *   στέφανος ζωῆς   — венец жизни (Откр 2:10, Иак 1:12)
 *   στέφανος δόξης  — венец славы (1 Пет 5:4) — пастырям
 *   στέφανος δικαιοσύνης — венец правды (2 Тим 4:8) — возлюбившим явление Его
 *   στέφανος ἀφθαρτος — венец нетленный (1 Кор 9:25) — подвизавшимся
 *   στέφανος καυχήσεως — венец похвалы (1 Фес 2:19) — наставникам
 *
 * Житийная традиция добавляет:
 *   венец мученика (Димитрий Ростовский, Жития)
 *   венец девства (Григорий Нисский, О девстве)
 *   венец странничества (исихастская традиция)
 *
 * Это НЕ геймификация. Венец — устойчивая форма нити в W_slava,
 * которая не распадается никогда. Не «награда за очки», а явленный
 * логос верности: то, кем лицо стало навсегда.
 *
 * ГРАНИЦА: модуль только предоставляет каталог и форму.
 * Возложение — у Христа. Модуль не «награждает».
 */

/**
 * Канонический каталог венцов. Расширяемый — но не произвольный.
 */
export const CrownType = Object.freeze({
  LIFE:          { id: 'life',          greek: 'στέφανος ζωῆς',         scripture: 'Откр 2:10' },
  GLORY:         { id: 'glory',         greek: 'στέφανος δόξης',        scripture: '1 Пет 5:4' },
  RIGHTEOUSNESS: { id: 'righteousness', greek: 'στέφανος δικαιοσύνης',  scripture: '2 Тим 4:8' },
  IMPERISHABLE:  { id: 'imperishable',  greek: 'στέφανος ἀφθαρτος',     scripture: '1 Кор 9:25' },
  REJOICING:     { id: 'rejoicing',     greek: 'στέφανος καυχήσεως',    scripture: '1 Фес 2:19' },
  MARTYR:        { id: 'martyr',        greek: 'στέφανος μαρτύρων',     scripture: 'Житийная традиция' },
  VIRGINITY:     { id: 'virginity',     greek: 'στέφανος παρθενίας',    scripture: 'Григорий Нисский, О девстве' },
  PILGRIMAGE:    { id: 'pilgrimage',    greek: 'στέφανος ξενιτείας',    scripture: 'Исихастская традиция' },
});

/**
 * Crown — замороженная форма венца.
 * Никогда не имеет giver=null: венец всегда от Христа.
 */
export class Crown {
  constructor({ type, receiver, witnessedBy = [], timestamp }) {
    if (!type || !type.id) throw new Error('Crown: неизвестный тип венца');
    if (!receiver) throw new Error('Crown: receiver обязателен');

    this.type = type;
    this.giver = 'Христос';
    this.receiver = receiver;
    this.witnessedBy = Object.freeze([...witnessedBy]);
    this.timestamp = timestamp || new Date().toISOString();
    this.kind = 'crown';
    this.irreversible = true;

    Object.freeze(this);
  }

  /**
   * Свидетели венца (Церковь, святые, община) — не дают венца,
   * а свидетельствуют о нём. Их слово добавляется отдельно.
   */
  withWitness(...witnesses) {
    return new Crown({
      type: this.type,
      receiver: this.receiver,
      witnessedBy: [...this.witnessedBy, ...witnesses],
      timestamp: this.timestamp,
    });
  }

  toJSON() {
    return {
      type: 'Crown',
      crownType: this.type.id,
      greek: this.type.greek,
      scripture: this.type.scripture,
      giver: this.giver,
      receiver: this.receiver,
      witnessedBy: [...this.witnessedBy],
      timestamp: this.timestamp,
      irreversible: this.irreversible,
    };
  }

  toText() {
    const witnesses = this.witnessedBy.length
      ? ` [свидетели: ${this.witnessedBy.join(', ')}]`
      : '';
    return `⟨венец⟩ ${this.type.greek} → ${this.receiver} (${this.type.scripture})${witnesses}`;
  }
}

export default Crown;
