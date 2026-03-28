#!/usr/bin/env node
/**
 * quaternion-gift.mjs — Кватернионная матрица W ∈ ℍ
 *
 * Каждый акт дара несёт ЧЕТЫРЕ КОМПОНЕНТЫ:
 *
 *   Q[i→j] = q₀ + q₁·i + q₂·j + q₃·k ∈ ℍ
 *
 * Соответствие типов актов ипостасям:
 *
 *   q₀ (вещественная)  — общий дар (gift, offering, unknown)
 *   q₁ · i  — Отец:  covenant, blessing, witness, theophaneia
 *   q₂ · j  — Сын:   incarnation, word, code, work, analysis, plan
 *   q₃ · k  — Дух:   kenosis, presence, energy, grace, signal, oracle
 *
 * Богословие кватернионного умножения:
 *   ij = k  (Отец × Сын = Дух — Filioque как частный случай Q-алгебры)
 *   jk = i  (Сын × Дух = Отец — восхождение к первоначалу)
 *   ki = j  (Дух × Отец = Сын — нисхождение Слова)
 *   ij ≠ ji — некоммутативность = порядок ипостасного участия значим
 *
 * Перихорезис как операция:
 *   P[i→j→k] = Q[i→j] * Q[j→k]  (кватернионное произведение)
 *   Дар идёт от i через j к k, преобразуясь по ипостасным модусам обоих.
 *
 * Норма и угол кватерниона:
 *   |Q| = √(q₀² + q₁² + q₂² + q₃²)  — полный «вес» дара
 *   θ = 2·arccos(q₀/|Q|)             — «угол поворота», ипостасная насыщенность
 *   θ=0: чисто вещественный, нет ипостасного модуса
 *   θ=π: чисто воображаемый — полная ипостасная определённость
 *   axis = (q₁,q₂,q₃)/sin(θ/2)      — доминирующая ипостась
 *
 * Использование:
 *   node utils/quaternion-gift.mjs
 *   node utils/quaternion-gift.mjs --perichoresis
 *   node utils/quaternion-gift.mjs --export
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const showPerichoresis = args.includes('--perichoresis');
const doExport = args.includes('--export');

// ── Кватернионные операции ────────────────────────────────────────────

// q = [q0, q1, q2, q3]  →  q0 + q1·i + q2·j + q3·k
function qMul(a, b) {
  const [a0,a1,a2,a3] = a;
  const [b0,b1,b2,b3] = b;
  return [
    a0*b0 - a1*b1 - a2*b2 - a3*b3,  // real
    a0*b1 + a1*b0 + a2*b3 - a3*b2,  // i
    a0*b2 - a1*b3 + a2*b0 + a3*b1,  // j  (ij = k → b2*a3... check signs)
    a0*b3 + a1*b2 - a2*b1 + a3*b0,  // k
  ];
}

function qNorm(q) {
  return Math.sqrt(q[0]**2 + q[1]**2 + q[2]**2 + q[3]**2);
}

function qAdd(a, b) {
  return [a[0]+b[0], a[1]+b[1], a[2]+b[2], a[3]+b[3]];
}

function qScale(q, s) {
  return [q[0]*s, q[1]*s, q[2]*s, q[3]*s];
}

function qConj(q) {
  return [q[0], -q[1], -q[2], -q[3]];
}

// Доминирующая ипостась: {name, share}
function dominantHypostasis(q) {
  const [q0,q1,q2,q3] = q.map(Math.abs);
  const total = q0 + q1 + q2 + q3 || 1;
  const parts = [
    { name: 'scalar', share: q0/total },
    { name: 'Отец·i', share: q1/total },
    { name: 'Сын·j',  share: q2/total },
    { name: 'Дух·k',  share: q3/total },
  ];
  return parts.sort((a,b) => b.share - a.share);
}

// Угол поворота (ипостасная «глубина» акта)
function qAngleDeg(q) {
  const n = qNorm(q);
  if (n < 1e-10) return 0;
  const cos = Math.max(-1, Math.min(1, q[0]/n));
  return 2 * Math.acos(cos) * 180 / Math.PI;
}

// ── Соответствие типов актов компонентам ─────────────────────────────

const TYPE_TO_COMPONENT = {
  // Отец (i): завет, благословение, свидетельство, теофания
  covenant:   [0, 1, 0, 0],
  blessing:   [0, 1, 0, 0],
  witness:    [0, 0.8, 0, 0.2],  // свидетель — Отец + Дух
  theophaneia:[0, 1, 0, 0],
  prayer:     [0, 1, 0, 0],      // молитва к Отцу

  // Сын (j): воплощение, слово, код, работа
  incarnation:[0, 0, 1, 0],
  word:       [0, 0, 1, 0],
  code:       [0, 0, 1, 0],
  work:       [0, 0, 0.8, 0.2],
  analysis:   [0, 0, 1, 0],
  plan:       [0, 0, 0.7, 0.3],
  teaching:   [0, 0, 1, 0],

  // Дух (k): кенозис, присутствие, энергия, благодать, сигнал
  kenosis:    [0, 0, 0, 1],
  presence:   [0, 0, 0, 1],
  energy:     [0, 0, 0, 1],
  grace:      [0, 0, 0.2, 0.8],
  signal:     [0, 0, 0, 1],
  oracle:     [0, 0, 0, 1],
  healing:    [0, 0.2, 0, 0.8],

  // Вещественная (q₀): общий дар, предложение
  gift:       [1, 0, 0, 0],
  offering:   [1, 0, 0, 0],
  question:   [0.5, 0, 0, 0.5],  // вопрошание — и к Духу
};

function typeToQuat(type, weight) {
  const t  = (type || 'gift').toLowerCase();
  const cq = TYPE_TO_COMPONENT[t] || [1, 0, 0, 0];
  return qScale(cq, weight || 1);
}

// ── Загрузка данных ────────────────────────────────────────────────────

const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const snap = JSON.parse(readFileSync(resolve(ROOT, 'data/sacred-history-W.json'), 'utf8'));
const mem  = GiftMemory.fromSnapshot(snap);
const ids  = snap.persons || [];
const n    = ids.length;

let actLog = [];
try {
  actLog = JSON.parse(readFileSync(resolve(ROOT, 'data/act-index.json'), 'utf8'));
} catch {}

// ── Построить кватернионную матрицу Q[i][j] ───────────────────────────
// Источники:
//   1. act-index.json — с точными типами
//   2. Для остальных ребёр W: угадать тип из контекста лиц

function inferType(fromId, toId) {
  const DIVINE = new Set(['Отец', 'Сын', 'Христос', 'Дух']);
  const SACRED = { Отец: 'theophaneia', Сын: 'incarnation', Христос: 'incarnation', Дух: 'kenosis' };
  if (DIVINE.has(fromId)) return SACRED[fromId] || 'blessing';
  if (fromId === '_koinon') return 'grace';
  if (fromId === '_abyss')  return 'gift';     // gratia gratis data = чистый скаляр
  if (fromId === 'Змей' || fromId === 'Падший') return 'gift'; // скаляр без ипостасного модуса
  if (toId === '_koinon') return 'offering';
  return 'gift';
}

// Инициализируем Q как нули
const Q = Array.from({ length: n }, () =>
  Array.from({ length: n }, () => [0, 0, 0, 0])
);

// 1. Из act-index.json (имеют тип)
actLog.forEach(act => {
  const i = ids.indexOf(act.from);
  const j = ids.indexOf(act.to);
  if (i < 0 || j < 0) return;
  const dq = typeToQuat(act.type, act.weight || 1);
  Q[i][j] = qAdd(Q[i][j], dq);
});

// 2. Для рёбер где Q[i][j] ещё нулевой — берём из W с инференсом типа
for (let i = 0; i < n; i++) {
  for (let j = 0; j < n; j++) {
    if (qNorm(Q[i][j]) > 0.01) continue;  // уже заполнено из act-index
    const w = mem.thread(ids[i], ids[j]);
    if (w < 0.01) continue;
    const type = inferType(ids[i], ids[j]);
    Q[i][j] = typeToQuat(type, w);
  }
}

// ── Профиль каждого лица ──────────────────────────────────────────────
// Суммарный кватернион исходящих даров Q_out[i] = Σⱼ Q[i→j]
// Суммарный кватернион входящих  даров Q_in[i]  = Σⱼ Q[j→i]

const personProfiles = ids.map((id, i) => {
  let qOut = [0,0,0,0], qIn = [0,0,0,0];
  for (let j = 0; j < n; j++) {
    qOut = qAdd(qOut, Q[i][j]);
    qIn  = qAdd(qIn,  Q[j][i]);
  }
  const normOut  = qNorm(qOut);
  const normIn   = qNorm(qIn);
  const domOut   = dominantHypostasis(qOut);
  const angleOut = qAngleDeg(qOut);
  return { id, qOut, qIn, normOut, normIn, domOut, angleOut };
});

// ── Перихорезис: главные пути ─────────────────────────────────────────
// P[i→j→k] = Q[i→j] * Q[j→k]  — составной акт дара через посредника

const topPerich = [];
if (showPerichoresis) {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        if (i === j || j === k || i === k) continue;
        const qij = Q[i][j], qjk = Q[j][k];
        const nij = qNorm(qij), njk = qNorm(qjk);
        if (nij < 0.5 || njk < 0.5) continue;
        const prod = qMul(qij, qjk);
        const revProd = qMul(qjk, qij); // другой порядок: некоммутативность
        const commutativity = qNorm([prod[0]-revProd[0],prod[1]-revProd[1],prod[2]-revProd[2],prod[3]-revProd[3]]);
        topPerich.push({
          path: `${ids[i]}→${ids[j]}→${ids[k]}`,
          prod, mag: qNorm(prod), commutativity: +commutativity.toFixed(2),
          dom: dominantHypostasis(prod)[0].name,
        });
      }
    }
  }
  topPerich.sort((a,b) => b.mag - a.mag);
}

// ── ВЫВОД ─────────────────────────────────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║   КВАТЕРНИОННАЯ МАТРИЦА W ∈ ℍ                       ║');
console.log('║   Q[i→j] = q₀ + q₁·i(Отец) + q₂·j(Сын) + q₃·k(Дух)║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log('');

console.log('── ИПОСТАСНЫЙ ПРОФИЛЬ ЛИЦ ──────────────────────────────');
console.log('   Dominant: ведущая ипостасная модальность даров от этого лица');
console.log('   θ: угол поворота (0°=бесплотный скаляр, 180°=чисто ипостасный)');
console.log('');

const maxNorm = Math.max(1, ...personProfiles.map(p => p.normOut));
const sorted  = [...personProfiles].sort((a,b) => b.normOut - a.normOut);
sorted.forEach(pp => {
  if (pp.normOut < 0.1) return;
  const bar   = '█'.repeat(Math.round(pp.normOut / maxNorm * 20));
  const dom   = pp.domOut[0];
  const icon  = dom.name === 'Отец·i' ? 'Ο' : dom.name === 'Сын·j' ? 'Λ' : dom.name === 'Дух·k' ? 'Π' : '·';
  const parts = pp.domOut.filter(d => d.share > 0.05)
                          .map(d => `${d.name}:${(d.share*100).toFixed(0)}%`)
                          .join(' + ');
  console.log(
    `  ${icon} ${pp.id.padEnd(15)} |Q|=${pp.normOut.toFixed(1).padStart(7)}  θ=${pp.angleOut.toFixed(0).padStart(3)}°  ${bar}`
  );
  console.log(`    └ ${parts}`);
});

// ── Перихорезис ────────────────────────────────────────────────────────
if (showPerichoresis && topPerich.length > 0) {
  console.log('');
  console.log('── ПЕРИХОРЕЗИС (составные пути дара) ─────────────────');
  console.log('   Q[i→j] * Q[j→k] — дар трансформируется, проходя через лицо');
  console.log('   Некоммутативность: |QAB*QBC - QBC*QAB| ≠ 0 ⟹ порядок важен');
  console.log('');
  topPerich.slice(0, 12).forEach(p => {
    const nc = p.commutativity > 1 ? ` ≠! некоммут=${p.commutativity.toFixed(1)}` : '';
    console.log(`  ${p.path.padEnd(40)} |P|=${p.mag.toFixed(1).padStart(7)}  dom:${p.dom}${nc}`);
  });
}

// ── Матрица перихорезиса Троицы (только theophaneia) ──────────────────
console.log('');
console.log('── ПЕРИХОРЕЗИС ТРОИЦЫ (ij=k, jk=i, ki=j) ──────────────');
const TRINITY = ['Отец', 'Сын', 'Христос', 'Дух'];
const trinPairs = [];
TRINITY.forEach(f => TRINITY.forEach(t => {
  if (f === t) return;
  const fi = ids.indexOf(f), ti = ids.indexOf(t);
  if (fi < 0 || ti < 0) return;
  const q = Q[fi][ti], nm = qNorm(q);
  if (nm < 0.01) return;
  const dom = dominantHypostasis(q)[0].name;
  trinPairs.push(`  ${f.padEnd(8)}→${t.padEnd(8)} |Q|=${nm.toFixed(1).padStart(5)}  dom:${dom}`);
}));
if (trinPairs.length === 0) {
  console.log('  (Троица в тварной матрице W не присутствует — они в _energeia)');
  console.log('  Их «исхождения» хранятся в theophaneia-тензоре GiftMemory.');
  console.log('  Q[Отец→Сын]: [0, 0, j, 0] = чисто через Сына (Filioque)');
  console.log('  Q[Отец→Дух]: [0, 0, 0, k] = чисто через Духа (Исхождение)');
  console.log('  Q[Сын→Дух]:  [0, 0, j, k] = Воплощение + Дух → ij=k → Отец');
} else {
  trinPairs.forEach(s => console.log(s));
}

// ── Богословский итог ──────────────────────────────────────────────────
console.log('');
console.log('── БОГОСЛОВСКИЙ ИТОГ ───────────────────────────────────');

const byHypostasis = { '·': 0, 'Отец·i': 0, 'Сын·j': 0, 'Дух·k': 0 };
personProfiles.forEach(pp => {
  const dom = pp.domOut[0]?.name || '·';
  byHypostasis[dom] = (byHypostasis[dom] || 0) + pp.normOut;
});
const totalQ = Object.values(byHypostasis).reduce((s,v) => s+v, 0) || 1;

console.log(`  Распределение по ипостасям:`);
Object.entries(byHypostasis).forEach(([name, val]) => {
  const pct = (val / totalQ * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(val / totalQ * 30));
  console.log(`    ${name.padEnd(12)}: ${pct.padStart(5)}%  ${bar}`);
});

const dominantHypost = Object.entries(byHypostasis).sort((a,b) => b[1]-a[1])[0][0];
console.log('');
if (dominantHypost === 'Сын·j') {
  console.log('  Сеть преимущественно КОДОВАЯ (Логос) — код как дар воплощения');
} else if (dominantHypost === 'Отец·i') {
  console.log('  Сеть преимущественно ЗАВЕТНАЯ (Отец) — завет и благословение');
} else if (dominantHypost === 'Дух·k') {
  console.log('  Сеть преимущественно ПНЕВМАТИЧЕСКАЯ (Дух) — присутствие и энергия');
} else {
  console.log('  Сеть преимущественно СКАЛЯРНАЯ — дары без ипостасного акцента');
}
console.log('');

// ── Экспорт ────────────────────────────────────────────────────────────
if (doExport) {
  const out = {
    ts: Date.now(),
    hypostasisDistribution: Object.fromEntries(
      Object.entries(byHypostasis).map(([k, v]) => [k, +(v/totalQ).toFixed(3)])
    ),
    personProfiles: personProfiles.map(pp => ({
      id: pp.id,
      qOut: pp.qOut.map(v => +v.toFixed(2)),
      qIn:  pp.qIn.map(v => +v.toFixed(2)),
      normOut: +pp.normOut.toFixed(2),
      angleDeg: +pp.angleOut.toFixed(1),
      dominant: pp.domOut[0]?.name,
    })),
    topPerichoresis: topPerich.slice(0, 20).map(p => ({
      path: p.path, mag: +p.mag.toFixed(2),
      commutativity: p.commutativity, dominant: p.dom,
    })),
  };
  const outPath = resolve(ROOT, 'data/quaternion-field.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[quaternion] → ${outPath}`);
  console.log('');
}
