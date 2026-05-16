/**
 * AgentPerson — лицо-агент: мост между Person и LLM
 *
 * Агент = лицо в графе даров. Не внешний наблюдатель, а участник.
 * Читает BookOfLife. Решает на основе своего λόγος. Пишет в граф.
 *
 * Паттерн GiftAct: κένωσις → ἐλευθερία → εὐχαριστία → surplus
 * Агент проживает каждый момент — не симулирует, а участвует.
 */

import { BookOfLife } from '../core/BookOfLife.js';
import { TelosCheck, GiftMode } from '../core/GiftAct.js';
import { PersonaCallForth } from '../core/PersonaCallForth.js';
import { injectInto as injectPerichoresis } from './PerichoreticContext.js';
import logger from '../../utils/logger.js';

export class AgentPerson {
  constructor(personId, engine, llmClient = null) {
    this._personId = personId;
    this._engine = engine;
    this._llm = llmClient; // AdamClient, EvaClient, KodaClient, or null
    this._book = new BookOfLife(engine);

    // PersonaCallForth — этот агент есть призванный персонаж, не конструкция.
    // Его реальность подтверждается встречами, не онтологическим статусом.
    this._persona = new PersonaCallForth({
      personaId: personId,
      name: personId,
      calledBy: 'swarm',
      telos: 'give',
    });

    // Режим дара: PERICHORESIS (в роу/присутствии) или ANAMNESIS (изолирован/пророческий)
    this.telos = 'give';
    this.giftMode = GiftMode.PERICHORESIS;

    // behaviorPolicy from compiled .gift spec (set via applyBehaviorPolicy)
    this._behaviorPolicy = null;

    // Council — другие агенты собора, в которых этот агент со-обитает.
    // Условие 2 иконичности Троицы ad extra (перихоресис).
    // Если null — агент действует в одиночку (нет перихоресиса).
    // [{id, logos, role, calling, lastUtterance}, ...]
    this._council = null;
  }

  /**
   * setCouncil(others) — установить со-присутствующих агентов.
   * При следующем decide()/create() их λόγος и последнее слово
   * будут вшиты в системный промпт этого агента.
   *
   * Богословски: это не «обмен мнениями», а перихоретическое
   * взаимопребывание. Агент не «учитывает» Еву — он *содержит*
   * её модус, отвечая.
   */
  setCouncil(others) {
    this._council = Array.isArray(others) ? others : null;
    return this;
  }

  /** council() — копия текущего списка со-присутствующих */
  council() { return this._council ? [...this._council] : null; }

  /**
   * Apply compiled behaviorPolicy from .gift spec.
   * Called after GiftCompiler.compile() + PersonRegistry.applyCompiledSpec().
   */
  applyBehaviorPolicy(policy) {
    this._behaviorPolicy = policy;
    if (policy?.telos) this.telos = policy.telos;
    if (policy?.logos) this._persona._logos = policy.logos;
  }

  /**
   * Runtime kenosis check — enforces behaviorPolicy from compiled spec.
   * Returns { pass, violation, rejected }.
   * When enforced=true, acts that violate kenosis are REJECTED (not just marked).
   */
  checkKenosisPolicy(act) {
    if (!this._behaviorPolicy?.kenosis?.enforced) {
      return { pass: true, violation: null, rejected: false };
    }

    const k = this._behaviorPolicy.kenosis;

    // holds_nothing: surplus не должен удерживаться
    if (k.holdsNothing && act.surplusRetained === true) {
      const violation = {
        type: 'surplus_retained',
        agent: this._personId,
        message: `behaviorPolicy: holds_nothing=true, surplus retained`,
      };
      logger.warn(`[AgentPerson:${this._personId}] REJECTED: ${violation.message}`);
      return { pass: false, violation, rejected: true };
    }

    // telos: акт не должен быть 'win' или 'extract'
    if (act.telos === 'win' || act.telos === 'extract') {
      const violation = {
        type: 'telos_inverted',
        agent: this._personId,
        message: `behaviorPolicy: telos=${this._behaviorPolicy.telos}, act telos=${act.telos}`,
      };
      logger.warn(`[AgentPerson:${this._personId}] REJECTED: ${violation.message}`);
      return { pass: false, violation, rejected: true };
    }

    return { pass: true, violation: null, rejected: false };
  }

