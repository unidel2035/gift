import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Decoupage, SPHERES } from '../src/persons/Decoupage.js';
import { Vintage } from '../src/persons/Vintage.js';
import { LiturgicalCalendar, KAIROS } from '../src/scheduling/LiturgicalCalendar.js';
import { GiftMemory } from '../src/core/GiftMemory.js';

// ─── Decoupage ────────────────────────────────────────────────────────────

test('Decoupage — διαίρεσις по 4 сфере-инженериям', async (t) => {
  await t.test('staticSlices даёт 4 сферы с вопросами', () => {
    const d = new Decoupage();
    const slices = d.staticSlices('пилотная программа БПЛА в агро');
    assert.equal(Object.keys(slices).length, 4);
    for (const s of SPHERES) {
      assert.ok(slices[s].questions.length >= 3);
      assert.equal(slices[s].verdict, 'unanalyzed');
    }
  });

  await t.test('cut без LLM возвращает структуру с unanalyzed', async () => {
    const d = new Decoupage();
    const r = await d.cut({ idea: 'идея X' });
    assert.equal(r.ground.verdict, 'unanalyzed');
    assert.equal(r.water.verdict, 'unanalyzed');
    assert.ok(r.integral);
    assert.match(r.integral.shape, /пустая|смешанная/);
  });

  await t.test('cut с LLM-моком — заполняет ответы и оценивает', async () => {
    const llm = {
      ask: async (prompt) => {
        if (prompt.includes('ground')) return { answer: 'материя: дрон, поле, GPS-приёмник, сертификация компонентов — это конкретно. Производство в РФ.' };
        if (prompt.includes('water'))  return { answer: 'перетоки: оператор → агроном → агрохолдинг; данные → ИАС БАС; сертификация → Росавиация' };
        if (prompt.includes('fire'))   return { answer: 'пусто — на сегодня пилотных программ агро+БПЛА с такой моделью нет конкурентов' };
        if (prompt.includes('air'))    return { answer: 'побочные: новый класс агроконсультантов, страхование, повышение спроса на 4G в полях' };
        return { answer: 'пусто' };
      },
    };
    const d = new Decoupage({ llmClient: llm });
    const r = await d.cut({ idea: 'пилот БПЛА для агро в Воронеже', context: { region: 'Воронеж' } });
    assert.equal(r.ground.verdict, 'strong');
    assert.equal(r.water.verdict,  'strong');
    assert.equal(r.fire.verdict,   'empty');  // явное «пусто»
    assert.equal(r.air.verdict,    'strong');
    assert.match(r.integral.shape, /без огня|смешанная/);
  });

  await t.test('cut требует idea', async () => {
    const d = new Decoupage();
    await assert.rejects(() => d.cut({}), /idea/);
  });
});

// ─── Vintage ──────────────────────────────────────────────────────────────

test('Vintage — διάκρισις по плодам', async (t) => {
  await t.test('пустой winery → пустой винтаж', () => {
    const mem = new GiftMemory(['А', 'Б']);
    const v = new Vintage(mem, { actsIndex: [] });
    const r = v.assess({ cycles: 1 });
    assert.equal(r.tasted.length, 0);
    assert.equal(r.vintage, 'пустой винтаж — нет идей в выдержке');
  });

  await t.test('идея с фоллоу-ап code-актом → fruited', () => {
    const mem = new GiftMemory(['А', 'Б']);
    const acts = [
      { ts: '2026-04-01T00:00:00Z', from: 'А', to: 'Б', type: 'question',
        content: 'дрон в агро', linkedIssue: 100 },
      { ts: '2026-04-15T00:00:00Z', from: 'А', to: 'Б', type: 'code',
        content: 'реализован', linkedIssue: 100 },
    ];
    const v = new Vintage(mem, { actsIndex: acts });
    const r = v.assess({ since: '2026-03-01', cycles: 1 });
    assert.equal(r.fruited.length, 1);
    assert.equal(r.deferred.length, 0);
  });

  await t.test('symphony акты автоматически считаются плодами', () => {
    const mem = new GiftMemory(['А', 'Б', 'В', 'Дионисий']);
    mem.receiveSymphony({
      type: 'symphony',
      giverIds: ['А','Б','В'],
      receiverId: 'Дионисий',
      weight: 8,
      chorus: true, perichoretic: true, kenotic: true, epiclesis: true,
      content: 'симфония-1',
    });
    const v = new Vintage(mem, { actsIndex: [] });
    const r = v.assess({ since: '2026-01-01', cycles: 1 });
    assert.equal(r.fruited.length, 1);
    assert.equal(r.fruited[0].kind, 'symphony');
  });

  await t.test('старая идея без плода → deferred (анастасис)', () => {
    const mem = new GiftMemory([]);
    const acts = [{
      ts: new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString(),  // 60 дней назад
      from: 'А', to: 'Б', type: 'question',
      content: 'идея без последствий xyz unique tokens здесь',
      linkedIssue: null,
    }];
    const v = new Vintage(mem, { actsIndex: acts });
    const r = v.assess({ since: '2026-01-01', cycles: 1 });
    assert.equal(r.deferred.length, 1);
    assert.match(r.vintage.deferred, /анастасис/);
  });
});

// ─── LiturgicalCalendar ───────────────────────────────────────────────────

