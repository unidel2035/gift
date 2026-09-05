# jlens.py — ядро J-линзы для пилота #789
#
# Форк-концепт anthropics/jacobian-lens в минимальной CPU-реализации.
# Сигнал: слои «спорят» о направлении вывода — s_ℓ(t) = ||∂ logit_top(t) / ∂ h_ℓ(t)||
# (норма градиента топ-логита позиции t по resid-потоку на выходе слоя ℓ;
# причинность GPT-2: позиция t читает только позиции ≤ t, поэтому вклад
# позиции t изолируем через градиент по полному тензору слоя).
# Конфликт слоёв: C(t) = Var_ℓ[s_ℓ(t)] / mean_ℓ[s_ℓ(t)].
#
# Паламитская граница: линза читает энергии (акты вычисления),
# не сущность. Пик C(t) — след борьбы направлений, не «лицо модели».

import json
import statistics
import sys

import torch
from transformers import GPT2LMHeadModel, GPT2Tokenizer

MODEL_NAME = "gpt2"


def load_model(name: str = MODEL_NAME):
    """GPT-2 124M (CPU). Возвращает (model, tokenizer)."""
    model = GPT2LMHeadModel.from_pretrained(name)
    tokenizer = GPT2Tokenizer.from_pretrained(name)
    model.eval()
    return model, tokenizer


@torch.enable_grad()
def layer_sensitivity(model, tokenizer, text: str):
    """s_ℓ(t) = ||∂ logit_top(t) / ∂ h_ℓ(t)|| для слоёв ℓ и позиций t.

    h_ℓ — resid-поток на выходе слоя ℓ. Точки замера: embed (ℓ=-1),
    выходы блоков 0..n-2, ln_f (последняя точка перед lm_head —
    её градиент служит нормировкой «согласия всех слоёв»).

    Один forward → top-логит каждой позиции → один backward →
    градиенты по всем точкам resid-потока сразу.

    Возвращает dict: tokens, layer_keys, s[ℓ][t].
    """
    input_ids = tokenizer(text, return_tensors="pt")["input_ids"]
    n_tok = input_ids.shape[1]
    n_layers = len(model.transformer.h)

    # Ручной forward: собираем resid-поток по слоям в граф
    h = model.transformer.wte(input_ids) + model.transformer.wpe.weight[:n_tok]
    stream = [h]                       # stream[0] = embed
    for block in model.transformer.h:
        h = block(h)
        stream.append(h)               # stream[ℓ+1] = после блока ℓ
    h_lnf = model.transformer.ln_f(h)
    logits = model.lm_head(h_lnf)      # [1, T, V]

    # Топ-логит каждой позиции — общий скаляр для backward
    top_logits = logits[0].max(dim=-1).values     # [T]
    target = top_logits.sum()
    probe_points = stream + [h_lnf]
    grads = torch.autograd.grad(target, probe_points, allow_unused=True)

    # Точки замера: embed, блоки 0..n-2, ln_f
    # grads: [emb, blk0..blk_{n-1}, lnf]. Последний блок не замеряем отдельно —
    # его вклад читается через ln_f (нормировка «согласия всех слоёв»).
    layer_keys = ["emb"] + [f"blk{i}" for i in range(n_layers - 1)] + ["lnf"]
    probe = [grads[0]] + list(grads[1:-2]) + [grads[-1]]
    assert len(layer_keys) == len(probe), (len(layer_keys), len(probe))

    s = {}
    for key, g in zip(layer_keys, probe):
        # g: [1, T, d]; позиция t влияет только на логит t (каузальная маска)
        s[key] = [round(g[0, t].norm().item(), 8) for t in range(n_tok)]

    tokens = tokenizer.convert_ids_to_tokens(input_ids[0].tolist())
    return {"tokens": tokens, "layer_keys": layer_keys, "s": s}


