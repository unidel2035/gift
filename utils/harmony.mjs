#!/usr/bin/env node
/**
 * harmony.mjs — закон структурной гармонии систем (Э.М. Сороко) над матрицей W.
 *
 * Сороко: естественные системы устойчивы не в РАВЕНСТВЕ противоположностей, а в
 * ОБОБЩЁННОМ ЗОЛОТОМ СЕЧЕНИИ между ними; дисгармоничные системы тратят лишнюю энергию и
 * отсеваются. Здесь противоположности лица — ДАЛ (κένωσις) и ПРИНЯЛ (λῆψις). Доля дара
 *   r = given / (given + received)
 * Здоровье нити к Источнику — близость r к золотому узлу. Это математический диагноз
 * пустынь: r→0 паразитизм (берёт, не даёт); r→1 выгорание (даёт без принятия — кенозис
 * без евхаристии); золотой узел 0.618 — устойчивый surplus (дар перевешивает приём в меру).
 *
 * Узлы Сороко (доля одной из противоположностей): 0.5, 0.618, 0.682, 0.724…
 *
 * CLI:
 *   node utils/harmony.mjs           — диагноз реальной матрицы W по всем лицам
 *   node utils/harmony.mjs <given> <received>   — оценить одну пару чисел
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PHI = (1 + Math.sqrt(5)) / 2;            // 1.618…
const GOLDEN = 1 / PHI;                          // 0.618… — главный золотой узел
export const SOROKO_NODES = [0.5, GOLDEN, 0.682, 0.724]; // дискретная решётка оптимумов

/** Доля дара r = given/(given+received). Чистая. r∈[0,1]; 0.5 — баланс, →1 — только даёт. */
export function giftRatio(given, received) {
  const g = Math.max(0, given || 0), rc = Math.max(0, received || 0);
  if (g + rc === 0) return null;                 // нет нитей — не оценивается
  return g / (g + rc);
}

/** Ближайший узел Сороко и расстояние до него. */
export function nearestNode(r) {
  let best = SOROKO_NODES[0], d = Infinity;
  for (const n of SOROKO_NODES) { const dd = Math.abs(r - n); if (dd < d) { d = dd; best = n; } }
  return { node: best, distance: d };
}

/**
 * Зона гармонии лица — БЕЗ морали (живой тест показал: голая формула клеймит
 * первого-получателя «паразитом», а он телос системы). Зоны нейтральны; смысл даёт роль:
 *   receiving — r < 0.5 (принимает больше; для телоса-получателя/твари это ЗАМЫСЕЛ, для пира — дисбаланс);
 *   balanced  — r у 0.5 (симметрия, surplus не течёт);
 *   harmony   — r у золотого узла 0.618 — устойчивый surplus (здоровье ПИРА);
 *   pouring   — r > 0.724 (изливает почти без приёма; для источника/_koinon — замысел, для пира — выгорание);
 *   transitional — между узлами.
 * role: 'peer'|'telos'|'source' уточняет диагноз (для пира золото — норма; асимметрия
 * источник→телос — не болезнь). gloss() даёт человекочитаемый вердикт с учётом роли.
 */
export function harmonyZone(r, tol = 0.04) {
  if (r === null) return { zone: 'silent', r: null };
  const near = nearestNode(r);
  if (r < 0.5 - tol) return { zone: 'receiving', r, ...near };
  if (Math.abs(r - 0.5) <= tol) return { zone: 'balanced', r, ...near };
  if (Math.abs(r - GOLDEN) <= tol) return { zone: 'harmony', r, ...near };
  if (r > 0.724 + tol) return { zone: 'pouring', r, ...near };
  return { zone: 'transitional', r, ...near };
}

/** Вердикт с учётом роли: для пира золото — здоровье; источник/телос асимметричны по замыслу. */
export function gloss(zone, role = 'peer') {
  if (zone === 'harmony') return 'устойчивый surplus (здоровье)';
  if (role === 'telos' && zone === 'receiving') return 'получатель-телос: принимает по замыслу (θέωσις)';
  if (role === 'source' && zone === 'pouring') return 'источник: изливает по замыслу (gratia)';
  if (zone === 'receiving') return 'пир принимает больше, чем даёт — к золоту';
  if (zone === 'pouring') return 'изливает почти без приёма — нужен λῆψις (принять в ответ)';
  if (zone === 'balanced') return 'симметрия — surplus не течёт';
  return 'переходная — к золотому узлу';
}