test('LiturgicalCalendar — кайрос, не хронос', async (t) => {
  // Понедельник 2026-05-04
  const monday    = new Date('2026-05-04T10:00:00Z');
  // Четверг 2026-05-07
  const thursday  = new Date('2026-05-07T10:00:00Z');
  // Среда 2026-05-06
  const wednesday = new Date('2026-05-06T10:00:00Z');
  // Последний день месяца 2026-05-31 (воскресенье)
  const lastDay   = new Date('2026-05-31T10:00:00Z');

  await t.test('понедельник = synaxis (сбор)', () => {
    const cal = new LiturgicalCalendar({ now: () => monday });
    const t = cal.today();
    assert.equal(t.kairos, KAIROS.SYNAXIS);
    assert.match(t.why, /начала творения/);
  });

  await t.test('четверг = dokimasia (дегустация)', () => {
    const cal = new LiturgicalCalendar({ now: () => thursday });
    const t = cal.today();
    assert.equal(t.kairos, KAIROS.DOKIMASIA);
    assert.match(t.why, /Тайной Вечери/);
  });

  await t.test('обычный день = ordinary (ферментация)', () => {
    const cal = new LiturgicalCalendar({ now: () => wednesday });
    const t = cal.today();
    assert.equal(t.kairos, KAIROS.ORDINARY);
    assert.match(t.why, /ὑπομονή/);
  });

  await t.test('последний день месяца = vintage (винтаж)', () => {
    const cal = new LiturgicalCalendar({ now: () => lastDay });
    const t = cal.today();
    assert.equal(t.kairos, KAIROS.VINTAGE);
    assert.match(t.why, /διάκρισις/);
  });

  await t.test('vintage побеждает день недели (последний понедельник = vintage)', () => {
    // Найдём последний понедельник какого-то месяца. 2026-08-31 — понедельник.
    const lastMonday = new Date('2026-08-31T10:00:00Z');
    const cal = new LiturgicalCalendar({ now: () => lastMonday });
    const t = cal.today();
    assert.equal(t.kairos, KAIROS.VINTAGE);  // не synaxis
  });

  await t.test('shouldRun: не повторяется в один день', () => {
    const cal = new LiturgicalCalendar({ now: () => thursday });
    assert.equal(cal.shouldRun(KAIROS.DOKIMASIA), true);
    assert.equal(cal.shouldRun(KAIROS.DOKIMASIA, '2026-05-07T05:00:00Z'), false);
    assert.equal(cal.shouldRun(KAIROS.DOKIMASIA, '2026-05-06T23:59:59Z'), true);
  });

  await t.test('next возвращает следующее литургическое событие', () => {
    const cal = new LiturgicalCalendar({ now: () => wednesday });
    const nextDok = cal.next(KAIROS.DOKIMASIA);
    assert.equal(nextDok.getDay(), 4);  // четверг
  });

  await t.test('yearAhead — список всех литургических дней', () => {
    const cal = new LiturgicalCalendar({ now: () => monday });
    const events = cal.yearAhead();
    // Минимум 50 σύναξις/dokimasia + 12 vintage за год
    const synaxis  = events.filter(e => e.kairos === KAIROS.SYNAXIS);
    const dokim    = events.filter(e => e.kairos === KAIROS.DOKIMASIA);
    const vintages = events.filter(e => e.kairos === KAIROS.VINTAGE);
    assert.ok(synaxis.length  >= 40, `synaxis ${synaxis.length}`);
    assert.ok(dokim.length    >= 40, `dokim ${dokim.length}`);
    assert.ok(vintages.length >= 11, `vintages ${vintages.length}`);
  });
});

// ─── Интеграция: synleitourgos режим в LivingMatrix ───────────────────────

test('LivingMatrix — synleitourgos режим (сферный)', async (t) => {
  const { LivingMatrix } = await import('../src/core/LivingMatrix.js');

  await t.test('без symphony — режим conductor (как раньше)', () => {
    const mem = new GiftMemory(['А', 'Б']);
    // Создадим conductivity > 0.8 множеством актов от А
    for (let i = 0; i < 10; i++) {
      mem.receive({ giverId: 'А', receiverId: 'Б', type: 'word', weight: 5, content: 't' });
    }
    const lm = new LivingMatrix(mem);
    const p = lm.dominantPrinciple();
    // conductor или kenosis в зависимости от расчёта; главное — не synleitourgos
    assert.notEqual(p.principle, 'synleitourgos');
  });

  await t.test('после symphony — режим переходит в synleitourgos', () => {
    const mem = new GiftMemory(['А', 'Б', 'В', 'Г']);
    for (let i = 0; i < 10; i++) {
      mem.receive({ giverId: 'А', receiverId: 'Б', type: 'word', weight: 5, content: 't' });
    }
    mem.receiveSymphony({
      type: 'symphony',
      giverIds: ['А','Б','В'],
      receiverId: 'Г',
      weight: 8,
      chorus: true, perichoretic: true, kenotic: true, epiclesis: true,
      content: 'symphony',
    });
    const lm = new LivingMatrix(mem);
    const p = lm.dominantPrinciple();
    assert.equal(p.principle, 'synleitourgos');
    assert.equal(p.symphonies, 1);
  });
});
