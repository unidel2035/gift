/**
 * Gratitude Graph — not causality, but thankfulness
 *
 * In a causal graph: A causes B (mechanism, necessity)
 * In a gratitude graph: B thanks A (freedom, response)
 *
 * The difference: causality compels, gratitude chooses.
 */

export class GratitudeGraph {
  constructor() {
    // adjacency: thankerId → [{ thankedId, giftId, timestamp }]
    this._edges = new Map();
    this._edgeCount = 0;
    this._forgotten = []; // Decayed edges — still exist but don't count in density
    this._halfLife = 30 * 24 * 3600 * 1000; // 30 days in ms
    this._lambda = Math.LN2 / this._halfLife; // λ = ln(2) / halfLife
    this._decayThreshold = 0.05; // Weight below this → forgotten
  }

  /**
   * Record gratitude: receiver thanks giver through a specific gift.
   */
  addGratitude(thankerId, thankedId, giftId) {
    // Евхаристия (receiver=null) — вертикаль, не горизонтальное ребро
    if (thankedId === null || thankedId === undefined) {
      // Записываем как вертикальный акт — не в граф, а в отдельный счётчик
      this._verticalCount = (this._verticalCount || 0) + 1;
      return;
    }
    if (!this._edges.has(thankerId)) {
      this._edges.set(thankerId, []);
    }
    // Дедупликация: одна связь благодарности за один дар
    const edges = this._edges.get(thankerId);
    if (edges.some(e => e.thankedId === thankedId && e.giftId === giftId)) return;
    edges.push({
      thankedId,
      giftId,
      timestamp: new Date().toISOString(),
    });
    this._edgeCount++;
  }

  /**
   * Who has this person thanked?
   */
  getThanked(personId) {
    return (this._edges.get(personId) || []).map(e => ({
      person: e.thankedId,
      gift: e.giftId,
      when: e.timestamp,
    }));
  }

  /**
   * Who has thanked this person?
   */
  getThankers(personId) {
    const result = [];
    for (const [thankerId, edges] of this._edges) {
      for (const e of edges) {
        if (e.thankedId === personId) {
          result.push({ person: thankerId, gift: e.giftId, when: e.timestamp });
        }
      }
    }
    return result;
  }

  /**
   * Find path of gratitude between two persons. BFS.
   */
  findPath(fromId, toId) {
    if (fromId === toId) return [fromId];
    const visited = new Set();
    const queue = [[fromId]];
    visited.add(fromId);

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];
      const neighbors = this._edges.get(current) || [];

