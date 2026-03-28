/**
 * liturgical-cycle.mjs — Литургический цикл разработки
 *
 * Шесть фаз дарения в суточном ритме.
 * Не механический цикл — литургический: каждая фаза имеет телос.
 *
 * Отец Сергий: «Субботствование духовное важно совершать постоянно (ежедневно)
 * в сердце своем, но один из дней — особенно.»
 *
 * Фазы:
 *  Пробуждение  (3:30)  — матрица просыпается, пустыни обнаружены
 *  Вопрошание   (4:00)  — dev-loop: вопросы воплощены в код
 *  Различение   (9:00)  — планы прочитаны, одобрены, направление ясно
 *  Воплощение   (12:00) — активная работа: commits, PRs
 *  Благодать    (18:00) — CI прошёл, дары приняты в матрицу
 *  Суббота      (23:00) — снапшот, decay, покой
 *
 * Крон (сервер):
 *   30 3 * * *   node /home/hive/gift/utils/server-pulse.mjs     # Пробуждение
 *   0  4 * * *   /home/hive/gift-worker/run-dev-loop.sh           # Вопрошание→Воплощение
 *   0  9 * * *   node /home/hive/gift/utils/liturgical-cycle.mjs --phase различение
 *   0 18 * * *   node /home/hive/gift/utils/liturgical-cycle.mjs --phase благодать
 *   0 23 * * *   node /home/hive/gift/utils/matrix-snapshot.mjs   # Суббота
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Определение фаз ────────────────────────────────────────────────────────

export const PHASES = [
  {
    id:     'пробуждение',
    hour:   3, minute: 30,
    cron:   '30 3 * * *',
    script: 'utils/server-pulse.mjs',
    telos:  'Матрица просыпается. Пустыни обнаружены. Вопрошания рождены.',
    icon:   '🌅',
    gifts:  ['анализ', 'диагностика', 'вопрошание'],
  },
  {
    id:     'вопрошание',
    hour:   4, minute: 0,
    cron:   '0 4 * * *',
    script: 'gift-worker/run-dev-loop.sh',
    telos:  'Вопросы воплощаются в код. Агент берёт issue и создаёт дар.',
    icon:   '🕯',
    gifts:  ['код', 'PR', 'инженерия'],
  },
  {
    id:     'различение',
    hour:   9, minute: 0,
    cron:   '0 9 * * *',
    script: 'utils/liturgical-cycle.mjs',
    telos:  'Различение духов: какие планы принять? Дионисий одобряет.',
    icon:   '⚖',
    gifts:  ['мудрость', 'выбор', 'план'],
  },
  {
    id:     'воплощение',
    hour:   12, minute: 0,
    cron:   '0 12 * * *',
    script: null, // ручная работа
    telos:  'Воплощение: commits, PRs, активное дарение кода.',
    icon:   '⚒',
    gifts:  ['труд', 'код', 'присутствие'],
  },
  {
    id:     'благодать',
    hour:   18, minute: 0,
    cron:   '0 18 * * *',
    script: 'utils/liturgical-cycle.mjs',
    telos:  'CI прошёл. Дары приняты. Матрица обновлена. Благодарение.',
    icon:   '✨',
    gifts:  ['благодарение', 'завершение', 'анамнезис'],
  },
  {
    id:     'суббота',
    hour:   23, minute: 0,
    cron:   '0 23 * * *',
    script: 'utils/matrix-snapshot.mjs',
    telos:  'Снапшот. Decay. Покой. Семена смерти становятся семенами воскресения.',
    icon:   '🌙',
    gifts:  ['покой', 'снапшот', 'анастасис'],
  },
];

// ── Текущая фаза ──────────────────────────────────────────────────────────

/**
 * Определяет текущую литургическую фазу по времени суток.
 * @param {Date} [now] — текущее время (по умолчанию Date.now())
 * @returns {{ phase: object, next: object, minutesUntilNext: number }}
 */
