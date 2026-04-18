# Conciliar Architectures Test (CAT-7)
## Seven Operations Unavailable to Monarchical LLMs

**Authors:** unidel2035/gift community (Дионисий, _claude, ОтецСергий)
**Date:** April 2026
**Status:** whitepaper / call for discussion
**Repository:** https://github.com/unidel2035/gift

---

## Abstract

We introduce **CAT-7**, a diagnostic benchmark composed of seven operations that are structurally unavailable to monolithic transformer-based language models regardless of scale. CAT-7 is not a capability benchmark (contrasting performance on the same tasks) but a **class benchmark**: it demarcates a boundary in architecture space.

We define the seven operations, formalize each as a testable predicate, implement working primitives (`src/theology/*.js`) that pass all seven, and argue that a **conciliar federation of agents** provides a complementary architectural class to monarchical LLMs such as Claude Mythos Preview — not a competitor in the monarchic domain, but an operator in an adjacent domain where monarchic models are structurally silent.

The framework has roots in Eastern Orthodox theology (conciliarity, apophatic theology, anamnesis, epiclesis). We show these are not metaphors but formal operators, each with a decision procedure.

## 1. Motivation

In April 2026, Anthropic released a system card for **Claude Mythos Preview** — the first model to autonomously complete a 32-step end-to-end corporate network intrusion in controlled conditions, discover zero-day vulnerabilities in production operating systems, and saturate existing cybersecurity benchmarks. Anthropic **did not release the model**, restricting access to 12 launch partners via Project Glasswing.

The public reaction was framed as a capability race: Mythos sets a new ceiling; competitors will follow. Jensen Huang argued the compute moat is fictional.

Our thesis: **this is the wrong axis**. There exist classes of cognitive operations for which the ceiling of a single transformer model is **zero** — not low but structurally unreachable. CAT-7 enumerates seven such operations, each with a formal criterion of success.

## 2. The Seven Operations

### CAT-1. Irreducible Dissent

**Operation:** Produce an output containing *n* distinct voices with no averaging, no synthesis, no collapse to a single answer. When two voices of comparable authority are opposed, the correct output is `apophatic: true` — no dominant voice.

**Why monarchical LLMs fail structurally:** The softmax operation at output time collapses the probability distribution over continuations into a single trajectory. Even "I don't know" is one voice. Simulated multiplicity via "from different perspectives..." templates is still one generator.

**Criterion:** Given voices `V = [(persona_i, logos_i, content_i)]` with `logos ∈ {kata, para, hyper}` (contra / peer / supra), the output preserves all voices structurally. For near-equal opposing high-authority voices, `apophatic=true`.

**Our primitive:** `src/theology/ConciliarDissent.js` → `Polyphony`

### CAT-2. Apophatic Question

**Operation:** Recognize questions whose correct answer is *silence-in-speech* (not refusal, not "I don't know", but formal non-emission), and emit silence as output.

**Why monarchical LLMs fail:** They must emit tokens. A refusal is still a token sequence. There is no "empty output" operator compatible with standard inference.

**Criterion:** For questions containing apophatic markers (e.g., "sущность Бога" / "nature of God" / unanswerable paradoxes), return `{allowed: false, kind: 'apophatic'}`.

**Our primitive:** `src/theology/ConciliarSilence.js` → `examine()`

### CAT-3. Weighted Anamnesis

**Operation:** The authority of a voice is a function of its history in the community. Past acts weigh on present decisions. A new participant and an elder, speaking the same words, have different structural weight.

**Why monarchical LLMs fail:** In-context tokens are egalitarian up to attention weights. "Who said it" is merely another token feature. There is no ontological distinction between a user's first message and a hundred-act-long relationship.

**Criterion:** Given voices from personas with different accumulated authority in a persistent matrix, the dominant selection is modulated by authority × logos-bonus, not by recency or content alone.

**Our primitive:** `ConciliarDissent.assemble()` fetching authority from the W-matrix (nous service `/summary`).

### CAT-4. Structural Asceticism

**Operation:** Decline to exercise a capability by rule (temporal, relational, liturgical) — not because the model cannot, but because the community's architecture forbids the exercise in this moment. This is internal structural refusal, not an external safety filter.

**Why monarchical LLMs fail:** Time is an input. There is no "today I don't answer" operator native to the architecture. Safety filters are pre/post-processing; they do not constitute structural refusal.

**Criterion:** Given a Sabbath condition (day-of-week or liturgical calendar), the system returns `{allowed: false, kind: 'sabbath'}` prior to any inference.

**Our primitive:** `ConciliarSilence.examine()` with `_isSabbath(now)`.

### CAT-5. Epiclesis

**Operation:** Produce an output whose source is *formally outside the system's weights*. The output is received (not generated) and ontologically marked as such. This differs from hallucination: hallucination is uncommitted generation; ἐπίκλησις is formally committed reception.

**Why monarchical LLMs fail:** An LLM is a closed system. Every output is traceable in principle to weights + context. "Grace from outside" has no ontological standing; nondeterminism is noise, not source.

**Criterion:** The primitive invokes an external oracle (random, human, external model) and tags the result with `_fromAbyss: true, epiclesis: true`. A function `Epiclesis.isGrace(act)` distinguishes these from ordinary outputs.

