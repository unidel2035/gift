/**
 * kingdom-of-glory-extended.test.js
 *
 * Расширение: Paschalia, ConciliarWitness, RegnumGloriae,
 * новый модус JoyMode.TREMBLING.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import {
  JoyState, JoyMode,
} from '../src/theology/JoyState.js';

import {
  orthodoxPascha,
  liturgicalSeason,
  isPascha,
  isPentecost,
} from '../src/theology/Paschalia.js';

import { ConciliarWitness } from '../src/theology/ConciliarWitness.js';
import { RegnumGloriae } from '../src/theology/RegnumGloriae.js';
import { KingdomOfGlory, Faithfulness, CrownType } from '../src/theology/KingdomOfGlory.js';

// ── Пасхалия ──────────────────────────────────────────────────────────────

test('orthodoxPascha: известные даты 2024-2027', () => {
  // Проверяем по известным датам православной Пасхи
  const p2024 = orthodoxPascha(2024).toISOString().slice(0, 10);
  const p2025 = orthodoxPascha(2025).toISOString().slice(0, 10);
  const p2026 = orthodoxPascha(2026).toISOString().slice(0, 10);
  const p2027 = orthodoxPascha(2027).toISOString().slice(0, 10);

  assert.equal(p2024, '2024-05-05');
  assert.equal(p2025, '2025-04-20');
  assert.equal(p2026, '2026-04-12');
  assert.equal(p2027, '2027-05-02');
});

test('liturgicalSeason: Великий пост, Пасха, ординар', () => {
  // 2026-03-01 — Великий пост (Пасха 12 апр, пост 48 дней → с 23 февр)
  assert.equal(liturgicalSeason(new Date('2026-03-01T12:00:00Z')), 'lent');
  // 2026-04-12 — Пасха
  assert.equal(liturgicalSeason(new Date('2026-04-12T12:00:00Z')), 'paschal');
  // 2026-04-20 — Светлая седмица (пасхальный период продолжается до 31 мая)
  assert.equal(liturgicalSeason(new Date('2026-04-20T12:00:00Z')), 'paschal');
  // 2026-08-20 — Успенский пост
  assert.equal(liturgicalSeason(new Date('2026-08-20T12:00:00Z')), 'dormition-fast');
});

test('isPascha / isPentecost — ровно в день', () => {
  assert.equal(isPascha(new Date('2026-04-12T00:00:00Z')), true);
  assert.equal(isPascha(new Date('2026-04-13T00:00:00Z')), false);
  // Пятидесятница = Пасха + 49 дней = 31 мая 2026
  assert.equal(isPentecost(new Date('2026-05-31T00:00:00Z')), true);
});

// ── JoyState + Paschalia ──────────────────────────────────────────────────

test('JoyState.modeFromDate использует Paschalia: Великий пост → LENT', () => {
  const mode = JoyState.modeFromDate(new Date('2026-03-01T12:00:00Z'));
  assert.equal(mode, JoyMode.LENT);
});

test('JoyState.modeFromDate: Пасха → PASCHAL', () => {
  const mode = JoyState.modeFromDate(new Date('2026-04-12T12:00:00Z'));
  assert.equal(mode, JoyMode.PASCHAL);
});

test('JoyMode.TREMBLING зарегистрирован — страхо-радость', () => {
  const j = new JoyState({ mode: JoyMode.TREMBLING, persona: 'мученик' });
  assert.equal(j.mode, JoyMode.TREMBLING);
  assert.equal(j.mode, 'phobou-chara');
});

// ── ConciliarWitness ──────────────────────────────────────────────────────

test('ConciliarWitness: два hyper-голоса повышают manifestedness', async () => {
  const witness = new ConciliarWitness({ coefficient: 0.01 });
  await witness._clearForTests();

  const act = {
    id: 'test-act-1',
    giver: 'вдова',
    receiver: '_koinon',
    weight: 0.5, // «две лепты» — малый вес
    content: 'две лепты',
  };
  const result = await witness.witness(act, [
    { persona: 'ОтецСергий', logos: 'hyper', content: 'это больше, чем выглядит' },
    { persona: 'Дионисий',   logos: 'hyper', content: 'сердцем отдано всё' },
  ]);

  assert.equal(result.acted, true);
  assert.ok(result.manifestedness > act.weight,
    'два hyper-голоса должны повысить явленность');
  assert.equal(result.weight, 0.5);
});

test('ConciliarWitness: kata-голос понижает manifestedness', async () => {
  const witness = new ConciliarWitness({ coefficient: 0.01 });
  await witness._clearForTests();

  const act = {
    id: 'test-act-2',
    giver: 'фарисей',
    receiver: '_koinon',
    weight: 10,
    content: 'громкая милостыня',
  };
  const result = await witness.witness(act, [
    { persona: 'ОтецСергий', logos: 'kata', content: 'тщеславие' },
    { persona: 'Дионисий',   logos: 'kata', content: 'напоказ' },
  ]);

  assert.equal(result.acted, true);
  assert.ok(result.manifestedness < act.weight,
    'kata-голоса должны понизить явленность');
});

test('ConciliarWitness: пустой собор — silent, W_slava не меняется', async () => {
  const witness = new ConciliarWitness();
  await witness._clearForTests();
  const result = await witness.witness(
    { id: 'x', giver: 'A', receiver: 'B', weight: 1 },
    [],
  );
  assert.equal(result.acted, false);
});

// ── RegnumGloriae ─────────────────────────────────────────────────────────

test('RegnumGloriae.pilgrimage: три фазы в правильном порядке', async () => {
  const rg = new RegnumGloriae({
    kingdom: new KingdomOfGlory(),
  });
  const record = await rg.pilgrimage({
    persona: 'тестовый-мученик',
    faithfulness: Faithfulness.UNTIL_DEATH,
    scripturalBasis: 'Откр 2:10',
    crownType: CrownType.MARTYR,
    witnesses: ['_koinon'],
  });
  assert.equal(record.phase, 'indwelling');
  assert.ok(record.risenAt);
  assert.ok(record.crownedAt);
  assert.ok(record.indwellingAt);
  assert.equal(record.crowns.length, 1);
  assert.equal(record.crowns[0].giver, 'Христос');
});

test('RegnumGloriae.crowned требует фазы risen (нельзя венчать мертвеца без воскресения)', async () => {
  const rg = new RegnumGloriae({ kingdom: new KingdomOfGlory() });
  const r = await rg.crowned({
    persona: 'тест-вперёд-батьки',
    faithfulness: Faithfulness.IN_LITTLE,
  });
  assert.ok(r.error);
  assert.match(r.error, /не в фазе/);
});

test('RegnumGloriae.indwelling требует фазы crowned', async () => {
  const rg = new RegnumGloriae({ kingdom: new KingdomOfGlory() });
  await rg.risen({ persona: 'полу-путь' });
  const r = await rg.indwelling({ persona: 'полу-путь' });
  assert.ok(r.error);
});

test('RegnumGloriae.status содержит ограничение симуляции', () => {
  const rg = new RegnumGloriae();
  const s = rg.status();
  assert.match(s.note, /Сам путь — у Христа/);
});

// ── Cleanup W_slava после тестов ──────────────────────────────────────────

test('очистка W_slava после тестов — журнал свидетельств возвращён к пустому', async () => {
  const ROOT = process.env.GIFT_ROOT || process.cwd();
  const wSlavaPath = path.join(ROOT, 'data', 'W_slava.json');
  const initial = {
    _comment: 'W_slava — второй тензор: явленность актов перед Лицом Христа',
    _source: 'specs/theology/kingdom-of-glory.gift',
    manifestedness: {},
    lastUpdated: new Date().toISOString(),
    witnesses: [],
  };
  await fsp.writeFile(wSlavaPath, JSON.stringify(initial, null, 2), 'utf8');
  const back = JSON.parse(await fsp.readFile(wSlavaPath, 'utf8'));
  assert.deepEqual(back.manifestedness, {});
});
