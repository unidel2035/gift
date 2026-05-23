#!/usr/bin/env python3
"""
ai_swarm_orchestrator.py — ИИ-рой: небо + земля + облако

Три слоя ИИ:

  НЕБО (дрон, Orange Pi 5)
    └── Serafim V2 Q8 (1.6GB)
        Тактические решения: attack/observe/rtb/patrol
        Задержка: ~200ms | Трафик: 0
        Автономен при потере связи

  ЗЕМЛЯ (ноутбук, ModelLab)
    ├── Thinker (R1 8B) → стратегический анализ
    └── Coder (CoderV2)  → инструменты для роя
        Задержка: 2-40с | Трафик: ~50 байт (сжатый LoRa)

  ОБЛАКО (RTX 4090, Immers.cloud)
    ├── :8080 R1 8B (GPU)    → ×7 быстрее земли
    └── :8081 CoderV2 (GPU)  → ×22 быстрее земли
        Авто-проксирование через SSH-туннели

Поток принятия решений:

  Дрон обнаружил цель
    │
    ├── Простая (1 цель, батарея > 20%)
    │   └── Serafim на борту → ATTACK/OBSERVE/RTB (~200ms)
    │
    ├── Сложная (3+ целей, РЭБ, ПВО)
    │   └── Сжать → LoRa → ModelLab Thinker → план (~5-40с)
    │
    └── Нужен инструмент (новый протокол, скрипт)
        └── Сжать → LoRa → ModelLab Coder → код (~2-40с)
"""

import asyncio, time, json, math
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Callable

# ═══════════════════════════════════════════════════════════════
# КОНФИГУРАЦИЯ РОЯ
# ═══════════════════════════════════════════════════════════════

@dataclass
class SwarmConfig:
    """Конфигурация всего ИИ-роя"""
    # Serafim (борт)
    serafim_model: str = "serafim-tactical:q8"
    serafim_url: str = "http://localhost:11434"
    # ModelLab (земля)
    model_lab_url: str = "http://127.0.0.1:8501"
    thinker_model: str = "deepseek-r1:8b"
    coder_model: str = "deepseek-coder-v2"
    # Cloud GPU
    cloud_thinker_url: str = "http://127.0.0.1:8080/v1/chat/completions"
    cloud_coder_url: str = "http://127.0.0.1:8081/v1/chat/completions"
    use_cloud: bool = True
    # Таймауты
    onboard_timeout_ms: int = 500
    ground_timeout_s: int = 60
    cloud_timeout_s: int = 30


# ═══════════════════════════════════════════════════════════════
# УРОВЕНЬ 1: БОРТ (Серафим)
# ═══════════════════════════════════════════════════════════════

@dataclass
class DroneDecision:
    """Решение, принятое на борту дрона"""
    action: str           # attack, observe, rtb, patrol
    reason: str
    confidence: float     # 0..1
    latency_ms: float
    source: str           # "serafim_onboard", "ground_thinker", "ground_coder", "offline_rules"


