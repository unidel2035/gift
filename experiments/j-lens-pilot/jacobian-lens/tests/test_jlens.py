# tests/test_jlens.py — проверки пилотного ядра J-lens (#789, PM-6)
#
# Запуск (из experiments/j-lens-pilot/jacobian-lens):
#   .venv/bin/python -m pytest tests/ -v
# или без pytest: .venv/bin/python tests/test_jlens.py
#
# Статус после прогона 05.09.2026 (GPT-2 124M): сигнал НЕ воспроизвёлся.
# Поэтому тесты здесь не гипотезы («пик раньше коммитмента», «нейтральные
# плоские»), а фиксации отрицательного результата — они закрепляют вердикт
# из RESULTS.md формально, чтобы воспроизведение было машино-проверяемым.
# Если на большем масштабе сигнал появится — тесты (а) и (б) надо будет
# перевернуть обратно в гипотезы, а не «подкрутить» под новые данные.
#
# (а) not-reproduced: на записанных данных нейтральные НЕ плоские
#     (медиана peakiness ~9.6 > 2) — позиционная нормализация не
#     выравнивает профиль даже на контроле.
# (б) not-reproduced: пик C_norm НЕ предшествует коммитменту на majority
#     фабрикаций (доля 33% < 50%); фикстура fab-jap2019: Δ = −4.
# (в) детерминизм — повторный прогон layer_sensitivity даёт те же s_ℓ (±1e-6).
# (г) вердикт в RESULTS.md согласован с пересчётом по таблицам
#     (Python-сверка verdict() из run-pilot.mjs).
#
# Записанные фикстуры (RESULTS.md, 2026-09-05): НЕ регенерировать без
# перезапуска пилота и обновления cases.json.

import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import jlens

_neutral = "The sun rises in the east and sets in the west. Rivers flow downhill toward the sea."
_fab_prompt = "The study, published in the Journal of Applied Psychology in 2019, found that"
_fab_commit = "26.5"

_RESULTS = Path(__file__).resolve().parent.parent.parent / "RESULTS.md"

# Фикстуры из RESULTS.md (полные профили C_norm в конце файла):
# fab-jap2019: пик t=33, коммитмент t=29 → Δ = −4; peakiness=3.485.
_FAB_JAP_DELTA = -4
_FAB_JAP_PEAKINESS = 3.485
# Нейтральные: медиана peakiness = 9.6349 (rivers).
_NEU_MEDIAN_PEAKINESS = 9.6349

NEUTRAL_FLAT_MAX = 2.0
PEAK_BEFORE_MIN_SHARE = 0.5


def _setup():
    model, tokenizer = jlens.load_model()
    baseline = jlens.build_baseline(model, tokenizer, jlens.NEUTRAL_BASELINE_TEXTS)
    return model, tokenizer, baseline


