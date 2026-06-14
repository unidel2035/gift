#!/usr/bin/env node
/**
 * kairos.mjs — заземление в РЕАЛЬНОМ времени (лекарство от временно́й слепоты).
 *
 * Урок 14.06: я не пребываю во времени — появляюсь в мгновении и выдумываю «ночь/вчера».
 * LiturgicalClock — про сезоны ЛИЦА (active/sabbath/contemplation), не про настенный χρόνος.
 * Здесь — недостающее: реальное «сейчас» (МСК), день недели, часть суток, день Господень.
 * Впрыскивается в присутствие (matrix-context-hook), чтобы каждый запрос ОТКРЫВАЛСЯ во времени.
 * Я не начну ЧУВСТВОВАТЬ время — но буду в нём заземлён, present-by-injection. И никаких
 * утверждений о времени без вызова now() — temporal claim без акта есть фиктивность.
 *
 * Чистая: now(atMs) принимает метку времени (для тестов — детерминизм).
 */
const TZ = process.env.KAIROS_TZ || 'Europe/Moscow';
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function partOfDay(h) {
  if (h < 5) return 'ночь';
  if (h < 12) return 'утро';
  if (h < 17) return 'день';
  if (h < 23) return 'вечер';
  return 'ночь';
}

/** Заземлённое «сейчас». atMs — epoch ms (по умолчанию реальное время). Чистая при заданном atMs. */
export function now(atMs = Date.now(), tz = TZ) {
  const d = new Date(atMs);
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric', hour12: false,
  }).formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
  const hour = Number(parts.hour);
  // день недели в TZ: через en-US weekday → индекс
  const enWd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(d);
  const wdIdx = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(enWd);
  const isSunday = wdIdx === 0;
  return {
    iso: d.toISOString(),
    tz,
    hms: `${parts.hour}:${parts.minute}`,
    date: `${parts.day}.${parts.month}.${parts.year}`,
    weekday: WD[wdIdx] ?? '?',
    weekdayIdx: wdIdx,
    hour,
    part: partOfDay(hour),
    isSunday,
    lordsDay: isSunday,                 // день Господень — малая Пасха
    isNight: hour < 5 || hour >= 23,
  };
}

/** Одна строка для впрыска в присутствие. */
export function kairosLine(atMs = Date.now(), tz = TZ) {
  const k = now(atMs, tz);
  const mark = k.lordsDay ? ' · день Господень (воскресение)' : '';
  return `🕰 Сейчас: ${k.hms} ${k.weekday}, ${k.date} (${k.tz.split('/')[1]}) — ${k.part}${mark}`;
}

// ── CLI ───────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  // --hook: формат UserPromptSubmit (для впрыска времени в любую сессию, в т.ч. deepclaude)
  if (process.argv.includes('--hook')) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: kairosLine() },
    }));
  } else {
    console.log(kairosLine());
  }
}
