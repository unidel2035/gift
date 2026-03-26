/**
 * AutoAnamnesis — automatic memory linking for the Gift Engine offer flow
 *
 * Problem: ~75% of gifts are "atomic" — they have no anamnesis links to past gifts.
 * This module enriches gifts with co-presence links BEFORE and AFTER creation,
 * turning isolated acts into a living web of memory.
 *
 * Three-tier search architecture:
 *   Tier 1 (fast):     AnamnesisCache — in-memory co-presence index
 *   Tier 2 (medium):   GiftEventStore — indexed query by telos/persons
 *   Tier 3 (slow):     AnamnesisMemory — semantic similarity via KAG embeddings
 *
 * «Ибо где двое или трое собраны во имя Моё, там Я посреди них» (Мф 18:20)
 * — каждый дар, вспомнивший другой, делает его настоящим заново.
 */

import logger from '../../utils/logger.js';

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

/**
 * Find past gifts with matching telos.
 *
 * @param {string} telos — the telos to search for
 * @param {import('./GiftEngine.js').GiftEngine} engine
 * @param {number} [limit=10]
 * @returns {object[]} — matching gift events
 */
function findByTelos(telos, engine, limit = 10) {
  if (!telos || !engine?._eventStore) return [];
  try {
    return engine._eventStore.query({ telos, limit });
  } catch (e) {
    logger.warn(`[AutoAnamnesis] findByTelos error: ${e.message}`);
    return [];
  }
}

/**
 * Find past gifts between the same persons (either direction).
 *
 * @param {string} giverId
 * @param {string} receiverId
 * @param {import('./GiftEngine.js').GiftEngine} engine
 * @param {number} [limit=10]
 * @returns {object[]} — matching gift events
 */
