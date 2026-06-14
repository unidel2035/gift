#!/usr/bin/env node
/**
 * recap.mjs — «В предыдущих сериях…»: нарративный возврат в активную арку.
 *
 * Анамнезис-хук даёт сырую сводку W; recap даёт СЮЖЕТ: последняя главная серия (logline +
 * сцены-точки), открытые недоделки (клиффхэнгеры) и свежие дары. Чтобы Дионисий (и я) входили
 * в продолжение сериала, а не в чистый лист. См. specs/apophatic-memory-idea-graph.gift §7.
 *
 * CLI: gift recap   (для session-start: «previously on»)
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// «Главная» серия = диалог человека, не суб-сессия агента и не артефакт теста.
const SUBAGENT = /^(Ты\s|Замысел:|Артефакт:|Это вопрошание|System:)/;
export function isMainEpisode(ep) {
  return ep && ep.userTurns >= 3 && !SUBAGENT.test(ep.logline);
}

export async function buildRecap() {
  const { listEpisodes } = await import('./episodes.mjs');
  const { buildGraph } = await import('./idea-graph.mjs');
  const eps = listEpisodes({ all: true }).filter(isMainEpisode);
  const last = eps[1] || eps[0];                 // [0] часто текущая — берём предыдущую главную
  const open = buildGraph({ limitFiles: 25 })
    .filter(n => n.status === 'open' && n.type !== 'idea');
  const seen = new Set();
  const loops = open.filter(n => { const k = n.text.slice(0, 50); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5);
  return { last, loops };
}

// ── CLI ───────────────────────────────────────────────────────────────
const C = { dim: '\x1b[2m', b: '\x1b[1m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m' };
if (import.meta.url === `file://${process.argv[1]}`) {
  const { last, loops } = await buildRecap();
  console.log(`\n${C.b}${C.y}═══ В предыдущих сериях… ═══${C.x}`);
  if (last) {
    console.log(`${C.b}Серия ${last.id}${C.x} ${C.dim}(${last.userTurns} реплик):${C.x} ${last.logline}`);
    if (last.scenes?.length) console.log(`  ${C.dim}повороты: ${last.scenes.slice(0, 6).join(' · ')}${C.x}`);
  } else console.log(`${C.dim}(пилот — прошлых серий нет)${C.x}`);
  if (loops.length) {
    console.log(`\n${C.b}${C.r}Клиффхэнгеры (висят, ждут разрешения):${C.x}`);
    for (const n of loops) console.log(`  ${C.r}⑂${C.x} ${n.text} ${C.dim}(${n.episode})${C.x}`);
  } else console.log(`\n${C.dim}открытых клиффхэнгеров нет — нити замкнуты${C.x}`);
  console.log('');
}
