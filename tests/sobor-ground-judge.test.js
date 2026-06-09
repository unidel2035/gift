/**
 * Заземляющий судья: заякорен / эхо / зазор + композиция с критерием дара.
 * На лексической мере и фейковом корпусе — детерминированно.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lexicalSim, grounding, makeGroundedJudge } from '../utils/sobor-ground-judge.mjs';

const CORPUS = [
  { id: 'k1', text: 'дар необратим, время тяжелее денег, кеносис открывает рост' },
  { id: 'k2', text: 'матрица W хранит веса нитей между лицами общины' },
  { id: 'k3', text: 'собор рождает вопрошания из пустынь матрицы' },
];
const lexFn = (a, b) => ({ sim: lexicalSim(a, b), mode: 'lex' });

test('заземление · якорь / эхо / зазор', async (t) => {

  await t.test('фантазия без слов корпуса — не заякорена', () => {
    const g = grounding('квантовый блокчейн токенизация маркетплейс', CORPUS, lexFn);
    assert.equal(g.anchored, false);
    assert.equal(g.grounded, false);
  });

  await t.test('точный повтор фрагмента — эхо, не заземлён', () => {
    const g = grounding('дар необратим время тяжелее денег кеносис открывает рост', CORPUS, lexFn);
    assert.equal(g.anchored, true);
    assert.equal(g.echo, true);
    assert.equal(g.grounded, false, 'дубль не нов → не заземлён');
  });

  await t.test('связано, но ново — заземлён (целит в зазор)', () => {
    const g = grounding('как кеносис лица меняет вес нити в матрице со временем?', CORPUS, lexFn);
    assert.equal(g.anchored, true);
    assert.equal(g.echo, false);
    assert.equal(g.grounded, true);
    assert.ok(g.evidence.length > 0);
  });

  await t.test('заземлённый судья: заземлённое бьёт фантазию', () => {
    const base = () => ({ winner: 'A', why: 'базовый всегда A' });
    const J = makeGroundedJudge(CORPUS, base, lexFn);
    const grounded = { id: 'g', text: 'как кеносис меняет вес нити в матрице со временем?' };
    const fantasy = { id: 'f', text: 'квантовый блокчейн токенизация маркетплейс синергия' };
    // фантазия стоит на позиции A — базовый судья выбрал бы её, но заземление перебивает
    const r = J(fantasy, grounded);
    assert.equal(r.winner, 'B', 'заземлённое (B) побеждает фантазию (A) вопреки базовому');
  });

  await t.test('равно заземлены → решает базовый критерий', () => {
    const base = () => ({ winner: 'B', why: 'дар выбрал B' });
    const J = makeGroundedJudge(CORPUS, base, lexFn);
    const a = { id: 'a', text: 'как вес нити в матрице растёт от кеносиса лиц?' };
    const b = { id: 'b', text: 'что собор берёт из пустынь матрицы для роста?' };
    const r = J(a, b);
    assert.equal(r.winner, 'B', 'оба заземлены → базовый судья решает');
  });
});
