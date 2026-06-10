/**
 * Proximity-агент собора: кластеризация почти-дубликатов на детерминированной
 * лексической мере (без сети/embeddings), чтобы проверять механику, а не модель.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cluster, diversify } from '../utils/sobor-proximity.mjs';

test('proximity собор · кластеризация', async (t) => {

  await t.test('почти-дубликат схлопывается, разное сохраняется', () => {
    const cands = [
      { id: 'a1', text: 'базовый PID контур держит точку при возмущениях в пределах допуска' },
      { id: 'a2', text: 'базовый PID контур удерживает точку при возмущениях в пределах допуска норм' },
      { id: 'b1', text: 'рой из пятидесяти аппаратов самоорганизуется без центрального управления' },
      { id: 'c1', text: 'предиктивная модель ветра снимает остаточный риск срыва миссии' },
    ];
    const { diverse, clusters } = diversify(cands, { threshold: 0.6 });
    assert.equal(clusters.length, 3, 'a1≈a2 → один кластер, b1 и c1 отдельны');
    assert.equal(diverse.length, 3, 'в турнир идут 3 представителя');
    const merged = diverse.find(d => d.mergedCount === 1);
    assert.ok(merged, 'один представитель поглотил дубликат');
    assert.equal(merged.merged.length, 1, 'поглощённый виден (лицо не теряется)');
  });

  await t.test('испытуемый кандидат — представитель кластера (trial в приоритете)', () => {
    const cands = [
      { id: 'plain', text: 'контур управления держит точку при возмущениях стабильно надёжно' },
      { id: 'tried', text: 'контур управления держит точку при возмущениях', trial: { cmd: 'exit 0' } },
    ];
    const clusters = cluster(cands, { threshold: 0.5 });
    assert.equal(clusters.length, 1, 'оба в одном кластере');
    assert.equal(clusters[0].rep.id, 'tried', 'представитель — с испытанием, а не более длинный');
  });

  await t.test('всё разное — ничего не схлопывается', () => {
    const cands = [
      { id: 'x', text: 'автономность навигации без спутника' },
      { id: 'y', text: 'защищённость канала связи от подавления' },
      { id: 'z', text: 'дешёвое массовое производство планера' },
    ];
    const { diverse } = diversify(cands, { threshold: 0.6 });
    assert.equal(diverse.length, 3, 'разные гипотезы все доходят до турнира');
  });
});