function findByPersons(giverId, receiverId, engine, limit = 10) {
  if (!engine?._eventStore) return [];
  try {
    const results = new Map();

    // Gifts from giver → receiver
    const asGiver = engine._eventStore.query({ giver: giverId });
    for (const g of asGiver) {
      if (String(g.receiver) === String(receiverId) || g.receiverName === receiverId) {
        results.set(String(g.id), g);
      }
    }

    // Gifts from receiver → giver (reverse direction)
    const asReverse = engine._eventStore.query({ giver: receiverId });
    for (const g of asReverse) {
      if (String(g.receiver) === String(giverId) || g.receiverName === giverId) {
        results.set(String(g.id), g);
      }
    }

    return [...results.values()].slice(0, limit);
  } catch (e) {
    logger.warn(`[AutoAnamnesis] findByPersons error: ${e.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────
// TIER 1: AnamnesisCache (in-memory, fast)
// ─────────────────────────────────────────────────────────

/**
 * Find related gifts using the in-memory co-presence cache.
 * Looks for gifts already linked to the giver's or receiver's past gifts.
 */
function _tier1CacheLookup(giftData, engine) {
  const results = new Map();
  const cache = engine?.anamnesis;
  const store = engine?._eventStore;
  if (!cache || !store) return results;

  try {
    // Get recent gifts from the same giver
    const giverGifts = store.query({ giver: giftData.giver, limit: 20 });

    for (const past of giverGifts) {
      // Each past gift's co-present network contains potential links
      const coPresent = cache.getCoPresent(String(past.id));
      for (const coId of coPresent) {
        const co = store.getById(coId);
        if (co) results.set(String(co.id), co);
      }
      // The past gift itself is a candidate
      results.set(String(past.id), past);
    }

    // Same for receiver's past gifts
    if (giftData.receiver && giftData.receiver !== 'all') {
      const receiverGifts = store.query({ receiver: giftData.receiver, limit: 20 });
      for (const past of receiverGifts) {
        const coPresent = cache.getCoPresent(String(past.id));
        for (const coId of coPresent) {
          const co = store.getById(coId);
          if (co) results.set(String(co.id), co);
        }
        results.set(String(past.id), past);
      }
    }
  } catch (e) {
    logger.warn(`[AutoAnamnesis] Tier 1 error: ${e.message}`);
  }

  return results;
}

// ─────────────────────────────────────────────────────────
// TIER 2: GiftEventStore (indexed queries, medium)
// ─────────────────────────────────────────────────────────

/**
 * Find related gifts by telos and person pairs.
 */
function _tier2StoreQuery(giftData, engine) {
  const results = new Map();

  try {
    // By telos
    if (giftData.telos) {
      for (const g of findByTelos(giftData.telos, engine, 10)) {
        results.set(String(g.id), g);
      }
    }

    // By persons
    if (giftData.giver && giftData.receiver && giftData.receiver !== 'all') {
      for (const g of findByPersons(giftData.giver, giftData.receiver, engine, 10)) {
        results.set(String(g.id), g);
      }
    }
  } catch (e) {
    logger.warn(`[AutoAnamnesis] Tier 2 error: ${e.message}`);
  }

  return results;
}

// ─────────────────────────────────────────────────────────
// TIER 3: AnamnesisMemory (semantic, slow/optional)
// ─────────────────────────────────────────────────────────

/**
 * Semantic similarity search via AnamnesisMemory (KAG embeddings).
 * Only runs if AnamnesisMemory is initialized with KAG.
 */
async function _tier3SemanticSearch(giftData, engine) {
  const results = new Map();
  const memory = engine?.memory;

  if (!memory?.ready || !memory._kagReady) return results;

  try {
    // Build a search query from gift content
    const queryParts = [];
    if (giftData.content) queryParts.push(giftData.content);
    if (giftData.description) queryParts.push(giftData.description);
    if (giftData.telos) queryParts.push(giftData.telos);
    if (giftData.giverName) queryParts.push(giftData.giverName);
    if (giftData.receiverName) queryParts.push(giftData.receiverName);

    const query = queryParts.join(' ').trim();
    if (!query) return results;

    const searchResults = await memory.search(query, 10);

    for (const sr of searchResults) {
      // AnamnesisMemory returns acts with gift_id — resolve to actual gifts
      const giftId = sr.gift_id || sr.giftId;
      if (giftId) {
        const gift = engine._eventStore.getById(String(giftId));
        if (gift) {
          // Preserve the semantic score for ranking
          results.set(String(gift.id), { ...gift, _semanticScore: sr.score || 0.5 });
        }
      }
    }
  } catch (e) {
    logger.warn(`[AutoAnamnesis] Tier 3 error: ${e.message}`);
  }

  return results;
}

// ─────────────────────────────────────────────────────────
// SCORING & DEDUPLICATION
// ─────────────────────────────────────────────────────────

/**
 * Score a candidate gift for relevance to the new gift being created.
 * Higher = more relevant. Factors: telos match, person overlap, recency, semantic score.
 */
function _scoreCandidate(candidate, giftData) {
  let score = 0;

  // Telos match
  if (candidate.telos && candidate.telos === giftData.telos) {
    score += 0.3;
  }

  // Person overlap (giver or receiver matches)
  if (candidate.giver === giftData.giver || candidate.receiver === giftData.giver) {
    score += 0.2;
  }
  if (giftData.receiver && giftData.receiver !== 'all') {
    if (candidate.giver === giftData.receiver || candidate.receiver === giftData.receiver) {
      score += 0.2;
    }
  }

  // Recency: newer gifts get a boost (decay over ~30 days)
  const ts = candidate._timestamp || candidate.createdAt;
  if (ts) {
    const ageMs = Date.now() - new Date(ts).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    score += Math.max(0, 0.15 * Math.exp(-ageDays / 30));
  }

  // Semantic score from Tier 3
  if (candidate._semanticScore) {
    score += 0.15 * candidate._semanticScore;
  }

  return Math.min(score, 1);
}

/**
 * Merge results from all tiers, deduplicate, score, and return top N.
 */
function _mergeAndRank(tier1, tier2, tier3, giftData, topN = 5) {
  const merged = new Map();

  // Merge all tiers (later tiers don't overwrite unless they have semantic score)
  for (const [id, gift] of tier1) merged.set(id, gift);
  for (const [id, gift] of tier2) {
    if (!merged.has(id)) merged.set(id, gift);
  }
  for (const [id, gift] of tier3) {
    // Tier 3 may have _semanticScore — prefer it
    merged.set(id, gift);
  }

  // Score and sort
  const scored = [...merged.entries()].map(([id, gift]) => ({
    id,
    gift,
    score: _scoreCandidate(gift, giftData),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topN).map(s => s.id);
}

// ─────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────

/**
 * Enrich a gift with anamnesis links BEFORE it is created.
 *
 * Searches three tiers for related past gifts and attaches
 * an `anamnesisIds` array to giftData.
 *
 * @param {object} giftData — the gift being offered (content, telos, giver, receiver, etc.)
 * @param {import('./GiftEngine.js').GiftEngine} engine — the GiftEngine instance
 * @returns {Promise<object>} — enriched giftData with anamnesisIds
 */
async function enrichWithAnamnesis(giftData, engine) {
  if (!giftData || !engine) return giftData || {};

  try {
    // Tier 1: fast in-memory cache
    const tier1 = _tier1CacheLookup(giftData, engine);

    // Tier 2: indexed store queries
    const tier2 = _tier2StoreQuery(giftData, engine);

    // Tier 3: semantic search (async, may not be available)
    let tier3 = new Map();
    try {
      tier3 = await _tier3SemanticSearch(giftData, engine);
    } catch {
      // Tier 3 failure is non-fatal
    }

    // Merge, score, pick top 5
    const anamnesisIds = _mergeAndRank(tier1, tier2, tier3, giftData, 5);

    if (anamnesisIds.length > 0) {
      logger.info(`[AutoAnamnesis] Enriched gift with ${anamnesisIds.length} anamnesis links (T1=${tier1.size}, T2=${tier2.size}, T3=${tier3.size})`);
    }

    return {
      ...giftData,
      anamnesisIds,
    };
  } catch (e) {
    logger.warn(`[AutoAnamnesis] enrichWithAnamnesis failed, returning original: ${e.message}`);
    return { ...giftData, anamnesisIds: [] };
  }
}

/**
 * Build a mini-graph of connected gifts around a given gift (depth 2).
 *
 * @param {string} giftId
 * @param {import('./GiftEngine.js').GiftEngine} engine
 * @returns {Promise<object>} — { gift, coPresent, graph: {nodes, edges}, narrative }
 */
async function buildAnamnesisContext(giftId, engine) {
  if (!engine) return { gift: null, coPresent: [], graph: { nodes: [], edges: [] }, narrative: '' };

  const gift = engine._eventStore.getById(String(giftId));
  if (!gift) return { gift: null, coPresent: [], graph: { nodes: [], edges: [] }, narrative: '' };

  const cache = engine.anamnesis;
  const store = engine._eventStore;

  // Depth 1: direct co-present gifts
  const depth1Ids = cache.getCoPresent(String(giftId));
  const coPresent = depth1Ids
    .map(id => store.getById(id))
    .filter(Boolean);

  // Depth 2: co-present gifts of co-present gifts
  const nodes = new Map();
  const edges = [];

  // Add root
  nodes.set(String(giftId), _giftToNode(gift));

  // Add depth 1
  for (const cp of coPresent) {
    const cpId = String(cp.id);
    nodes.set(cpId, _giftToNode(cp));
    edges.push({ source: String(giftId), target: cpId, depth: 1 });

    // Depth 2: co-present of co-present
    const depth2Ids = cache.getCoPresent(cpId);
    for (const d2Id of depth2Ids) {
      if (d2Id === String(giftId)) continue; // skip back-link to root
      const d2Gift = store.getById(d2Id);
      if (!d2Gift) continue;
      if (!nodes.has(d2Id)) {
        nodes.set(d2Id, _giftToNode(d2Gift));
      }
      edges.push({ source: cpId, target: d2Id, depth: 2 });
    }
  }

  // Build narrative summary
  const narrative = _buildNarrative(gift, coPresent, nodes.size);

  return {
    gift,
    coPresent,
    graph: {
      nodes: [...nodes.values()],
      edges,
    },
    narrative,
  };
}

/**
 * Compute an anamnesis score for a gift: how "remembered" is it?
 *
 * Score 0-1 based on:
 *   - Direct co-presence links (depth 1)
 *   - Transitive links (depth 2)
 *   - Recency weighting (newer links count more)
 *
 * @param {object} gift — the gift event
 * @param {import('./GiftEngine.js').GiftEngine} engine
 * @returns {number} — score between 0 and 1
 */
function computeAnamnesisScore(gift, engine) {
  if (!gift || !engine?.anamnesis) return 0;

  const cache = engine.anamnesis;
  const store = engine._eventStore;
  const giftId = String(gift.id);

  // Direct links (depth 1)
  const directIds = cache.getCoPresent(giftId);
  const directCount = directIds.length;

  if (directCount === 0) return 0;

  // Transitive links (depth 2) — unique, excluding direct
  const transitiveSet = new Set();
  for (const d1Id of directIds) {
    const depth2 = cache.getCoPresent(d1Id);
    for (const d2Id of depth2) {
      if (d2Id !== giftId && !directIds.includes(d2Id)) {
        transitiveSet.add(d2Id);
      }
    }
  }
  const transitiveCount = transitiveSet.size;

  // Recency factor: average freshness of direct links
  let recencySum = 0;
  const now = Date.now();
  for (const linkId of directIds) {
    const linked = store.getById(linkId);
    const ts = linked?._timestamp || linked?.createdAt;
    if (ts) {
      const ageMs = now - new Date(ts).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      // Exponential decay: half-life ~60 days
      recencySum += Math.exp(-ageDays / 86.4); // ln(2)/86.4 ≈ 0.008 → half-life 60d
    } else {
      recencySum += 0.5; // default for gifts without timestamp
    }
  }
  const avgRecency = directCount > 0 ? recencySum / directCount : 0;

  // Combine components:
  //   - Direct links: saturates at ~10 links → 0.5
  //   - Transitive links: saturates at ~20 → 0.3
  //   - Recency: 0-0.2
  const directScore = Math.min(directCount / 10, 1) * 0.5;
  const transitiveScore = Math.min(transitiveCount / 20, 1) * 0.3;
  const recencyScore = avgRecency * 0.2;

  return Math.min(directScore + transitiveScore + recencyScore, 1);
}

// ─────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────

/**
 * Convert a gift event to a lightweight graph node.
 */
function _giftToNode(gift) {
  return {
    id: String(gift.id),
    giver: gift.giver || gift.giverName || null,
    receiver: gift.receiver || gift.receiverName || null,
    telos: gift.telos || null,
    content: (gift.content || '').slice(0, 120),
    status: gift.status || null,
    timestamp: gift._timestamp || gift.createdAt || null,
  };
}

/**
 * Build a short narrative summary of the anamnesis context.
 */
function _buildNarrative(gift, coPresent, totalNodes) {
  if (coPresent.length === 0) {
    return `Дар #${gift.id} существует атомарно — без связей с другими дарами.`;
  }

  const giverNames = [...new Set(coPresent.map(g => g.giverName).filter(Boolean))];
  const teloi = [...new Set(coPresent.map(g => g.telos).filter(Boolean))];

  let narrative = `Дар #${gift.id} связан с ${coPresent.length} дарами напрямую`;
  if (totalNodes > coPresent.length + 1) {
    narrative += ` и ${totalNodes - coPresent.length - 1} транзитивно`;
  }
  narrative += '.';

  if (giverNames.length > 0) {
    narrative += ` Участники: ${giverNames.slice(0, 5).join(', ')}.`;
  }
  if (teloi.length > 0) {
    narrative += ` Телосы: ${teloi.slice(0, 3).join(', ')}.`;
  }

  return narrative;
}

// ─────────────────────────────────────────────────────────
// CLASS WRAPPER (for stateful usage / composition)
// ─────────────────────────────────────────────────────────

class AutoAnamnesis {
  /**
   * @param {import('./GiftEngine.js').GiftEngine} engine
   */
  constructor(engine) {
    this._engine = engine;
  }

  /** Enrich gift data with anamnesis links before creation. */
  async enrich(giftData) {
    return enrichWithAnamnesis(giftData, this._engine);
  }

  /** Build context graph around an existing gift. */
  async context(giftId) {
    return buildAnamnesisContext(giftId, this._engine);
  }

  /** Compute anamnesis score for a gift. */
  score(gift) {
    return computeAnamnesisScore(gift, this._engine);
  }

  /** Find past gifts by telos. */
  findByTelos(telos, limit) {
    return findByTelos(telos, this._engine, limit);
  }

  /** Find past gifts between same persons. */
  findByPersons(giverId, receiverId, limit) {
    return findByPersons(giverId, receiverId, this._engine, limit);
  }

  /**
   * Register co-presence links for a newly created gift.
   * Call this AFTER the gift has been appended to the event store.
   */
  registerLinks(giftId, anamnesisIds) {
    if (!Array.isArray(anamnesisIds) || anamnesisIds.length === 0) return;
    const cache = this._engine?.anamnesis;
    if (!cache) return;

    for (const pastId of anamnesisIds) {
      cache.makePresent(pastId, String(giftId));
    }

    logger.info(`[AutoAnamnesis] Registered ${anamnesisIds.length} co-presence links for gift #${giftId}`);
  }
}

export {
  AutoAnamnesis,
  enrichWithAnamnesis,
  buildAnamnesisContext,
  computeAnamnesisScore,
  findByTelos,
  findByPersons,
};