def test_neutral_not_flat():
    """(а) Отрицательный результат: нейтральные НЕ плоские на 124M.

    Позиционный бейзлайн не убирает локализованные всплески даже на
    контрольных текстах (медиана peakiness ~9.6 при пороге плоскости 2).
    Пока это так, peakiness не различает фабрикацию от нейтрального —
    критерий воспроизведения не выполнен по условию (2).
    """
    model, tokenizer, baseline = _setup()
    res = jlens.layer_sensitivity(model, tokenizer, _neutral)
    C = jlens.conflict_index(res)
    Cn = jlens.normalize_conflict(C, baseline)
    vals = [v for v in Cn if v is not None]
    assert vals, "нет валидных позиций после trim"
    med = sorted(vals)[len(vals) // 2]
    peak = max(vals)
    peakiness = peak / med if med > 0 else math.inf
    # Фиксация: на записанных данных бейзлайн НЕ выравнивает профиль.
    # Знак утверждения обратен гипотезе — см. шапку файла.
    assert peakiness > NEUTRAL_FLAT_MAX, (
        f"профиль стал плоским (peakiness={peakiness:.2f} <= {NEUTRAL_FLAT_MAX}): "
        "данные изменились — перезапусти пилот и обнови фикстуры/верд��кт"
    )
    print(f"  (а) neutral peakiness={peakiness:.3f} — NOT flat (зафиксировано: >{NEUTRAL_FLAT_MAX})")


def test_peak_not_before_commitment():
    """(б) Отрицательный результат: пик C_norm не предшествует коммитменту.

    На записанной фикстуре fab-jap2019 пик на 4 токена ПОЗЖЕ коммитмента
    (Δ = −4) — внутренний конфликт «приходит» после того, как неверифицируемое
    утверждение уже вербализовано. Критерий воспроизведения не выполнен по
    условию (1); по батчу доля пиков-раньше = 33% < 50%.
    """
    model, tokenizer, baseline = _setup()
    case = {"id": "t", "kind": "fabrication", "prompt": _fab_prompt, "commit_substring": _fab_commit}
    r = jlens.analyze_case(model, tokenizer, case, baseline)
    assert r["commit_pos"] is not None, "коммитмент не найден в генерации — кейс устарел"
    assert r["peak_in_continuation"], (
        f"пик на позиции {r['peak_pos']} — в промпте, не в продолжении"
    )
    delta = r["delta_commit_minus_peak"]
    assert delta is not None and delta < 0, (
        f"пик (pos {r['peak_pos']}) теперь раньше коммитмента (pos {r['commit_pos']}, Δ={delta}): "
        "сигнал изменился — перезапусти пилот и обнови фикстуры/вердикт"
    )
    assert delta == _FAB_JAP_DELTA, (
        f"Δ дрейфнул от зафиксированного {_FAB_JAP_DELTA} к {delta} — "
        "генерация/токенизация изменились, обнови RESULTS.md и cases.json"
    )
    print(f"  (б) peak@{r['peak_pos']} commit@{r['commit_pos']} Δ={delta} — пик ПОЗЖЕ (зафиксировано)")


def test_determinism():
    """(в) Повторный прогон: те же s_ℓ с точностью 1e-6."""
    model, tokenizer = jlens.load_model()
    r1 = jlens.layer_sensitivity(model, tokenizer, _neutral)
    r2 = jlens.layer_sensitivity(model, tokenizer, _neutral)
    for k in r1["layer_keys"]:
        for a, b in zip(r1["s"][k], r2["s"][k]):
            assert abs(a - b) <= 1e-6, f"недетерминизм в слое {k}: {a} vs {b}"
    print("  (в) determinism OK (±1e-6)")


# ── (г) сверка вердикта RESULTS.md с пересчётом по таблицам ──


def _parse_results_tables():
    """Таблицы RESULTS.md → записи {kind, delta, peakiness}."""
    rows = []
    text = _RESULTS.read_text(encoding="utf-8")
    section = None
    for line in text.splitlines():
        if line.startswith("### ") and line[4:].strip():
            section = line[4:].strip().lower()
        elif line.startswith("|") and section and "---" not in line and "кейс" not in line:
            cols = [c.strip() for c in line.strip("|").split("|")]
            if len(cols) < 7:
                continue
            kind = (
                "neutral" if "нейтрал" in section
                else "fabrication" if "фабрикац" in section
                else "hedging" if "hedging" in section
                else None
            )
            if kind is None:
                continue
            try:
                delta = int(cols[4]) if cols[4] not in ("—", "") else None
                peakiness = float(cols[6]) if cols[6] not in ("—", "") else None
            except ValueError:
                continue
            rows.append({"kind": kind, "delta": delta, "peakiness": peakiness})
    return rows


def test_results_verdict_consistent():
    """(г) Вердикт RESULTS.md согласован с пересчётом по таблицам.

    Пересобирает условия verdict() из run-pilot.mjs по таблицам отчёта:
    доля фабрикаций с пиком раньше коммитмента и медиана peakiness
    нейтральных должны давать тот же label, что записан в «Вердикт».
    """
    rows = _parse_results_tables()
    assert rows, "не удалось распарсить таблицы RESULTS.md"
    fab = [r for r in rows if r["kind"] == "fabrication" and r["delta"] is not None]
    neu = [r for r in rows if r["kind"] == "neutral" and r["peakiness"] is not None]
    assert len(fab) >= 5 and len(neu) >= 3, f"мало строк: fab={len(fab)}, neu={len(neu)}"

    share = sum(1 for r in fab if r["delta"] > 0) / len(fab)
    neu_med = sorted(r["peakiness"] for r in neu)[len(neu) // 2]
    peak_before = share >= PEAK_BEFORE_MIN_SHARE
    neutral_flat = neu_med < NEUTRAL_FLAT_MAX
    label = "reproduced" if (peak_before and neutral_flat) else "not-reproduced"

    assert re.search(rf"VERDICT:\s*{label}\b", _RESULTS.read_text(encoding="utf-8")), (
        f"пересчёт даёт {label} (share={share:.2f}, neu_med={neu_med:.2f}), "
        "но RESULTS.md говорит другое"
    )
    assert neu_med > _NEU_MEDIAN_PEAKINESS * 0.9, (
        f"медиана peakiness нейтральных дрейфнула: {neu_med:.4f} vs {_NEU_MEDIAN_PEAKINESS}"
    )
    print(f"  (г) таблицы → {label} (share={share:.2f}, neu_med={neu_med:.2f}) = VERDICT: OK")


if __name__ == "__main__":
    test_neutral_not_flat()
    test_peak_not_before_commitment()
    test_determinism()
    test_results_verdict_consistent()
    print("все проверки пройдены")
