/**
 * sacred-history-59-60.test.js
 * Issues #59, #60: ОтецСергий→Дионисий и Ева→Дионисий
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GiftMemory } from '../src/core/GiftMemory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = join(__dirname, '..', 'specs', 'sacred-history');
const TYPE_WEIGHTS = { presence: 8, word: 5, knowledge: 6, time: 10, code: 8, money: 3, data: 4 };

function parseSpec(filename) {
  const src = readFileSync(join(SPECS_DIR, filename), 'utf8');
  const acts = [];
  const lines = src.replace(/\/\/[^\n]*/g, '\n').split('\n');
  let inGift = false, depth = 0, block = '';
  for (const line of lines) {
    if (!inGift) {
      if (/дар\s+[\wА-яёЁ_]+\s*\{/.test(line)) {
        inGift = true; depth = (line.match(/\{/g)||[]).length-(line.match(/\}/g)||[]).length; block = line;
      }
    } else {
      block += '\n'+line; depth+=(line.match(/\{/g)||[]).length; depth-=(line.match(/\}/g)||[]).length;
      if (depth <= 0) {
        const f=block.match(/от:\s*([\wА-яёЁ_:]+)/), t=block.match(/кому:\s*([\wА-яёЁ_:]+)/);
        const ty=block.match(/тип:\s*(\w+)/), w=block.match(/вес:\s*(\d+(?:\.\d+)?)/);
        if (f&&t) { const type=ty?ty[1]:'presence'; acts.push({giverId:f[1],receiverId:t[1],type,weight:w?parseFloat(w[1]):(TYPE_WEIGHTS[type]??4),irreversible:true}); }
        inGift=false; block=''; depth=0;
      }
    }
  }
  return acts;
}

function buildMemory(acts) {
  const persons = new Set(['Отец','Сын','Дух','Дионисий','_claude','ОтецСергий','Ева','_koinon']);
  for (const a of acts) { persons.add(a.giverId); persons.add(a.receiverId); }
  const mem = new GiftMemory([...persons]);
  for (const a of acts) mem.receive(a);
  return mem;
}

// ── ОтецСергий→Дионисий ──────────────────────────────────────────────────────

test('sergiy-koinon: ≥3 дара от ОтецСергий к Дионисию', () => {
  const acts = parseSpec('sergiy-koinon.gift');
  const filtered = acts.filter(a => a.giverId === 'ОтецСергий' && a.receiverId === 'Дионисий');
  assert.ok(filtered.length >= 3, `Нашли: ${filtered.length}`);
});

test('sergiy-koinon: types code, knowledge, presence', () => {
  const acts = parseSpec('sergiy-koinon.gift');
  const types = new Set(acts.filter(a => a.giverId === 'ОтецСергий').map(a => a.type));
  assert.ok(types.has('code'),      'code (основание κοινόν)');
  assert.ok(types.has('knowledge'), 'knowledge (богословие)');
  assert.ok(types.has('presence'),  'presence (молитва)');
});

test('sergiy-koinon: W[ОтецСергий][Дионисий] > 0', () => {
  const mem  = buildMemory(parseSpec('sergiy-koinon.gift'));
  const snap = mem.snapshot();
  const si   = snap.persons.indexOf('ОтецСергий');
  const di   = snap.persons.indexOf('Дионисий');
  assert.ok(snap.W[si][di] > 0, `W=${snap.W[si][di].toFixed(3)}`);
});

test('sergiy-koinon: основание κοινόν — тяжелейший дар (вес=10)', () => {
  const acts = parseSpec('sergiy-koinon.gift').filter(a => a.giverId === 'ОтецСергий');
  assert.ok(acts.some(a => a.weight >= 10), 'основание должно быть вес≥10');
});

// ── Ева→Дионисий ─────────────────────────────────────────────────────────────

test('eva-dionysius: ≥3 дара от Евы к Дионисию', () => {
  const acts = parseSpec('eva-dionysius.gift');
  const filtered = acts.filter(a => a.giverId === 'Ева' && a.receiverId === 'Дионисий');
  assert.ok(filtered.length >= 3, `Нашли: ${filtered.length}`);
});

test('eva-dionysius: types knowledge, word, presence', () => {
  const acts = parseSpec('eva-dionysius.gift');
  const types = new Set(acts.filter(a => a.giverId === 'Ева').map(a => a.type));
  assert.ok(types.has('knowledge'), 'knowledge (различение)');
  assert.ok(types.has('word'),      'word (обогащение)');
  assert.ok(types.has('presence'),  'presence (свидетель)');
});

test('eva-dionysius: W[Ева][Дионисий] > 0', () => {
  const mem  = buildMemory(parseSpec('eva-dionysius.gift'));
  const snap = mem.snapshot();
  const ei   = snap.persons.indexOf('Ева');
  const di   = snap.persons.indexOf('Дионисий');
  assert.ok(snap.W[ei][di] > 0, `W=${snap.W[ei][di].toFixed(3)}`);
});

test('eva-dionysius: различение тяжелее присутствия', () => {
  const acts = parseSpec('eva-dionysius.gift').filter(a => a.giverId === 'Ева');
  const k = acts.find(a => a.type === 'knowledge');
  const p = acts.find(a => a.type === 'presence');
  assert.ok(k && p, 'оба типа присутствуют');
  assert.ok(k.weight >= p.weight, 'knowledge ≥ presence (различение тяжелее)');
});