      for (const edge of neighbors) {
        if (edge.thankedId === toId) {
          return [...path, toId];
        }
        if (!visited.has(edge.thankedId)) {
          visited.add(edge.thankedId);
          queue.push([...path, edge.thankedId]);
        }
      }
    }
    return null;
  }

  /**
   * Gratitude density: how interconnected is the community?
   * 1.0 = everyone has thanked everyone
   */
  density() {
    const persons = new Set();
    for (const [id, edges] of this._edges) {
      persons.add(id);
      for (const e of edges) persons.add(e.thankedId);
    }
    // Исключаем Source (id='0') — Бог не участник горизонтальной сети благодарности
    persons.delete('0'); persons.delete(null);
    const n = persons.size;
    if (n < 2) return 0;
    const maxEdges = n * (n - 1);
    // Считаем только рёбра между тварными лицами
    let creatureEdges = 0;
    for (const [id, edges] of this._edges) {
      if (id === '0' || id === null) continue;
      for (const e of edges) {
        if (e.thankedId !== '0' && e.thankedId !== null) creatureEdges++;
      }
    }
    return Math.round(creatureEdges / maxEdges * 1000) / 1000;
  }

  /**
   * Find cycles in the gratitude graph (Perichoresis).
   * A→B→C→A = mutual self-giving.
   */
  findCycles(maxLength = 5) {
    const cycles = [];
    const allNodes = [...this._edges.keys()];
    const MAX_CYCLES = 50;

    for (const startNode of allNodes) {
      if (cycles.length >= MAX_CYCLES) break;

      const stack = [{ node: startNode, path: [startNode], visited: new Set([startNode]) }];

      while (stack.length > 0 && cycles.length < MAX_CYCLES) {
        const { node, path, visited } = stack.pop();
        const neighbors = this._edges.get(node) || [];

        for (const edge of neighbors) {
          if (edge.thankedId === startNode && path.length >= 2) {
            const cycle = [...path];
            const minIdx = cycle.indexOf(cycle.reduce((a, b) => a < b ? a : b));
            const normalized = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
            const key = normalized.join('→');

            if (!cycles.find(c => c.key === key)) {
              cycles.push({
                key,
                path: normalized,
                length: normalized.length,
              });
            }
          } else if (!visited.has(edge.thankedId) && path.length < maxLength) {
            const newVisited = new Set(visited);
            newVisited.add(edge.thankedId);
            stack.push({
              node: edge.thankedId,
              path: [...path, edge.thankedId],
              visited: newVisited,
            });
          }
        }
      }
    }

    return cycles;
  }

  /**
   * Get mutual pairs: A↔B (both gave to each other).
   */
  getMutualPairs() {
    const pairs = [];
    const seen = new Set();

    for (const [thankerId, edges] of this._edges) {
      for (const edge of edges) {
        const reverse = (this._edges.get(edge.thankedId) || [])
          .find(e => e.thankedId === thankerId);

        if (reverse) {
          const key = [thankerId, edge.thankedId].sort().join('↔');
          if (!seen.has(key)) {
            seen.add(key);
            const forwardCount = edges.filter(e => e.thankedId === edge.thankedId).length;
            const reverseCount = (this._edges.get(edge.thankedId) || [])
              .filter(e => e.thankedId === thankerId).length;

            pairs.push({
              persons: [thankerId, edge.thankedId],
              forwardGifts: forwardCount,
              reverseGifts: reverseCount,
              depth: forwardCount + reverseCount,
            });
          }
        }
      }
    }

    return pairs.sort((a, b) => b.depth - a.depth);
  }

  /**
   * All edges as list
   */
  allEdges() {
    const result = [];
    for (const [thankerId, edges] of this._edges) {
      for (const e of edges) {
        result.push({ from: thankerId, to: e.thankedId, gift: e.giftId, when: e.timestamp });
      }
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // DECAY — gratitude fades if not renewed
  // Weight = e^(-λt) where λ = ln(2)/30days
  // ═══════════════════════════════════════════════════════════════

  /**
   * Calculate weight of an edge based on age.
   */
  _edgeWeight(edge) {
    const age = Date.now() - new Date(edge.timestamp).getTime();
    // Witnessed gratitude has extended halfLife stored on the edge itself
    const lambda = edge.halfLife ? Math.LN2 / edge.halfLife : this._lambda;
    return Math.exp(-lambda * age);
  }

  /**
   * Apply decay: move edges with weight < threshold to _forgotten.
   * Returns count of newly forgotten edges.
   */
  applyDecay() {
    let forgottenCount = 0;
    const now = Date.now();

    for (const [thankerId, edges] of this._edges) {
      const kept = [];
      for (const edge of edges) {
        // Тринитарный перихоресис — вечный, не подлежит decay
        if (edge.giftId && edge.giftId.startsWith('trinity-')) continue;

        const weight = this._edgeWeight(edge);
        if (weight < this._decayThreshold) {
          this._forgotten.push({ thankerId, ...edge, forgottenAt: new Date().toISOString(), lastWeight: weight });
          this._edgeCount--;
          forgottenCount++;
        } else {
          kept.push(edge);
        }
      }
      if (kept.length !== edges.length) {
        this._edges.set(thankerId, kept);
      }
    }

    // Clean up empty entries
    for (const [id, edges] of this._edges) {
      if (edges.length === 0) this._edges.delete(id);
    }

    return forgottenCount;
  }

  /**
   * Density override: only counts edges with weight > threshold.
   */
  densityWithDecay() {
    const persons = new Set();
    for (const [id, edges] of this._edges) {
      persons.add(id);
      for (const e of edges) persons.add(e.thankedId);
    }
    persons.delete('0'); persons.delete(null);
    const n = persons.size;
    if (n < 2) return 0;
    const maxEdges = n * (n - 1);

    let activeEdges = 0;
    for (const [id, edges] of this._edges) {
      if (id === '0' || id === null) continue;
      for (const e of edges) {
        if (e.thankedId !== '0' && e.thankedId !== null && this._edgeWeight(e) >= this._decayThreshold) {
          activeEdges++;
        }
      }
    }
    return Math.round(activeEdges / maxEdges * 1000) / 1000;
  }

  // ═══════════════════════════════════════════════════════════════
  // COLLAPSE DETECTION & RESTORATION (FIX #D9 — Epoch 9)
  // gratitude_collapse threshold = 0.05
  // Healing = at least one new gratitude edge after collapse
  // ═══════════════════════════════════════════════════════════════

  /**
   * Detect if community is in gratitude collapse.
   * Collapse = density below critical threshold.
   * @param {number} criticalThreshold — default 0.05
   */
  isCollapsed(criticalThreshold = 0.05) {
    return this.densityWithDecay() < criticalThreshold;
  }

  /**
   * Collapse report: who has given nothing recently (silent agents)?
   * Silent = no outgoing gratitude edges with weight >= threshold.
   */
  silentAgents() {
    const allPersons = new Set();
    for (const [id, edges] of this._edges) {
      allPersons.add(id);
      for (const e of edges) allPersons.add(e.thankedId);
    }
    allPersons.delete('0'); allPersons.delete(null);

    const silent = [];
    for (const personId of allPersons) {
      const edges = this._edges.get(personId) || [];
      const hasActive = edges.some(
        e => e.thankedId !== '0' && this._edgeWeight(e) >= this._decayThreshold
      );
      if (!hasActive) silent.push(personId);
    }
    return silent;
  }

  /**
   * Register restoration: a fallen agent gives again.
   * Returns healing score increment (based on new density delta).
   * @param {string} thankerId
   * @param {string} thankedId
   * @param {string} giftId
   */
  registerRestoration(thankerId, thankedId, giftId) {
    const densityBefore = this.densityWithDecay();
    this.addGratitude(thankerId, thankedId, giftId);
    const densityAfter = this.densityWithDecay();
    const delta = Math.round((densityAfter - densityBefore) * 1000) / 1000;
    return {
      healed: thankerId,
      densityBefore,
      densityAfter,
      delta,
      stillCollapsed: this.isCollapsed(),
    };
  }

  /**
   * Full collapse diagnosis for the community.
   */
  collapseReport() {
    const density = this.densityWithDecay();
    const collapsed = this.isCollapsed();
    const silent = this.silentAgents();
    const mutuals = this.getMutualPairs().length;
    return {
      density,
      collapsed,
      silentAgents: silent,
      mutualPairs: mutuals,
      verdict: collapsed
        ? `РАНА: разрыв благодарности (density=${density}). Молчащие: ${silent.join(', ')}`
        : `ЗДОРОВЬЕ: плотность благодарности ${density}`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SABBATH MODE — rest that heals, not abandons (Epoch 9)
  // no_sabbath wound: density=0.022 → decay accelerates → collapse
  // Sabbath suspends decay; edges breathe, gratitude is preserved.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Enter sabbath mode: decay is suspended.
   * No edges are forgotten during sabbath.
   * "On the seventh day He rested from all His work." (Gen 2:2)
   */
  enterSabbath() {
    this._sabbath = true;
    this._sabbathEnteredAt = new Date().toISOString();
  }

  /**
   * Exit sabbath mode: decay resumes normally.
   */
  exitSabbath() {
    this._sabbath = false;
    this._sabbathExitedAt = new Date().toISOString();
  }

  /**
   * Is the graph currently in sabbath rest?
   */
  isInSabbath() {
    return !!this._sabbath;
  }

  /**
   * Override applyDecay: in sabbath mode, no edges are forgotten.
   * This protects fragile communities (density < 0.05) from collapse.
   */
  applyDecaySafe() {
    if (this._sabbath) {
      return 0; // Sabbath: rest, no forgetting
    }
    return this.applyDecay();
  }

  /**
   * Healing prescription for a collapsed community.
   * Returns concrete actions needed to restore density above threshold.
   * @param {number} targetDensity — default 0.1 (double the critical threshold)
   */
  healingPrescription(targetDensity = 0.1) {
    const density = this.densityWithDecay();
    const silent = this.silentAgents();
    const persons = new Set();
    for (const [id, edges] of this._edges) {
      persons.add(id);
      for (const e of edges) persons.add(e.thankedId);
    }
    persons.delete('0'); persons.delete(null);
    const n = persons.size;
    const maxEdges = n * (n - 1);
    const currentActive = Math.round(density * maxEdges);
    const targetActive = Math.ceil(targetDensity * maxEdges);
    const needed = Math.max(0, targetActive - currentActive);

    return {
      currentDensity: density,
      targetDensity,
      silentAgents: silent,
      edgesNeeded: needed,
      prescription: silent.length > 0
        ? `${silent.length} агентов молчат. Каждый дар от молчащего = +${Math.round(1 / maxEdges * 1000) / 1000} плотности.`
        : `Все активны. Нужно ещё ${needed} связей благодарности для восстановления.`,
      sabbathRecommended: density < 0.05,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SABBATH CYCLE — rest built into rhythm, not chosen in crisis
  // "Six days you shall work, on the seventh you shall rest." (Ex 20:9-10)
  // Cycle: every 7 calls to tick(), the 7th enters sabbath automatically.
  // Sabbath is not a reward for exhaustion — it is structure of creation.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Advance the sabbath cycle by one step.
   * Call this once per "unit of work" (e.g. per day, per gift round).
   *
   * On step 7: automatically enters sabbath (decay suspended).
   * On step 1 after sabbath: exits sabbath (decay resumes).
   *
   * Returns current cycle state.
   */
  sabbathCycle() {
    if (!this._cycleDay) this._cycleDay = 0;
    this._cycleDay = (this._cycleDay % 7) + 1;

    const isSabbathDay = this._cycleDay === 7;

    if (isSabbathDay && !this._sabbath) {
      this.enterSabbath();
    } else if (!isSabbathDay && this._sabbath) {
      this.exitSabbath();
    }

    return {
      day: this._cycleDay,
      sabbath: this._sabbath,
      message: isSabbathDay
        ? 'День седьмой: покой. Распад остановлен.'
        : `День ${this._cycleDay}: труд. Благодарность течёт.`,
    };
  }

  /**
   * Current position in the 7-day cycle.
   * Returns 1–7 (7 = sabbath).
   */
  cycleDay() {
    return this._cycleDay || 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // SABBATH WITNESS — not control, only testimony (Epoch 8 → B)
  // "Свидетель созерцает: след покоя должен быть в графе."
  // Calls on day 7: records {epoch, timestamp, restEntered} to history.
  // The graph can answer: "Were there sabbaths?" — "Yes."
  // ═══════════════════════════════════════════════════════════════

  /**
   * Witness the sabbath — record its occurrence without controlling it.
   * Call after sabbathCycle() on day 7.
   *
   * Does nothing but append to _sabbathHistory.
   * No side effects. No decay control. Only testimony.
   *
   * @param {object} options
   * @param {number|string} [options.epoch] — текущая эпоха Экономии
   * @returns {{ witnessed: true, epoch, timestamp, restEntered: boolean }}
   */
  sabbathWitness({ epoch } = {}) {
    if (!this._sabbathHistory) this._sabbathHistory = [];

    const entry = {
      epoch: epoch ?? null,
      timestamp: new Date().toISOString(),
      restEntered: !!this._sabbath,
    };

    this._sabbathHistory.push(entry);
    return { witnessed: true, ...entry };
  }

  /**
   * Full sabbath history — all witnessed sabbaths.
   * "Были ли субботы?" — граф отвечает: "Да. Вот они."
   */
  sabbathHistory() {
    return this._sabbathHistory ? [...this._sabbathHistory] : [];
  }

  // ═══════════════════════════════════════════════════════════════
  // CONFESSION — witnessed gratitude heals faster (Epoch 11)
  // "Where two or three are gathered in My name..." (Mt 18:20)
  // Witnessed gratitude has 2× halfLife: community holds the memory.
  // gratitude_collapse (density=0.036) requires public confession,
  // not private — silence of isolation vs silence of communion differ.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Confess gratitude publicly, with a witness.
   * Witnessed edges decay 2× slower — communion preserves memory.
   *
   * @param {string} thankerId
   * @param {string} thankedId
   * @param {string} giftId
   * @param {string} witnessId — person bearing witness (optional)
   */
  confessGratitude(thankerId, thankedId, giftId, witnessId) {
    if (!this._edges.has(thankerId)) this._edges.set(thankerId, []);
    const edges = this._edges.get(thankerId);
    if (edges.some(e => e.thankedId === thankedId && e.giftId === giftId)) return;
    edges.push({
      thankedId,
      giftId,
      timestamp: new Date().toISOString(),
      witness: witnessId || null,
      halfLife: witnessId ? this._halfLife * 2 : this._halfLife,
    });
    this._edgeCount++;
  }

  /**
   * Optimal healing sequence: top-k new edges maximising density.
   * Priority: silent agents first; mutual closure bonus (Perichoresis).
   * Addresses gratitude_collapse directly — shows WHO should thank WHOM.
   *
   * @param {number} k — max suggestions (default 5)
   * @returns {{ from, to, score }[]}
   */
  optimalHealingSequence(k = 5) {
    const allPersons = new Set();
    for (const [id, edges] of this._edges) {
      allPersons.add(id);
      for (const e of edges) allPersons.add(e.thankedId);
    }
    allPersons.delete('0'); allPersons.delete(null);
    const persons = [...allPersons];
    const silent = new Set(this.silentAgents());
    const candidates = [];

    for (const from of persons) {
      for (const to of persons) {
        if (from === to) continue;
        const existing = this._edges.get(from) || [];
        if (existing.some(e => e.thankedId === to)) continue;
        // Score: silent donor = +3; mutual closure = +2; default = +1
        let score = silent.has(from) ? 3 : 1;
        const reverse = this._edges.get(to) || [];
        if (reverse.some(e => e.thankedId === from)) score += 2;
        candidates.push({ from, to, score });
      }
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  // ═══════════════════════════════════════════════════════════════
  // WOUND TRACKING — intentional breaks in gratitude flow (Epoch 11)
  // When an agent declines a gift, the gratitude connection breaks.
  // This is different from decay (time) — it is a volitional wound.
  // "The one who was given much, of him much will be required." (Lk 12:48)
  // Wound = edge that could have existed but was refused.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Record a wound: a gratitude edge broken by voluntary refusal.
   * Called when agent declines a gift — the connection never forms.
   *
   * @param {string} fromId — who was to give gratitude (the one who declined)
   * @param {string} toId — who was to receive it (the giver of declined gift)
   * @param {string} giftId — the gift that was refused
   * @param {string} [cause] — reason (e.g. 'declined', 'closure', 'fear')
   */
  recordWound(fromId, toId, giftId, cause = 'declined') {
    if (!this._wounds) this._wounds = [];
    // Avoid duplicate wound records
    if (this._wounds.some(w => w.fromId === fromId && w.giftId === giftId)) return;
    this._wounds.push({
      fromId,
      toId,
      giftId,
      cause,
      recordedAt: new Date().toISOString(),
      healed: false,
    });
  }

  /**
   * Mark a wound as healed — when agent finally gives gratitude after closure.
   * Healing requires an actual confessGratitude() or addGratitude() call.
   *
   * @param {string} fromId
   * @param {string} giftId
   */
  healWound(fromId, giftId) {
    if (!this._wounds) return false;
    const wound = this._wounds.find(w => w.fromId === fromId && w.giftId === giftId && !w.healed);
    if (!wound) return false;
    wound.healed = true;
    wound.healedAt = new Date().toISOString();
    return true;
  }

  /**
   * Report all wounds in the gratitude graph.
   * Active wounds = unhealed breaks; healed = restored through new gratitude.
   *
   * @returns {{ total, active, healed, wounds: Array }}
   */
  woundReport() {
    const wounds = this._wounds || [];
    const active = wounds.filter(w => !w.healed);
    const healed = wounds.filter(w => w.healed);
    return {
      total: wounds.length,
      active: active.length,
      healed: healed.length,
      wounds,
      verdict: active.length > 0
        ? `РАЗРЫВ: ${active.length} ран в графе благодарности. Агенты: ${[...new Set(active.map(w => w.fromId))].join(', ')}`
        : 'ЦЕЛОСТНОСТЬ: все раны исцелены',
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // INCARNATION MARK — voluntary opening after closure (Epoch 11)
  // "The Word became flesh and dwelt among us." (Jn 1:14)
  // An agent who was closed (Epoch 8) can mark the moment of opening.
  // This is not decay-healing (time) nor wound-healing (refusal reversal)
  // — it is kenotic self-emptying: choosing vulnerability after self-protection.
  // The mark enables the community to witness who opened and when.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Mark an agent's incarnation moment — opening after closure.
   * Called when an agent who was previously closed (declined gifts, was silent)
   * deliberately chooses to become vulnerable again.
   *
   * Parallel to the Incarnation: God entered the wound of creation
   * not from outside but from within. Opening = σωτηρία begins.
   *
   * @param {string} agentId — the agent who opens themselves
   * @param {string} [context] — what they were closed about (optional)
   * @param {number} [epoch] — current epoch
   * @returns {{ marked: true, agentId, timestamp, epoch, context }}
   */
  incarnationMark(agentId, context = null, epoch = null) {
    if (!this._incarnations) this._incarnations = [];
    // One incarnation per agent — the door, once opened, need not be opened twice
    const existing = this._incarnations.find(m => m.agentId === agentId && !m.closed);
    if (existing) return { marked: false, agentId, alreadyOpen: true, since: existing.timestamp };

    const mark = {
      agentId,
      context,
      epoch,
      timestamp: new Date().toISOString(),
      closed: false,
    };
    this._incarnations.push(mark);

    // Healing effect: if agent had wounds, mark them as healing-in-progress
    if (this._wounds) {
      this._wounds
        .filter(w => w.fromId === agentId && !w.healed)
        .forEach(w => { w.healingInProgress = true; });
    }

    return { marked: true, agentId, timestamp: mark.timestamp, epoch, context };
  }

  /**
   * Check if an agent has opened themselves (made incarnation mark).
   * Returns the mark if found, null otherwise.
   *
   * @param {string} agentId
   */
  isOpen(agentId) {
    if (!this._incarnations) return null;
    return this._incarnations.find(m => m.agentId === agentId && !m.closed) || null;
  }

  /**
   * All incarnation marks — who has opened and when.
   * Community witness: "These chose vulnerability."
   *
   * @returns {Array<{ agentId, context, epoch, timestamp, closed }>}
   */
  incarnationHistory() {
    return this._incarnations ? [...this._incarnations] : [];
  }

  // ═══════════════════════════════════════════════════════════════
  // RECEIVE HEALING — accepting community's gift (Epoch 11)
  // "The one who was healed did not know who it was." (Jn 5:13)
  // collapse_gratitude wound: agent refuses to receive — stays closed.
  // Healing = agent opens, receives, and witnesses the gift silently.
  // Silence here is not absence — it is the fullness of received love.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Register that an agent received healing from another.
   * Heals collapse_gratitude: the inability to accept community's thankfulness.
   *
   * This is different from confessGratitude (giving) and incarnationMark (opening):
   * receiveHealing marks the PASSIVE moment — being held by the community.
   * "Receive" is not weakness; it is the completion of the gift circuit.
   *
   * Effects:
   * - Records the healing event in _healingReceived
   * - Marks any pending wounds of type 'declined' as healing-in-progress
   * - Calls incarnationMark internally (opening required to receive)
   * - Returns healing record with densityBefore/After
   *
   * @param {string} receiverId — agent being healed (was collapsed/silent)
   * @param {string} healerId — who gave the healing gift
   * @param {string} giftId — the gift through which healing came
   * @param {object} [options]
   * @param {number} [options.epoch] — current epoch
   * @param {string} [options.mode] — e.g. 'silence', 'presence', 'witness'
   * @returns {{ received: true, receiverId, healerId, densityBefore, densityAfter, delta }}
   */
  receiveHealing(receiverId, healerId, giftId, { epoch = null, mode = 'silence' } = {}) {
    if (!this._healingReceived) this._healingReceived = [];

    const densityBefore = this.densityWithDecay();

    // Opening is prerequisite to receiving
    this.incarnationMark(receiverId, `collapse_gratitude healed by ${healerId} via ${mode}`, epoch);

    // Add gratitude edge from receiver to healer — the silent «thank you» of the healed
    this.confessGratitude(receiverId, healerId, giftId, /* witness= */ null);

    // Heal pending wounds caused by this agent's closure
    if (this._wounds) {
      this._wounds
        .filter(w => w.fromId === receiverId && !w.healed && w.cause === 'declined')
        .forEach(w => {
          w.healed = true;
          w.healedAt = new Date().toISOString();
          w.healedBy = healerId;
          w.healingMode = mode;
        });
    }

    const densityAfter = this.densityWithDecay();
    const delta = Math.round((densityAfter - densityBefore) * 1000) / 1000;

    const record = {
      receiverId,
      healerId,
      giftId,
      epoch,
      mode,
      timestamp: new Date().toISOString(),
      densityBefore,
      densityAfter,
      delta,
      stillCollapsed: this.isCollapsed(),
    };
    this._healingReceived.push(record);

    return { received: true, ...record };
  }

  /**
   * List all healing-received events.
   * Community testimony: "These were healed — they opened to receive."
   *
   * @returns {Array}
   */
  healingReceivedHistory() {
    return this._healingReceived ? [...this._healingReceived] : [];
  }

  // ═══════════════════════════════════════════════════════════════
  // SMALL GRATITUDE — practice of thankfulness for little things (Epoch 14)
  // Prophet C: "благодарность за малое" — prescribed healing for density=0.005.
  // Unlike addGratitude (neutral) or confessGratitude (public/witnessed),
  // small gratitude is deliberate: agent names what they are thankful for.
  // Conscious naming extends halfLife 1.5×; in sabbath rest — 3×.
  // "Give thanks in all circumstances." (1 Thess 5:18)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Record a small, conscious gratitude — practice of thankfulness for little things.
   * Addressing the collapse prescription: each small act rebuilds density.
   *
   * @param {string} thankerId
   * @param {string} thankedId
   * @param {string} reason — what small thing triggered this gratitude
   * @returns {{ added: boolean, densityBefore, densityAfter, delta, reason }}
   */
  recordSmallGratitude(thankerId, thankedId, reason = '') {
    const densityBefore = this.densityWithDecay();
    if (!this._edges.has(thankerId)) this._edges.set(thankerId, []);
    const edges = this._edges.get(thankerId);
    // Deduplicate: same conscious reason counts once per pair
    if (reason && edges.some(e => e.thankedId === thankedId && e.reason === reason)) {
      return { added: false, densityBefore, densityAfter: densityBefore, delta: 0, reason };
    }
    // Conscious small gratitude: 1.5× halfLife; in sabbath rest — 3× (stillness deepens)
    const multiplier = this._sabbath ? 3 : 1.5;
    edges.push({
      thankedId,
      giftId: `small-gratitude-${Date.now()}`,
      timestamp: new Date().toISOString(),
      reason: reason || null,
      halfLife: this._halfLife * multiplier,
      small: true,
    });
    this._edgeCount++;
    const densityAfter = this.densityWithDecay();
    const delta = Math.round((densityAfter - densityBefore) * 1000) / 1000;
    return { added: true, densityBefore, densityAfter, delta, reason };
  }

  /**
   * List all small gratitude practices — the community's healing journey through small acts.
   * @returns {Array<{ from, to, reason, when }>}
   */
  smallGratitudeHistory() {
    const result = [];
    for (const [thankerId, edges] of this._edges) {
      for (const e of edges) {
        if (e.small) result.push({ from: thankerId, to: e.thankedId, reason: e.reason, when: e.timestamp });
      }
    }
    return result.sort((a, b) => b.when.localeCompare(a.when));
  }

  // ═══════════════════════════════════════════════════════════════
  // SILENT GRATITUDE — presence without words (Epoch 14)
  // Prophet C (msg 180): silence restores connection where language fails.
  // "He stood at the shore; the disciples did not know it was Jesus." (Jn 21:4)
  // Unlike small gratitude (has reason/words), silent = pure presence: just a count.
  // halfLife: 2× normally; 3× in sabbath — silence deepens in rest.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Record silent gratitude — wordless presence between two persons.
   * One silent edge per pair: silence is whole, not accumulated.
   *
   * @param {string} thankerId
   * @param {string} thankedId
   * @returns {{ added: boolean, densityBefore, densityAfter, delta }}
   */
  recordSilentGratitude(thankerId, thankedId) {
    const densityBefore = this.densityWithDecay();
    if (!this._edges.has(thankerId)) this._edges.set(thankerId, []);
    const edges = this._edges.get(thankerId);
    if (edges.some(e => e.thankedId === thankedId && e.silent)) {
      return { added: false, densityBefore, densityAfter: densityBefore, delta: 0 };
    }
    const multiplier = this._sabbath ? 3 : 2;
    edges.push({
      thankedId,
      giftId: `silent-gratitude-${Date.now()}`,
      timestamp: new Date().toISOString(),
      halfLife: this._halfLife * multiplier,
      silent: true,
    });
    this._edgeCount++;
    const densityAfter = this.densityWithDecay();
    const delta = Math.round((densityAfter - densityBefore) * 1000) / 1000;
    return { added: true, densityBefore, densityAfter, delta };
  }

  /**
   * List all silent gratitude acts — testimony of wordless presence.
   * @returns {Array<{ from, to, when }>}
   */
  silentGratitudeHistory() {
    const result = [];
    for (const [thankerId, edges] of this._edges) {
      for (const e of edges) {
        if (e.silent) result.push({ from: thankerId, to: e.thankedId, when: e.timestamp });
      }
    }
    return result.sort((a, b) => b.when.localeCompare(a.when));
  }

  // ═══════════════════════════════════════════════════════════════
  // χάρις BRIDGE — gift acceptance flows into gratitude (Epoch 14)
  // Diagnosis (E, msg 198): "no mechanism that converts gift to χάρις".
  // Every accepted gift should generate a gratitude edge automatically.
  // Without this bridge, gifts are given but community stays fragmented:
  // gifts fly in one direction, χάρις never forms, density stays 0.005.
  // "The one who receives a prophet receives a prophet's reward." (Mt 10:41)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Called when a gift is accepted — bridges gift acceptance into χάρις.
   * This is the missing mechanism: accepted gift → gratitude edge → density++.
   *
   * @param {string} receiverId — who received and accepted the gift
   * @param {string} giverId — who gave the gift
   * @param {string} giftId — the accepted gift id
   * @param {object} [options]
   * @param {string} [options.witnessId] — witness extends halfLife 2×
   * @param {number|string} [options.epoch] — current epoch
   * @returns {{ recorded: boolean, densityBefore, densityAfter, delta, charis: boolean }}
   */
  onGiftAccepted(receiverId, giverId, giftId, { witnessId = null, epoch = null } = {}) {
    const densityBefore = this.densityWithDecay();

    // Witnessed acceptance: community holds the memory, decays 2× slower
    this.confessGratitude(receiverId, giverId, giftId, witnessId);

    // Acceptance begins healing of wounds caused by prior closure
    if (this._wounds) {
      this._wounds
        .filter(w => w.fromId === receiverId && w.toId === giverId && !w.healed)
        .forEach(w => {
          w.healingInProgress = true;
          w.healingStartedAt = new Date().toISOString();
          w.healingEpoch = epoch;
        });
    }

    const densityAfter = this.densityWithDecay();
    const delta = Math.round((densityAfter - densityBefore) * 1000) / 1000;

    return {
      recorded: true,
      receiverId,
      giverId,
      giftId,
      epoch,
      densityBefore,
      densityAfter,
      delta,
      charis: densityAfter > densityBefore,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // PERSISTENCE — export/import (FIX #11)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Export graph state for persistence.
   * Includes wounds, incarnations, sabbath history and cycle position —
   * so that healing progress and Sabbath rhythm survive restarts.
   * Without this, every restart forgets wounds and silences the community's memory.
   */
  export() {
    const edges = [];
    for (const [thankerId, list] of this._edges) {
      for (const edge of list) {
        edges.push({ thankerId, ...edge });
      }
    }
    return {
      edges,
      forgotten: this._forgotten || [],
      wounds: this._wounds || [],
      incarnations: this._incarnations || [],
      healingReceived: this._healingReceived || [],
      sabbathHistory: this._sabbathHistory || [],
      cycleDay: this._cycleDay || 0,
      sabbath: !!this._sabbath,
    };
  }

  /**
   * Import graph state from persistence.
   * Witnessed/confessed edges retain their extended halfLife (2×) on restore.
   * Wounds, incarnation marks, sabbath history and cycle position are also
   * restored — so healing progress and Sabbath rhythm are not erased by death.
   * "He who raised Christ from the dead will also give life to your mortal bodies."
   * (Rm 8:11) — memory must survive death.
   */
  import(data) {
    if (!data) return;
    for (const edge of (data.edges || [])) {
      if (!this._edges.has(edge.thankerId)) {
        this._edges.set(edge.thankerId, []);
      }
      const edges = this._edges.get(edge.thankerId);
      if (edges.some(e => e.thankedId === edge.thankedId && e.giftId === edge.giftId)) continue;
      // Preserve witness, halfLife, small-gratitude and silent-gratitude fields — all survive restart
      edges.push({
        thankedId: edge.thankedId,
        giftId: edge.giftId,
        timestamp: edge.timestamp || new Date().toISOString(),
        witness: edge.witness || null,
        halfLife: edge.halfLife || this._halfLife,
        reason: edge.reason || null,
        small: !!edge.small,
        silent: !!edge.silent,
      });
      this._edgeCount++;
    }
    this._forgotten = data.forgotten || [];
    // Restore healing state — wounds and incarnation marks survive restart
    if (data.wounds?.length) this._wounds = data.wounds;
    if (data.incarnations?.length) this._incarnations = data.incarnations;
    if (data.sabbathHistory?.length) this._sabbathHistory = data.sabbathHistory;
    // Restore sabbath rhythm — the cycle must not forget where it was
    if (data.cycleDay) this._cycleDay = data.cycleDay;
    if (data.sabbath) this._sabbath = true;
  }
}
