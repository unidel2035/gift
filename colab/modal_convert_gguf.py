"""
Онтология Дара — Конвертация LoRA адаптеров в GGUF
====================================================
Использует уже обученные safetensors адаптеры → GGUF q4_k_m

Запуск:
    modal run colab/modal_convert_gguf.py --agent adam
    modal run colab/modal_convert_gguf.py --agent bezalel
    modal run colab/modal_convert_gguf.py --agent eva
    modal run colab/modal_convert_gguf.py --agent serafim
    modal run colab/modal_convert_gguf.py --agent all
"""

import modal
import os
import sys
from pathlib import Path

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "cmake", "build-essential")
    .pip_install(
        "unsloth[colab-new]",
        "trl",
        "datasets",
        "transformers",
        "accelerate",
        "bitsandbytes",
        "torch",
        "torchvision",
        # Зависимости для GGUF конвертации
        "gguf",
        "protobuf",
        "sentencepiece",
        "mistral_common",
    )
    # Предсобираем llama.cpp в /root/llama.cpp — unsloth ищет его там.
    # Используем современные cmake флаги (без устаревшего -DLLAMA_CURL=ON).
    .run_commands(
        "git clone --depth 1 https://github.com/ggerganov/llama.cpp /root/llama.cpp",
        "cd /root/llama.cpp && cmake . -B build -DBUILD_SHARED_LIBS=OFF -DGGML_CUDA=OFF",
        "cd /root/llama.cpp && cmake --build build --config Release -j$(nproc) "
        "--target llama-quantize llama-gguf-split 2>&1 || "
        "cmake --build build --config Release -j$(nproc)",
    )
)

app = modal.App("gift-convert-gguf", image=image)

MODEL_MAP = {
    "adam":    "unsloth/Qwen2.5-3B-Instruct-bnb-4bit",
    "eva":     "unsloth/Qwen2.5-3B-Instruct-bnb-4bit",
    "bezalel": "unsloth/Qwen2.5-3B-Instruct-bnb-4bit",
    "serafim": "unsloth/Qwen2.5-0.5B-Instruct-bnb-4bit",
    "serafim-1.5b": "unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit",
    "all":     "unsloth/Qwen2.5-3B-Instruct-bnb-4bit",
}


@app.function(
    gpu="T4",
    timeout=3600,
    memory=16384,
)
def convert_adapter_to_gguf(agent: str, adapter_zip: bytes) -> bytes:
    """
    Принимает ZIP с safetensors адаптером → возвращает GGUF файл.
    Не требует переобучения — использует уже обученные веса.
    """
    import zipfile, io, tempfile, os, torch

    print(f"=== GGUF конвертация: агент={agent} ===")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    # Распаковываем адаптер
    adapter_dir = f"/tmp/adapter/{agent}"
    os.makedirs(adapter_dir, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(adapter_zip)) as zf:
        zf.extractall(adapter_dir)
        print(f"Адаптер распакован: {zf.namelist()}")

    from unsloth import FastLanguageModel

    # Загружаем базовую модель + применяем адаптер через unsloth нативно
    # (adapter_config.json содержит base_model_name_or_path)
    print(f"Загружаем базовую модель + адаптер из {adapter_dir}...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=adapter_dir,
        max_seq_length=2048,
        dtype=None,
        load_in_4bit=True,
    )
    print("✓ Модель + адаптер загружены")

    # Переключаем в режим инференса (обязательно перед GGUF)
    FastLanguageModel.for_inference(model)

    # Конвертируем в GGUF
    gguf_dir = f"/tmp/gguf/{agent}"
    os.makedirs(gguf_dir, exist_ok=True)
    print("Конвертируем в GGUF (q4_k_m)...")

    import subprocess, builtins

    # Создаём venv с доступом к системным пакетам — uv требует venv для pip install
    venv_path = "/tmp/unsloth_uv_env"
    subprocess.run(["uv", "venv", venv_path, "--system-site-packages"], check=True)
    os.environ["VIRTUAL_ENV"] = venv_path
    os.environ["PATH"] = f"{venv_path}/bin:{os.environ.get('PATH', '')}"
    print(f"✓ venv создан: {venv_path}")

    # Используем Unsloth для мержа весов (это работает), затем вручную конвертируем
    # через уже собранные llama.cpp бинарники (Unsloth-сборка llama.cpp сломана)
    merged_dir = f"/tmp/merged/{agent}"
    os.makedirs(merged_dir, exist_ok=True)
    print("Сохраняем смерженную модель в 16-bit...")
    model.save_pretrained(merged_dir)
    tokenizer.save_pretrained(merged_dir)
    print(f"✓ Модель сохранена в {merged_dir}")

    # Ручная конвертация через llama.cpp с явным указанием модели
    convert_script = "/root/llama.cpp/convert_hf_to_gguf.py"
    if not os.path.exists(convert_script):
        raise RuntimeError(f"convert_hf_to_gguf.py not found at {convert_script}")

    # Убедимся что config.json содержит model_type (нужно для конвертера)
    config_path = os.path.join(merged_dir, "config.json")
    if os.path.exists(config_path):
        import json
        with open(config_path) as f: cfg = json.load(f)
        if "model_type" not in cfg:
            cfg["model_type"] = "qwen2"
            with open(config_path, "w") as f: json.dump(cfg, f)
            print("✓ Добавлен model_type=qwen2 в config.json")

    f16_path = os.path.join(gguf_dir, f"{agent}.gguf")
    print(f"Конвертируем HF → GGUF f16...")
    subprocess.run([
        "python", convert_script, merged_dir,
        "--outfile", f16_path,
        "--outtype", "f16",
    ], check=True)
    print(f"✓ f16 GGUF: {os.path.getsize(f16_path) / 1e9:.2f} GB")

    # Квантуем в q4_k_m
    quantizer = "/root/llama.cpp/build/bin/llama-quantize"
    if not os.path.exists(quantizer):
        import glob
        found = glob.glob("/root/llama.cpp/**/llama-quantize", recursive=True)
        if found: quantizer = found[0]
        else: raise RuntimeError("llama-quantize not found")

    q4_path = os.path.join(gguf_dir, f"{agent}-Q4_K_M.gguf")
    print(f"Квантуем f16 → q4_k_m...")
    subprocess.run([quantizer, f16_path, q4_path, "Q4_K_M"], check=True)
    print(f"✓ Q4_K_M GGUF: {os.path.getsize(q4_path) / 1e9:.2f} GB")

    # Удаляем f16 чтобы не тащить
    os.remove(f16_path)

    # Находим GGUF файл (теперь ищем Q4_K_M)
    gguf_files = [f for f in os.listdir(gguf_dir) if f.endswith('.gguf')]
    if not gguf_files:
        raise RuntimeError(f"GGUF не создан в {gguf_dir}. Файлы: {os.listdir(gguf_dir)}")

    # Предпочитаем q4_k_m
    gguf_file = next((f for f in gguf_files if 'Q4_K_M' in f), gguf_files[0])
    gguf_path = os.path.join(gguf_dir, gguf_file)
    gguf_size = os.path.getsize(gguf_path)
    print(f"✓ GGUF: {gguf_file} ({gguf_size / 1e9:.2f} GB)")

    # Возвращаем GGUF + имя файла в ZIP (чтобы знать как назвать)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:  # STORED — без сжатия (бинарный)
        zf.write(gguf_path, gguf_file)
        zf.writestr("gguf_info.txt", f"agent={agent}\nfile={gguf_file}\nsize_bytes={gguf_size}\n")

    buf.seek(0)
    result = buf.read()
    print(f"✓ ZIP с GGUF: {len(result) / 1e9:.2f} GB")
    return result


