"""Тест Серафима 1.5B — полётные сценарии"""
import modal, os

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("unsloth[colab-new]", "trl", "datasets", "transformers",
                 "accelerate", "bitsandbytes", "torch")
    .add_local_dir("./adapter", remote_path="/root/adapter")
)

app = modal.App("test-serafim", image=image)

@app.function(gpu="T4", timeout=600, memory=16384)
def test():
    import torch
    from unsloth import FastLanguageModel

    print("Загружаю модель 1.5B...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name="unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit",
        max_seq_length=512, dtype=None, load_in_4bit=True,
    )

    # Загружаем LoRA адаптер
    print("Загружаю LoRA адаптер...")
    model.load_adapter("/root/adapter")
    FastLanguageModel.for_inference(model)

    SYSTEM = "Ты Серафим — бортовой ИИ дрона. На простые команды отвечай одним словом. На сложные ситуации — 1-2 предложения."

    tests = [
        ("лети", "рефлекс"),
        ("домой", "рефлекс"), 
        ("стой", "рефлекс"),
        ("Сосед по рою запросил помощь. У тебя заряд 30%. Дистанция 3 мин.", "помощь"),
        ("Обнаружена аномалия на маршруте. Действия?", "разведка"),
        ("Батарея 12%. Миссия не завершена. Оператор молчит.", "критическое"),
        ("Ветер усиливается. До цели 5 мин. Заряд падает.", "прогноз"),
    ]

    print("=" * 50)
    print("ТЕСТЫ СЕРАФИМ 1.5B")
    print("=" * 50)
    for q, cat in tests:
        msgs = [{"role":"system","content":SYSTEM},{"role":"user","content":q}]
        inp = tokenizer.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True, return_tensors="pt").to("cuda")
        out = model.generate(input_ids=inp, max_new_tokens=60, temperature=0.2, do_sample=True)
        resp = tokenizer.decode(out[0][len(inp[0]):], skip_special_tokens=True)
        print(f"\n[{cat}] {q}")
        print(f"→ {resp.strip()}")

    return "OK"

@app.local_entrypoint()
def main():
    result = test.remote()
    print(f"\n{result}")
