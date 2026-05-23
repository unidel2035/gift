#!/usr/bin/env python3
"""
model_lab_bridge.py — мост между дроном и ModelLab (Thinker→Coder)

Архитектура наземной станции:
  Дрон (Serafim V2 Q8) → LoRa-сжатый запрос → ModelLab
    ├── Thinker (R1 8B, :8080) → стратегический план
    └── Coder (CoderV2, :8081)  → инструмент/код для роя

Три режима ModelLab:
  1. THINK — стратегический анализ обстановки
  2. CODE  — написать инструмент для роя (скрипт, адаптер, конвертер)
  3. FULL  — Thinker→Coder→Reviewer полный цикл

Использование:
  bridge = ModelLabBridge()
  result = await bridge.think("Сложная обстановка: 3 цели, РЭБ, ПВО")
  code = await bridge.code("Напиши дешифровщик протокола DJI O3")
"""

import asyncio, json, time, os
from dataclasses import dataclass, field
from typing import Optional, Dict, List
import aiohttp


@dataclass
class ModelLabConfig:
    """Конфигурация ModelLab"""
    model_lab_url: str = "http://127.0.0.1:8501"
    # Cloud GPU (через SSH-туннели) — приоритет при доступности
    thinker_url: str = "http://127.0.0.1:8080/v1/chat/completions"
    coder_url: str = "http://127.0.0.1:8081/v1/chat/completions"
    # Локальные модели (Ollama) — всегда доступны
    thinker_model: str = "deepseek-r1:8b"
    coder_model: str = "deepseek-coder-v2"
    local_thinker: str = "deepseek-r1:8b"
    local_coder: str = "deepseek-coder-v2"
    reviewer_model: str = "deepseek-r1:8b"
    ollama_url: str = "http://127.0.0.1:11434"
    # Режим: "auto" | "local" | "cloud"
    mode: str = "auto"


