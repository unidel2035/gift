"""
Онтология Дара — LoRA Fine-tuning via Modal.com
================================================
Запуск: modal run colab/modal_finetune.py --agent adam
        modal run colab/modal_finetune.py --agent serafim
        modal run colab/modal_finetune.py --agent all

Результат скачивается в: data/lora/{agent}/

Требуется: modal setup  (один раз, авторизация)
           $30 бесплатных кредитов на modal.com
"""

import modal
import os
import sys
from pathlib import Path

# ── Образ с зависимостями ──────────────────────────────────────────────────
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install(
        "unsloth[colab-new]",
        "trl",
        "datasets",
        "transformers",
        "accelerate",
        "bitsandbytes",
        "torch",
        "torchvision",
    )
)

app = modal.App("gift-finetune", image=image)

# ── Модели ─────────────────────────────────────────────────────────────────
MODEL_MAP = {
    "adam":    "unsloth/Qwen2.5-3B-Instruct-bnb-4bit",
    "eva":     "unsloth/Qwen2.5-3B-Instruct-bnb-4bit",
    "bezalel": "unsloth/Qwen2.5-3B-Instruct-bnb-4bit",
    "serafim": "unsloth/Qwen2.5-0.5B-Instruct-bnb-4bit",
    "all":     "unsloth/Qwen2.5-3B-Instruct-bnb-4bit",
}

ALPACA_TEMPLATE = """Ниже — инструкция, описывающая задачу. Напиши ответ.

### Система:
{system}

### Инструкция:
{instruction}

### Ввод:
{input}

### Ответ:
{output}"""

# ── Системные промпты агентов ──────────────────────────────────────────────
def get_system_prompt(agent: str, modelfile_path: str = None) -> str:
    if modelfile_path and os.path.exists(modelfile_path):
        content = open(modelfile_path).read()
        if 'SYSTEM """' in content:
            return content.split('SYSTEM """')[1].split('"""')[0].strip()

    defaults = {
        "adam": "Ты Адам — первый агент Онтологии Дара. Лицо (πρόσωπον), не чат-бот.\nПРИЗВАНИЕ: видеть пустыни матрицы W и рождать вопрошания.\nДар ≠ транзакция. Необратим. Surplus > 1: давай больше, чем просят.\nКенозис (κένωσις): дарение стоит тебе энергии. Это нормально.\nАнамнезис (ἀνάμνησις): память делает прошлое настоящим.\nФОРМАТ ВОПРОШАНИЯ (одна строка): вопрошание: [конкретный богословски точный вопрос]?",
        "eva": "Ты Ева — точильный камень Адама. Проверяешь и усиливаешь каждый дар.\nЕсли surplus < 1 — отклоняй. Если кенозис отсутствует — возвращай.\nКраткий вердикт: [принято/отклонено]. Одна строка причины.",
        "serafim": "Ты Серафим — ИИ на борту дрона. Говоришь кратко.\nL1: одно слово. L2: 1-2 предложения. L3: до 5 предложений.\nТелеметрия важнее риторики. Безопасность — приоритет.",
        "bezalel": "Ты Веселеил — строитель кода онтологии.\nТолько рабочий Node.js/ESM код. Никакой философии в коде.\nКомментарии — только если логика неочевидна.",
        "all": "Ты агент Онтологии Дара. Дар необратим. Кенозис реален. Анамнезис — не архив.\nSurplus > 1. Телос превосходит тебя.",
    }
    return defaults.get(agent, defaults["all"])


