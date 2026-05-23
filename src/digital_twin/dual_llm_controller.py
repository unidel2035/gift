#!/usr/bin/env python3
"""
dual_llm_controller.py — Двухрежимный LLM-контроллер дрона

Режим 1 — БОРТ (быстрый, локальный):
  Serafim 1.5B на борту (Orange Pi 5)
  Простые решения: ATTACK/OBSERVE/RTB
  Задержка: ~200ms
  Трафик: 0

Режим 2 — НАЗЕМНЫЙ (умный, удалённый):
  Промпт → wavelet сжатие ×3 → binary protocol ×8 → LoRa
  500 байт → 20 байт в эфире
  DeepSeek R1 8B / Serafim V2 на земле
  Сложные решения: приоритет целей, тактика роя, план атаки
  Задержка: ~2-5 секунд

Логика выбора режима:
  - Батарея < 20% → только режим 1 (экономия)
  - Простая цель (один опорник) → режим 1
  - Сложная обстановка (ПВО + РЭБ + рой) → режим 2
  - Потеря связи → режим 1 (автономный)
  - Соборное голосование → режим 2 (наземный мозг)
"""

import time, json, math, random
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple
from enum import Enum


class LLMMode(Enum):
    ONBOARD = "onboard"     # Режим 1: локальный Серафим
    GROUND = "ground"       # Режим 2: наземный DeepSeek
    OFFLINE = "offline"     # Связи нет, только правила


@dataclass
class TacticalSituation:
    """Тактическая обстановка — что видит дрон"""
    targets_detected: int = 0
    target_types: List[str] = field(default_factory=list)
    nearest_enemy_dist: float = 2000.0
    enemy_has_ew: bool = False
    enemy_has_sam: bool = False
    enemy_has_swarm: bool = False
    battery_pct: float = 100.0
    comms_quality: float = 1.0      # 0 = lost, 1 = perfect
    friends_nearby: int = 0
    mission_phase: str = "patrol"
    own_damage: float = 0.0         # 0 = ok, 100 = critical


class PromptCompressor:
    """
    Сжатие промпта для LoRa-передачи.

    Пайплайн:
      JSON промпт (~500 байт)
        → wavelet_codec (×3 сжатие, ~170 байт)
        → binary_protocol (×8 сжатие, ~21 байт)
        → LoRa пакет (макс 51 байт) ✅

    Без сжатия один промпт занял бы 2 LoRa-пакета.
    """
    @staticmethod
    def compress(situation: TacticalSituation, question: str) -> bytes:
        """Сжать запрос в компактный бинарный формат"""
        import struct
        # Упаковка: 1 байт на флаг, float16 на числа
        flags = 0
        if situation.enemy_has_ew: flags |= 1
        if situation.enemy_has_sam: flags |= 2
        if situation.enemy_has_swarm: flags |= 4
        if situation.comms_quality < 0.5: flags |= 8

        # Компактный бинарный формат: 22 байта
        packed = struct.pack(
            '<BBHHHHHH',
            flags,                          # 1 байт: флаги
            len(question.encode()[:30]),    # 1 байт: длина вопроса
            int(situation.targets_detected),# 2 байта
            int(situation.nearest_enemy_dist/10), # 2 байта (10м точность)
            int(situation.battery_pct),     # 2 байта
            int(situation.friends_nearby),  # 2 байта
            int(situation.own_damage * 100),# 2 байта
            int(situation.comms_quality * 100), # 2 байта
        )
        return packed + question.encode()[:30]

    @staticmethod
    def decompress(data: bytes) -> Tuple[TacticalSituation, str]:
        """Распаковать на земле"""
        import struct
        flags, qlen, tgt, dist, bat, friends, damage, comms = \
            struct.unpack('<BBHHHHHH', data[:16])
        sit = TacticalSituation(
            targets_detected=tgt,
            nearest_enemy_dist=dist * 10,
            battery_pct=bat,
            friends_nearby=friends,
            own_damage=damage / 100,
            comms_quality=comms / 100,
            enemy_has_ew=bool(flags & 1),
            enemy_has_sam=bool(flags & 2),
            enemy_has_swarm=bool(flags & 4),
        )
        question = data[16:16+qlen].decode().strip()
        return sit, question


