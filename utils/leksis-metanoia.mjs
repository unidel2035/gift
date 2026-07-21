#!/usr/bin/env node
/**
 * leksis-metanoia.mjs — обработчик μετάνοια для дара unknown→_koinon (closes #758)
 *
 * Пульс онтологии (ontology-pulse.mjs) находит пустыни leksis_pending:
 * отвергнутые дары, ждущие покаяния. Но ничто их не разбирало.
 * Эта утилита — операционный обработчик λήψις: она проходит по журналу
 * отвергнутых даров и для случая unknown→_koinon строит акт-поворот μετάνοια.
 *
 * Богословие (по GiftMemory._repentUnknownToAbyss):
 *   Покаяние не стирает прошлое — исходный дар остаётся frozen в _declined.
 *   Оно именует безымянное: «unknown» после μετάνοια общины признаётся как
 *   _abyss — бездна, дающая gratia gratis data (Ин 3:8: «Дух дышит, где хочет»).
 *   Дар не отвергнут, а пере-узнан. Новый акт type:'metanoia' с reversedFrom.
 *
 * Использование:
 *   node utils/leksis-metanoia.mjs           — отчёт по журналу λήψις снапшота
 *   node utils/leksis-metanoia.mjs --emit     — + напечатать акты μετάνοια (JSON)
 *
 * Утилита НЕ мутирует священный снапшот. Применение к матрице W —
 * через GiftMemory.repent(giftId) (требует полного ядра).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');

// ── Чистое ядро (без TensorFlow) ─────────────────────────────────────────────

/**
 * Применима ли μετάνοια-через-_abyss к акту из журнала λήψις?
 * Зеркалит проверки GiftMemory._repentUnknownToAbyss — но возвращает
 * результат-классификатор вместо исключения, чтобы сканер мог сортировать.
 */
export function eligibleForAbyssMetanoia(act) {
  if (!act)                          return { ok: false, reason: 'пустой акт' };
  if (act.reception !== 'declined')  return { ok: false, reason: `reception=${act.reception ?? '—'} (нужно declined)` };
  if (act.giverId !== 'unknown')     return { ok: false, reason: `даритель=${act.giverId} (нужно unknown)` };
  if (act.receiverId !== '_koinon')  return { ok: false, reason: `получатель=${act.receiverId} (нужно _koinon)` };
  return { ok: true, reason: 'подлежит μετάνοια через _abyss' };
}

/**
 * Строит акт-поворот μετάνοια для дара unknown→_koinon.
 * recognizedAt передаётся снаружи — ради детерминизма и тестируемости.
 * Бросает, если акт не подлежит покаянию (как и ядро).
 */
export function makeMetanoiaAct(act, recognizedAt) {
  const check = eligibleForAbyssMetanoia(act);
  if (!check.ok) throw new Error(`μετάνοια невозможна: ${check.reason}`);
  return Object.freeze({
    giverId:      '_abyss',    // безымянный переузнан как Бездна
    receiverId:   '_koinon',
    type:         'metanoia',
    weight:       act.weight ?? 1,
    content:      act.content ?? '',
    reversedFrom: act.giftId,  // поворот, не отмена: указывает на исходный дар
    irreversible: true,
    recognizedAt,
  });
}

/**
 * Сканирует журнал λήψις (список { act, declinedAt } или голых актов),
 * делит на подлежащие покаянию и прочие — с причиной для каждого.
 */
export function scanLeksis(declinedJournal) {
  const eligible = [], skipped = [];
  for (const entry of declinedJournal || []) {
    const act = entry.act ?? entry;
    const check = eligibleForAbyssMetanoia(act);
    (check.ok ? eligible : skipped).push({ act, reason: check.reason });
  }
  return { eligible, skipped };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(SNAP)) {
    console.error(`Снапшот не найден: ${SNAP}`);
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
  const journal = snap.declined || [];
  const { eligible, skipped } = scanLeksis(journal);

  console.log(`\n═══ λήψις — журнал отвергнутых даров ═══`);
  console.log(`Всего в журнале: ${journal.length} | подлежат μετάνοια (unknown→_koinon): ${eligible.length}\n`);

  if (skipped.length) {
    console.log('Не подлежат (не unknown→_koinon):');
    for (const s of skipped) {
      console.log(`  · ${s.act.giverId}→${s.act.receiverId} (${s.act.type}) — ${s.reason}`);
    }
    console.log();
  }

  if (!eligible.length) {
    console.log('Нет даров unknown→_koinon, ждущих покаяния. Пустыня leksis_pending чиста.');
    return;
  }

  const emit = process.argv.includes('--emit');
  console.log(`Подлежат μετάνοια:`);
  for (const e of eligible) {
    const act = makeMetanoiaAct(e.act, new Date().toISOString());
    console.log(`  ✦ ${e.act.giftId}: unknown→_koinon пере-узнан как _abyss→_koinon (вес ${act.weight})`);
    if (emit) console.log(`    ${JSON.stringify(act)}`);
  }
  console.log(`\nПрименить к матрице W: GiftMemory.repent(giftId) для каждого giftId выше.`);
}

// Запуск как CLI (а не как импорт)
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
