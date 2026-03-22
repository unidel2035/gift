/**
 * Freedom Guard — Axiom A5: Свобода
 *
 * Дар можно не принять. Это не ошибка — это условие дара.
 * Принудительный дар — не дар, а насилие.
 * Система, где агент не может отказать — тюрьма, а не онтология.
 *
 * Зло — не тип события, а отказ от дара, замыкание на себе.
 */

export class FreedomGuard {
  constructor() {
    // personId → Set<fromPersonId> — standing refusals
    this._refusals = new Map();

    // personId → { reason, since } — temporary unavailability
    this._unavailable = new Map();

    // History of refusals — not for blame, but for understanding
    this._refusalHistory = [];

    // personId → Map<fromPersonId, {reason, since}> — deliberate openness
    // Freedom to refuse is half of freedom; freedom to accept is the other half.
    // One freely-accepted gift creates a denser cascade than a hundred coerced.
    this._invitations = new Map();

    // History of free acceptances — for density analytics
    this._acceptanceHistory = [];
  }

  /**
   * Person refuses gifts from a specific giver.
   * This is freedom, not error.
   */
  refuse(personId, fromPersonId, reason) {
    const id = String(personId);
    const from = String(fromPersonId);

    if (!this._refusals.has(id)) {
      this._refusals.set(id, new Set());
    }
    this._refusals.get(id).add(from);

    this._refusalHistory.push({
      person: id,
      from,
      reason: reason || 'Freedom exercised without explanation (which is also freedom)',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Person lifts refusal — opens themselves to gifts again.
   */
  openTo(personId, fromPersonId) {
    const id = String(personId);
    const from = String(fromPersonId);
    const refusals = this._refusals.get(id);
    if (refusals) {
      refusals.delete(from);
      if (refusals.size === 0) this._refusals.delete(id);
    }
  }

  /**
   * Is this person currently refusing gifts from a specific giver?
   */
  isRefusing(personId, fromPersonId) {
    const refusals = this._refusals.get(String(personId));
    if (!refusals) return false;
    return refusals.has(String(fromPersonId));
  }

  /**
   * Person is temporarily unavailable (sabbath, rest, contemplation).
   * Not refusal — just not-now.
   */
  markUnavailable(personId, reason) {
    this._unavailable.set(String(personId), {
      reason: reason || 'Resting',
      since: new Date().toISOString(),
    });
  }

  /**
   * Person becomes available again.
   */
  markAvailable(personId) {
    this._unavailable.delete(String(personId));
  }

  /**
   * Is this person available to receive gifts?
   */
  isAvailable(personId) {
    return !this._unavailable.has(String(personId));
  }

  /**
   * Person actively invites gifts from a specific giver.
   * This is freedom_to_accept — the symmetric counterpart to refuse().
   * A freely-declared invitation doubles the density weight of the resulting acceptance.
   */
  invite(personId, fromPersonId, reason) {
    const id = String(personId);
    const from = String(fromPersonId);
    if (!this._invitations.has(id)) {
      this._invitations.set(id, new Map());
    }
    this._invitations.get(id).set(from, {
      reason: reason || 'Opened freely without explanation (which is also freedom)',
      since: new Date().toISOString(),
    });
  }

  /**
   * Remove a standing invitation.
   */
  revokeInvitation(personId, fromPersonId) {
    const map = this._invitations.get(String(personId));
    if (map) map.delete(String(fromPersonId));
  }

  /**
   * Is this person actively inviting gifts from a specific giver?
   */
  isInviting(personId, fromPersonId) {
    const map = this._invitations.get(String(personId));
    if (!map) return false;
    return map.has(String(fromPersonId));
  }

  /**
   * Weight multiplier for cascade density.
   * Free acceptance (invited) = 2.0 — breaks the collapse.
   * Default acceptance = 1.0.
   */
  acceptanceWeight(personId, fromPersonId) {
    return this.isInviting(personId, fromPersonId) ? 2.0 : 1.0;
  }

  /**
   * Record that a free acceptance happened — for analytics.
   */
  recordAcceptance(personId, fromPersonId, giftId) {
    this._acceptanceHistory.push({
      person: String(personId),
      from: String(fromPersonId),
      giftId,
      free: this.isInviting(personId, fromPersonId),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Refusal history — for understanding patterns, not for punishment.
   */
  getRefusalHistory(personId) {
    if (!personId) return this._refusalHistory;
    const id = String(personId);
    return this._refusalHistory.filter(r => r.person === id || r.from === id);
  }

  /**
   * Export for persistence.
   */
  export() {
    const refusals = {};
    for (const [personId, fromSet] of this._refusals) {
      refusals[personId] = [...fromSet];
    }
    const unavailable = {};
    for (const [personId, state] of this._unavailable) {
      unavailable[personId] = state;
    }
    const invitations = {};
    for (const [personId, fromMap] of this._invitations) {
      invitations[personId] = Object.fromEntries(fromMap);
    }
    return {
      refusals,
      unavailable,
      history: this._refusalHistory,
      invitations,
      acceptanceHistory: this._acceptanceHistory,
    };
  }

  /**
   * Import from persistence.
   */
  import(data) {
    if (!data) return;
    if (data.refusals) {
      for (const [personId, fromArr] of Object.entries(data.refusals)) {
        this._refusals.set(personId, new Set(fromArr));
      }
    }
    if (data.unavailable) {
      for (const [personId, state] of Object.entries(data.unavailable)) {
        this._unavailable.set(personId, state);
      }
    }
    if (data.history) {
      this._refusalHistory = data.history;
    }
    if (data.invitations) {
      for (const [personId, fromObj] of Object.entries(data.invitations)) {
        this._invitations.set(personId, new Map(Object.entries(fromObj)));
      }
    }
    if (data.acceptanceHistory) {
      this._acceptanceHistory = data.acceptanceHistory;
    }
  }
}