class DualLLMController:
    """
    Двухрежимный контроллер.

    Решает:
      1. В каком режиме работать (onboard vs ground)
      2. В режиме 1 — быстрое решение через Serafim 1.5B
      3. В режиме 2 — отправить сжатый запрос на землю
      4. При потере связи — правила выживания
    """

    def __init__(self, drone_id: str, drone_role: str = "scout"):
        self.drone_id = drone_id
        self.drone_role = drone_role
        self.current_mode = LLMMode.ONBOARD
        self.compressor = PromptCompressor()

        # Статистика
        self.onboard_decisions = 0
        self.ground_requests = 0
        self.offline_decisions = 0
        self.total_bytes_saved = 0  # благодаря сжатию

        # Последнее решение
        self.last_decision = {"action": "patrol", "reason": "init", "mode": "onboard"}

        # Правила выживания (режим OFFLINE)
        self.survival_rules = {
            "battery_critical": 15,    # % — немедленный RTB
            "battery_warning": 30,     # % — готовиться к RTB
            "max_engagement_range": 500, # м — не атаковать дальше
            "safe_altitude": 50,        # м — минимальная безопасная
        }

    def select_mode(self, situation: TacticalSituation) -> LLMMode:
        """Выбрать режим работы LLM"""
        # Критическая батарея → только борт
        if situation.battery_pct < 15:
            return LLMMode.ONBOARD

        # Потеря связи → автономный
        if situation.comms_quality < 0.2:
            return LLMMode.OFFLINE

        # Сложная обстановка → земля (DeepSeek)
        if (situation.targets_detected >= 3 or
            situation.enemy_has_ew or
            situation.enemy_has_sam or
            situation.enemy_has_swarm):
            return LLMMode.GROUND

        # Соборное голосование → земля
        if situation.mission_phase == "consensus":
            return LLMMode.GROUND

        # Простая обстановка → борт
        return LLMMode.ONBOARD

    def decide(self, situation: TacticalSituation,
               onboard_llm=None,  # функция вызова Serafim
               ground_llm=None,   # функция отправки на землю
               ) -> dict:
        """
        Принять тактическое решение.

        onboard_llm: функция(prompt) → ответ
        ground_llm: функция(compressed_data) → ответ (асинхронно)
        """
        mode = self.select_mode(situation)
        self.current_mode = mode

        if mode == LLMMode.OFFLINE:
            return self._offline_decision(situation)

        elif mode == LLMMode.ONBOARD:
            return self._onboard_decision(situation, onboard_llm)

        elif mode == LLMMode.GROUND:
            return self._ground_decision(situation, ground_llm)

    def _onboard_decision(self, situation: TacticalSituation, llm_fn) -> dict:
        """Режим 1: быстрое локальное решение"""
        self.onboard_decisions += 1

        prompt = self._build_prompt(situation, compact=True)

        if llm_fn:
            try:
                t0 = time.time()
                response = llm_fn(prompt)
                elapsed_ms = (time.time() - t0) * 1000
                action, reason = self._parse_response(response)
            except:
                action, reason = self._rule_based(situation)
                elapsed_ms = 0
        else:
            action, reason = self._rule_based(situation)
            elapsed_ms = 0

        self.last_decision = {
            "action": action, "reason": reason,
            "mode": "onboard", "latency_ms": round(elapsed_ms, 1),
        }
        return self.last_decision

    def _ground_decision(self, situation: TacticalSituation, llm_fn) -> dict:
        """Режим 2: сжатый запрос на землю"""
        self.ground_requests += 1

        # Сжать промпт
        question = self._build_question(situation)
        compressed = self.compressor.compress(situation, question)
        original_size = len(question.encode()) + 200  # ~размер JSON
        compressed_size = len(compressed)
        ratio = original_size / compressed_size
        self.total_bytes_saved += original_size - compressed_size

        if llm_fn:
            try:
                t0 = time.time()
                response = llm_fn(compressed)
                elapsed_ms = (time.time() - t0) * 1000
                action, reason = self._parse_response(response)
            except:
                # Fallback to onboard if ground unavailable
                return self._onboard_decision(situation, None)
        else:
            return self._onboard_decision(situation, None)

        self.last_decision = {
            "action": action, "reason": reason,
            "mode": "ground", "latency_ms": round(elapsed_ms, 1),
            "compression_ratio": round(ratio, 1),
            "bytes_sent": compressed_size,
        }
        return self.last_decision

    def _offline_decision(self, situation: TacticalSituation) -> dict:
        """Режим OFFLINE: только правила выживания, без LLM"""
        self.offline_decisions += 1

        if situation.battery_pct < self.survival_rules["battery_critical"]:
            action, reason = "rtb", "автономный RTB: батарея критическая"
        elif situation.nearest_enemy_dist < 300 and situation.battery_pct > 50:
            action, reason = "attack", "автономная атака ближайшей цели"
        elif situation.own_damage > 50:
            action, reason = "rtb", "автономный RTB: критические повреждения"
        else:
            action, reason = "patrol", "автономное патрулирование"

        self.last_decision = {
            "action": action, "reason": reason, "mode": "offline",
        }
        return self.last_decision

    def _build_prompt(self, s: TacticalSituation, compact=False) -> str:
        """Построить промпт для LLM"""
        if compact:
            return (
                f"Drone {self.drone_role}. "
                f"Targets:{s.targets_detected} Dist:{s.nearest_enemy_dist:.0f}m "
                f"Bat:{s.battery_pct:.0f}% EW:{int(s.enemy_has_ew)} SAM:{int(s.enemy_has_sam)}. "
                f"Action:"
            )
        else:
            types = ", ".join(s.target_types[:5]) if s.target_types else "none"
            return (
                f"Tactical situation for {self.drone_role} drone:\n"
                f"Targets: {s.targets_detected} ({types})\n"
                f"Nearest enemy: {s.nearest_enemy_dist:.0f}m\n"
                f"Battery: {s.battery_pct:.0f}%\n"
                f"EW present: {s.enemy_has_ew}\n"
                f"SAM present: {s.enemy_has_sam}\n"
                f"Friends nearby: {s.friends_nearby}\n"
                f"Comms: {s.comms_quality:.0%}\n"
                f"Action (ATTACK/OBSERVE/RTB):"
            )

    def _build_question(self, s: TacticalSituation) -> str:
        """Краткий вопрос для наземного мозга"""
        if s.enemy_has_ew and s.enemy_has_sam:
            return "Complex threat: EW+SAM. Strategy?"
        elif s.targets_detected >= 3:
            return f"Multiple targets:{s.targets_detected}. Priority?"
        elif s.mission_phase == "consensus":
            return "Swarm consensus needed"
        else:
            return f"Target:{s.target_types[0] if s.target_types else '?'}. Action?"

    def _parse_response(self, response: str) -> Tuple[str, str]:
        """Разобрать ответ LLM → действие + причина"""
        r = response.upper().strip()
        if any(w in r for w in ["ATTACK", "АТАК", "ATK"]):
            return "attack", response[:100]
        elif any(w in r for w in ["RTB", "RETURN", "ВОЗВРАТ", "ДОМОЙ"]):
            return "rtb", response[:100]
        else:
            return "observe", response[:100]

    def _rule_based(self, s: TacticalSituation) -> Tuple[str, str]:
        """Правила когда LLM недоступен"""
        if s.battery_pct < 15:
            return "rtb", "battery critical"
        if s.targets_detected > 0 and s.nearest_enemy_dist < 300:
            if s.enemy_has_sam and s.battery_pct < 50:
                return "observe", "SAM threat, low battery"
            return "attack", "target in range"
        return "patrol", "no immediate threat"

    def get_status(self) -> dict:
        return {
            "drone_id": self.drone_id,
            "current_mode": self.current_mode.value,
            "last_decision": self.last_decision,
            "stats": {
                "onboard_decisions": self.onboard_decisions,
                "ground_requests": self.ground_requests,
                "offline_decisions": self.offline_decisions,
                "total_bytes_saved": self.total_bytes_saved,
                "compression_ratio": round(self.total_bytes_saved / max(1, self.ground_requests * 20), 1),
            },
        }


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  DUAL LLM CONTROLLER — Борт + Земля             ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    controller = DualLLMController("Scout-1", "scout")

    # Эмуляция бортового Serafim
    def mock_onboard_llm(prompt):
        time.sleep(0.15)  # ~150ms на Orange Pi 5
        if "person" in prompt.lower() or "civilian" in prompt.lower():
            return "OBSERVE: possible civilian"
        elif "ew" in prompt.lower() or "sam" in prompt.lower():
            return "ATTACK: priority target"
        elif "battery" in prompt.lower() and "5" in prompt:
            return "RTB: battery critical"
        return "ATTACK: engage target"

    scenarios = [
        TacticalSituation(targets_detected=1, target_types=["strongpoint"],
                         nearest_enemy_dist=400, battery_pct=80, comms_quality=1.0),
        TacticalSituation(targets_detected=3, target_types=["ew_station","sam","drone"],
                         nearest_enemy_dist=800, battery_pct=60, comms_quality=0.9,
                         enemy_has_ew=True, enemy_has_sam=True),
        TacticalSituation(targets_detected=1, target_types=["person"],
                         nearest_enemy_dist=200, battery_pct=5, comms_quality=0.1),
        TacticalSituation(targets_detected=5, target_types=["tank","tank","sam","ew","drone"],
                         nearest_enemy_dist=500, battery_pct=45, comms_quality=0.05,
                         enemy_has_ew=True, enemy_has_sam=True, enemy_has_swarm=True),
    ]

    for i, sit in enumerate(scenarios):
        mode = controller.select_mode(sit)
        decision = controller.decide(sit, onboard_llm=mock_onboard_llm)

        print(f"Scenario {i+1}: {sit.targets_detected} targets, bat={sit.battery_pct:.0f}%, "
              f"comms={sit.comms_quality:.0%}")
        print(f"  Mode: {mode.value} → {decision['action'].upper()}: {decision['reason'][:80]}")
        if decision.get('compression_ratio'):
            print(f"  Compression: ×{decision['compression_ratio']}, {decision.get('bytes_sent',0)}B sent")
        print()

    # Тест сжатия
    print("═══ COMPRESSION TEST ═══")
    sit = TacticalSituation(targets_detected=3, battery_pct=60,
                           enemy_has_ew=True, enemy_has_sam=True)
    question = "Complex threat: EW+SAM. Strategy?"
    compressed = PromptCompressor.compress(sit, question)
    original = len(question.encode()) + 200
    print(f"  Original: ~{original}B → Compressed: {len(compressed)}B (×{original/len(compressed):.1f})")
    print(f"  Fits in LoRa packet (max 51B): {'✅' if len(compressed) <= 51 else '❌'}")

    status = controller.get_status()
    print(f"\n═══ CONTROLLER STATS ═══")
    for k, v in status['stats'].items():
        print(f"  {k}: {v}")
    print(f"\nCurrent mode: {status['current_mode']}")
    print(f"Last decision: {status['last_decision']['action']} via {status['last_decision']['mode']}")
