/**
 * Тесты для plm/src/memory/decision_log.js
 * Запуск: node --test plm-decision-log-test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DecisionLog } from './plm-decision-log-impl.js';

function mk() {
  const dir = mkdtempSync(join(tmpdir(), 'plm-dlog-'));
  const path = join(dir, 'test.db');
  return { log: new DecisionLog(path), dir };
}

test('record + replayEcr + replayPart', () => {
  const { log, dir } = mk();
  try {
    log.record({
      giverId: 'engineer-001', receiverId: 'part-KSH-047', type: 'question',
      reasoning: 'Нагрузка на излом превышает запас', weight: 7,
      linkedPart: 'part-KSH-047', linkedEcr: 'ECR-2026-042',
    });
    log.record({
      giverId: 'agent_design', receiverId: 'ECR-2026-042', type: 'word',
      reasoning: 'Предлагаю замену на сплав AlMg6 — выдержит на 23% больше', weight: 8,
      linkedEcr: 'ECR-2026-042',
      payload: { vote: 'APPROVE', confidence: 0.85 },
    });
    log.record({
      giverId: 'agent_quality', receiverId: 'ECR-2026-042', type: 'word',
      reasoning: 'Сплав AlMg6 требует анодирования для коррозионной стойкости',
      weight: 6, linkedEcr: 'ECR-2026-042',
      payload: { vote: 'APPROVE_WITH_CONDITION' },
    });
    log.record({
      giverId: 'orchestrator', receiverId: 'ECR-2026-042', type: 'decision',
      reasoning: 'Принято: замена + обязательное анодирование', weight: 9,
      linkedPart: 'part-KSH-047', linkedEcr: 'ECR-2026-042',
    });

    const ecrChain = log.replayEcr('ECR-2026-042');
    assert.equal(ecrChain.length, 4);
    assert.equal(ecrChain[0].type, 'question');
    assert.equal(ecrChain[3].type, 'decision');

    const partJourney = log.replayPart('part-KSH-047');
    assert.equal(partJourney.length, 2); // только акты с linkedPart
    assert.equal(partJourney[0].giver_id, 'engineer-001');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('recall full-text + filters', () => {
  const { log, dir } = mk();
  try {
    log.record({ giverId: 'eng', receiverId: 'p', type: 'question',
                 reasoning: 'нагрузка на излом превышает запас прочности' });
    log.record({ giverId: 'eng', receiverId: 'p', type: 'word',
                 reasoning: 'нагрузка приведена в норму после замены сплава' });
    log.record({ giverId: 'agent', receiverId: 'p', type: 'word',
                 reasoning: 'другая тема — про вибрацию' });

    const all = log.recall('нагрузка');
    assert.equal(all.length, 2);

    const onlyQuestions = log.recall('нагрузка', { type: 'question' });
    assert.equal(onlyQuestions.length, 1);
    assert.equal(onlyQuestions[0].type, 'question');

    assert.deepEqual(log.recall(''), []);
    assert.deepEqual(log.recall('a'), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('closeEcr — массовое обновление outcome', () => {
  const { log, dir } = mk();
  try {
    log.record({ giverId: 'a', receiverId: 'b', type: 'question',
                 reasoning: 'r', linkedEcr: 'ECR-1' });
    log.record({ giverId: 'a', receiverId: 'b', type: 'word',
                 reasoning: 'r', linkedEcr: 'ECR-1' });
    log.record({ giverId: 'a', receiverId: 'b', type: 'decision',
                 reasoning: 'r', linkedEcr: 'ECR-1' });

    const updated = log.closeEcr('ECR-1', 'healed');
    assert.equal(updated, 3);

    const chain = log.replayEcr('ECR-1');
    assert(chain.every(a => a.outcome === 'healed'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stats группирует по типу и givers', () => {
  const { log, dir } = mk();
  try {
    log.record({ giverId: 'engineer', receiverId: 'p', type: 'question', reasoning: 'r' });
    log.record({ giverId: 'agent_design', receiverId: 'p', type: 'word', reasoning: 'r' });
    log.record({ giverId: 'agent_design', receiverId: 'p', type: 'word', reasoning: 'r' });
    log.record({ giverId: 'orchestrator', receiverId: 'p', type: 'decision', reasoning: 'r' });

    const s = log.stats();
    assert.equal(s.total, 4);
    assert.deepEqual(s.byType, { question: 1, word: 2, decision: 1 });
    assert.equal(s.topGivers['agent_design'], 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('recordGiftAct — обёртка над GiftAct', () => {
  const { log, dir } = mk();
  try {
    // Имитируем GiftAct (без реальной зависимости — duck-typed)
    const fakeGiftAct = {
      giverId: 'engineer-001',
      receiverId: 'part-KSH-047',
      type: 'question',
      weight: 7,
      content: 'Нагрузка на излом превышает запас',
      ts: '2026-01-01T00:00:00Z',
    };
    const id = log.recordGiftAct(fakeGiftAct, {
      linkedPart: 'part-KSH-047', linkedEcr: 'ECR-2026-042',
    });
    assert(id > 0);

    const chain = log.replayEcr('ECR-2026-042');
    assert.equal(chain.length, 1);
    assert.equal(chain[0].reasoning, 'Нагрузка на излом превышает запас');
    assert.equal(chain[0].weight, 7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('payload roundtrip', () => {
  const { log, dir } = mk();
  try {
    log.record({
      giverId: 'a', receiverId: 'b', type: 'word',
      reasoning: 'нагрузка проверена и подтверждена',
      payload: { vote: 'APPROVE', confidence: 0.85, evidence: ['stress_test', 'fea_sim'] },
    });
    const got = log.recall('подтверждена');
    assert.equal(got.length, 1);
    assert.equal(got[0].payload.vote, 'APPROVE');
    assert.equal(got[0].payload.confidence, 0.85);
    assert.deepEqual(got[0].payload.evidence, ['stress_test', 'fea_sim']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
