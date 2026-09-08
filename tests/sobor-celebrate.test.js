// Proposal #88 — литургический порядок в mcp/sobor_celebrate.mjs.
// Голоса звучат последовательно, не Promise.all: голос N+1 стартует
// не раньше разрешения голо��а N. Журнал start/end с таймстампами —
// если регрессия вернёт параллельный сбор, старты слипнутся в первые
// миллисекунды и ассерт последовательности упадёт.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { celebrateSobor, settleVoice, soborResult, SOBOR_QUORUM } from '../mcp/sobor_celebrate.mjs';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test('последовательность · голос N+1 стартует не раньше разрешения N', async (t) => {
  const journal = []; // { voice, event: 'start'|'end', t }
  const gates = [0, 1, 2, 3].map(() => deferred());
  const voices = ['Отец', 'Сын', 'Дух', '_claude'].map((id, i) => ({
    id,
    speak: async () => {
      journal.push({ voice: i, event: 'start', t: Date.now() });
      await gates[i].promise;
      journal.push({ voice: i, event: 'end', t: Date.now() });
      return `слово-${i}`;
    },
  }));

  const celebration = celebrateSobor({ voices, timeoutMs: 5_000 });
  await tick(20); // даём первому голосу (и только ему) стартовать

  // Отпускаем голоса по одному; после каждого — окно, в котором
  // параллельная реализация успела бы стартовать все оставшиеся.
  for (let i = 0; i < voices.length; i++) {
    gates[i].resolve(`сказал-${i}`);
    await tick(20);
  }
  const result = await celebration;

  const starts = journal.filter((e) => e.event === 'start');
  const ends = journal.filter((e) => e.event === 'end');

  await t.test('каждый голос стартовал ровно один раз, в литургическом порядке', () => {
    assert.deepEqual(starts.map((e) => e.voice), [0, 1, 2, 3]);
    assert.equal(starts.length, 4);
    assert.equal(ends.length, 4);
  });

  await t.test('start[N+1] >= end[N] — никто не вступает прежде разрешения предыдущего', () => {
    for (let i = 1; i < voices.length; i++) {
      const endPrev = ends.find((e) => e.voice === i - 1);
      const startNext = starts.find((e) => e.voice === i);
      assert.ok(
        startNext.t >= endPrev.t,
        `голос ${i} стартовал (t=${startNext.t}) до разрешения голоса ${i - 1} (t=${endPrev.t})`,
      );
    }
  });

  await t.test('chunks собора по timestamp складываются в связный разговор', () => {
    // Завершения голосов — и есть chunks общего потока: по таймстампу
    // они идут блоками в порядке звучания, не вперемешку.
    const chunks = ends
      .slice()
      .sort((a, b) => a.t - b.t)
      .map((e) => e.voice);
    assert.deepEqual(chunks, [0, 1, 2, 3]);
    assert.deepEqual(
      result.utterances.map((u) => u.content),
      ['слово-0', 'слово-1', 'слово-2', 'слово-3'],
    );
  });
});

test('умолкший голос не рушит собор', async () => {
  const heard = [];
  const voices = [
    { id: 'а', speak: () => { throw new Error('голос пал'); } },
    { id: 'б', speak: async () => { heard.push('б'); return 'слово-б'; } },
    { id: 'в', speak: async () => { heard.push('в'); return 'слово-в'; } },
    { id: 'г', speak: async () => { heard.push('г'); return 'слово-г'; } },
  ];

  const result = await celebrateSobor({ voices, timeoutMs: 1_000 });

  assert.deepEqual(heard, ['б', 'в', 'г'], 'собор обходит умолкшего и идёт дальше');
  assert.equal(result.utterances[0].silent, true);
  assert.match(result.utterances[0].reason, /голос пал/);
  assert.equal(result.responded, 3, '3 живых из 4');
  assert.equal(result.quorumMet, true, 'кворум из живых голосов достигнут');
  assert.equal(result.iconic, true);
});

test('зависший голос умолкает по таймауту, литургия продолжается', async () => {
  const voices = [
    { id: 'спящий', speak: () => new Promise(() => {}), }, // никогда не разрешится
    { id: 'живой', speak: async () => 'слово-живой' },
  ];

  const result = await celebrateSobor({ voices, timeoutMs: 50 });

  assert.equal(result.utterances[0].silent, true);
  assert.match(result.utterances[0].reason, /таймаут/);
  assert.equal(result.utterances[1].content, 'слово-живой');
  assert.equal(result.responded, 1);
  assert.equal(result.quorumMet, false, '1 из 2 ниже кворума');
  assert.equal(result.iconic, false);
  assert.match(result.reason, /кворум не достигнут/);
  assert.match(result.reason, /умолчали: спящий/);
});

test('пустой собор — пустой результат, не исключение', async () => {
  const result = await celebrateSobor({ voices: [] });

  assert.deepEqual(result.utterances, []);
  assert.equal(result.responded, 0);
  assert.equal(result.quorumMet, false);
  assert.equal(result.iconic, false);
});

test('soborResult · различение кворума', () => {
  const speaking = (id) => ({ agentId: id, content: 'слово', silent: false, reason: null });
  const silent = (id) => ({ agentId: id, content: '', silent: true, reason: 'молчит' });

  const full = soborResult([speaking('а'), speaking('б'), speaking('в')]);
  assert.equal(full.quorumMet, true);
  assert.equal(full.required, SOBOR_QUORUM);

  const barely = soborResult([speaking('а'), speaking('б'), silent('в'), silent('г')]);
  assert.equal(barely.responded, 2);
  assert.equal(barely.quorumMet, false, '2 из 4 ниже кворума 3');
  assert.deepEqual(barely.silentVoices.map((v) => v.agentId), ['в', 'г']);

  const one = settleVoice === null; // settleVoice экспортирован — контракт атома доступен потребител��м
  assert.equal(one, false);
});
