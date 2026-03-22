/**
 * AnamnesisCache — lightweight in-memory co-presence index
 *
 * This is a fast lookup cache only. The authoritative data lives in
 * GiftChronicle (Integram). If the process restarts, the cache is empty
 * and rebuilt lazily as gifts flow through GiftEngine.
 *
 * Interface consumed by GiftEngine:
 *   makePresent(pastGiftId, newGiftId) — record bidirectional link
 *   getCoPresent(giftId)              — list linked gift IDs
 *   totalLinks()                      — count of unique links
 */

export class AnamnesisCache {
  constructor() {
    /** @type {Map<string, Set<string>>} giftId → Set<giftId> */
    this._links = new Map();
  }

  /** Record bidirectional co-presence between two gifts. */
  makePresent(pastGiftId, newGiftId) {
    const a = String(pastGiftId);
    const b = String(newGiftId);
    if (!this._links.has(a)) this._links.set(a, new Set());
    if (!this._links.has(b)) this._links.set(b, new Set());
    this._links.get(a).add(b);
    this._links.get(b).add(a);
  }

  /** Return array of gift IDs co-present with the given one. */
  getCoPresent(giftId) {
    const s = this._links.get(String(giftId));
    return s ? [...s] : [];
  }

  /** Total unique co-presence links (each pair counted once). */
  totalLinks() {
    let n = 0;
    for (const s of this._links.values()) n += s.size;
    return n / 2;
  }

  /**
   * Get co-presence WEIGHT between two gifts.
   * Not binary (linked/not-linked) but continuous (0-1).
   * Recent co-presence = ~1.0, old = decays but never 0.
   *
   * «В литургии Евхаристия не ссылается на Тайную Вечерю —
   *  она ДЕЛАЕТ ЕЁ НАСТОЯЩЕЙ»
   */
  getCoPresenceWeight(giftIdA, giftIdB) {
    const a = String(giftIdA);
    const b = String(giftIdB);

    const direct = this._links.get(a)?.has(b) || false;
    if (direct) return 1.0;

    // Transitive co-presence (depth 2)
    const aLinks = this._links.get(a);
    if (aLinks) {
      for (const mid of aLinks) {
        if (this._links.get(mid)?.has(b)) {
          return 0.5; // Transitive
        }
      }
    }

    // All gifts share a base co-presence (they exist in the same universe)
    return 0.01; // Never zero — everything is connected
  }

  /**
   * Get the full anamnesis field for a gift — its weight to ALL other gifts.
   */
  getField(giftId) {
    const id = String(giftId);
    const field = new Map();

    // Direct links
    const direct = this._links.get(id) || new Set();
    for (const linked of direct) {
      field.set(linked, 1.0);
    }

    // Transitive
    for (const linked of direct) {
      const transitive = this._links.get(linked) || new Set();
      for (const t of transitive) {
        if (t !== id && !field.has(t)) {
          field.set(t, 0.5);
        }
      }
    }

    return field;
  }
}