@app.local_entrypoint()
def main(agent: str = "adam"):
    here = Path(__file__).parent.parent  # /home/unidel/gift

    agents_to_convert = list(MODEL_MAP.keys()) if agent == "all" else [agent]

    for ag in agents_to_convert:
        lora_dir = here / "data" / "lora" / ag
        adapter_zip_path = lora_dir / f"gift-{ag}-lora.zip"

        if not adapter_zip_path.exists():
            print(f"ERROR: адаптер не найден: {adapter_zip_path}")
            print("Сначала запусти: modal run colab/modal_finetune.py --agent {ag}")
            continue

        adapter_bytes = adapter_zip_path.read_bytes()
        print(f"\nКонвертируем {ag}: {adapter_zip_path} ({len(adapter_bytes) / 1e6:.0f} KB)")
        print("Запускаем на Modal T4 GPU...")

        result_zip = convert_adapter_to_gguf.remote(ag, adapter_bytes)

        # Распаковываем GGUF
        import zipfile, io
        with zipfile.ZipFile(io.BytesIO(result_zip)) as zf:
            info_text = zf.read("gguf_info.txt").decode()
            gguf_filename = None
            for line in info_text.splitlines():
                if line.startswith("file="):
                    gguf_filename = line.split("=", 1)[1]

            if not gguf_filename:
                print(f"ERROR: не удалось определить имя GGUF файла")
                continue

            # Сохраняем с каноническим именем
            canonical_name = f"{ag}-lora.gguf"
            gguf_path = lora_dir / canonical_name
            with open(gguf_path, "wb") as f:
                f.write(zf.read(gguf_filename))
            size = gguf_path.stat().st_size
            print(f"✓ Сохранён: {gguf_path} ({size / 1e9:.2f} GB)")

        # Обновляем Modelfile
        modelfile_path = lora_dir / f"Modelfile.{ag}-lora"
        if modelfile_path.exists():
            content = modelfile_path.read_text()
            # Заменяем закомментированную строку FROM на реальную
            lines = content.splitlines()
            new_lines = []
            from_added = False
            for line in lines:
                if line.startswith("# FROM") or line.startswith("#FROM"):
                    if not from_added:
                        new_lines.append(f"FROM {gguf_path}")
                        from_added = True
                    # пропускаем старую закомментированную строку
                elif line.startswith("FROM ") and "путь" in line:
                    if not from_added:
                        new_lines.append(f"FROM {gguf_path}")
                        from_added = True
                else:
                    new_lines.append(line)

            # Если FROM ещё не добавлен — вставить в начало
            if not from_added:
                new_lines.insert(0, f"FROM {gguf_path}")

            modelfile_path.write_text("\n".join(new_lines) + "\n")
            print(f"✓ Modelfile обновлён: {modelfile_path}")

        # Регистрируем в Ollama
        import subprocess
        print(f"Регистрируем {ag}-lora в Ollama...")
        result = subprocess.run(
            ["ollama", "create", f"{ag}-lora", "-f", str(modelfile_path)],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            print(f"✓ ollama create {ag}-lora — OK")
        else:
            print(f"✗ ollama create {ag}-lora — ОШИБКА:\n{result.stderr}")

    print("\n=== Готово ===")
    print("Тест: ollama run adam-lora 'В матрице W пустыня у bezalel'")
