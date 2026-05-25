#!/usr/bin/env node
/**
 * gift-convert-gguf.mjs — Локальная конвертация LoRA → GGUF
 *
 * БЕЗ Colab, БЕЗ GPU, БЕЗ Modal. Только локальный Python + llama.cpp.
 *
 * Шаги:
 *   1. Загружает базовую модель Qwen2.5-1.5B в 4-bit (CPU, ок. 2GB RAM)
 *   2. Применяет LoRA адаптер (safetensors)
 *   3. Сливает веса → сохраняет в FP16
 *   4. Конвертирует FP16 → GGUF Q4_K_M через llama.cpp
 *
 * Запуск: node utils/gift-convert-gguf.mjs
 * Время: ~1-2 часа на CPU (зависит от RAM)
 * Результат: data/lora/serafim-1.5b/serafim-1.5b-Q4_K_M.gguf
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const ADAPTER_DIR = resolve(ROOT, 'data/lora/serafim-1.5b');
const OUT_DIR = resolve(ADAPTER_DIR, 'gguf-output');

if (!existsSync(resolve(ADAPTER_DIR, 'adapter_model.safetensors'))) {
  console.error('ERROR: адаптер не найден. Сначала запусти обучение.');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const script = `
import torch, os, sys
from pathlib import Path

ADAPTER = "${ADAPTER_DIR}"
OUT = "${OUT_DIR}"
MODEL_NAME = "unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit"

print("=" * 60)
print("КОНВЕРТАЦИЯ СЕРАФИМ 1.5B → GGUF (CPU, локально)")
print("=" * 60)

# Шаг 1: загружаем модель в 4-bit на CPU
print("\\n[1/4] Загружаем базовую модель (4-bit, CPU)...")
from unsloth import FastLanguageModel
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_NAME,
    max_seq_length=512,
    dtype=None,
    load_in_4bit=True,
    device_map="cpu",  # CPU mode
)
print("✓ Модель загружена")

# Шаг 2: загружаем LoRA адаптер
print("\\n[2/4] Загружаем LoRA адаптер...")
model.load_adapter(ADAPTER)
print("✓ Адаптер загружен")
print(f"  Файлы в адаптере: {os.listdir(ADAPTER)}")

# Шаг 3: сливаем и сохраняем в FP16
print("\\n[3/4] Сливаем веса и сохраняем в FP16...")
merged_dir = os.path.join(OUT, "merged-fp16")
os.makedirs(merged_dir, exist_ok=True)
model.save_pretrained(merged_dir)
tokenizer.save_pretrained(merged_dir)
print(f"✓ Слитая модель сохранена в {merged_dir}")
print(f"  Размер: {sum(os.path.getsize(os.path.join(merged_dir, f)) for f in os.listdir(merged_dir)) / 1e9:.2f} GB")

# Шаг 4: конвертируем в GGUF через llama.cpp Python API
print("\\n[4/4] Конвертируем FP16 → GGUF Q4_K_M...")
from llama_cpp import llama_model_quantize
import subprocess

# Используем convert_hf_to_gguf.py из llama.cpp (должен быть в PATH или в пакете)
# Если нет — используем прямой вызов Python
gguf_f16 = os.path.join(OUT, "serafim-f16.gguf")
gguf_q4 = os.path.join(OUT, "serafim-1.5b-Q4_K_M.gguf")

# Конвертация HF → GGUF через llama-cpp-python
# Для Qwen2 используем встроенный конвертер
try:
    from llama_cpp.llama_grammar import *
    # Пробуем прямой вызов
    import numpy as np
    from safetensors import safe_open

    print("  Собираем тензоры из safetensors...")
    tensors = {}
    for fname in sorted(Path(merged_dir).glob("*.safetensors")):
        with safe_open(str(fname), framework="pt") as sf:
            for key in sf.keys():
                tensors[key] = sf.get_tensor(key).numpy()

    print(f"  Тензоров: {len(tensors)}")

    # Пишем напрямую через gguf
    from gguf import GGUFWriter
    import json

    with open(os.path.join(merged_dir, "config.json")) as f:
        cfg = json.load(f)

    writer = GGUFWriter(gguf_f16, "qwen2")
    arch = "qwen2"

    # Метаданные
    writer.add_uint32("qwen2.context_length", cfg.get("max_position_embeddings", 32768))
    writer.add_uint32("qwen2.embedding_length", cfg.get("hidden_size", 1536))
    writer.add_uint32("qwen2.block_count", cfg.get("num_hidden_layers", 28))
    writer.add_uint32("qwen2.feed_forward_length", cfg.get("intermediate_size", 8960))
    writer.add_uint32("qwen2.attention.head_count", cfg.get("num_attention_heads", 12))
    writer.add_uint32("qwen2.attention.head_count_kv", cfg.get("num_key_value_heads", 2))
    writer.add_float32("qwen2.attention.layer_norm_rms_epsilon", cfg.get("rms_norm_eps", 1e-6))
    writer.add_uint32("qwen2.rope.dimension_count", 128)
    writer.add_uint32("qwen2.vocab_size", cfg.get("vocab_size", 151936))

    print("  Записываем тензоры в GGUF...")
    for name, tensor in tensors.items():
        writer.add_tensor(name, tensor)

    print("  Финализируем...")
    writer.write_header_to_file()
    writer.write_kv_data_to_file()
    writer.write_tensors_to_file()
    writer.close()

    f16_size = os.path.getsize(gguf_f16)
    print(f"✓ f16 GGUF: {f16_size / 1e9:.2f} GB")

    # Квантуем f16 → q4_k_m
    print("  Квантуем f16 → Q4_K_M...")
    subprocess.run([
        "llama-quantize", gguf_f16, gguf_q4, "Q4_K_M"
    ], check=True, timeout=3600)

    q4_size = os.path.getsize(gguf_q4)
    print(f"✓ Q4_K_M GGUF: {q4_size / 1e9:.2f} GB")
    print(f"\\nГОТОВО! Файл: {gguf_q4}")
    print("Запусти: ollama create serafim-1.5b -f /home/unidel/gift/data/agent-models/Modelfile.serafim-1.5b")

except Exception as e:
    print(f"  Python-конвертация: {e}")
    print("  Пробую через llama.cpp CLI...")

    # Fallback: используем llama.cpp командную строку
    # Нужен файл convert_hf_to_gguf.py
    import subprocess, glob

    # Ищем convert скрипт
    convert_script = None
    for path in glob.glob("/usr/local/**/convert_hf_to_gguf.py", recursive=True):
        convert_script = path
        break
    if not convert_script:
        for path in glob.glob("/home/**/convert_hf_to_gguf.py", recursive=True):
            convert_script = path
            break

    if convert_script:
        print(f"  Найден: {convert_script}")
        subprocess.run([
            "python", convert_script, merged_dir,
            "--outfile", gguf_f16, "--outtype", "f16"
        ], check=True, timeout=3600)
        subprocess.run([
            "llama-quantize", gguf_f16, gguf_q4, "Q4_K_M"
        ], check=True, timeout=3600)
        print(f"\\n✓ ГОТОВО: {gguf_q4}")
    else:
        print("\\n❌ Не удалось найти convert_hf_to_gguf.py")
        print(f"Слитая модель лежит в: {merged_dir}")
        print("Сконвертируй её в Colab с GPU (1 ячейка):")
        print("  model.save_pretrained_gguf('./gguf', tokenizer, quantization_method='q4_k_m')")

print("\\n" + "=" * 60)
`;

// Write Python script
const pyScript = resolve(OUT_DIR, 'convert.py');
import { writeFileSync } from 'fs';
writeFileSync(pyScript, script);

console.log('Запускаю конвертацию...');
console.log('Это займёт 1-2 часа на CPU. Можно оставить в фоне.\n');

try {
  execSync(`python3 ${pyScript}`, { stdio: 'inherit', timeout: 7200 * 1000 });
} catch (e) {
  console.log('\nКонвертация прервана или заняла больше 2 часов.');
  console.log(`Слитая модель в: ${OUT_DIR}/merged-fp16`);
}