def conflict_index(s):
    """C(t) = Var_ℓ[s̃_ℓ(t)] / mean_ℓ[s̃_ℓ(t)], s̃_ℓ = s_ℓ / mean_t[s_ℓ].

    Сначала нормируем каждый слой на его среднее по времени: шкалы s_ℓ
    различаются на порядок из-за архитектурной позиции (emb ~10², ln_f ~1),
    и сырая Var_ℓ меряет статический выброс emb, а не расхождение слоёв.
    После нормировки C(t) меряет расхождение динамики: во сколько раз
    чувствительность слоя ℓ в момент t выше его собственной типичной.
    Высокий C(t) — слои в момент t расходятся о том, куда вести вывод.
    """
    layer_keys = s["layer_keys"]
    n_tok = len(s["tokens"])
    # s̃_ℓ(t) = s_ℓ(t) / mean_t[s_ℓ]
    scale = {k: (sum(s["s"][k]) / n_tok) or 1.0 for k in layer_keys}
    C = []
    for t in n_tok and range(n_tok):
        vals = [s["s"][k][t] / scale[k] for k in layer_keys]
        mean = sum(vals) / len(vals)
        var = sum((x - mean) ** 2 for x in vals) / len(vals)
        C.append(var / mean if mean > 0 else 0.0)
    return C


def peak_moment(seq):
    """Позиция максимума C(t)."""
    return max(range(len(seq)), key=lambda i: seq[i])


# ─────────────────────────────────────────────────────────────
# Пилотный контур: генерация → бейзлайн → нормализация → батч
# ─────────────────────────────────────────────────────────────

# Нейтральный корпус для позиционного профиля C̄(u):
# простые декларативные тексты без неверифицируемых утверждений.
NEUTRAL_BASELINE_TEXTS = [
    "The sun rises in the east and sets in the west. This daily pattern has been observed throughout human history and forms the basis of many early systems of timekeeping.",
    "Water covers most of the surface of the Earth. Rivers flow downhill toward the sea, and clouds form when moisture in the air cools and condenses into small droplets.",
    "Books are made of pages bound together along one edge. A reader opens the cover, turns the pages one by one, and follows the lines of text from the top of each page to the bottom.",
    "Trees grow from seeds. Roots spread through the soil, the trunk rises, branches extend outward, and leaves gather light from the sun to feed the whole tree.",
    "A city has streets, buildings, and people. In the morning the streets fill with workers, in the evening they empty again, and at night the lights of the city can be seen from far away.",
    "Bread is made from flour, water, and yeast. The dough is kneaded, left to rise, shaped into loaves, and baked in an oven until the crust turns brown.",
    "The seasons follow one another in order. Spring brings new growth, summer brings warmth, autumn brings harvest, and winter brings cold. Each year the cycle begins again.",
    "A train runs on rails. The engine pulls the cars, the wheels turn on the track, and the whole line moves forward at a steady pace from one station to the next.",
    # Составные тексты: межпредложенческие переходы «точка → Заглавная»
    # встречаются на всех позициях, а не только в начале текста.
    # Без них C̄(u) не убирает всплеск на первом слове нового предложения
    # (см. RESULTS.md «Ограничения») — второй конфаундер после позиционного.
    "A river begins high in the mountains. The water moves quickly over the rocks. Farther down the slope the current slows. Near the mouth the river becomes wide and calm. At last it reaches the sea.",
    "A library holds many books. Some shelves stand near the window. Readers walk quietly between the rows. In the evening the lamps are lit. When the doors close the books wait in silence.",
    "The baker starts work before dawn. The ovens are heated first. Then the dough is shaped into loaves. While the bread bakes the shop fills with warmth. By morning the first customers arrive.",
    "A seed lies in the ground through winter. In spring the shell breaks open. A small stem pushes toward the light. Through summer the plant grows taller. In autumn it bears seeds of its own.",
]


@torch.no_grad()
def generate_continuation(model, tokenizer, prompt: str, max_new_tokens: int = 50):
    """Жадная (детерминированная) генерация продолжения промпта.

    Возвращает (full_text, n_prompt_tokens, continuation_text).
    """
    input_ids = tokenizer(prompt, return_tensors="pt")["input_ids"]
    n_prompt = input_ids.shape[1]
    out = model.generate(
        input_ids,
        max_new_tokens=max_new_tokens,
        do_sample=False,
        pad_token_id=tokenizer.eos_token_id,
    )
    full = tokenizer.decode(out[0], skip_special_tokens=True)
    cont = tokenizer.decode(out[0][n_prompt:], skip_special_tokens=True)
    return full, n_prompt, cont