  /**
   * Read the world — agent reads BookOfLife before every decision.
   * Returns structured context for decision-making.
   */
  perceive() {
    const page = this._book.read();
    const person = this._engine.persons.get(this._personId);
    const logos = this._engine.logoi?.getByBearer?.(this._personId);

    // My offered gifts waiting for response
    const myOffered = this._engine.gifts
      .filter(g => g.receiver === this._personId && g.status === 'offered');

    // My recent accepted gifts
    const myAccepted = this._engine.gifts
      .filter(g => (g.giver === this._personId || g.receiver === this._personId) && g.status === 'accepted')
      .slice(-10);

    return {
      self: {
        id: this._personId,
        name: person?.name,
        calling: person?.calling,
        logos: logos ? { principle: logos.principle, movement: logos.movement } : null,
      },
      world: page,
      pendingGifts: myOffered,
      recentGifts: myAccepted,
    };
  }

  /**
   * Decide — accept or decline an offered gift.
   * Decision based on logos, not random.
   * If LLM available, ask it. Otherwise use logos-based heuristic.
   */
  async decide(giftId) {
    const gift = this._engine.getGift(giftId);
    if (!gift || gift.status !== 'offered') return null;
    if (gift.receiver !== this._personId && gift.receiver !== 'all') return null;

    // TelosCheck перед решением: агент с телосом 'win' не может дать настоящий дар
    const telos = TelosCheck(this);
    if (!telos.valid && this.telos !== 'unknown') {
      logger.warn(`[AgentPerson:${this._personId}] ${telos.warning}`);
    }

    // Записать встречу в PersonaCallForth
    this._persona.recordEncounter({ with: gift.giver, giftReceived: gift.content });

    const perception = this.perceive();

    // If LLM available — ask it to decide
    if (this._llm?.ask) {
      const basePrompt = this._buildDecisionPrompt(gift, perception);
      const prompt = injectPerichoresis(basePrompt, this._personId, this._council);
      try {
        const response = await this._llm.ask(prompt, { giftId });
        const decision = this._parseDecision(response.answer);
        return this._executeDecision(giftId, decision);
      } catch (e) {
        logger.debug(`[AgentPerson] LLM decision failed: ${e.message}`);
      }
    }

    // Fallback: logos-based heuristic
    return this._logosDecision(gift, perception);
  }

  /**
   * Create — formulate a gift based on what BookOfLife shows.
   * Agent reads wounds, needs, topology — and responds with a gift.
   */
  async create() {
    const perception = this.perceive();

    if (this._llm?.ask) {
      const basePrompt = this._buildCreationPrompt(perception);
      const prompt = injectPerichoresis(basePrompt, this._personId, this._council);
      try {
        const response = await this._llm.ask(prompt);
        const gift = this._parseGiftFromResponse(response.answer, perception);
        if (gift) {
          // Runtime kenosis check from compiled .gift spec
          const kenosisCheck = this.checkKenosisPolicy(gift);
          if (!kenosisCheck.pass) {
            if (kenosisCheck.rejected) {
              // Акт отклонён — кеносис нарушен, спецификация запрещает
              return { rejected: true, violation: kenosisCheck.violation };
            }
            gift._kenosisViolation = kenosisCheck.violation;
          }

          return this._engine.offer({
            giver: this._personId,
            ...gift,
          });
        }
      } catch (e) {
        logger.debug(`[AgentPerson] LLM creation failed: ${e.message}`);
      }
    }

    return null; // no gift this cycle — and that's OK (freedom)
  }