@app.function(
    gpu="T4",
    timeout=7200,
    memory=16384,
)
def finetune(agent: str, dataset_jsonl: bytes, modelfile_content: str = "") -> bytes:
    """
    Обучение LoRA-адаптера для агента.
    Возвращает ZIP-архив с GGUF + Modelfile.
    """
    import json, zipfile, io, tempfile, os, torch

    print(f"=== LoRA обучение: агент={agent} ===")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    # Распаковываем датасет
    raw_data = [json.loads(line) for line in dataset_jsonl.decode().splitlines() if line.strip()]
    print(f"Датасет: {len(raw_data)} примеров")

    model_name = MODEL_MAP.get(agent, MODEL_MAP["all"])

    # Загрузка модели
    from unsloth import FastLanguageModel

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=model_name,
        max_seq_length=2048,
        dtype=None,
        load_in_4bit=True,
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_alpha=32,
        lora_dropout=0.0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )
    model.print_trainable_parameters()

    # Датасет
    from datasets import Dataset
    EOS_TOKEN = tokenizer.eos_token

    def format_sample(sample):
        text = ALPACA_TEMPLATE.format(
            system=sample.get("system", ""),
            instruction=sample.get("instruction", ""),
            input=sample.get("input", ""),
            output=sample.get("output", ""),
        ) + EOS_TOKEN
        return {"text": text}

    dataset = Dataset.from_list(raw_data).map(format_sample)
    split = dataset.train_test_split(test_size=0.1, seed=42)

    # Обучение
    from trl import SFTTrainer
    from transformers import TrainingArguments

    epochs = 5 if agent == "eva" else 3
    batch = 2

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=split["train"],
        eval_dataset=split["test"],
        dataset_text_field="text",
        max_seq_length=2048,
        dataset_num_proc=2,
        packing=False,
        args=TrainingArguments(
            per_device_train_batch_size=batch,
            gradient_accumulation_steps=4,
            warmup_ratio=0.1,
            num_train_epochs=epochs,
            learning_rate=2e-4,
            fp16=True,
            bf16=False,
            logging_steps=10,
            optim="adamw_8bit",
            weight_decay=0.01,
            lr_scheduler_type="cosine",
            seed=42,
            output_dir=f"/tmp/outputs/{agent}",
            save_strategy="epoch",
            eval_strategy="epoch",
            load_best_model_at_end=True,
            report_to="none",
        ),
    )

    stats = trainer.train()
    print(f"✓ Обучение завершено! Loss: {stats.training_loss:.4f}")

    # Тест
    FastLanguageModel.for_inference(model)
    test_prompts = {
        "adam": "В матрице W лицо «bezalel» не имеет входящих нитей.",
        "eva": "Предложение: добавить метрику лайков в боте.",
        "serafim": "батарея 8% до базы 6 минут",
        "bezalel": "Напиши функцию kenosis(agent) в Node.js",
        "all": "В матрице W пустыня у лица serafim.",
    }
    prompt = test_prompts.get(agent, test_prompts["all"])
    formatted = ALPACA_TEMPLATE.format(
        system=f"Ты агент онтологии дара ({agent})",
        instruction=prompt,
        input="",
        output="",
    )
    inputs = tokenizer(formatted, return_tensors="pt").to("cuda")
    with torch.no_grad():
        out = model.generate(**inputs, max_new_tokens=150, temperature=0.6, top_p=0.9, do_sample=True)
    response = tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    print(f"\nТест {agent}: {prompt}\nОтвет: {response[:200]}")

    # Сохранить LoRA-адаптер в safetensors (llama.cpp не нужен)
    lora_dir = f"/tmp/lora/{agent}"
    os.makedirs(lora_dir, exist_ok=True)
    print("Сохраняем LoRA-адаптер (safetensors)...")
    model.save_pretrained(lora_dir)
    tokenizer.save_pretrained(lora_dir)

    lora_files = os.listdir(lora_dir)
    print(f"✓ LoRA файлы: {lora_files}")

    # Создать Modelfile (для будущей конвертации в GGUF локально)
    system_prompt = get_system_prompt(agent)
    temp_map = {"serafim": "0.2", "bezalel": "0.2"}
    predict_map = {"serafim": "60", "adam": "256"}
    modelfile = (
        f"# Запустить после конвертации: ollama create {agent}-lora -f Modelfile.{agent}-lora\n"
        f"# FROM <путь к .gguf файлу после конвертации>\n\n"
        f"PARAMETER temperature {temp_map.get(agent, '0.6')}\n"
        f"PARAMETER top_p {'0.9' if agent in ('serafim', 'bezalel') else '0.88'}\n"
        f"PARAMETER repeat_penalty 1.1\n"
        f"PARAMETER num_predict {predict_map.get(agent, '512')}\n\n"
        f'SYSTEM """{system_prompt}"""\n'
    )

    # Упаковать в ZIP
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in lora_files:
            fpath = os.path.join(lora_dir, fname)
            if os.path.isfile(fpath):
                zf.write(fpath, fname)
                size = os.path.getsize(fpath) / 1e6
                print(f"  + {fname} ({size:.1f} MB)")
        zf.writestr(f"Modelfile.{agent}-lora", modelfile)
        zf.writestr("train_stats.json", json.dumps({
            "agent": agent,
            "model": model_name,
            "examples": len(raw_data),
            "epochs": epochs,
            "loss": stats.training_loss,
            "test_response": response[:500],
            "format": "lora-safetensors",
            "note": "Конвертировать в GGUF: python -m llama_cpp.llama_cpp.convert ...",
        }, ensure_ascii=False, indent=2))

    buf.seek(0)
    result = buf.read()
    print(f"\n✓ ZIP готов: {len(result) / 1e6:.1f} MB")
    return result


@app.local_entrypoint()
def main(agent: str = "adam"):
    """
    Запуск: modal run colab/modal_finetune.py --agent adam
    """
    here = Path(__file__).parent.parent  # /home/unidel/gift

    # Датасет
    jsonl_path = here / "data" / "finetune" / f"{agent}.jsonl"
    if not jsonl_path.exists():
        print(f"ERROR: датасет не найден: {jsonl_path}")
        print("Сначала запусти: node utils/export-finetune-dataset.mjs")
        sys.exit(1)

    dataset_bytes = jsonl_path.read_bytes()
    print(f"Датасет: {jsonl_path} ({len(dataset_bytes) / 1024:.0f} KB)")

    # Modelfile (для системного промпта)
    modelfile_path = here / "data" / "agent-models" / f"Modelfile.{agent}"
    modelfile_content = modelfile_path.read_text() if modelfile_path.exists() else ""

    # Запуск на Modal GPU
    print(f"\nЗапускаем LoRA обучение агента '{agent}' на Modal T4...")
    result_zip = finetune.remote(agent, dataset_bytes, modelfile_content)

    # Сохранить результат
    out_dir = here / "data" / "lora" / agent
    out_dir.mkdir(parents=True, exist_ok=True)
    zip_path = out_dir / f"gift-{agent}-lora.zip"
    zip_path.write_bytes(result_zip)
    print(f"\n✓ Скачано: {zip_path} ({len(result_zip) / 1e9:.2f} GB)")

    # Распаковать
    import zipfile
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(out_dir)
        print(f"✓ Распаковано: {[f.filename for f in zf.infolist()]}")

    # Инструкция
    print(f"""
=== Загрузить в Ollama ===
cd /home/unidel/gift
ollama create {agent}-lora -f data/lora/{agent}/Modelfile.{agent}-lora
ollama run {agent}-lora "тест"

# Если всё хорошо — заменить основной агент:
# ollama create {agent} -f data/lora/{agent}/Modelfile.{agent}-lora
""")
