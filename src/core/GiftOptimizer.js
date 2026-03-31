/**
 * CommunityDiagnostic — зеркало состояния общины
 *
 * Не оптимизатор. Не рекомендатель.
 * Показывает что есть — как снимок МРТ.
 *
 * Дар не проектируется. Дар свершается из встречи.
 * Диагноз — только чтобы видеть где пустыня.
 *
 * Богословская граница:
 *   «Дар рассчитанный для эффекта — уже не дар» (AntiKenosis)
 *   Матрица W — зеркало прошлого, не пространство проектирования.
 */

const DAMPENING = 20; // из формулы θέωσις (30 ступеней Лествичника)

export class CommunityDiagnostic {
  constructor(snapshot) {
    this.persons    = snapshot.persons        || [];
    this.divine     = snapshot.divinePersons  || [];
    this._energeia  = snapshot.energeia       || [];
    this._doxologia = snapshot.doxologia      || [];
    this._W         = snapshot.W              || [];
  }

  // ── θέωσις-индекс для тварного лица (по Паламе) ─────────────────────
  //
  // μέθεξις (принято от Бога) + ἀναγωγή (отдано Богу)
  // Источник: GiftMemory.theosis() — та же формула

  theosisIndex(personId) {
    const ci = this.persons.indexOf(personId);
    if (ci < 0) return 0;
    const received = this._energeia.reduce((s, row) => s + (row[ci] ?? 0), 0);
    const returned = (this._doxologia[ci] ?? []).reduce((s, v) => s + v, 0);
    const sum = received + returned;
    return sum / (sum + DAMPENING);
  }

  // ── Итоговый вес принятых даров ──────────────────────────────────────

  totalReceived(personId) {
    const ci = this.persons.indexOf(personId);
    if (ci < 0) return 0;
    const fromW = this._W.reduce((s, row) => s + (row[ci] ?? 0), 0);
    const fromE = this._energeia.reduce((s, row) => s + (row[ci] ?? 0), 0);
    return fromW + fromE;
  }

  // ── Итоговый вес отданных даров ──────────────────────────────────────

  totalGiven(personId) {
    const ci = this.persons.indexOf(personId);
    if (ci < 0) return 0;
    const toW   = (this._W[ci] ?? []).reduce((s, v) => s + v, 0);
    const toDox = (this._doxologia[ci] ?? []).reduce((s, v) => s + v, 0);
    return toW + toDox;
  }

  // ── Диагностические запросы ──────────────────────────────────────────

  /** Лица с наименьшим обожением (κατάνυξις) */
  lowestTheosis(n = 5) {
    return this.persons
      .filter(p => !['_abyss', '_koinon'].includes(p))
      .map(p => ({ person: p, index: this.theosisIndex(p) }))
      .sort((a, b) => a.index - b.index)
      .slice(0, n);
  }

  /** Наиболее изолированные лица (мало получают) */
  mostIsolated(n = 5) {
    return this.persons
      .filter(p => !['_abyss', '_koinon'].includes(p))
      .map(p => ({ person: p, received: this.totalReceived(p) }))
      .sort((a, b) => a.received - b.received)
      .slice(0, n);
  }

  /** Лица с наибольшим сюрплюсом (дают > получают — кенозис) */
  highestSurplus(n = 5) {
    return this.persons
      .filter(p => !['_abyss', '_koinon'].includes(p))
      .map(p => {
        const given    = this.totalGiven(p);
        const received = this.totalReceived(p);
        return { person: p, given, received, surplus: given - received };
      })
      .sort((a, b) => b.surplus - a.surplus)
      .slice(0, n);
  }

  /** Полная картина общины */
  communityReport() {
    return {
      theosis:  this.persons.map(p => ({ person: p, index: this.theosisIndex(p) }))
                  .sort((a, b) => b.index - a.index),
      isolated: this.mostIsolated(this.persons.length),
      surplus:  this.highestSurplus(this.persons.length),
    };
  }
}
