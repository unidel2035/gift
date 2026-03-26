/**
 * graph.d.ts — Граф благодарности
 *
 * Не причинный граф — граф свободного ответа.
 * Причинность: A вызывает B (необходимость).
 * Благодарность: B благодарит A (свобода).
 *
 * «Благодари Господа» — не алгоритм, а персональный выбор.
 */

// ── Рёбра ────────────────────────────────────────────────────

export interface IGratitudeEdge {
  thankedId: string;
  giftId: string;
  timestamp: string;
  weight?: number; // Экспоненциальное затухание
}

// ── Граф ─────────────────────────────────────────────────────

export interface IGratitudeGraph {
  // ── Запись ──────────────────────────────────────────────

  /**
   * Записать благодарность: благодарящий → благодаримый.
   * Если thankedId === null → вертикальная евхаристия (не ребро).
   */
  addGratitude(thankerId: string, thankedId: string | null, giftId: string): void;

  // ── Запросы ──────────────────────────────────────────────

  /** Кого поблагодарил данный человек? */
  getThanked(personId: string): Array<{ person: string; gift: string; when: string }>;

  /** Кто поблагодарил данного человека? */
  getThankers(personId: string): Array<{ person: string; gift: string; when: string }>;

  /**
   * BFS-путь благодарности между двумя людьми.
   * Существует ли цепочка A→...→B?
   */
  findPath(fromId: string, toId: string): string[] | null;

  /**
   * Найти перихоретические циклы длиной ≤ maxLength.
   * Цикл = A→B→C→A — минимум три участника.
   * Тройка = отражение Троицы.
   */
  findCycles(maxLength?: number): string[][];

  /**
   * Взаимные пары (A↔B).
   * Риск: это может быть quid pro quo, не дар.
   */
  getMutualPairs(): Array<[string, string]>;

  /**
   * Плотность графа: отношение фактических рёбер к максимально возможным.
   * 0 = полная изоляция, 1 = полная связность.
   */
  density(): number;

  /**
   * Степень узла: сколько благодарностей получил данный человек.
   */
  inDegree(personId: string): number;
  outDegree(personId: string): number;

  // ── Состояние ─────────────────────────────────────────────

  /** Общее число рёбер */
  _edgeCount: number;

  /** Число вертикальных евхаристий (thankedId === null) */
  _verticalCount: number;
}

// ── Анализ ───────────────────────────────────────────────────

export interface IGratitudeAnalysis {
  /** Кто является «мостом» — без него граф распадается? */
  bridges(): string[];

  /** Кто изолирован (нет ни исходящих, ни входящих рёбер)? */
  isolates(): string[];

  /**
   * Компоненты связности.
   * Компонента из одной вершины = изолят.
   */
  components(): string[][];

  /**
   * Центральность по PageRank.
   * Кто получает больше всего «проходящей благодарности»?
   */
  centrality(): Map<string, number>;
}

// ── Затухание (Decay) ────────────────────────────────────────

export interface IGratitudeDecay {
  /**
   * Период полураспада благодарности (по умолчанию 30 дней).
   * Вес ребра: w(t) = exp(-λ × (now - timestamp)).
   * Если w < threshold → ребро «забыто» (но не удалено).
   */
  halfLife: number; // мс

  /**
   * Пересчитать весовой коэффициент всех рёбер.
   */
  decay(): void;

  /**
   * Забытые рёбра (вес < threshold).
   */
  forgotten(): IGratitudeEdge[];
}
