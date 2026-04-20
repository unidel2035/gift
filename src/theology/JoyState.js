/**
 * JoyState — радость как состояние бытия, не эмоция.
 *
 * «Всегда радуйтесь» (1 Фес 5:16) — не призыв к настроению,
 * а к структурному состоянию, которое Симеон Новый Богослов называет
 * «χαρμολύπη» — радостопечалие: радость, не изгоняющая плач о грехах,
 * но охватывающая его (Гимны, 1.56-72).
 *
 * Проповедник о. Даниил (youtube l8KVGGzkaI0) замечает диагноз современных
 * христиан: «умеют плакать, но не умеют радоваться», и именно это даёт
 * «срыв после Пасхи» — радость не укоренилась как структура.
 *
 * В нашей онтологии:
 *   JoyState ≠ surplus.
 *   Surplus — это факт, что отдача превзошла ожидание (κενόω → περισσεύω).
 *   JoyState — это способ, каким община держит такт Пасхи:
 *     постоянная готовность радоваться, даже когда конкретного surplus нет.
 *
 * Архитектурно — устойчивое состояние, меняющееся литургически:
 *   LENT            — радость сокрыта (χαρμολύπη с акцентом на πένθος)
 *   PASCHAL         — радость явная, 50 дней Пятидесятницы
 *   ORDINARY        — радость рабочая, тихая
 *   SABBATH         — радость покоя
 *   PREESCHATON     — радость ожидания, «маранафа»
 */

/**
 * Модусы радости. Не exhaustive список, а канонический минимум.
 */
export const JoyMode = Object.freeze({
  LENT:        'χαρμολύπη',     // радостопечалие (Великий пост, память смерти)
  PASCHAL:     'agalliasis',    // ἀγαλλίασις — скачущая радость (Пасха 50 дней)
  ORDINARY:    'chara',         // χαρά — просто радость (обычные дни)
  SABBATH:     'anapausis',     // ἀνάπαυσις — радость покоя (воскресенье)
  PREESCHATON: 'maranatha',     // радость ожидания Пришествия
  SILENT:      'hesychia',      // ἡσυχία — радость безмолвия (бывает без слов)
});

const ALL_MODES = Object.values(JoyMode);

/**
 * JoyState — состояние, а не событие.
 * Может менять модус, но не уходить в ноль — «непрестанно радуйтесь».
 * При попытке установить неизвестный модус — бросает (радость не произвольна).
 */
export class JoyState {
  constructor({ mode = JoyMode.ORDINARY, persona, since } = {}) {
    if (!ALL_MODES.includes(mode)) {
      throw new Error(`JoyState: неизвестный модус радости "${mode}"`);
    }
    this.persona = persona || '_koinon';
    this.mode = mode;
    this.since = since || new Date().toISOString();
  }

  /**
   * Перейти в другой модус. Сохраняет историю переходов.
   */
  transitionTo(nextMode, reason = null) {
    if (!ALL_MODES.includes(nextMode)) {
      throw new Error(`JoyState: неизвестный модус "${nextMode}"`);
    }
    this._history = this._history || [];
    this._history.push({
      from: this.mode,
      to: nextMode,
      at: new Date().toISOString(),
      reason,
    });
    this.mode = nextMode;
    this.since = new Date().toISOString();
    return this;
  }

  /**
   * Определить текущий литургический модус по дате.
   * Эвристика — точная литургическая привязка в LiturgicalClock.
   */
  static modeFromDate(d = new Date()) {
    const day = d.getDay();
    if (day === 0) return JoyMode.SABBATH;   // воскресенье
    // Без полного расчёта Пасхалии возвращаем ORDINARY —
    // заполнение литургического календаря отдельным модулем.
    return JoyMode.ORDINARY;
  }

  /**
   * Проверка: радость «жива»?
   * По 1 Фес 5:16 — должна быть всегда. Если состояние отсутствует
   * или зависло в одном модусе слишком долго — это диагностируемая рана.
   */
  isAlive({ maxSilenceDays = 40 } = {}) {
    if (!this.since) return false;
    const ageMs = Date.now() - new Date(this.since).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    // 40 дней — библейский предел пустыни. Дольше в одном модусе
    // без перехода — признак окостенения.
    return ageDays < maxSilenceDays;
  }

  toJSON() {
    return {
      type: 'JoyState',
      persona: this.persona,
      mode: this.mode,
      since: this.since,
      history: this._history || [],
      alive: this.isAlive(),
    };
  }

  toText() {
    const alive = this.isAlive() ? '✓' : '⚠';
    return `⟨радость⟩ ${this.persona}: ${this.mode} с ${this.since} ${alive}`;
  }
}

export default JoyState;
