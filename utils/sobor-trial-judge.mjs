#!/usr/bin/env node
/**
 * sobor-trial-judge — испытание гипотезы РЕАЛЬНОСТЬЮ (такт 4 в турнире собора).
 *
 * Чего не хватало даже после заземления (sobor-ground-judge):
 *   • grounded-judge сверяет кандидата с КОРПУСОМ по близости текста — это проверка
 *     на КОНСИСТЕНТНОСТЬ (как литературная сверка у Google Co-Scientist).
 *   • но «согласуется с известным» ≠ «работает». Co-Scientist упирается в этот
 *     потолок: его верификация = непротиворечие литературе.
 *
 * Этот слой добавляет то, чего у DeepMind нет: ГРАУНД-ТРУС через ИСПОЛНЕНИЕ.
 * Гипотеза, у которой есть испытание (тестбэд такта 4), судится не мнением модели,
 * а кодом выхода прогона: exit 0 (result.json «подтверждено») > красивый текст.
 *
 * Иерархия судейства собора (от сильного к слабому):
 *   1. ИСПЫТАНИЕ (этот слой)  — прошёл прогон реальности? (если у кандидата есть trial)
 *   2. ЗАЗЕМЛЕНИЕ (ground)    — опирается на корпус и целит в зазор?
 *   3. ДАР (gift base)        — избыток/кеносис/телос.
 * Это и есть «большинство вычислений — в верификацию»: испытание дороже всего и решает первым.
 *
 * Кандидат с испытанием:
 *   { id, text, trial: { cmd: "bash-команда", dir?: "cwd", result?: "путь к result.json",
 *                        metric?: "ключ метрики (меньше=лучше по умолчанию)", lowerBetter?: true } }
 *
 * Офлайн-безопасно и детерминированно: нет trial → слой прозрачен (отдаёт базовому судье).
 *
 * Запуск (самопроверка):
 *   node utils/sobor-trial-judge.mjs --selftest
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Прогон одного испытания (с кешем: один кандидат — один запуск) ────
export function makeTrialRunner({ timeout = 600000, log = false } = {}) {
  const cache = new Map();
  return (cand) => {
    const t = cand && cand.trial;
    if (!t || !t.cmd) return { ran: false, passed: false, why: 'нет испытания' };
    const key = `${t.dir || '.'}::${t.cmd}`;
    if (cache.has(key)) return cache.get(key);
    if (log) process.stderr.write(`  ⚙ испытание ${cand.id}: ${t.cmd}\n`);
    let r;
    try {
      r = spawnSync('bash', ['-lc', t.cmd], {
        cwd: t.dir || process.cwd(), encoding: 'utf8', timeout, maxBuffer: 16e6,
      });
    } catch (e) {
      const out = { ran: true, passed: false, exit: -1, why: `стенд не запустился: ${e.message}` };
      cache.set(key, out); return out;
    }
    const passed = r.status === 0;
    // прочитать result.json, если указан/лежит рядом
    let metrics = null, status = null;
    const rp = t.result || (t.dir ? join(t.dir, 'result.json') : null);
    if (rp && existsSync(rp)) {
      try { const j = JSON.parse(readFileSync(rp, 'utf8')); metrics = j.metrics || null; status = j.status || null; } catch { /* битый json */ }
    }
    const tag = status ? `: ${status}` : '';
    const out = {
      ran: true, passed, exit: r.status, metrics, status,
      metric: t.metric, lowerBetter: t.lowerBetter !== false,
      why: passed ? `испытание пройдено (exit 0${tag})` : `испытание провалено (exit ${r.status}${tag})`,
    };
    cache.set(key, out);
    return out;
  };
}

// Сравнение двух пройденных испытаний по числовой метрике (если задана и сопоставима).
function compareMetric(ta, tb) {
  const key = ta.metric || tb.metric;
  if (!key || !ta.metrics || !tb.metrics) return null;
  const va = Number(ta.metrics[key]), vb = Number(tb.metrics[key]);
  if (!Number.isFinite(va) || !Number.isFinite(vb) || va === vb) return null;
  const lower = ta.lowerBetter !== false;
  const aWins = lower ? va < vb : va > vb;
  return { winner: aWins ? 'A' : 'B', why: `оба прошли → лучше по «${key}»: ${aWins ? va : vb} (${lower ? 'меньше' : 'больше'} лучше)` };
}

/**
 * Испытующий судья поверх базового (заземлённого или дара).
 * Прошедший испытание побеждает не-прошедшего/не-испытанного — реальность выше риторики.
 * Оба прошли → метрика (если есть) → иначе базовый судья. Оба без испытания → базовый судья (слой прозрачен).
 */
export function makeTrialJudge(baseJudge, runTrial = makeTrialRunner()) {
  return (a, b) => {
    const ta = runTrial(a), tb = runTrial(b);
    if (ta.ran || tb.ran) {
      if (ta.passed !== tb.passed) {
        const other = ta.passed ? tb : ta;
        return {
          winner: ta.passed ? 'A' : 'B',
          why: `испытание реальностью: ${ta.passed ? 'A' : 'B'} прошло, другое — ${other.ran ? 'провалено' : 'не испытано'}`,
        };
      }
      if (ta.passed && tb.passed) {
        const m = compareMetric(ta, tb);
        if (m) return m;
      }
    }
    const r = baseJudge(a, b);
    return { winner: r.winner, why: (ta.ran || tb.ran) ? `равны в испытании → ${r.why}` : r.why };
  };
}

// ── Самопроверка (детерминированная, без сети и без SITL) ────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) {
    const base = () => ({ winner: 'A', why: 'базовый: A (заглушка)' });
    const J = makeTrialJudge(base);
    const pass = { id: 'P', text: 'рабочая гипотеза', trial: { cmd: 'exit 0' } };
    const fail = { id: 'F', text: 'красивая, но ложная', trial: { cmd: 'exit 1' } };
    const none = { id: 'N', text: 'без испытания' };

    const t1 = J(fail, pass);  // ожидаем победу прошедшего (B = pass)
    const t2 = J(pass, none);  // ожидаем победу прошедшего (A = pass)
    const t3 = J(none, none);  // оба без испытания → базовый (A)
    const ok = t1.winner === 'B' && t2.winner === 'A' && t3.winner === 'A';
    console.log('1) провал vs успех →', t1.winner, '|', t1.why);
    console.log('2) успех vs без испытания →', t2.winner, '|', t2.why);
    console.log('3) оба без испытания →', t3.winner, '|', t3.why);
    // метрика: оба прошли, меньше промах — лучше
    const dA = { id: 'dA', text: 'дрон A', trial: { cmd: 'exit 0', metric: 'miss', metrics: undefined } };
    const runner = (c) => ({ ran: true, passed: true, metrics: { miss: c.id === 'dA' ? 4 : 9 }, metric: 'miss', lowerBetter: true });
    const Jm = makeTrialJudge(base, runner);
    const t4 = Jm({ id: 'dA' }, { id: 'dB' });
    console.log('4) метрика (промах 4 vs 9) →', t4.winner, '|', t4.why);
    console.log(ok && t4.winner === 'A' ? '\n✓ selftest passed' : '\n✗ selftest FAILED');
    process.exit(ok && t4.winner === 'A' ? 0 : 1);
  }
  console.log('Использование: node utils/sobor-trial-judge.mjs --selftest');
}
