/**
 * MatrixRecorder — пишет ключевые события GoalEngine в W-матрицу.
 *
 * Богословский расклад:
 *   - μετάνοια на итерации       → _executor → _koinon, type='kenosis', weight=1
 *   - done (цель достигнута)     → _executor → Дионисий, type='code', weight=10
 *   - failed (исчерпан maxIter)  → _executor → _koinon, type='kenosis', weight=2
 *   - cancelled                  → ничего (отмена — не акт)
 *
 * Каждое покаяние — отдельный кенозис-акт. Завершённая цель — большой дар (вес 10).
 * Это согласуется с аксиомой «время тяжелее денег» — длительная цель weighs heavy.
 *
 * Snapshot пишется на диск после каждого акта (атомарность не критична —
 * матрица переживает потерю одного акта, но не должна терять состояние сессии).
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

export class MatrixRecorder {
  constructor({ snapPath, agentId = '_executor', receiver = 'Дионисий', GiftMemoryCtor = null } = {}) {
    this.snapPath = snapPath;
    this.agentId  = agentId;
    this.receiver = receiver;
    this._mem = null;
    this._GiftMemory = GiftMemoryCtor;  // для тестов; в проде — динамический импорт
  }

  async _ensureMem() {
    if (this._mem) return this._mem;
    if (!this._GiftMemory) {
      const mod = await import('../core/GiftMemory.js');
      this._GiftMemory = mod.GiftMemory;
    }
    if (this.snapPath && existsSync(this.snapPath)) {
      this._mem = this._GiftMemory.fromSnapshot(JSON.parse(readFileSync(this.snapPath, 'utf8')));
    } else {
      this._mem = new this._GiftMemory([this.agentId, this.receiver, '_koinon']);
    }
    return this._mem;
  }

  async _record({ to, type, weight, content }) {
    const mem = await this._ensureMem();
    mem._idx(this.agentId);
    mem._idx(to);
    mem.receive({
      giverId: this.agentId,
      receiverId: to,
      weight,
      type,
      content,
      irreversible: true,
    });
    this._save();
  }

  // ── Хуки для GoalEngine ──────────────────────────────────────────────────
  async onMetanoia(state, step) {
    const snippet = (step.metanoia?.text || step.review?.reason || '').replace(/\s+/g, ' ').slice(0, 200);
    await this._record({
      to: '_koinon',
      type: 'kenosis',
      weight: 1,
      content: `μετάνοια goal=${state.id} step=${step.n}: ${snippet}`,
    });
  }

  async onDone(state) {
    await this._record({
      to: this.receiver,
      type: 'code',
      weight: 10,
      content: `goal=${state.id} done за ${state.iteration} итераций: ${state.objective}`,
    });
  }

  async onFailed(state) {
    await this._record({
      to: '_koinon',
      type: 'kenosis',
      weight: 2,
      content: `goal=${state.id} failed (${state.failReason}): ${state.objective}`,
    });
  }

  _save() {
    if (!this.snapPath) return;
    writeFileSync(this.snapPath, JSON.stringify(this._mem.snapshot(), null, 2));
  }
}
