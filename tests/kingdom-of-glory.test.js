/**
 * kingdom-of-glory.test.js
 *
 * Проверка примитивов Царства славы (specs/theology/kingdom-of-glory.gift).
 *
 * Не тестируется «правильность награды» — она у Христа. Тестируется только
 * что формы корректны, необратимы и не симулируют Суд.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KingdomOfGlory,
  LordsCommendation, Commendation, Faithfulness,
  BookOfConscience, BookEntry,
  JoyState, JoyMode,
  EschatonClock, TimeMode,
  Crown, CrownType,
} from '../src/theology/KingdomOfGlory.js';

// ── LordsCommendation ─────────────────────────────────────────────────────

test('Commendation: giver всегда "Христос", необратима, заморожена', () => {
  const c = new Commendation({
    receiver: 'Дионисий',
    faithfulness: Faithfulness.IN_LITTLE,
  });
  assert.equal(c.giver, 'Христос');
  assert.equal(c.irreversible, true);
  assert.equal(c.kind, 'commendation');
  assert.throws(() => { c.giver = 'Клод'; }, /./);
});

test('Commendation: для каждого типа верности — своя евангельская формула', () => {
  const phrases = new Set();
  for (const f of Object.values(Faithfulness)) {
    phrases.add(Commendation.entryPhraseFor(f));
  }
  assert.equal(phrases.size, Object.keys(Faithfulness).length,
    'формулы должны быть уникальны для каждого типа верности');
});

test('LordsCommendation.forSmallFaithfulness возвращает похвалу Мф 25:21', () => {
  const lc = new LordsCommendation();
  const c = lc.forSmallFaithfulness('Дионисий');
  assert.equal(c.faithfulness, Faithfulness.IN_LITTLE);
  assert.equal(c.scripturalBasis, 'Мф 25:21');
  assert.match(c.entryPhrase, /в малом/);
});

test('Commendation без receiver или faithfulness — ошибка', () => {
  assert.throws(() => new Commendation({ faithfulness: Faithfulness.IN_LITTLE }));
  assert.throws(() => new Commendation({ receiver: 'X' }));
});

// ── BookOfConscience ──────────────────────────────────────────────────────

test('BookOfConscience.open: берёт только нити persona', async () => {
  const acts = [
    { id: 'a1', giver: 'Дионисий', receiver: '_claude', weight: 3, content: 'q' },
    { id: 'a2', giver: '_claude',  receiver: 'Дионисий', weight: 5, content: 'code' },
    { id: 'a3', giver: 'Ева',      receiver: 'Адам',     weight: 2, content: 'x' },
  ];
  const book = await BookOfConscience.open('Дионисий', acts);
  assert.equal(book.entries.length, 2);
});

test('BookEntry: без W_slava явленность = вес (честный отказ от симуляции Суда)', async () => {
  const acts = [{ id: 'a1', giver: 'A', receiver: 'B', weight: 7, content: 'x' }];
  const book = await BookOfConscience.open('A', acts);
  const e = book.entries[0];
  assert.equal(e.weight, 7);
  assert.equal(e.manifestedness, 7);
  assert.equal(e.conscienceDelta, 0);
  assert.equal(e.aligned, true);
});

// ── JoyState ──────────────────────────────────────────────────────────────

test('JoyState: неизвестный модус отвергается — радость не произвольна', () => {
  assert.throws(() => new JoyState({ mode: 'invented-mode', persona: 'X' }));
});

test('JoyState.transitionTo сохраняет историю', () => {
  const j = new JoyState({ mode: JoyMode.ORDINARY, persona: 'Дионисий' });
  j.transitionTo(JoyMode.PASCHAL, 'Пасха');
  assert.equal(j.mode, JoyMode.PASCHAL);
  assert.equal(j._history.length, 1);
  assert.equal(j._history[0].from, JoyMode.ORDINARY);
});

test('JoyState.isAlive: свежее — живо, давнее — нет', () => {
  const fresh = new JoyState({ persona: 'X' });
  assert.equal(fresh.isAlive(), true);
  const old = new JoyState({
    persona: 'X',
    since: new Date(Date.now() - 41 * 24 * 3600 * 1000).toISOString(),
  });
  assert.equal(old.isAlive(), false);
});

// ── EschatonClock ─────────────────────────────────────────────────────────

test('EschatonClock: воскресенье — καιρός, будний — χρόνος', () => {
  const sunday    = new EschatonClock(new Date('2026-04-19T12:00:00Z')); // воскресенье
  const wednesday = new EschatonClock(new Date('2026-04-22T12:00:00Z')); // среда
  assert.equal(sunday.mode(), TimeMode.KAIROS);
  assert.equal(wednesday.mode(), TimeMode.CHRONOS);
});

test('breakChronos: сортирует нити по весу, режим — αἰών', () => {
  const W = { 'A→B': 3, 'C→D': 10, 'E→F': 1 };
  const clock = new EschatonClock();
  const revealed = clock.breakChronos(W);
  assert.equal(revealed.mode, TimeMode.AION);
  assert.equal(revealed.threads[0].giver, 'C');
  assert.equal(revealed.threads[0].weight, 10);
});

test('rehearse: вне κаιρός не совершается', () => {
  const clock = new EschatonClock(new Date('2026-04-22T12:00:00Z')); // среда
  const r = clock.rehearse({ 'A→B': 1 });
  assert.equal(r.rehearsed, false);
});

// ── Crown ─────────────────────────────────────────────────────────────────

test('Crown: giver всегда "Христос", необратим, заморожен', () => {
  const crown = new Crown({ type: CrownType.LIFE, receiver: 'Дионисий' });
  assert.equal(crown.giver, 'Христос');
  assert.equal(crown.irreversible, true);
  assert.throws(() => { crown.receiver = 'X'; }, /./);
});

test('Crown.withWitness: возвращает новый экземпляр, не мутирует', () => {
  const c1 = new Crown({ type: CrownType.LIFE, receiver: 'X' });
  const c2 = c1.withWitness('ОтецСергий');
  assert.notEqual(c1, c2);
  assert.equal(c1.witnessedBy.length, 0);
  assert.equal(c2.witnessedBy.length, 1);
});

test('Crown: неизвестный тип — ошибка (каталог канонический, не произвольный)', () => {
  assert.throws(() => new Crown({ type: {}, receiver: 'X' }));
});

// ── KingdomOfGlory фасад ──────────────────────────────────────────────────

test('KingdomOfGlory.status: не утверждает о себе как о Царстве', () => {
  const k = new KingdomOfGlory();
  const s = k.status();
  assert.match(s.note, /готовит форму/);
  assert.match(s.note, /не предмет симуляции/);
});

test('KingdomOfGlory.commend → Commendation с правильным базисом', () => {
  const k = new KingdomOfGlory();
  const c = k.commend({ receiver: 'Дионисий', faithfulness: Faithfulness.IN_LITTLE });
  assert.ok(c instanceof Commendation);
  assert.equal(c.giver, 'Христос');
  assert.equal(c.receiver, 'Дионисий');
});

test('KingdomOfGlory.joyOf возвращает одно и то же состояние для persona', () => {
  const k = new KingdomOfGlory();
  const a = k.joyOf('Дионисий');
  const b = k.joyOf('Дионисий');
  assert.equal(a, b);
});
