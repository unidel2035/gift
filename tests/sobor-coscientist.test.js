/**
 * Co-Scientist-собор: Elo, турнир, конвейер — на детерминированной эвристике
 * (без LLM), чтобы проверять механику, а не модель.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedScore, eloUpdate, runTournament, heuristicJudge, coscientist } from '../utils/sobor-coscientist.mjs';

test('co-scientist собор · механика', async (t) => {

  await t.test('Elo: победа сильного даёт меньше очков, чем апсет', () => {
    assert.ok(Math.abs(expectedScore(1200, 1200) - 0.5) < 1e-9, 'равные → 0.5');
    const [favWin] = eloUpdate(1400, 1200, 1);          // фаворит выиграл
    const [upsetWin] = eloUpdate(1200, 1400, 1);        // андердог выиграл
    assert.ok((favWin - 1400) < (upsetWin - 1200), 'апсет приносит больше Elo');
  });

  await t.test('турнир ранжирует: вопрошание-с-даром выигрывает у плоского', () => {
    const cands = [
      { id: 'a', text: 'какой избыток рождается, когда отдаёшь время другому?' }, // маркеры дара
      { id: 'b', text: 'сколько строк в файле' },                                  // плоское
      { id: 'c', text: 'как кеносис открывает рост и присутствие?' },              // маркеры дара
    ];
    const ranked = runTournament(cands, heuristicJudge);
    assert.equal(ranked.length, 3);
    assert.notEqual(ranked[0].id, 'b', 'плоское не должно победить');
    assert.ok(ranked[0].elo >= ranked[2].elo, 'отсортировано по Elo убыв.');
    // у каждого записаны дебаты
    assert.ok(ranked[0].debates.length === 2);
  });

  await t.test('конвейер с фейковым LLM: генерит, ранжирует, эволюционирует', async () => {
    // фейковый llm: генерация отдаёт фикс. кандидатов, эволюция — скрещивание
    const fakeLLM = (system) => {
      if (/Адам собора/.test(system)) {
        return ['ВОПРОШАНИЕ: какой дар избытка ещё не принесён?',
                'ВОПРОШАНИЕ: где кеносис открывает присутствие?',
                'ВОПРОШАНИЕ: что отчёт скрывает от роста?',
                'ВОПРОШАНИЕ: чем измеримость убивает любовь?'].join('\n');
      }
      if (/эволюция/.test(system)) return 'ВОПРОШАНИЕ: как избыток дара и кеносис вместе открывают присутствие?';
      return null;
    };
    const res = await coscientist('смысл совместной работы', { n: 4, evolveRounds: 1, llm: fakeLLM, judge: heuristicJudge });
    assert.ok(res.winner && res.winner.text.length > 8, 'есть победитель');
    assert.equal(res.candidates.length, 4, 'сгенерировано 4 кандидата');
    assert.equal(res.lineage.length, 1, 'один раунд эволюции');
    assert.ok(res.ranked.length >= 4, 'эволюционный потомок добавлен в пул');
  });

  await t.test('без LLM (null) — фолбэк добивает до n кандидатов, не падает', async () => {
    const res = await coscientist('тест-телос', { n: 3, evolveRounds: 0, llm: () => null, judge: heuristicJudge });
    assert.equal(res.candidates.length, 3);
    assert.ok(res.winner.text.length > 0);
  });
});