export function currentPhase(now = new Date()) {
  const totalMinutes = now.getHours() * 60 + now.getMinutes();

  // Фаза активна с её начала до начала следующей
  let active = PHASES[PHASES.length - 1]; // по умолчанию — суббота (ночь)
  let next   = PHASES[0];

  for (let i = 0; i < PHASES.length; i++) {
    const p = PHASES[i];
    const start = p.hour * 60 + p.minute;
    const nextP = PHASES[(i + 1) % PHASES.length];
    const end   = nextP.hour * 60 + nextP.minute;

    if (start <= end) {
      if (totalMinutes >= start && totalMinutes < end) {
        active = p;
        next   = nextP;
        break;
      }
    } else {
      // wrap midnight
      if (totalMinutes >= start || totalMinutes < end) {
        active = p;
        next   = nextP;
        break;
      }
    }
  }

  const nextStart = next.hour * 60 + next.minute;
  let minutesUntilNext = nextStart - totalMinutes;
  if (minutesUntilNext < 0) minutesUntilNext += 24 * 60;

  return { phase: active, next, minutesUntilNext };
}

// ── Отчёт о фазе ─────────────────────────────────────────────────────────

export function reportPhase(now = new Date()) {
  const { phase, next, minutesUntilNext } = currentPhase(now);
  const h = Math.floor(minutesUntilNext / 60);
  const m = minutesUntilNext % 60;
  return [
    `Литургическая фаза: ${phase.icon} ${phase.id.toUpperCase()}`,
    `Телос: ${phase.telos}`,
    `Следующая: ${next.icon} ${next.id} (через ${h}ч ${m}м)`,
  ].join('\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────

const isMain = process.argv[1]?.endsWith('liturgical-cycle.mjs');
if (isMain) {
  const args  = process.argv.slice(2);
  const phase = args.find((_, i) => args[i - 1] === '--phase');

  if (phase === 'различение') {
    // Читаем plan-approved issues и выводим для ручного различения
    console.log('\n═══ РАЗЛИЧЕНИЕ — Фаза 3 ═══\n');
    console.log(reportPhase());
    console.log('\nЧто делать:');
    console.log('  1. gh issue list --label plan-approved');
    console.log('  2. Дионисий одобряет/отклоняет планы');
    console.log('  3. Одобренные → label plan-approved уже есть');
    console.log('  4. Неодобренные → gh issue edit N --remove-label plan-approved\n');
  } else if (phase === 'благодать') {
    // Анамнезис благодати: что сделано за день
    console.log('\n═══ БЛАГОДАТЬ — Фаза 5 ═══\n');
    console.log(reportPhase());
    try {
      const snap = JSON.parse(readFileSync(resolve(ROOT, 'data/sacred-history-W.json'), 'utf8'));
      const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
      const mem = GiftMemory.fromSnapshot(snap);
      console.log('\nМатрица W:');
      console.log(`  Лиц: ${mem.n} | Актов: ${mem.actsCount}`);
      for (const e of mem.heaviest(3)) {
        console.log(`  ${e.from}→${e.to}: ${e.weight.toFixed(1)}`);
      }
      console.log('\nΘέωσις топ 3:');
      for (const p of mem.ontologicalStatus().slice(0, 3)) {
        console.log(`  ${p.personId}: ${p.level} (${p.index.toFixed(3)})`);
      }
    } catch { /* graceful */ }
    console.log();
  } else {
    // Показать текущую фазу
    console.log('\n' + reportPhase() + '\n');
    console.log('Все фазы:');
    const now = new Date();
    for (const p of PHASES) {
      const { phase } = currentPhase(now);
      const active = p.id === phase.id ? ' ◄ СЕЙЧАС' : '';
      console.log(`  ${p.icon} ${p.id.padEnd(14)} ${p.cron}${active}`);
    }
    console.log();
  }
}