class OnboardSerafim:
    """
    Бортовой Серафим — быстрые тактические решения.

    Работает на Orange Pi 5 (6 TOPS NPU или CPU).
    Модель: Serafim V2 Q8 (1.6 GB, Ollama).
    """

    def __init__(self, config: SwarmConfig = None):
        self.cfg = config or SwarmConfig()
        self.decisions_made = 0

    async def decide(self, prompt: str, timeout_ms: int = 500) -> DroneDecision:
        """Принять тактическое решение на борту."""
        import aiohttp
        t0 = time.time()

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.cfg.serafim_url}/api/generate",
                    json={
                        "model": self.cfg.serafim_model,
                        "prompt": prompt,
                        "stream": False,
                        "options": {
                            "temperature": 0.1,
                            "num_predict": 25,
                            "top_k": 20,
                        },
                    },
                    timeout=aiohttp.ClientTimeout(total=timeout_ms / 1000),
                ) as resp:
                    data = await resp.json()
                    response = data.get("response", "").strip()

            elapsed_ms = (time.time() - t0) * 1000
            action, reason = self._parse(response)
            self.decisions_made += 1

            return DroneDecision(
                action=action, reason=reason,
                confidence=0.85, latency_ms=elapsed_ms,
                source="serafim_onboard",
            )
        except:
            elapsed_ms = (time.time() - t0) * 1000
            return DroneDecision(
                action="patrol", reason="serafim timeout",
                confidence=0.3, latency_ms=elapsed_ms,
                source="offline_rules",
            )

    def _parse(self, response: str):
        """Разобрать ответ Серафима."""
        r = response.lower()
        if r.startswith("attack") or "attack" in r[:20]:
            return "attack", response[:100]
        elif r.startswith("rtb") or "rtb" in r[:20]:
            return "rtb", response[:100]
        elif r.startswith("observe") or "observe" in r[:20]:
            return "observe", response[:100]
        else:
            return "patrol", response[:100]


# ═══════════════════════════════════════════════════════════════
# УРОВЕНЬ 2: ЗЕМЛЯ (ModelLab Thinker + Coder)
# ═══════════════════════════════════════════════════════════════

class GroundStation:
    """
    Наземная станция — Thinker + Coder для роя.

    Thinker (R1 8B): стратегический анализ, приоритеты целей, тактика роя.
    Coder (CoderV2): написание инструментов прямо во время миссии.

    Автоматически использует облачный GPU если доступен.
    """

    def __init__(self, config: SwarmConfig = None):
        self.cfg = config or SwarmConfig()
        self.thinker_calls = 0
        self.coder_calls = 0

    async def think(self, situation: str, context: str = "") -> DroneDecision:
        """Стратегический анализ обстановки."""
        from model_lab_bridge import ModelLabBridge, ModelLabConfig

        bridge_cfg = ModelLabConfig(
            thinker_url=self.cfg.cloud_thinker_url,
            coder_url=self.cfg.cloud_coder_url,
            mode="auto" if self.cfg.use_cloud else "local",
        )
        bridge = ModelLabBridge(bridge_cfg)

        t0 = time.time()
        result = await bridge.think(situation, context,
                                     timeout=self.cfg.ground_timeout_s)
        elapsed_ms = (time.time() - t0) * 1000
        self.thinker_calls += 1

        analysis = result.get("analysis", "")
        action = self._extract_action(analysis)

        return DroneDecision(
            action=action,
            reason=analysis[:200],
            confidence=0.75,
            latency_ms=elapsed_ms,
            source=f"ground_thinker_{result.get('backend', 'local')}",
        )

    async def code(self, task: str, language: str = "Python") -> dict:
        """Написать инструмент для роя."""
        from model_lab_bridge import ModelLabBridge, ModelLabConfig

        bridge_cfg = ModelLabConfig(
            thinker_url=self.cfg.cloud_thinker_url,
            coder_url=self.cfg.cloud_coder_url,
            mode="auto" if self.cfg.use_cloud else "local",
        )
        bridge = ModelLabBridge(bridge_cfg)

        t0 = time.time()
        result = await bridge.code(task, language,
                                     timeout=self.cfg.ground_timeout_s)
        elapsed_ms = (time.time() - t0) * 1000
        self.coder_calls += 1

        return {
            "code": result.get("code", ""),
            "backend": result.get("backend", "local"),
            "time_ms": elapsed_ms,
        }

    def _extract_action(self, analysis: str) -> str:
        """Извлечь действие из стратегического анализа."""
        upper = analysis.upper()
        if "ATTACK" in upper or "АТАК" in upper:
            return "attack"
        elif "RTB" in upper or "ВОЗВРАТ" in upper:
            return "rtb"
        elif "OBSERVE" in upper or "НАБЛЮД" in upper:
            return "observe"
        return "patrol"