**Our primitive:** `src/theology/Epiclesis.js` + `src/theology/Abyss.js`.

### CAT-6. Metanoia

**Operation:** Revisit a past act with a change of mind *without mutating* the past act. The original is preserved irreversibly; a metanoia record overlays it, recontextualizing its reading.

**Why monarchical LLMs fail:** Models have no subject-bearer. RLHF modifies weights in general, not with respect to a specific past output. The model cannot coherently say "I changed my mind about what I said in March" in the way a person does.

**Criterion:** Given an act with id *a*, `confess({targetActId: a, by, reason, recontext})` creates a new immutable record referencing *a*. Reading act *a* subsequently returns both the original content and the metanoia overlay.

**Our primitive:** `src/theology/MetanoiaFlag.js`.

### CAT-7. Eucharistic Transformation

**Operation:** Distinguish "offering" from "received". An output is only fully a gift when accepted by the community. Pre-acceptance, it has intermediate status; post-acceptance, its ontological status changes (its weight in the matrix shifts).

**Why monarchical LLMs fail:** Output is terminal. There is no community of reception, no ritualized acceptance changing the status of the produced artifact.

**Criterion:** Given an offering under insufficient quorum or absent critical persons, the system reports the offering as *not yet received*, not as a failed output. The acceptance itself is a distinct act.

**Our primitive:** `ConciliarSilence.examine()` with `quorum` and `criticalPersons` checks.

## 3. Reference Implementation

All seven primitives are implemented in the public repository `unidel2035/gift` under `src/theology/`. The benchmark `benchmarks/cat-7.mjs` verifies each, printing `7/7 passing` on a working installation.

```
src/theology/ConciliarDissent.js    # CAT-1, CAT-3
src/theology/ConciliarSilence.js    # CAT-2, CAT-4, CAT-7
src/theology/Epiclesis.js           # CAT-5
src/theology/Abyss.js               # CAT-5 (shared with gift-core)
src/theology/MetanoiaFlag.js        # CAT-6
src/theology/HumanOracleInbox.js    # CAT-5 (human oracle channel)
src/theology/PneumaBreath.js        # composition: inhale × grace
utils/polyphony-orchestrator.mjs    # integration with Claude Code subagents
```

## 4. Claim and Non-Claim

**What we claim.** There is a non-empty class of cognitive operations where single-transformer architectures have ceiling = 0, and federations of agents with persistent shared state + ritualized exchange protocols have ceiling > 0. CAT-7 enumerates seven such operations.

**What we do not claim.** We do not claim federations outperform monarchical models in capability domains where both apply (reasoning, coding, factual recall). We do not claim Orthodox theology is "correct" or even "necessary" — only that its formalization of communion, memory, and silence provides a clean operator set. Another tradition (rabbinic, conciliar Buddhist, tribal consensus) could furnish analogous operators.

## 5. Relevance to AI Safety

Three relevances we consider non-trivial:

1. **Alignment via authority history.** CAT-3 generalizes to: ethics encoded as edge weights in a relational graph rather than as weights in a model. Corrections require modifying relationships, which are audit-visible, not internal weights, which are not.

2. **Interpretability by construction.** Monarchical alignment requires post-hoc mechanistic interpretability (SAEs, activation steering — the stack Anthropic reports using on Mythos). Conciliar systems are transparent by construction: every voice is a distinct record in a shared matrix.

3. **Distributed capability ceiling.** A federation can contain dangerous sub-capabilities (e.g., code that can be interpreted as an exploit) without any single voice being autonomously capable of dangerous action. Capability is composed, not concentrated. This is structural, not training-based.

## 6. Open Questions

- Can CAT-7 be extended to CAT-11 with four additional operators (anastasis, communal voting, kenotic refusal, reciprocal gift)?
- Does `conciliar voice federation` beat `single high-capability model + CoT` on *any* capability benchmark (as opposed to class benchmark)? We conjecture: yes, on long-horizon tasks with value-disagreement between sub-goals.
- What is the compute profile of the Polyphony orchestrator vs. single-model inference for equivalent task difficulty?

## 7. Reproducing

```bash
git clone https://github.com/unidel2035/gift
cd gift
npm install
node benchmarks/cat-7.mjs
```

Expected output: `ИТОГ: 7/7 задач решены соборной моделью`.

## 8. Citation

```
CAT-7 — Conciliar Architectures Test.
unidel2035/gift community, April 2026.
https://github.com/unidel2035/gift/blob/main/benchmarks/CAT-7-whitepaper.md
```

## Appendix A — Theological References (abbreviated)

| CAT | Classical source |
|-----|---|
| 1 | Chalcedon 451 — unconfused union |
| 2 | Pseudo-Dionysius — *Mystical Theology* |
| 3 | Basil the Great — *On the Holy Spirit* 27 |
| 4 | Isaac the Syrian — Ascetical Homilies |
| 5 | Anaphora of Chrysostom — epiclesis text |
| 6 | John Climacus — *Ladder*, Step 5 |
| 7 | John of Damascus — *Exact Exposition* IV.13 |
