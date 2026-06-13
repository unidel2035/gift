#!/usr/bin/env node
/**
 * sobor-grounding — заземление вердикта собора.
 *
 * Рычаг №1 победителей арены BitGN ECOM1 (подтверждён баллами): «нельзя процитировать
 * файл, который ты не открывал». Победитель B одной правкой grounding-reference поднял
 * 45→68% (+22пп). Балл берётся не оркестрацией, а ОТКАЗОМ принять незаземлённый ответ.
 *
 * Это наша же аксиома анти-фиктивности: claim без акта весит ноль. Здесь — в коде ревью:
 * находка ревьюера/собора СЧИТАЕТСЯ только если она заземлена точной ссылкой —
 * `файл:строка` ИЛИ путь, который ревьюер реально открывал (touched). Незаземлённые
 * находки не отбрасываются молча, а помечаются `dropped` (видимы, но не влияют на вердикт).
 *
 * Совместимо: работает поверх находок sobor-blind-review / любого ревью.
 *
 * Запуск:  node utils/sobor-grounding.mjs --selftest
 */

// Точная ссылка: «path:line» (любой непробельный путь + двоеточие + номер строки).
const REF_RE = /(^|[^\s:])[^\s:]*:\d+/;

/** Заземлена ли находка: file:line, либо ref/file из реально открытых путей (touched). */
export function isGrounded(finding, { touched = [] } = {}) {
  const ref = String(finding.ref || finding.file || finding.path || '').trim();
  if (!ref) return false;
  if (REF_RE.test(ref)) return true;                 // file:line — самодостаточно
  if (touched.includes(ref)) return true;            // путь, который реально читали
  return false;
}

/** Разделить находки на заземлённые и отброшенные (с причиной). */
export function groundFindings(findings = [], opts = {}) {
  const grounded = [], dropped = [];
  for (const f of findings) {
    if (isGrounded(f, opts)) grounded.push(f);
    else dropped.push({ ...f, dropped_reason: 'нет точной ссылки (file:line или открытый путь) — claim без акта не считается' });
  }
  return { grounded, dropped };
}

/**
 * Вердикт по заземлённым находкам:
 *   reject — есть заземлённая находка высокой важности;
 *   open   — есть заземлённые находки (решает человек);
 *   affirm — заземлённых находок нет.
 * Незаземлённые НЕ влияют на вердикт (но возвращаются для прозрачности).
 */
export function groundedVerdict(findings = [], opts = {}) {
  const { grounded, dropped } = groundFindings(findings, opts);
  const verdict = grounded.some(f => f.severity === 'high') ? 'reject'
    : grounded.length ? 'open' : 'affirm';
  return { verdict, grounded, dropped, grounded_count: grounded.length, dropped_count: dropped.length };
}

// ── Самопроверка (детерминированная) ─────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) {
    const findings = [
      { severity: 'high', why: 'пустой catch', ref: 'cells/save.js:2' },        // заземлено (file:line)
      { severity: 'med', why: 'не покрыт null', file: '/proc/x.json' },          // заземлено если touched
      { severity: 'high', why: 'звучит плохо' },                                  // НЕ заземлено (нет ссылки)
    ];
    const r = groundedVerdict(findings, { touched: ['/proc/x.json'] });
    console.log('вердикт:', r.verdict, '| заземлено:', r.grounded_count, '| отброшено:', r.dropped_count);
    r.dropped.forEach(f => console.log('  ✗ отброшено:', f.why));
    // ожидаем: 2 заземлены (одна high → reject), 1 отброшена
    const ok = r.verdict === 'reject' && r.grounded_count === 2 && r.dropped_count === 1
      && r.dropped[0].why === 'звучит плохо';
    console.log(ok ? '\n✓ selftest passed (незаземлённое не влияет на вердикт)' : '\n✗ FAILED');
    process.exit(ok ? 0 : 1);
  }
  console.log('node utils/sobor-grounding.mjs --selftest');
}