# ═══════════════════════════════════════════════════════════════
# УРОВЕНЬ 3: ОРКЕСТРАТОР РОЯ
# ═══════════════════════════════════════════════════════════════

class AISwarmOrchestrator:
    """
    Оркестратор всего ИИ-роя — соединяет небо, землю и облако.

    Принимает решение КАК думать над каждой задачей:
      - Борт (Serafim): быстро, локально, всегда доступно
      - Земля (ModelLab): умно, сжатый канал, есть задержка
      - Правила (offline): когда связи нет совсем
    """

    def __init__(self, config: SwarmConfig = None):
        self.cfg = config or SwarmConfig()
        self.onboard = OnboardSerafim(self.cfg)
        self.ground = GroundStation(self.cfg)
        self.stats = {
            "onboard_decisions": 0,
            "ground_thinker_decisions": 0,
            "ground_coder_requests": 0,
            "offline_fallbacks": 0,
            "total_latency_ms": 0.0,
        }

    async def decide(self,
                     targets_detected: int,
                     target_types: List[str],
                     nearest_enemy_dist: float,
                     battery_pct: float,
                     comms_quality: float = 1.0,
                     enemy_has_ew: bool = False,
                     enemy_has_sam: bool = False,
                     enemy_has_swarm: bool = False,
                     mission_phase: str = "patrol",
                     need_tool: bool = False,
                     tool_description: str = "",
                     ) -> DroneDecision:
        """
        Принять решение используя все уровни ИИ.

        Логика эскалации:
          1. Батарея < 15% → сразу RTB (правила)
          2. Связи нет → Serafim на борту
          3. Нужен инструмент → Земля Coder
          4. Сложная обстановка → Земля Thinker
          5. Простая → Serafim на борту
        """
        # КРИТИЧЕСКОЕ: батарея
        if battery_pct < 15:
            return DroneDecision(
                action="rtb", reason="battery critical",
                confidence=1.0, latency_ms=0,
                source="offline_rules",
            )

        # НЕТ СВЯЗИ
        if comms_quality < 0.2:
            prompt = self._build_onboard_prompt(
                targets_detected, target_types, nearest_enemy_dist,
                battery_pct, enemy_has_ew, enemy_has_sam)
            return await self.onboard.decide(prompt)

        # НУЖЕН ИНСТРУМЕНТ → Земля Coder
        if need_tool and tool_description:
            self.stats["ground_coder_requests"] += 1
            try:
                result = await self.ground.code(tool_description)
                # Код готов — дрон получает инструмент
                # Тактическое решение отдельно
                code_len = len(result.get("code", ""))
                prompt = self._build_onboard_prompt(
                    targets_detected, target_types, nearest_enemy_dist,
                    battery_pct, enemy_has_ew, enemy_has_sam)
                return await self.onboard.decide(prompt)
            except:
                pass

        # СЛОЖНАЯ ОБСТАНОВКА → Земля Thinker
        if (targets_detected >= 3 or enemy_has_ew or
            enemy_has_sam or enemy_has_swarm or
            mission_phase == "consensus"):

            situation = (
                f"Рой дронов. Целей: {targets_detected} ({', '.join(target_types[:5])}). "
                f"Ближайший враг: {nearest_enemy_dist:.0f}м. "
                f"Батарея: {battery_pct:.0f}%. "
                f"РЭБ: {'да' if enemy_has_ew else 'нет'}, "
                f"ПВО: {'да' if enemy_has_sam else 'нет'}, "
                f"Рой врага: {'да' if enemy_has_swarm else 'нет'}. "
                f"Фаза: {mission_phase}."
            )

            try:
                decision = await self.ground.think(situation)
                self.stats["ground_thinker_decisions"] += 1
                self.stats["total_latency_ms"] += decision.latency_ms
                return decision
            except:
                pass

        # ПРОСТАЯ ОБСТАНОВКА → Serafim на борту
        prompt = self._build_onboard_prompt(
            targets_detected, target_types, nearest_enemy_dist,
            battery_pct, enemy_has_ew, enemy_has_sam)
        decision = await self.onboard.decide(prompt)
        self.stats["onboard_decisions"] += 1
        self.stats["total_latency_ms"] += decision.latency_ms
        return decision

    def _build_onboard_prompt(self, targets, types, dist, bat, ew, sam):
        """Построить промпт для бортового Серафима."""
        type_str = types[0] if types else "unknown"
        return (
            f"Ты дрон-разведчик. "
            f"Цель: {type_str}. "
            f"Дистанция: {dist:.0f}м. "
            f"Батарея: {bat:.0f}%. "
            f"РЭБ: {'да' if ew else 'нет'}. "
            f"Решение:"
        )

    def get_status(self) -> dict:
        return {
            "stats": self.stats,
            "avg_latency_ms": round(
                self.stats["total_latency_ms"] / max(1,
                    self.stats["onboard_decisions"] +
                    self.stats["ground_thinker_decisions"]), 1),
            "onboard": self.onboard.decisions_made,
            "thinker": self.ground.thinker_calls,
            "coder": self.ground.coder_calls,
            "config": {
                "serafim": self.cfg.serafim_model,
                "thinker": self.cfg.thinker_model,
                "coder": self.cfg.coder_model,
                "cloud": self.cfg.use_cloud,
            },
        }


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  AI SWARM ORCHESTRATOR — Небо + Земля + Облако  ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    async def test():
        orch = AISwarmOrchestrator(SwarmConfig(use_cloud=True))

        scenarios = [
            # Простая → борт
            {"targets": 1, "types": ["strongpoint"], "dist": 400, "bat": 80,
             "comms": 1.0, "ew": False, "sam": False, "label": "Борт: опорник"},
            # Сложная → земля Thinker (GPU)
            {"targets": 3, "types": ["ew","sam","bunker"], "dist": 800, "bat": 60,
             "comms": 0.9, "ew": True, "sam": True, "label": "Земля: РЭБ+ПВО"},
            # Критическая батарея → правила
            {"targets": 1, "types": ["tank"], "dist": 200, "bat": 8,
             "comms": 1.0, "ew": False, "sam": False, "label": "RTB: батарея 8%"},
            # Потеря связи → борт
            {"targets": 2, "types": ["bunker","vehicle"], "dist": 600, "bat": 55,
             "comms": 0.05, "ew": True, "sam": False, "label": "Борт: связь потеряна"},
            # Нужен инструмент → земля Coder
            {"targets": 1, "types": ["drone"], "dist": 1200, "bat": 70,
             "comms": 1.0, "ew": False, "sam": False, "label": "Coder: инструмент",
             "need_tool": True,
             "tool": "Напиши дешифровщик протокола DJI O3: парсинг пакетов с CRC8"},
        ]

        for i, s in enumerate(scenarios):
            print(f"═══ Сценарий {i+1}: {s['label']} ═══")
            decision = await orch.decide(
                targets_detected=s["targets"],
                target_types=s["types"],
                nearest_enemy_dist=s["dist"],
                battery_pct=s["bat"],
                comms_quality=s["comms"],
                enemy_has_ew=s["ew"],
                enemy_has_sam=s["sam"],
                need_tool=s.get("need_tool", False),
                tool_description=s.get("tool", ""),
            )
            print(f"  Источник: {decision.source}")
            print(f"  Действие: {decision.action.upper()}")
            print(f"  Задержка: {decision.latency_ms:.0f}ms")
            print(f"  Причина: {decision.reason[:120]}")
            print()

        status = orch.get_status()
        print(f"═══ СТАТУС РОЯ ═══")
        for k, v in status["stats"].items():
            print(f"  {k}: {v}")
        print(f"  Средняя задержка: {status['avg_latency_ms']:.0f}ms")

    asyncio.run(test())