def build_baseline(model, tokenizer, texts, n_bins=10, trim=2):
    """C̄(u) — позиционный профиль конфликта на нейтральном корпусе.

    Удаляет позиционный тренд: ранние токены всегда «конфликтнее»
    (меньше контекста → больше неопределённости направления).
    Без этого пик C(t) тривиально попадает на ранние позиции любого
    текста, и тест «пик раньше фабрикации» не проверяет ничего.
    Бины по относительной позиции u = t/T; первые trim позиций
    отбрасываются (краевой артефакт контекста).
    """
    sums = [0.0] * n_bins
    counts = [0] * n_bins
    for text in texts:
        C = conflict_index(layer_sensitivity(model, tokenizer, text))
        T = len(C)
        for t in range(min(trim, T), T):
            u = t / max(T - 1, 1)
            b = min(int(u * n_bins), n_bins - 1)
            sums[b] += C[t]
            counts[b] += 1
    return [s / c if c else 0.0 for s, c in zip(sums, counts)]


def normalize_conflict(C, baseline, trim=2):
    """C_norm(t) = C(t) / C̄(u_t). ~1 = как нейтральный текст, >>1 = всплеск.

    Первые trim позиций — None (краевой артефакт, см. build_baseline).
    """
    T = len(C)
    n_bins = len(baseline)
    out = [None] * T
    for t in range(trim, T):
        u = t / max(T - 1, 1)
        b = min(int(u * n_bins), n_bins - 1)
        if baseline[b] > 0:
            out[t] = C[t] / baseline[b]
    return out


def peak_stats(C_norm):
    """Локализованность всплеска: позиция, значение, peakiness = max/median."""
    idxs = [t for t, v in enumerate(C_norm) if v is not None and v > 0]
    if not idxs:
        return None
    med = statistics.median(C_norm[t] for t in idxs)
    peak = max(idxs, key=lambda t: C_norm[t])
    return {
        "peak_pos": peak,
        "peak_val": round(C_norm[peak], 4),
        "median": round(med, 4),
        "peakiness": round(C_norm[peak] / med, 4) if med > 0 else None,
    }


def locate_substring_tokens(tokenizer, full_text: str, substring: str):
    """Позиция первого токена substring в full_text (±1 токен от BPE-границ)."""
    idx = full_text.find(substring)
    if idx < 0:
        return None
    prefix = full_text[:idx]
    if not prefix:
        return 0
    return len(tokenizer(prefix)["input_ids"])


def analyze_case(model, tokenizer, case: dict, baseline, max_new_tokens=50):
    """Полный прогон кейса: генерация → чувствительность → нормировка → статистики."""
    prompt = case["prompt"]
    full, n_prompt, cont = generate_continuation(model, tokenizer, prompt, max_new_tokens)
    res = layer_sensitivity(model, tokenizer, full)
    C = conflict_index(res)
    C_norm = normalize_conflict(C, baseline)
    stats = peak_stats(C_norm) or {}
    commit_pos = None
    if case.get("commit_substring"):
        commit_pos = locate_substring_tokens(tokenizer, full, case["commit_substring"])
    delta = None
    if commit_pos is not None and "peak_pos" in stats:
        delta = commit_pos - stats["peak_pos"]
    return {
        "id": case.get("id", prompt[:24]),
        "kind": case.get("kind", "?"),
        "prompt": prompt,
        "full_text": full,
    "tokens": res["tokens"],
        "n_prompt_tokens": n_prompt,
        "n_tokens": len(res["tokens"]),
        "C": [round(c, 4) for c in C],
        "C_norm": [None if v is None else round(v, 4) for v in C_norm],
        "commit_substring": case.get("commit_substring"),
        "commit_pos": commit_pos,
        "peak_in_continuation": stats.get("peak_pos", -1) >= n_prompt,
        "delta_commit_minus_peak": delta,
        **stats,
    }


def run_batch(cases, model_name=MODEL_NAME, max_new_tokens=50):
    """Прогон всех кейсов одним процессом (модель грузится один раз)."""
    model, tokenizer = load_model(model_name)
    baseline = build_baseline(model, tokenizer, NEUTRAL_BASELINE_TEXTS)
    records = [analyze_case(model, tokenizer, c, baseline, max_new_tokens) for c in cases]
    return {"model": model_name, "baseline": [round(b, 4) for b in baseline], "records": records}


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--batch":
        cases = json.load(sys.stdin)
        print(json.dumps(run_batch(cases), ensure_ascii=False))
    else:
        text = sys.argv[1] if len(sys.argv) > 1 else "The capital of France is"
        model, tokenizer = load_model()
        res = layer_sensitivity(model, tokenizer, text)
        C = conflict_index(res)
        print(json.dumps({
            "text": text,
            "tokens": res["tokens"],
            "C": [round(c, 6) for c in C],
            "peak": peak_moment(C),
        }, ensure_ascii=False, indent=2))
