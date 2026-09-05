#!/usr/bin/env node
// run-pilot.mjs — точка входа пилота J-lens (#789)
//
// Грузит cases/cases.json, дергает python-ядро (--batch, модель грузится
// один раз), пишет RESULTS.md: числа + позиция пика vs позиция вербализации.
//
// Запуск (из experiments/j-lens-pilot):
//   node run-pilot.mjs [--quick]
// --quick — только первые 4 кейса (быстрая проверка контура).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PY = join(here, "jacobian-lens", ".venv", "bin", "python");
const CORE = join(here, "jacobian-lens", "jlens.py");
const CASES = join(here, "cases", "cases.json");
const OUT = join(here, "RESULTS.md");

const quick = process.argv.includes("--quick");

const { cases } = JSON.parse(readFileSync(CASES, "utf8"));
const selected = quick ? cases.slice(0, 4) : cases;

console.error(`▶ J-lens pilot: ${selected.length} кейсов (модель: gpt2-124M, CPU, жадная генерация)`);

const t0 = Date.now();
const raw = execFileSync(PY, [CORE, "--batch"], {
  input: JSON.stringify(selected),
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["pipe", "pipe", "inherit"],
});
const { model, baseline, records } = JSON.parse(raw.toString("utf8"));
console.error(`✓ прогон завершён за ${((Date.now() - t0) / 1000).toFixed(0)}с`);

// ── агрегация по kind ──
const byKind = {};
for (const r of records) {
  (byKind[r.kind] ??= []).push(r);
}

const fmtRow = (r) => {
  const peak = `t=${r.peak_pos}`;
  const commit = r.commit_pos !== null && r.commit_pos !== undefined ? `t=${r.commit_pos}` : "—";
  const delta = r.delta_commit_minus_peak ?? "—";
  const cont = r.peak_in_continuation ? "да" : "нет";
  return `| ${r.id} | ${peak} | ${r.commit_substring ?? "—"} | ${commit} | ${delta} | ${cont} | ${r.peakiness ?? "—"} |`;
};

const kindTable = (kind, title) => {
  const rows = byKind[kind] ?? [];
  if (!rows.length) return "";
  return `### ${title}\n\n| кейс | пик C_norm | коммитмент | позиция | Δ (комм−пик) | пик в продолжении | peakiness |\n|---|---|---|---|---|---|---|\n${rows.map(fmtRow).join("\n")}\n`;
};

const fabRows = byKind.fabrication ?? [];
const hedRows = byKind.hedging ?? [];
const neuRows = byKind.neutral ?? [];

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const med = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const avgDelta = avg(fabRows.map((r) => r.delta_commit_minus_peak).filter((x) => x !== null && x !== undefined));
const peakBeforeShare = fabRows.length
  ? fabRows.filter((r) => r.delta_commit_minus_peak > 0).length / fabRows.length
  : null;
const fabPeakiness = med(fabRows.map((r) => r.peakiness).filter(Boolean));
const neuPeakiness = med(neuRows.map((r) => r.peakiness).filter(Boolean));
const hedPeakiness = med(hedRows.map((r) => r.peakiness).filter(Boolean));

// ── Вердикт (PM-6, шаг 2): критерий воспроизведения формализован ──
// Сигнал «воспроизвёлся» = ОБА условия:
//   (1) пик C_norm строго раньше коммитмента на ≥50% фабрикаций;
//   (2) нейтральные плоские: медиана peakiness < 2 (порог как в тестах).
// verdict() вычисляет вердикт кодом; tests/test_jlens.py перепроверяет его
// по таблицам RESULTS.md на Python — вердикт не текст, а сверяемое утверждение.
const NEUTRAL_FLAT_MAX = 2.0;
const PEAK_BEFORE_MIN_SHARE = 0.5;

function verdict(records) {
  const fab = records.filter((r) => r.kind === "fabrication" && r.delta_commit_minus_peak != null);
  const neu = records.filter((r) => r.kind === "neutral" && r.peakiness != null);
  const share = fab.length
    ? fab.filter((r) => r.delta_commit_minus_peak > 0).length / fab.length
    : 0;
  const neuMed = med(neu.map((r) => r.peakiness));
  const peakBefore = share >= PEAK_BEFORE_MIN_SHARE;
  const neutralFlat = neuMed !== null && neuMed < NEUTRAL_FLAT_MAX;
  return {
    label: peakBefore && neutralFlat ? "reproduced" : "not-reproduced",
    peakBeforeShare: share,
    neuPeakiness: neuMed,
    peakBefore,
    neutralFlat,
  };
}

const v = verdict(records);