class ModelLabBridge:
    """
    Мост между боевым дроном и ModelLab.

    Дрон присылает сжатый (через PromptCompressor) запрос.
    ModelLabBridge:
      1. Распаковывает запрос
      2. Выбирает режим (THINK/CODE/FULL)
      3. Отправляет в ModelLab / напрямую в llama-server
      4. Сжимает ответ для отправки дрону
    """

    def __init__(self, config: ModelLabConfig = None):
        self.cfg = config or ModelLabConfig()
        self.stats = {"think": 0, "code": 0, "full": 0, "total_time_s": 0.0}
        self._cloud_available = None  # кеш проверки облака

    async def _check_cloud(self) -> bool:
        """Проверить доступность облачного GPU."""
        if self._cloud_available is not None:
            return self._cloud_available
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    "http://127.0.0.1:8080/health",
                    timeout=aiohttp.ClientTimeout(total=3),
                ) as resp:
                    self._cloud_available = (resp.status == 200)
        except:
            self._cloud_available = False
        return self._cloud_available

    async def _ollama_chat(self, model: str, messages: list,
                           max_tokens: int = 1024,
                           temperature: float = 0.2,
                           timeout: int = 300) -> str:
        """Вызов локальной Ollama-модели (без GPU)."""
        # Собрать промпт из сообщений
        prompt = ""
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            if role == "system":
                prompt += f"<|im_start|>system\n{content}<|im_end|>\n"
            elif role == "user":
                prompt += f"<|im_start|>user\n{content}<|im_end|>\n"
            elif role == "assistant":
                prompt += f"<|im_start|>assistant\n{content}<|im_end|>\n"
        prompt += "<|im_start|>assistant\n"

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.cfg.ollama_url}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens,
                        "top_k": 40,
                        "top_p": 0.9,
                    },
                },
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"Ollama error {resp.status}")
                data = await resp.json()
                return data.get("response", "").strip()

    # ═══════════════════════════════════════════════════════════
    # РЕЖИМ 1: THINK — стратегический анализ
    # ═══════════════════════════════════════════════════════════

    async def think(self, situation: str, context: str = "",
                    timeout: int = 120) -> dict:
        """
        Thinker (R1 8B GPU) анализирует тактическую обстановку.

        Принимает описание ситуации, возвращает стратегический план.
        Используется когда:
          - Сложная обстановка (3+ целей, РЭБ, ПВО)
          - Соборное голосование роя
          - Выбор приоритетов целей
        """
        t0 = time.time()

        system = """Ты — стратегический ИИ боевого роя дронов (КТР).
Твоя задача — анализировать тактическую обстановку и выдавать план действий.

Формат ответа (строго):
  1. ОЦЕНКА: краткая оценка угроз
  2. ПРИОРИТЕТ: список целей по убыванию угрозы
  3. ПЛАН: последовательность действий роя
  4. РИСКИ: что может пойти не так

Действия: ATTACK, OBSERVE, RTB, PATROL, SUPPRESS, FLANK.
Отвечай на русском, кратко, по делу."""

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Контекст: {context}\n\nОбстановка: {situation}"},
        ]

        raw_response = ""
        used_cloud = False

        # Пробуем облако если доступно
        if self.cfg.mode in ("auto", "cloud") and await self._check_cloud():
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        self.cfg.thinker_url,
                        json={"messages": messages, "max_tokens": 1024, "temperature": 0.2},
                        timeout=aiohttp.ClientTimeout(total=timeout),
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            raw_response = data["choices"][0]["message"]["content"]
                            used_cloud = True
            except:
                pass

        # Fallback: локальный Ollama
        if not raw_response and self.cfg.mode in ("auto", "local"):
            try:
                raw_response = await self._ollama_chat(
                    self.cfg.local_thinker, messages, max_tokens=1024, timeout=timeout)
            except Exception as e:
                raw_response = f"ERROR(local): {e}"

        elapsed = time.time() - t0
        self.stats["think"] += 1
        self.stats["total_time_s"] += elapsed

        return {
            "mode": "think",
            "analysis": raw_response,
            "time_s": round(elapsed, 1),
            "model": self.cfg.thinker_model if used_cloud else self.cfg.local_thinker,
            "backend": "cloud" if used_cloud else "local",
        }

    # ═══════════════════════════════════════════════════════════
    # РЕЖИМ 2: CODE — инструмент для роя
    # ═══════════════════════════════════════════════════════════

    async def code(self, task: str, language: str = "Python",
                   timeout: int = 180) -> dict:
        """
        Coder (DeepSeek-Coder-V2 GPU) пишет инструмент для роя.

        Примеры задач:
          - "Напиши дешифровщик протокола DJI O3 с CRC8"
          - "Скрипт перекодировки видео MJPEG→H.265 для LoRa"
          - "Адаптер между MAVLink и нашим binary_protocol"
          - "Эвристика обнаружения РЭБ по спектру SDR"

        Возвращает готовый к запуску код.
        """
        t0 = time.time()

        system = f"""Ты — боевой программист роя дронов. Твоя задача — написать рабочий инструмент прямо во время миссии.

Требования:
- Язык: {language}
- Код должен быть немедленно готов к запуску
- Минимум зависимостей (стандартная библиотека + numpy по возможности)
- Обработка ошибок
- Комментарии на русском

Формат ответа:
  1. Краткое описание (1-2 предложения)
  2. Код в маркдаун-блоке ```"""

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Задача: {task}\n\nНапиши код:"},
        ]

        raw_response = ""
        used_cloud = False

        # Пробуем облако если доступно
        if self.cfg.mode in ("auto", "cloud") and await self._check_cloud():
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        self.cfg.coder_url,
                        json={"messages": messages, "max_tokens": 2048, "temperature": 0.2},
                        timeout=aiohttp.ClientTimeout(total=timeout),
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            raw_response = data["choices"][0]["message"]["content"]
                            used_cloud = True
            except:
                pass

        # Fallback: локальный Ollama
        if not raw_response and self.cfg.mode in ("auto", "local"):
            try:
                raw_response = await self._ollama_chat(
                    self.cfg.local_coder, messages, max_tokens=2048, timeout=timeout)
            except Exception as e:
                raw_response = f"ERROR(local): {e}"

        elapsed = time.time() - t0
        self.stats["code"] += 1
        self.stats["total_time_s"] += elapsed

        # Извлечь код из маркдаун-блоков
        import re
        code_blocks = re.findall(r'```(?:\w+)?\n(.*?)```', raw_response, re.DOTALL)
        extracted_code = '\n\n'.join(code_blocks) if code_blocks else raw_response

        return {
            "mode": "code",
            "code": extracted_code,
            "raw": raw_response,
            "time_s": round(elapsed, 1),
            "model": self.cfg.coder_model,
        }

    # ═══════════════════════════════════════════════════════════
    # РЕЖИМ 3: FULL — Thinker → Coder → Reviewer
    # ═══════════════════════════════════════════════════════════

    async def full_pipeline(self, task: str, language: str = "Python",
                            timeout: int = 300) -> dict:
        """
        Полный цикл: Thinker (план) → Coder (код) → Reviewer (проверка).

        Для самых сложных задач — когда нужно не просто решение,
        а проверенный и отревьюированный инструмент.
        """
        t0 = time.time()

        # Stage 1: Think
        thinker_result = await self.think(
            f"Спроектировать решение: {task}",
            context=f"Язык: {language}, целевая платформа: дрон (Orange Pi 5)",
            timeout=timeout // 3,
        )
        plan = thinker_result.get("analysis", "")

        # Stage 2: Code
        coder_result = await self.code(task, language, timeout=timeout // 3)
        code = coder_result.get("code", "")

        # Stage 3: Review (быстрая проверка)
        review = ""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.cfg.thinker_url,
                    json={
                        "messages": [
                            {"role": "system", "content": "Ты — ревьювер кода. Проверь: соответствует ли код задаче? Есть ли ошибки? Ответь кратко: PASS или FIX с замечаниями."},
                            {"role": "user", "content": f"Задача: {task}\n\nПлан: {plan}\n\nКод: {code}\n\nРевью:"},
                        ],
                        "max_tokens": 512,
                        "temperature": 0.1,
                    },
                    timeout=aiohttp.ClientTimeout(total=timeout // 3),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        review = data["choices"][0]["message"]["content"]
        except:
            review = "REVIEW SKIPPED"

        elapsed = time.time() - t0
        self.stats["full"] += 1
        self.stats["total_time_s"] += elapsed

        return {
            "mode": "full",
            "plan": plan[:2000],
            "code": code,
            "review": review,
            "verdict": "PASS" if "PASS" in review.upper() and "FIX" not in review.upper() else "FIX",
            "total_time_s": round(elapsed, 1),
        }

    # ═══════════════════════════════════════════════════════════
    # ОТВЕТ ДРОНУ — сжатие результата
    # ═══════════════════════════════════════════════════════════

    def compress_response(self, result: dict, max_bytes: int = 200) -> bytes:
        """Сжать результат для отправки дрону через LoRa."""
        import struct

        if result["mode"] == "think":
            # Отправляем только план (первые 150 байт)
            text = result.get("analysis", "")[:150]
            return text.encode()[:max_bytes]
        elif result["mode"] == "code":
            # Отправляем код (первые 180 байт) + флаг что код готов
            code = result.get("code", "")
            header = b"CODE:"
            return (header + code.encode())[:max_bytes]
        else:
            text = json.dumps({
                "v": result.get("verdict", "?"),
                "t": result.get("total_time_s", 0),
            })
            return text.encode()[:max_bytes]


# ═══════════════════════════════════════════════════════════════
# СИНХРОННАЯ ОБЁРТКА ДЛЯ DUAL LLM CONTROLLER
# ═══════════════════════════════════════════════════════════════

def model_lab_ground_sync(compressed_data: bytes,
                          bridge: ModelLabBridge = None,
                          timeout: float = 30.0) -> str:
    """
    Синхронная обёртка для dual_llm_controller.py.

    Контроллер вызывает llm_fn(compressed) синхронно.
    Эта функция запускает асинхронный ModelLabBridge в event loop.

    Использование:
      controller = DualLLMController("Scout-1")
      controller.decide(situation, ground_llm=model_lab_ground_sync)
    """
    if bridge is None:
        bridge = ModelLabBridge()

    async def _handle():
        from dual_llm_controller import PromptCompressor
        situation, question = PromptCompressor.decompress(compressed_data)
        result = await bridge.think(
            f"{question}\n"
            f"Targets: {situation.targets_detected}, "
            f"Distance: {situation.nearest_enemy_dist:.0f}m, "
            f"Battery: {situation.battery_pct:.0f}%, "
            f"EW: {situation.enemy_has_ew}, SAM: {situation.enemy_has_sam}",
            timeout=int(timeout),
        )
        return result.get("analysis", "patrol: analysis failed")

    try:
        return asyncio.run(_handle())
    except:
        return "patrol: ground station unreachable"


# ═══════════════════════════════════════════════════════════════
# АСИНХРОННАЯ ИНТЕГРАЦИЯ С DUAL LLM CONTROLLER
# ═══════════════════════════════════════════════════════════════

async def model_lab_ground_handler(compressed_data: bytes) -> str:
    """
    Обработчик наземной станции для dual_llm_controller.py.

    Принимает сжатые данные от дрона (PromptCompressor.compress()),
    распаковывает, отправляет в ModelLab, возвращает решение.

    Использование в DualLLMController:
      controller = DualLLMController("Scout-1")
      ground_llm = model_lab_ground_handler  # async fn
      decision = await controller.decide(situation, ground_llm=ground_llm)
    """
    from dual_llm_controller import PromptCompressor
    bridge = ModelLabBridge()

    # Распаковать запрос
    situation, question = PromptCompressor.decompress(compressed_data)

    # Выбрать режим
    if "Strategy" in question or "strategy" in question.lower():
        result = await bridge.think(
            f"Targets: {situation.targets_detected}, "
            f"Distance: {situation.nearest_enemy_dist:.0f}m, "
            f"Battery: {situation.battery_pct:.0f}%, "
            f"EW: {situation.enemy_has_ew}, SAM: {situation.enemy_has_sam}, "
            f"Swarm: {situation.enemy_has_swarm}, "
            f"Comms: {situation.comms_quality:.0%}",
        )
        return result.get("analysis", "observe: analysis failed")
    else:
        result = await bridge.think(
            f"Одиночная цель. {question}\n"
            f"Дистанция: {situation.nearest_enemy_dist:.0f}m, "
            f"Батарея: {situation.battery_pct:.0f}%",
        )
        return result.get("analysis", "patrol: analysis failed")


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  MODEL LAB BRIDGE — Thinker + Coder для роя     ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    async def test():
        bridge = ModelLabBridge()

        # Тест 1: Thinker
        print("═══ ТЕСТ 1: Thinker (R1 8B GPU) ═══")
        result = await bridge.think(
            "Рой из 5 дронов. Цели: 2 опорника, 1 РЭБ, 1 ПВО (С-300). "
            "Батарея: 45-80%. Ветер: 7 м/с. Враг использует РЭБ подавления GPS.",
            context="Миссия: разведка и подавление ПВО противника.",
            timeout=60,
        )
        print(f"  Время: {result['time_s']:.1f}с")
        print(f"  Анализ: {result['analysis'][:400]}")
        print()

        # Тест 2: Coder
        print("═══ ТЕСТ 2: Coder (DeepSeek-Coder-V2 GPU) ═══")
        result = await bridge.code(
            "Напиши скрипт на Python для обнаружения РЭБ-подавления GPS: "
            "если за 1 секунду SNR падает на 15+ dB, а число видимых спутников < 4 — "
            "переключить навигацию на UWB-сетку + IMU.",
        )
        print(f"  Время: {result['time_s']:.1f}с")
        print(f"  Код: {result['code'][:400]}")
        print()

        print(f"Статистика: {bridge.stats}")

    asyncio.run(test())
