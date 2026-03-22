/**
 * PerichoresisCycle — наблюдатель перихоретических циклов
 *
 * Περιχώρησις — взаимопроникновение Лиц Троицы.
 * Не обмен между тремя. Взаимное пребывание.
 *
 * Минимальная единица хозяйства дара — не пара, а ТРОЕ.
 * Пара всегда рискует скатиться в обмен.
 * Трое — уже община. Уже перихоресис.
 *
 * НЕ перихоресис:         А перихоресис:
 * A ⇄ B                   A → B → C → A
 * (двое, замкнуты)        (трое+, открыты)
 *
 * Подтверждения:
 *   Богословски: Троица — три Лица, не два
 *   Антропологически: Marcel Mauss — архаический дар всегда идёт по кругу
 *   В коде: GratitudeGraph.findCycles(minLength=3)
 */

class PerichoresisCycle {
  /**
   * @param {object} context — { eventStore, gratitude }
   */
  constructor(context) {
    this._eventStore = context.eventStore;
    this._gratitude = context.gratitude;
  }

  /**
   * Observe perichoretic patterns in the community.
   *
   * @returns {{ triads, dyads, isolates, perichoretic, text }}
   */
  observe() {
    // Build adjacency from gifts
    const edges = new Map(); // giver → Set<receiver>
    const persons = new Set();

    for (const gift of this._eventStore.getAll()) {
      if (!gift.giver || !gift.receiver || gift.receiver === 'all') continue;
      if (gift.giver === '0' || gift.giver === null) continue; // Divine energy excluded from peer cycles

      persons.add(gift.giver);
      persons.add(gift.receiver);

      if (!edges.has(gift.giver)) edges.set(gift.giver, new Map());
      const current = edges.get(gift.giver).get(gift.receiver) || 0;
      edges.get(gift.giver).set(gift.receiver, current + 1);
    }

    // Find triads: A→B→C→A
    const triads = this._findTriads(edges, persons);

    // Find dyads: A⇄B (bidirectional, no third party)
    const dyads = this._findDyads(edges, persons);

    // Find isolates: persons not in any cycle
    const inCycle = new Set();
    for (const t of triads) for (const p of t.persons) inCycle.add(p);
    for (const d of dyads) for (const p of d.persons) inCycle.add(p);

    const isolates = [];
    for (const p of persons) {
      if (!inCycle.has(p) && p !== '0') {
        isolates.push({
          person: p,
          text: 'Не включён ни в один цикл дарения',
        });
      }
    }

    const perichoretic = triads.length > 0;

    return {
      triads,
      dyads,
      isolates,
      perichoretic,
      text: perichoretic
        ? 'Община перихоретична — дары текут по кругу через третьего'
        : dyads.length > 0
          ? 'Дары замкнуты в парах — не перихоресис, а потенциальный бартер'
          : 'Дарение не образует циклов — поток линеен или отсутствует',
      stats: {
        totalPersons: persons.size,
        inTriads: triads.reduce((s, t) => s + t.persons.length, 0),
        inDyads: dyads.reduce((s, d) => s + d.persons.length, 0),
        isolated: isolates.length,
      },
    };
  }

  /**
   * Find perichoretic pairs — directed cycles of length >= 3.
   */
  _findTriads(edges, persons) {
    const triads = [];
    const visited = new Set();

    for (const a of persons) {
      if (a === '0') continue;
      const aNeighbors = edges.get(a);
      if (!aNeighbors) continue;

      for (const [b, abDepth] of aNeighbors) {
        if (b === a || b === '0') continue;
        const bNeighbors = edges.get(b);
        if (!bNeighbors) continue;

        for (const [c, bcDepth] of bNeighbors) {
          if (c === a && c !== b) {
            // A→B→C→A where C===A — this is just A→B and B→A (dyad)
            continue;
          }
          if (c === b || c === '0' || c === a) continue;

          // Check if C→A exists (closing the triad)
          const cNeighbors = edges.get(c);
          if (cNeighbors && cNeighbors.has(a)) {
            const key = [a, b, c].sort().join('-');
            if (!visited.has(key)) {
              visited.add(key);
              triads.push({
                persons: [a, b, c],
                depth: abDepth + bcDepth + cNeighbors.get(a),
                text: `Живой цикл: ${a} → ${b} → ${c} → ${a}`,
              });
            }
          }
        }
      }
    }

    return triads;
  }

  /**
   * Find dyads — bidirectional gift pairs.
   */
  _findDyads(edges, persons) {
    const dyads = [];
    const visited = new Set();

    for (const a of persons) {
      if (a === '0') continue;
      const aNeighbors = edges.get(a);
      if (!aNeighbors) continue;

      for (const [b, abDepth] of aNeighbors) {
        if (b === '0') continue;
        const bNeighbors = edges.get(b);
        if (bNeighbors && bNeighbors.has(a)) {
          const key = [a, b].sort().join('-');
          if (!visited.has(key)) {
            visited.add(key);
            dyads.push({
              persons: [a, b],
              depth: abDepth + bNeighbors.get(a),
              question: 'Пара замкнута. Не бартер ли?',
            });
          }
        }
      }
    }

    return dyads;
  }
}

export { PerichoresisCycle };
export default PerichoresisCycle;