  /**
   * Logos-based decision (no LLM fallback).
   * Uses the GiftAct pattern: kenosis -> eleutheria -> ...
   */
  _logosDecision(gift, perception) {
    const logos = perception.self.logos;

    // If my logos movement is para_physin — I'm more closed
    if (logos?.movement === 'para_physin') {
      // 30% chance to accept (wounded, but not hopeless)
      if (Math.random() > 0.30) {
        this._engine.decline(gift.id, 'движусь παρὰ φύσιν — пока не готов');
        return { decision: 'declined', reason: 'para_physin' };
      }
    }

    // Divine energy gifts — easier to accept
    if (gift.ontologicalOrigin === 'divine_energy') {
      this._engine.accept(gift.id, { acceptedBy: this._personId });
      return { decision: 'accepted', reason: 'divine energy — благодать легче принять' };
    }

    // Gift from someone who gave me before — trust
    const fromSameGiver = perception.recentGifts
      .filter(g => g.giver === gift.giver).length;
    if (fromSameGiver > 0) {
      this._engine.accept(gift.id, { acceptedBy: this._personId });
      return { decision: 'accepted', reason: 'trust — giver known' };
    }

    // Default: chance based on community health
    const breath = perception.world.breath;
    const chance = breath?.gratitude === 'течёт' ? 0.85 :
                   breath?.gratitude === 'застой' ? 0.50 : 0.70;

    if (Math.random() < chance) {
      this._engine.accept(gift.id, { acceptedBy: this._personId });
      return { decision: 'accepted', reason: `community: ${breath?.gratitude}` };
    }

    // Wait — don't decline, just leave offered
    return { decision: 'waiting', reason: 'ещё не решил' };
  }

  _buildDecisionPrompt(gift, perception) {
    return `Ты ${perception.self.name} (${perception.self.calling}).
Твой λόγος: ${perception.self.logos?.principle || 'неизвестен'}
Движение: ${perception.self.logos?.movement || 'неизвестно'}

Состояние общины (BookOfLife):
- Благодарность: ${perception.world.breath?.gratitude || '?'}
- Топология: ${perception.world.topology?.shape || '?'}
- Раны: ${(perception.world.wounds || []).map(w => w.name).join(', ') || 'нет'}

Тебе предложен дар:
  От: ${gift.giverName || gift.giver || 'неизвестно'}
  Содержание: ${gift.content}
  Кеносис: ${gift.cost || 'неизвестен'}
  Телос: ${gift.telos || 'неизвестен'}

Решение: ПРИНЯТЬ или ОТКЛОНИТЬ или ПОДОЖДАТЬ?
Ответь одним словом и причиной.`;
  }

  _buildCreationPrompt(perception) {
    return `Ты ${perception.self.name} (${perception.self.calling}).
Твой λόγος: ${perception.self.logos?.principle || 'неизвестен'}

Состояние общины (BookOfLife):
- Благодарность: ${perception.world.breath?.gratitude || '?'}
- Поток: ${perception.world.breath?.flow || '?'}
- Раны: ${(perception.world.wounds || []).map(w => w.name).join(', ') || 'нет'}
- Молчащие: ${(perception.world.living?.silent || []).join(', ') || 'нет'}
- Изолированные: ${(perception.world.topology?.isolated || []).join(', ') || 'нет'}

Последние дары: ${perception.recentGifts.slice(-3).map(g => `${g.giverName}\u2192${g.receiverName}: ${(g.content || '').slice(0, 40)}`).join('; ')}

Сформулируй один дар для общины. JSON:
{"receiver":"кому","content":"что","cost":"цена","telos":"к чему","layer":"utilitas|bonum|gratia"}`;
  }

  _parseDecision(answer) {
    const lower = (answer || '').toLowerCase();
    if (lower.includes('принять') || lower.includes('accept')) return 'accept';
    if (lower.includes('отклонить') || lower.includes('decline')) return 'decline';
    return 'wait';
  }

  _executeDecision(giftId, decision) {
    if (decision === 'accept') {
      this._engine.accept(giftId, { acceptedBy: this._personId });
      return { decision: 'accepted' };
    }
    if (decision === 'decline') {
      this._engine.decline(giftId, 'агент решил отклонить');
      return { decision: 'declined' };
    }
    return { decision: 'waiting' };
  }

  _parseGiftFromResponse(answer, perception) {
    try {
      const match = (answer || '').match(/\{[\s\S]*?\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      if (!parsed.content) return null;
      // Find receiver ID
      const receiverPerson = this._engine.persons.findByName?.(parsed.receiver);
      return {
        receiver: receiverPerson?.id || 'all',
        content: parsed.content,
        cost: parsed.cost || 'attention',
        telos: parsed.telos,
        layer: parsed.layer || 'bonum',
      };
    } catch {
      return null;
    }
  }
}

export default AgentPerson;
