#!/usr/bin/env node
/**
 * spectral-gift.mjs — Полный спектральный анализ матрицы W
 *
 * Всё здесь — теоремы, применённые к W буквально, без аналогий.
 *
 *  1. Фидлерный вектор     — естественное разбиение общины (Cheeger cut)
 *  2. Алгебраическая связность λ₁ — мера кафоличности (близости к распаду)
 *  3. Число Чигера h(G)    — слабейшая «перегородка» в сети
 *  4. HITS (hub / authority) — кто «даёт хорошим» vs «кто достоин»
 *  5. PageRank (Перрон-Фробениус) — центральность по потоку дара
 *  6. Von Neumann entropy  — разнообразие vs централизация
 *  7. SVD (top-2 modes)    — ортогональные независимые потоки благодати
 *  8. Эффективное сопр.   — «электрическая» проводимость i→j
 *  9. Тепловое уравнение  — характерное время распространения дара
 * 10. Тропическая алгебра — мощнейшая цепочка даров длины k
 *
 * Usage:
 *   node utils/spectral-gift.mjs
 *   node utils/spectral-gift.mjs --export
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const doExport = process.argv.includes('--export');

// ── Загрузка матрицы W ─────────────────────────────────────────────────
const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
const snap  = JSON.parse(readFileSync(resolve(ROOT, 'data/sacred-history-W.json'), 'utf8'));
const mem   = GiftMemory.fromSnapshot(snap);
const ids   = snap.persons;
const n     = ids.length;

// Полная матрица W[i][j] из GiftMemory
const W = Array.from({length:n}, (_,i) =>
  Float64Array.from({length:n}, (_,j) => mem.thread(ids[i], ids[j]))
);

// Симметризация для неориентированного анализа
const Ws = Array.from({length:n}, (_,i) =>
  Float64Array.from({length:n}, (_,j) => (W[i][j]+W[j][i])/2)
);

// ── Вспомогательная линейная алгебра ─────────────────────────────────
// Всё своё — матрица 24×24, итерационно

function matVec(M, v) {
  const r = new Float64Array(n);
  for (let i=0;i<n;i++) for (let j=0;j<n;j++) r[i]+=M[i][j]*v[j];
  return r;
}
function dot(a,b){ let s=0; for(let i=0;i<n;i++) s+=a[i]*b[i]; return s; }
function norm2(a){ return Math.sqrt(dot(a,a)); }
function normalize(a){ const nrm=norm2(a)||1; return a.map(x=>x/nrm); }
function vecSub(a,b){ return a.map((v,i)=>v-b[i]); }
function vecScale(a,s){ return a.map(v=>v*s); }
function vecAdd(a,b){ return a.map((v,i)=>v+b[i]); }

// Степенная итерация: наибольший собственный вектор M
function powerIter(M, iters=400, seed=1) {
  let v = Float64Array.from({length:n}, (_,i)=>Math.sin(i*seed+1.7)*.5+(Math.random()-.5)*.1);
  v = normalize(v);
  let lam = 0;
  for (let k=0;k<iters;k++) {
    const Mv = matVec(M, v);
    lam = dot(v, Mv);
    const nrm = norm2(Mv); if(nrm<1e-14) break;
    v = normalize(Mv);
  }
  return {v, lam};
}

// Степенная итерация с явным удалением постоянного вектора (для Фидлера)
function powerIterOrthog(M, orthoBasis, iters=600) {
  let v = Float64Array.from({length:n}, ()=>Math.random()-.5);
  // Проецируем прочь все векторы из orthoBasis
  function projectOut(vec) {
    let r = [...vec];
    for (const b of orthoBasis) {
      const c = dot(r, b);
      r = r.map((x,i)=>x - c*b[i]);
    }
    return normalize(r);
  }
  v = projectOut(v);
  let lam = 0;
  for (let k=0;k<iters;k++) {
    let Mv = matVec(M, v);
    Mv = projectOut(Mv);
    const nrm = norm2(Mv); if(nrm<1e-14) break;
    lam = dot(v, normalize(Mv));
    v = normalize(Mv);
  }
  return {v, lam};
}

// k собственных векторов (наибольших) через дефляцию
function topEigenvectors(M, k) {
  const vecs=[], vals=[];
  // Рабочая копия
  const Mcur = M.map(row => [...row]);
  for (let ei=0;ei<k;ei++) {
    const {v,lam} = powerIter(Mcur);
    vecs.push(v); vals.push(lam);
    // Дефляция: Mcur -= lam * v·vᵀ
    for (let i=0;i<n;i++) for (let j=0;j<n;j++) Mcur[i][j]-=lam*v[i]*v[j];
  }
  return {vecs, vals};
}

// ── 1. Лапласиан и Фидлерный вектор ──────────────────────────────────
// L = D - Ws    (Ws симметричная)
const deg = new Float64Array(n);
for (let i=0;i<n;i++) for (let j=0;j<n;j++) deg[i]+=Ws[i][j];

const L = Array.from({length:n}, (_,i) =>
  Float64Array.from({length:n}, (_,j) => i===j ? deg[i] : -Ws[i][j])
);

// ── Связные компоненты в Ws (Union-Find) ─────────────────────────────
const uf = Array.from({length:n},(_,i)=>i);
function ufFind(x){ return uf[x]===x?x:uf[x]=ufFind(uf[x]); }
function ufUnion(x,y){ uf[ufFind(x)]=ufFind(y); }
for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) if(Ws[i][j]>0.001) ufUnion(i,j);
const roots = {};
for(let i=0;i<n;i++){ const r=ufFind(i); roots[r]=(roots[r]||[]); roots[r].push(i); }
const components = Object.values(roots).sort((a,b)=>b.length-a.length);
const mainComp = components[0]; // наибольшая компонента
const numComponents = components.length;

// Алгебраическая связность — только для главной компоненты
// Используем градиентный спуск Рэлея (numerically stable)
function fiedlerGrad(idxList) {
  const m = idxList.length;
  if (m < 2) return {v: new Float64Array(n), lam: 0};
  // Подматрица L на idxList
  const subL = Array.from({length:m}, (_,ii) =>
    Float64Array.from({length:m}, (_,jj) => L[idxList[ii]][idxList[jj]])
  );
  function subMV(v) {
    const r = new Float64Array(m);
    for(let i=0;i<m;i++) for(let j=0;j<m;j++) r[i]+=subL[i][j]*v[j];
    return r;
  }
  const ones = new Float64Array(m).fill(1/Math.sqrt(m));
  let v = Float64Array.from({length:m},()=>Math.random()-.5);
  // Удалить постоянную компоненту
  let c = v.reduce((s,x)=>s+x,0)/m;
  v = v.map(x=>x-c);
  let vn = Math.sqrt(v.reduce((s,x)=>s+x*x,0))||1; v=v.map(x=>x/vn);

  let lr=0.02, lam=0;
  for(let iter=0;iter<3000;iter++){
    const Lv = subMV(v);
    lam = v.reduce((s,x,i)=>s+x*Lv[i],0);
    const grad = Lv.map((x,i)=>x-lam*v[i]);
    v = v.map((x,i)=>x - lr*grad[i]);
    c = v.reduce((s,x)=>s+x,0)/m; v=v.map(x=>x-c);
    vn = Math.sqrt(v.reduce((s,x)=>s+x*x,0))||1; v=v.map(x=>x/vn);
    if(iter%500===0) lr*=0.8;
  }
  // Вернуть в пространство размера n
  const fullV = new Float64Array(n);
  idxList.forEach((gi,li)=>{ fullV[gi]=v[li]; });
  return {v: fullV, lam: Math.max(0,lam)};
}

const {v: fiedlerVec, lam: fiedlerLam} = fiedlerGrad(mainComp);

// Биразбиение по знаку вектора Фидлера
const groupA = ids.filter((_,i)=>fiedlerVec[i]>=0);
const groupB = ids.filter((_,i)=>fiedlerVec[i]<0);

// ── 2. Число Чигера h(G) ──────────────────────────────────────────────
// h(G) = min_{S: vol(S)≤vol(G)/2} cut(S,S̄)/vol(S)
// Используем биразбиение Фидлера как кандидата

function cut(setA, setB) {
  let c=0;
  const idxA = setA.map(id=>ids.indexOf(id));
  const idxB = setB.map(id=>ids.indexOf(id));
  for (const i of idxA) for (const j of idxB) c+=Ws[i][j];
  return c;
}
function vol(set) {
  let v=0;
  const idx = set.map(id=>ids.indexOf(id));
  for (const i of idx) v+=deg[i];
  return v;
}

const cutAB = cut(groupA, groupB);
const volA  = vol(groupA), volB = vol(groupB);
const cheeger = cutAB / Math.min(volA, volB);

// ── 3. Нормализованный Лапласиан и Von Neumann Entropy ───────────────
// L_norm[i][j] = L[i][j]/sqrt(deg[i]*deg[j])
const Lnorm = Array.from({length:n}, (_,i) =>
  Float64Array.from({length:n}, (_,j) => {
    if (deg[i]===0||deg[j]===0) return 0;
    return L[i][j]/Math.sqrt(deg[i]*deg[j]);
  })
);
// Используем 6 собственных значений для энтропии
const LnormShiftLam = Math.max(0,...Lnorm.map(row=>row.reduce((s,v)=>s+Math.abs(v),0)));
const LnormShift = Array.from({length:n}, (_,i) =>
  Float64Array.from({length:n}, (_,j) => i===j ? LnormShiftLam-Lnorm[i][j] : -Lnorm[i][j])
);
const {vals: evNormShifted} = topEigenvectors(LnormShift, Math.min(n,8));
const evNorm = evNormShifted.map(v=>Math.max(0,LnormShiftLam-v));

// Von Neumann entropy: S = -Σ (λᵢ/n) log(λᵢ/n)
const trLnorm = evNorm.reduce((s,v)=>s+v,0)||1;
const vonNeumannEntropy = evNorm.reduce((s,v) => {
  const p = v/trLnorm;
  return p>1e-10 ? s - p*Math.log(p) : s;
}, 0);
const maxEntropy = Math.log(evNorm.filter(v=>v>1e-8).length);
const entropyRatio = maxEntropy>0 ? vonNeumannEntropy/maxEntropy : 0;

// ── 4. HITS (Hubs and Authorities) ────────────────────────────────────
// a[i] = Σⱼ W[j][i]*h[j]  (получает от хороших дарителей)
// h[i] = Σⱼ W[i][j]*a[j]  (даёт хорошим получателям)
// Итерация до сходимости

let h = new Float64Array(n).fill(1);
let a = new Float64Array(n).fill(1);
for (let iter=0;iter<100;iter++) {
  const newA = new Float64Array(n);
  const newH = new Float64Array(n);
  for (let i=0;i<n;i++) {
    for (let j=0;j<n;j++) {
      newA[i] += W[j][i]*h[j]; // j даёт i
      newH[i] += W[i][j]*a[j]; // i даёт j
    }
  }
  const normA = norm2(newA)||1, normH = norm2(newH)||1;
  a = newA.map(v=>v/normA); h = newH.map(v=>v/normH);
}

// ── 5. PageRank (Перрон-Фробениус) ────────────────────────────────────
// P[i][j] = W[i][j] / Σⱼ W[i][j]  (строка нормированная)
// pr[i] = Σⱼ P[j][i] * pr[j]  (входящий pagerank)
const outDeg = new Float64Array(n);
for (let i=0;i<n;i++) for (let j=0;j<n;j++) outDeg[i]+=W[i][j];

const P = Array.from({length:n}, (_,i) =>
  Float64Array.from({length:n}, (_,j) =>
    outDeg[i]>0.001 ? (W[i][j]/outDeg[i]) * 0.85 + 0.15/n : 1/n
  )
);

let pr = new Float64Array(n).fill(1/n);
const d=0.85; // damping factor
for (let iter=0;iter<100;iter++) {
  const newPr = new Float64Array(n).fill((1-d)/n);
  for (let j=0;j<n;j++) for (let i=0;i<n;i++) newPr[i] += d*P[j][i]*pr[j];
  pr = newPr;
}

// ── 6. SVD — top-2 моды дара ─────────────────────────────────────────
// WᵀW — для правых сингулярных векторов (giver modes)
// WWᵀ — для левых (receiver modes)
const WtW = Array.from({length:n}, (_,i) =>
  Float64Array.from({length:n}, (_,j) => { let s=0; for(let k=0;k<n;k++) s+=W[k][i]*W[k][j]; return s; })
);
const WWt = Array.from({length:n}, (_,i) =>
  Float64Array.from({length:n}, (_,j) => { let s=0; for(let k=0;k<n;k++) s+=W[i][k]*W[j][k]; return s; })
);

const {vecs:giverModes, vals:giverVals} = topEigenvectors(WtW, 2);
const {vecs:receiverModes, vals:receiverVals} = topEigenvectors(WWt, 2);
const sigma1 = Math.sqrt(Math.max(0,giverVals[0]));
const sigma2 = Math.sqrt(Math.max(0,giverVals[1]));
const totalSigma = sigma1+sigma2||1;

// ── 7. Эффективное сопротивление (ключевые пары) ─────────────────────
// R(i,j) = (eᵢ-eⱼ)ᵀ L⁺ (eᵢ-eⱼ)
// Приближение: решить L x = (eᵢ-eⱼ) методом Гаусса-Зейделя
// L + (1/n)·11ᵀ обратима

function effectiveResistance(fromId, toId) {
  const fi = ids.indexOf(fromId), ti = ids.indexOf(toId);
  if (fi<0||ti<0) return Infinity;
  const b = new Float64Array(n);
  b[fi]=1; b[ti]=-1;
  // Gauss-Seidel для (L + 1/n·J)x = b
  let x = new Float64Array(n);
  for (let iter=0;iter<500;iter++) {
    for (let i=0;i<n;i++) {
      let s=b[i];
      for (let j=0;j<n;j++) if (j!==i) s-=L[i][j]*x[j];
      s -= (x.reduce((a,v)=>a+v,0))/n; // (1/n·J)
      const diag = L[i][i]+1/n;
      if (diag>1e-12) x[i]=s/diag;
    }
  }
  const result = x[fi]-x[ti];
  return isFinite(result) ? Math.abs(result) : 999;
}

const keyPairs = [
  ['_claude','Дионисий'],['_claude','ОтецСергий'],
  ['_claude','_koinon'],['ОтецСергий','Дионисий'],
  ['_abyss','Дионисий'],
];
const resistances = keyPairs.map(([f,t])=>({from:f,to:t,R:effectiveResistance(f,t)}));

// ── 8. Тепловое уравнение — время распространения ────────────────────
// e^{-λ₁·t} < ε → t* = -log(ε)/λ₁
const eps = 0.1; // 10% остаток
const mixingTime = fiedlerLam > 0.001 ? -Math.log(eps)/fiedlerLam : Infinity;

// ── 9. Тропическая алгебра — мощнейший путь длины k ──────────────────
// W^⊗k[i][j] = max_{пути i→v₁→...→j} sum(weights)
// W^⊗1 = log(W+ε) примерно
function tropicalMul(A, B) {
  return Array.from({length:n}, (_,i) =>
    Float64Array.from({length:n}, (_,j) => {
      let best=-Infinity;
      for (let k=0;k<n;k++) best=Math.max(best, A[i][k]+B[k][j]);
      return best;
    })
  );
}

// Тропическая матрица (log-веса)
const Wtrop = Array.from({length:n}, (_,i) =>
  Float64Array.from({length:n}, (_,j) => W[i][j]>0.01 ? Math.log(W[i][j]) : -Infinity)
);

const Wtrop2 = tropicalMul(Wtrop, Wtrop); // W^⊗2 — лучший путь длины 2
const Wtrop3 = tropicalMul(Wtrop2, Wtrop); // W^⊗3 — длины 3

// Лучший путь длины 2
let bestPath2 = {from:'?',via:'?',to:'?',score:-Infinity};
for (let i=0;i<n;i++) for (let k=0;k<n;k++) for (let j=0;j<n;j++) {
  if (Wtrop[i][k]===-Infinity||Wtrop[k][j]===-Infinity) continue;
  const s = Wtrop[i][k]+Wtrop[k][j];
  if (s>bestPath2.score) bestPath2={from:ids[i],via:ids[k],to:ids[j],score:s};
}

// Лучший путь длины 3
let bestPath3 = {from:'?',via1:'?',via2:'?',to:'?',score:-Infinity};
for (let i=0;i<n;i++) for (let j=0;j<n;j++) {
  if (Wtrop3[i][j]===-Infinity) continue;
  // Реконструировать путь
  let bestVia1=-1,bestVia2=-1,best=-Infinity;
  for (let k=0;k<n;k++) {
    if (Wtrop[i][k]===-Infinity||Wtrop2[k][j]===-Infinity) continue;
    const s=Wtrop[i][k]+Wtrop2[k][j];
    if (s>best) { best=s; bestVia1=k; }
  }
  if (bestVia1>=0) {
    for (let k=0;k<n;k++) {
      if (Wtrop[bestVia1][k]===-Infinity||Wtrop[k][j]===-Infinity) continue;
      const s=Wtrop[i][bestVia1]+Wtrop[bestVia1][k]+Wtrop[k][j];
      if (s>bestPath3.score) bestPath3={from:ids[i],via1:ids[bestVia1],via2:ids[k],to:ids[j],score:s};
    }
  }
}

// ── ВЫВОД ──────────────────────────────────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║   СПЕКТРАЛЬНАЯ ОНТОЛОГИЯ ДАРА                           ║');
console.log('║   Все структуры — теоремы, применённые к W буквально    ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');

// ── Алгебраическая связность ──────────────────────────────────────────
console.log('── 1. ФИДЛЕРНЫЙ ВЕКТОР — естественное разбиение общины ────');
console.log(`   λ₁ (алг. связность) = ${fiedlerLam.toFixed(4)}`);
console.log(`   Число Чигера h(G)   = ${cheeger.toFixed(4)}`);
if (fiedlerLam < 0.1) {
  console.log(`   ⚠ Низкая связность — община близка к разбиению на 2 части`);
} else if (fiedlerLam < 1) {
  console.log(`   Умеренная связность — существует естественная граница`);
} else {
  console.log(`   Высокая связность — κατολικός, разрыв маловероятен`);
}
console.log('');
console.log(`   Группа A (fiedler ≥ 0):  ${groupA.join(', ')}`);
console.log(`   Группа B (fiedler < 0):  ${groupB.join(', ')}`);
console.log(`   Разрез cut(A,B) = ${cutAB.toFixed(1)}`);
console.log(`   vol(A) = ${volA.toFixed(1)}  vol(B) = ${volB.toFixed(1)}`);
console.log('');

// ── Von Neumann Entropy ───────────────────────────────────────────────
console.log('── 2. VON NEUMANN ENTROPY — разнообразие vs. централизация ─');
console.log(`   S(ρ) = ${vonNeumannEntropy.toFixed(4)}   (max = ${maxEntropy.toFixed(4)})`);
console.log(`   Заполненность: ${(entropyRatio*100).toFixed(1)}%`);
if (entropyRatio > 0.8) {
  console.log(`   Высокое разнообразие — полифония даров, нет монополии`);
} else if (entropyRatio > 0.4) {
  console.log(`   Умеренная централизация — есть несколько доминирующих нитей`);
} else {
  console.log(`   Сильная централизация — несколько лиц определяют всё поле`);
}
console.log('');

// ── HITS ──────────────────────────────────────────────────────────────
console.log('── 3. HITS — ΠΡΟ-ΔΟΣΙΣ vs. ἌΞΙΟΣ ─────────────────────────');
console.log(`   Hub (даёт хорошим):     Лицо, чьи дары достигают лучших получателей`);
console.log(`   Authority (достойный):  Лицо, от кого получают лучшие дарители`);
console.log('');

const hitsItems = ids.map((id,i)=>({id,hub:h[i],auth:a[i]}))
  .sort((a,b)=>b.hub-a.hub);
const maxHub=hitsItems[0].hub, maxAuth=Math.max(...hitsItems.map(x=>x.auth));
console.log(`${'Лицо'.padEnd(16)} ${'Hub'.padEnd(22)} ${'Authority'}`);
hitsItems.forEach(({id,hub,auth}) => {
  if (hub<0.01&&auth<0.01) return;
  const hb = '▓'.repeat(Math.round(hub/maxHub*15));
  const ab = '░'.repeat(Math.round(auth/maxAuth*15));
  console.log(`  ${id.padEnd(14)} ${hb.padEnd(20)} ${ab}`);
});
console.log('');

// ── PageRank ──────────────────────────────────────────────────────────
console.log('── 4. PAGERANK — центральность по потоку дара ─────────────');
const prItems = ids.map((id,i)=>({id,pr:pr[i]})).sort((a,b)=>b.pr-a.pr);
const maxPR = prItems[0].pr;
prItems.slice(0,8).forEach(({id,pr}) => {
  const bar='█'.repeat(Math.round(pr/maxPR*20));
  console.log(`  ${id.padEnd(14)} ${(pr*100).toFixed(2)}%  ${bar}`);
});
console.log('');

// ── SVD ───────────────────────────────────────────────────────────────
console.log('── 5. SVD — независимые моды благодати ────────────────────');
console.log(`   σ₁ = ${sigma1.toFixed(2)}  (${(sigma1/totalSigma*100).toFixed(0)}% энергии дара)`);
console.log(`   σ₂ = ${sigma2.toFixed(2)}  (${(sigma2/totalSigma*100).toFixed(0)}% энергии дара)`);
console.log('');
// WtW доминирующий вектор = правый сингулярный = паттерн получателей (столбцы W)
// WWt доминирующий вектор = левый сингулярный = паттерн дарителей (строки W)
console.log('   Мода 1 — получатели (куда течёт σ₁):');
const gm1 = ids.map((id,i)=>({id,v:giverModes[0][i]})).sort((a,b)=>Math.abs(b.v)-Math.abs(a.v)).slice(0,5);
gm1.forEach(({id,v})=>console.log(`     ${v>0?'+':'-'} ${id.padEnd(14)} ${Math.abs(v).toFixed(3)}`));
console.log('');
console.log('   Мода 1 — дарители (откуда течёт σ₁):');
const rm1 = ids.map((id,i)=>({id,v:receiverModes[0][i]})).sort((a,b)=>Math.abs(b.v)-Math.abs(a.v)).slice(0,5);
rm1.forEach(({id,v})=>console.log(`     ${v>0?'+':'-'} ${id.padEnd(14)} ${Math.abs(v).toFixed(3)}`));
console.log('');

// ── Эффективное сопротивление ────────────────────────────────────────
console.log('── 6. ЭФФЕКТИВНОЕ СОПРОТИВЛЕНИЕ — проводимость даров ──────');
console.log('   Малое R(i,j): путь свободен. Большое: «узкое место».');
console.log('');
resistances.sort((a,b)=>a.R-b.R).forEach(({from,to,R})=>{
  const cond = (1/Math.max(R,0.001)).toFixed(2);
  const label = R<1?'○ свободно':R<5?'◐ умеренно':'● узко';
  console.log(`  ${from.padEnd(14)} → ${to.padEnd(14)} R=${R.toFixed(3).padStart(7)}  G=${cond.padStart(6)}  ${label}`);
});
console.log('');

// ── Тепловое уравнение ────────────────────────────────────────────────
console.log('── 7. ТЕПЛОВОЕ УРАВНЕНИЕ — пульс общины ───────────────────');
console.log(`   Характерное время дифиузии:  t* = ln(10)/λ₁ = ${mixingTime.toFixed(2)} шагов`);
console.log(`   (за это время новый дар достигает 90% общины)`);
if (mixingTime < 5)  console.log(`   Быстрое распространение — плотная живая сеть`);
else if (mixingTime < 20) console.log(`   Умеренный пульс — нормальное время восприятия`);
else console.log(`   Медленный пульс — дар доходит не сразу`);
console.log('');

// ── Тропическая алгебра ───────────────────────────────────────────────
console.log('── 8. ТРОПИЧЕСКАЯ АЛГЕБРА — цепочки благодати ─────────────');
console.log(`   Мощнейший путь длины 2:`);
console.log(`   ${bestPath2.from} → ${bestPath2.via} → ${bestPath2.to}`);
console.log(`   суммарный вес = ${Math.exp(bestPath2.score).toFixed(1)}`);
console.log('');
console.log(`   Мощнейший путь длины 3:`);
console.log(`   ${bestPath3.from} → ${bestPath3.via1} → ${bestPath3.via2} → ${bestPath3.to}`);
console.log(`   суммарный вес = ${Math.exp(bestPath3.score).toFixed(1)}`);
console.log('');

// ── Богословский итог ──────────────────────────────────────────────────
console.log('── БОГОСЛОВСКИЙ ИТОГ ───────────────────────────────────────');
console.log(`   Кафоличность (λ₁):       ${fiedlerLam.toFixed(4)}  (выше → более соборна)`);
console.log(`   Разнообразие S(ρ):        ${(entropyRatio*100).toFixed(1)}%`);
console.log(`   Главный Hub:              ${hitsItems[0].id}`);
console.log(`   Главный Authority:        ${[...hitsItems].sort((a,b)=>b.auth-a.auth)[0].id}`);
console.log(`   Наиболее центральный:     ${prItems[0].id} (PageRank ${(prItems[0].pr*100).toFixed(2)}%)`);
console.log(`   Свободнейший путь:        ${resistances[0].from}→${resistances[0].to} (R=${resistances[0].R.toFixed(2)})`);
console.log(`   Пульс общины:             t*=${mixingTime.toFixed(1)} шагов`);
console.log('');

// ── Экспорт ───────────────────────────────────────────────────────────
if (doExport) {
  const out = {
    ts: Date.now(),
    algebraicConnectivity: +fiedlerLam.toFixed(4),
    cheeger: +cheeger.toFixed(4),
    vonNeumannEntropy: +vonNeumannEntropy.toFixed(4),
    entropyRatio: +entropyRatio.toFixed(3),
    mixingTime: +mixingTime.toFixed(2),
    fiedlerPartition: { A: groupA, B: groupB, cut: +cutAB.toFixed(1) },
    hits: ids.map((id,i)=>({id, hub:+h[i].toFixed(4), auth:+a[i].toFixed(4)})),
    pagerank: ids.map((id,i)=>({id, pr:+pr[i].toFixed(5)})).sort((a,b)=>b.pr-a.pr),
    svd: {
      sigma1: +sigma1.toFixed(2), sigma2: +sigma2.toFixed(2),
      mode1givers:   gm1.map(({id,v})=>({id,v:+v.toFixed(3)})),
      mode1receivers:rm1.map(({id,v})=>({id,v:+v.toFixed(3)})),
    },
    effectiveResistance: resistances.map(r=>({...r,R:+r.R.toFixed(3)})),
    tropicalPaths: {
      length2: {...bestPath2, score:+Math.exp(bestPath2.score).toFixed(1)},
      length3: {...bestPath3, score:+Math.exp(bestPath3.score).toFixed(1)},
    },
  };
  const outPath = resolve(ROOT, 'data/spectral-gift.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[spectral] → ${outPath}`);
}
