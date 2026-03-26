/**
 * Telos Planner — Axiom A4: Призвание
 *
 * Планирование от образа завершённости.
 * «Чем это должно стать?» → «Что нужно отдать сейчас?»
 */

export class TelosPlanner {
  constructor() {
    // telos → { description, giftIds[], progress, vision }
    this._teloi = new Map();
  }

  /**
   * Declare a telos — an image of completeness that attracts gifts.
   */
  declareTelos(name, { description, vision } = {}) {
    if (this._teloi.has(name)) return this._teloi.get(name);

    const telos = {
      name,
      description: description || name,
      vision: vision || null,
      giftIds: [],
      progress: 0,
      declaredAt: new Date().toISOString(),
    };

    this._teloi.set(name, telos);
    return telos;
  }

  /**
   * Record that a gift moved toward this telos.
   * Progress: simple counter, no logarithmic formula pretending to measure divine purpose.
   */
  recordProgress(telosName, giftId) {
    if (!this._teloi.has(telosName)) {
      this.declareTelos(telosName);
    }
    const telos = this._teloi.get(telosName);
    const sid = String(giftId);
    // Дедупликация: один дар — один вклад в телос
    if (!telos.giftIds.includes(sid)) {
      telos.giftIds.push(sid);
      telos.progress = telos.giftIds.length;
    }
  }

  /**
   * What is needed to move toward a telos?
   */
  whatIsNeeded(personId, allGifts, persons) {
    const needs = [];

    for (const [name, telos] of this._teloi) {
      const contributors = new Set(
        allGifts
          .filter(g => g.telos === name && g.status === 'accepted')
          .map(g => g.giver)
      );

      if (!contributors.has(String(personId))) {
        needs.push({
          telos: name,
          description: telos.description,
          vision: telos.vision,
          giftsToward: telos.giftIds.length,
          suggestion: `Ваш дар к "${name}" нужен — ${telos.giftIds.length} даров уже отдано`,
        });
      }
    }

    return needs.sort((a, b) => a.giftsToward - b.giftsToward); // Most needed first
  }

  /**
   * All teloi and their progress.
   */
  getAllProgress() {
    const result = {};
    for (const [name, telos] of this._teloi) {
      result[name] = {
        giftsCount: telos.giftIds.length,
        vision: telos.vision,
      };
    }
    return result;
  }

  /**
   * Get a specific telos.
   */
  getTelos(name) {
    return this._teloi.get(name) || null;
  }

  /**
   * Discover telos from actual gift behavior — emergent, not declared.
   *
   * «По плодам их узнаете их» (Мф 7:16)
   *
   * Looks at:
   *   1. Most common declared telos strings in gifts
   *   2. WHO this person gives to most often (relationship pattern)
   *   3. WHAT layer dominates (utilitas/bonum/gratia pattern)
   *
   * Returns a discovered telos that may differ from declared ones.
   * Example: person declares "дронономика" but gives mostly code to Claude
   *   → real telos = "со-творчество"
   */
  discoverTelos(personId, allGifts, persons) {
    const pid = String(personId);
    const givenGifts = allGifts.filter(g => String(g.giver) === pid && g.status === 'accepted');
    const receivedGifts = allGifts.filter(g => String(g.receiver) === pid && g.status === 'accepted');

    if (givenGifts.length === 0 && receivedGifts.length === 0) {
      return { personId: pid, discovered: null, reason: 'Нет даров — нет плодов для наблюдения.' };
    }

    // 1. Most common declared telos strings
    const telosCounts = {};
    for (const g of givenGifts) {
      if (g.telos) telosCounts[g.telos] = (telosCounts[g.telos] || 0) + 1;
    }
    const declaredRanking = Object.entries(telosCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    // 2. WHO they give to most often (relationship pattern)
    const receiverCounts = {};
    for (const g of givenGifts) {
      const r = g.receiver || 'all';
      receiverCounts[r] = (receiverCounts[r] || 0) + 1;
    }
    const topReceivers = Object.entries(receiverCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => {
        const person = persons ? (typeof persons.get === 'function' ? persons.get(id) : null) : null;
        return { id, name: person?.name || id, count };
      });

    // 3. WHAT layer dominates
    const layerCounts = { utilitas: 0, bonum: 0, gratia: 0 };
    for (const g of givenGifts) {
      const layer = g.layer || 'utilitas';
      if (layerCounts[layer] !== undefined) layerCounts[layer]++;
    }
    const dominantLayer = Object.entries(layerCounts)
      .sort((a, b) => b[1] - a[1])[0];

    // Synthesize emergent telos
    let emergentTelos = null;
    let emergentReason = '';

    const topReceiver = topReceivers[0];
    const topDeclared = declaredRanking[0];
    const layer = dominantLayer ? dominantLayer[0] : 'utilitas';

    if (layer === 'gratia' && givenGifts.length >= 2) {
      emergentTelos = 'созерцание';
      emergentReason = 'Преобладание даров благодати — движение к созерцанию';
    } else if (topReceiver && topReceiver.count >= givenGifts.length * 0.6 && topReceiver.id !== 'all') {
      emergentTelos = `со-творчество с ${topReceiver.name}`;
      emergentReason = `${Math.round(topReceiver.count / givenGifts.length * 100)}% даров — одному лицу`;
    } else if (layer === 'bonum' && givenGifts.length >= 2) {
      emergentTelos = 'служение общине';
      emergentReason = 'Преобладание даров блага — движение к общине';
    } else if (topDeclared) {
      emergentTelos = topDeclared.name;
      emergentReason = 'Соответствует объявленному телосу';
    } else {
      emergentTelos = 'поиск призвания';
      emergentReason = 'Телос ещё не проявился в дарах';
    }

    // Compare with declared
    const declared = topDeclared ? topDeclared.name : null;
    const diverges = declared && emergentTelos !== declared;

    return {
      personId: pid,
      discovered: emergentTelos,
      declared,
      diverges,
      reason: emergentReason,
      evidence: {
        totalGiftsGiven: givenGifts.length,
        declaredTeloi: declaredRanking,
        topReceivers,
        layerDistribution: layerCounts,
        dominantLayer: layer,
      },
    };
  }
}
