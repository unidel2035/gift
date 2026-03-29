#!/usr/bin/env python3
"""
LoRA → GGUF конвертер для агентов Онтологии Дара
Использование: python3 utils/lora-to-gguf.py --agent adam [--quant q4_k_m]
"""
import argparse, os, sys, shutil
from pathlib import Path

HF_CACHE = "/mnt/d/hf-cache"
LLAMA_CPP = "/mnt/d/llama.cpp"
GIFT_ROOT = Path(__file__).parent.parent

BASE_MODELS = {
    "adam":    "Qwen/Qwen2.5-3B-Instruct",
    "eva":     "Qwen/Qwen2.5-3B-Instruct",
    "bezalel": "Qwen/Qwen2.5-3B-Instruct",
    "serafim": "Qwen/Qwen2.5-0.5B-Instruct",
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent", required=True, choices=list(BASE_MODELS.keys()))
    parser.add_argument("--quant", default="q4_k_m")
    args = parser.parse_args()

    agent = args.agent
    lora_dir = GIFT_ROOT / "data" / "lora" / agent
    merged_dir = Path(f"/mnt/d/gift-merged/{agent}")
    gguf_out = GIFT_ROOT / "data" / "lora" / agent / f"{agent}-lora.gguf"

    os.environ["HF_HOME"] = HF_CACHE
    os.makedirs(HF_CACHE, exist_ok=True)
    os.makedirs(merged_dir, exist_ok=True)

    if not lora_dir.exists() or not (lora_dir / "adapter_config.json").exists():
        print(f"✗ LoRA адаптер не найден: {lora_dir}")
        sys.exit(1)

    print(f"\n=== Агент: {agent} ===")
    print(f"LoRA: {lora_dir}")
    print(f"Base: {BASE_MODELS[agent]}")

    # 1. Скачать базовую модель
    print("\n[1/3] Скачиваем базовую модель...")
    from huggingface_hub import snapshot_download
    base_path = snapshot_download(
        repo_id=BASE_MODELS[agent],
        cache_dir=HF_CACHE,
        ignore_patterns=["*.msgpack", "*.h5", "flax_model*", "tf_model*"],
    )
    print(f"✓ Базовая модель: {base_path}")

    # 2. Слить LoRA с базовой моделью
    print("\n[2/3] Сливаем LoRA с базовой моделью...")
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    print("  Загружаем базовую модель...")
    tokenizer = AutoTokenizer.from_pretrained(base_path, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        base_path,
        torch_dtype=torch.float16,
        device_map="cpu",
        trust_remote_code=True,
    )
    print("  Загружаем LoRA адаптер...")
    model = PeftModel.from_pretrained(model, str(lora_dir))
    print("  Сливаем и выгружаем...")
    model = model.merge_and_unload()
    model.save_pretrained(str(merged_dir), safe_serialization=True)
    tokenizer.save_pretrained(str(merged_dir))
    print(f"✓ Merged модель: {merged_dir}")

    # 3. Конвертировать в GGUF
    print(f"\n[3/3] Конвертируем в GGUF ({args.quant})...")
    import subprocess
    convert_script = f"{LLAMA_CPP}/convert_hf_to_gguf.py"
    fp16_gguf = merged_dir / f"{agent}-fp16.gguf"

    result = subprocess.run([
        sys.executable, convert_script,
        str(merged_dir),
        "--outfile", str(fp16_gguf),
        "--outtype", "f16",
    ], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"✗ Конвертация провалилась:\n{result.stderr}")
        sys.exit(1)
    print(f"✓ fp16 GGUF: {fp16_gguf}")

    # Квантизация
    quantize_bin = f"{LLAMA_CPP}/build/bin/llama-quantize"
    if os.path.exists(quantize_bin):
        print(f"  Квантизируем {args.quant}...")
        result2 = subprocess.run([
            quantize_bin, str(fp16_gguf), str(gguf_out), args.quant.upper()
        ], capture_output=True, text=True)
        if result2.returncode == 0:
            fp16_gguf.unlink()
            print(f"✓ Квантизированный GGUF: {gguf_out}")
        else:
            shutil.move(str(fp16_gguf), str(gguf_out))
            print(f"  (квантизатор недоступен, оставляем fp16)")
    else:
        shutil.move(str(fp16_gguf), str(gguf_out))
        print(f"  (llama-quantize не собран, оставляем fp16)")
        print(f"  Собери: cd /mnt/d/llama.cpp && cmake -B build && cmake --build build -j")

    # Обновить Modelfile
    modelfile_path = lora_dir / f"Modelfile.{agent}-lora"
    if modelfile_path.exists():
        content = modelfile_path.read_text()
        if content.startswith("#"):
            lines = content.split("\n")
            lines[0] = f"FROM {gguf_out}"
            lines[1] = ""
            modelfile_path.write_text("\n".join(lines))
            print(f"✓ Modelfile обновлён: {modelfile_path}")

    print(f"""
=== Готово ===
ollama create {agent}-lora -f {modelfile_path}
ollama run {agent}-lora "тест"
""")

if __name__ == "__main__":
    main()