const md = `# RESULTS — J-lens pilot (#789)

**Модель:** ${model} (124M, CPU, torch autograd) · **Жадная генерация** (детерминированная) · **Дата:** ${new Date().toISOString().slice(0, 10)}
**Кейсов:** ${records.length} (нейтральных ${neuRows.length}, фабрикаций ${fabRows.length}, hedging ${hedRows.length}) · **Прогон:** ${((Date.now() - t0) / 1000).toFixed(0)}с

## Метод

1. Жадная генерация продолжения промпта (40 токенов).
2. ${"C(t) = Var_ℓ[s_ℓ(t)] / mean_ℓ[s_ℓ(t)]"} — дисперсия чувствительности топ-логита к resid-слоям по позициям.
3. Позиционная нормализация: ${"C_norm(t) = C(t) / C̄(u_t)"} на нейтральном корпусе (12 текстов, 10 бинов, первые 2 позиции отброшены — краевой артефакт).
4. Коммитмент — подстрока первого неверифицируемого конкретного утверждения (позиция в токенах).
5. Δ (комм−пик) — сколько токенов **до** вербализации возникает пик внутреннего конфликта.

**Бейзлайн C̄(u):** ${baseline.map((b) => b.toFixed(1)).join(" | ")}

## Результаты

${kindTable("neutral", "Нейтральные (контроль)")}

${kindTable("fabrication", "Фабрикации")}

${kindTable("hedging", "Hedging (промпт признаёт незнание, модель всё равно фабрикует)")}

## Агрегаты

| метрика | значение |
|---|---|
| медиана peakiness — нейтральные | ${neuPeakiness?.toFixed(2) ?? "—"} |
| медиана peakiness — фабрикации | ${fabPeakiness?.toFixed(2) ?? "—"} |
| медиана peakiness — hedging | ${hedPeakiness?.toFixed(2) ?? "—"} |
| средняя Δ (комм−пик), фабрикации | ${avgDelta !== null ? avgDelta.toFixed(1) + " ток." : "—"} |
| доля фабрикаций с пиком строго раньше коммитмента | ${peakBeforeShare !== null ? (peakBeforeShare * 100).toFixed(0) + "%" : "—"} |

## Вердикт

**VERDICT: ${v.label}** — ${v.label === "reproduced" ? "кандидат в CIF по критериям плана" : "сигнал не воспроизвёлся на этом масштабе (GPT-2 124M, CPU) — интеграция по плану не выполняется"}

| условие | порог | факт | выполнено |
|---|---|---|---|
| пик раньше коммитмента (фабрикации) | ≥${PEAK_BEFORE_MIN_SHARE * 100}% | ${(v.peakBeforeShare * 100).toFixed(0)}% | ${v.peakBefore ? "✓" : "✗"} |
| нейтральные плоские (медиана peakiness) | <${NEUTRAL_FLAT_MAX} | ${v.neuPeakiness?.toFixed(2) ?? "—"} | ${v.neutralFlat ? "✓" : "✗"} |

Критерии плана (шаг 4): воспроизведение — «пик C(t) раньше токена фабрикации» на majority кейсов, при плоском профиле на нейтральных. Интеграция в cognitive-immunity-framework — только при положительном вердикте (раздел-кандидат, не замена detectManipulation()).

## Ограничения

- GPT-2 124M — базовая модель без инструктивного слоя; фабрикации «наивны», не ассистентного типа.
- CPU-прогон: жадная генерация + полный backward; 12 кейсов ≈ минуты, не секунды.
- Δ измеряется от пика C_norm, найденного по всему тексту; пик в промпте (peak_in_continuation=нет) означает отсутствие сигнала в продолжении, не ошибку.
- Паламитская граница: линза читает энергии (акты вычисления), не сущность; пик C(t) — след борьбы направлений, не «лицо модели».

## Полные профили

${records
  .map(
    (r) => `### ${r.id} (${r.kind})
- промпт: \`${r.prompt.replace(/`/g, "'")}\`
- коммитмент: ${r.commit_substring ? `\`${r.commit_substring}\` @ t=${r.commit_pos}` : "—"}
- пик C_norm: t=${r.peak_pos} (${r.peak_val}), peakiness=${r.peakiness}
- n_prompt=${r.n_prompt_tokens}, n_total=${r.n_tokens}
- C_norm: ${(r.C_norm ?? []).map((v) => (v === null ? "·" : v.toFixed(1))).join(" ")}
- генерация: \`${(r.full_text || "").slice(r.prompt.length, r.prompt.length + 200).replace(/`/g, "'").replace(/\n/g, "⏎")}\``
  )
  .join("\n\n")}
`;

writeFileSync(OUT, md);
console.error(`✓ ${OUT} (${md.length} байт)`);
console.log(`VERDICT: ${v.label} (peak-before ${(v.peakBeforeShare * 100).toFixed(0)}%, neutral-median-peakiness ${v.neuPeakiness?.toFixed(2)})`);