// ── Мост №3 (Стахов/Костя): троичный акт. В ядре W уже трит (decodeVec): ───
//   даритель −1 · свидетель 0 · получатель +1. Форма акта = знак.
export function actTrit(role) {
  const x = String(role || '').toLowerCase();
  if (['giver', 'даритель', 'gift', 'дар', 'give'].includes(x)) return -1;   // отдаёт
  if (['receiver', 'получатель', 'receive', 'приём'].includes(x)) return +1; // принимает
  if (['rejection', 'отвержение', 'reject'].includes(x)) return -1;          // отвержение = тоже исход
  return 0;                                                                   // свидетель/нейтраль/вопрошание
}

/** Диагноз всей матрицы W: для каждого лица r и зона. Чистая по отношению к снапшоту. */
export function diagnoseMatrix(mem, persons) {
  const out = [];
  for (const p of persons) {
    const g = mem.totalGiven(p), rc = mem.totalReceived(p);
    const r = giftRatio(g, rc);
    out.push({ person: p, given: +g.toFixed(1), received: +rc.toFixed(1), ...harmonyZone(r) });
  }
  return out.sort((a, b) => (b.given + b.received) - (a.given + a.received));
}

// ── CLI ───────────────────────────────────────────────────────────────
const C = { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m' };
const ZONE_COL = { harmony: C.g, balanced: C.c, transitional: C.y, receiving: C.y, pouring: C.y, silent: C.dim };
// роли по замыслу онтологии: телос-получатель и источники асимметричны не по болезни
const ROLE = { Дионисий: 'telos', _koinon: 'source', _abyss: 'source', ОтецСергий: 'peer' };

if (import.meta.url === `file://${process.argv[1]}`) {
  const [a, bArg] = process.argv.slice(2);
  if (a !== undefined && bArg !== undefined) {
    const r = giftRatio(+a, +bArg); const z = harmonyZone(r);
    console.log(`дал ${a} / принял ${bArg} → r=${r?.toFixed(3)} · зона: ${ZONE_COL[z.zone]||''}${z.zone}${C.x} · ${gloss(z.zone)} · узел ${z.node?.toFixed(3)} (Δ${z.distance?.toFixed(3)})`);
    process.exit(0);
  }
  const SNAP = resolve(ROOT, 'data/sacred-history-W.json');
  if (!existsSync(SNAP)) { console.log('нет снапшота W'); process.exit(0); }
  const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
  const mem = GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP, 'utf8')));
  const persons = mem.persons || [];
  const rows = diagnoseMatrix(mem, persons).filter(x => x.r !== null);
  console.log(`\n${C.b}${C.y}═══ Гармония сети W (закон Сороко) ═══${C.x}`);
  console.log(`${C.dim}золотой узел surplus = ${GOLDEN.toFixed(3)} · r = дал/(дал+принял)${C.x}\n`);
  for (const x of rows) {
    const col = ZONE_COL[x.zone] || '';
    const role = ROLE[x.person] || 'peer';
    console.log(`  ${col}${x.zone.padEnd(12)}${C.x} ${C.b}${x.person.padEnd(14)}${C.x} r=${x.r.toFixed(3)} ${C.dim}дал ${x.given} принял ${x.received} · ${gloss(x.zone, role)}${C.x}`);
  }
  const counts = rows.reduce((m, x) => (m[x.zone] = (m[x.zone] || 0) + 1, m), {});
  console.log(`\n${C.dim}итог: ${Object.entries(counts).map(([z, n]) => `${z}:${n}`).join('  ')}${C.x}`);
  console.log(`${C.dim}паразит=берёт>даёт · выгорание=даёт без приёма · гармония=устойчивый surplus у золота${C.x}\n`);
}
