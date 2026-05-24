#!/usr/bin/env python3
"""
serafim_agent.py — Боевой LLM-агент: Serafim управляет дроном в симуляции

Подключается к любому симулятору (training_arena, unified_sim, endless_swarm).
Заменяет хардкодные правила на реальный инференс Serafim V2 Q8.

Архитектура:
  Сенсоры → TacticalSituation (JSON) → Serafim (LLM) → TacticalAction → Полётный контроллер

Два режима:
  SYNC  — синхронный вызов Ollama (для отладки, ≤400ms)
  ASYNC — асинхронный инференс (агент действует по предыдущему решению пока ждёт)

Использование:
  agent = SerafimAgent("Scout-1", "РАЗВ")
  situation = agent.build_situation(nearby_enemies, friendlies, battery, comms)
  action = await agent.decide(situation)
  agent.apply_action(drone, action)
"""

import asyncio, json, time, math, os, re
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from enum import Enum

# ═══════════════════════════════════════════════════════════════
# ДАННЫЕ
# ═══════════════════════════════════════════════════════════════

class SerafimAction(Enum):
    ATTACK = "attack"
    OBSERVE = "observe"
    RTB = "rtb"
    PATROL = "patrol"
    SUPPORT = "support"


@dataclass
class TacticalSituation:
    """Тактическая обстановка — вход для Serafim."""
    agent_id: str
    agent_role: str          # РАЗВ, ФПВ, ПЕРЕ, РЕТР, НАЗМ, КАМИКАДЗЕ
    agent_team: str          # blue / red
    x: float; y: float; z: float
    battery_pct: float
    heading_deg: float

    # Враги
    enemies: List[dict] = field(default_factory=list)   # [{id, role, dist_m, heading_rel_deg, y_rel}]
    nearest_enemy_dist: float = float('inf')

    # Свои
    friendlies: List[dict] = field(default_factory=list)  # [{id, role, dist_m, heading_rel_deg}]
    friendlies_alive: int = 0

    # Среда
    comms_quality: float = 1.0      # 0..1
    ew_jamming: bool = False
    sam_threat: bool = False
    weather: str = "clear"
    time_of_day: float = 12.0       # часы

    # Тактический контекст
    mission_phase: str = "patrol"   # deploy/patrol/engage/retreat
    kills: int = 0
    enemies_alive: int = 0


@dataclass
class TacticalDecision:
    """Решение Serafim."""
    action: SerafimAction
    target_id: str = ""
    priority: int = 5           # 0-10
    speed_ms: float = 20.0
    altitude_m: float = 100.0
    heading_deg: float = 0.0
    reason: str = ""
    confidence: float = 0.8
    latency_ms: float = 0.0
    raw_response: str = ""


# ═══════════════════════════════════════════════════════════════
# Serafim АГЕНТ
# ═══════════════════════════════════════════════════════════════

class SerafimAgent:
    """
    LLM-агент, управляющий одним дроном.

    Не хардкод. Каждое решение — реальный инференс Serafim.
    """

    def __init__(self, agent_id: str, role: str, team: str = "blue",
                 ollama_url: str = "http://localhost:11434",
                 model: str = "serafim-tactical:q8"):
        self.id = agent_id
        self.role = role
        self.team = team
        self.ollama_url = ollama_url
        self.model = model

        # Предыдущее решение (для async-режима)
        self.last_decision: Optional[TacticalDecision] = None
        self.last_decision_time: float = 0.0
        self.decision_timeout_s: float = 0.5  # запрашивать новое решение каждые 500ms

        # Статистика
        self.decisions_made: int = 0
        self.total_latency_ms: float = 0.0
        self.cache_hits: int = 0           # использовано кешированное решение
        self.fallback_count: int = 0       # использован fallback при ошибке

    # ═══════════════════════════════════════════════════════════
    # СЕНСОРЫ → ТЕКСТ
    # ═══════════════════════════════════════════════════════════

    def build_situation(self, **kwargs) -> TacticalSituation:
        """Построить тактическую обстановку из данных симуляции."""
        sit = TacticalSituation(
            agent_id=self.id,
            agent_role=self.role,
            agent_team=self.team,
            x=kwargs.get('x', 0),
            y=kwargs.get('y', 100),
            z=kwargs.get('z', 0),
            battery_pct=kwargs.get('battery', 100),
            heading_deg=kwargs.get('heading', 0),
        )
        sit.enemies = kwargs.get('enemies', [])
        sit.nearest_enemy_dist = kwargs.get('nearest_enemy_dist', float('inf'))
        sit.friendlies = kwargs.get('friendlies', [])
        sit.friendlies_alive = kwargs.get('friendlies_alive', 0)
        sit.enemies_alive = kwargs.get('enemies_alive', 0)
        sit.comms_quality = kwargs.get('comms_quality', 1.0)
        sit.ew_jamming = kwargs.get('ew_jamming', False)
        sit.sam_threat = kwargs.get('sam_threat', False)
        sit.weather = kwargs.get('weather', 'clear')
        sit.time_of_day = kwargs.get('time_of_day', 12.0)
        sit.mission_phase = kwargs.get('mission_phase', 'patrol')
        sit.kills = kwargs.get('kills', 0)
        return sit

    def _format_prompt(self, sit: TacticalSituation) -> str:
        """Форматировать тактическую обстановку в текст для Serafim."""
        role_names = {
            "РАЗВ": "дрон-разведчик", "ФПВ": "FPV-камикадзе",
            "ПЕРЕ": "перехватчик", "РЕТР": "ретранслятор",
            "НАЗМ": "наземная база", "КАМИКАДЗЕ": "камикадзе",
        }
        role_name = role_names.get(self.role, "дрон")

        prompt = f"Ты {role_name} ({self.team}). "

        # Враги
        if sit.enemies:
            enemy_strs = []
            for e in sit.enemies[:5]:
                enemy_strs.append(f"{e.get('role','враг')} на {e.get('dist_m',0):.0f}м")
            prompt += f"Враги: {', '.join(enemy_strs)}. "
        elif sit.nearest_enemy_dist < float('inf'):
            prompt += f"Ближайший враг: {sit.nearest_enemy_dist:.0f}м. "
        else:
            prompt += "Врагов не видно. "

        # Свои
        if sit.friendlies_alive > 0:
            prompt += f"Своих в рое: {sit.friendlies_alive}. "

        # Состояние
        prompt += f"Батарея: {sit.battery_pct:.0f}%. "

        # Угрозы
        threats = []
        if sit.sam_threat: threats.append("ПВО")
        if sit.ew_jamming: threats.append("РЭБ")
        if sit.comms_quality < 0.3: threats.append("связь плохая")
        if threats:
            prompt += f"Угрозы: {', '.join(threats)}. "

        # Фаза
        prompt += f"Фаза: {sit.mission_phase}. "

        prompt += "Решение:"
        return prompt

    # ═══════════════════════════════════════════════════════════
    # Serafim → РЕШЕНИЕ
    # ═══════════════════════════════════════════════════════════

    async def decide(self, sit: TacticalSituation,
                     timeout_s: float = 2.0) -> TacticalDecision:
        """Принять тактическое решение через Serafim."""
        # Проверка кеша: использовать предыдущее решение если оно свежее
        now = time.time()
        if (self.last_decision and
            now - self.last_decision_time < self.decision_timeout_s and
            sit.battery_pct > 15):  # кроме критических ситуаций
            self.cache_hits += 1
            return self.last_decision

        t0 = time.time()
        prompt = self._format_prompt(sit)

        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.ollama_url}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": prompt,
                        "stream": False,
                        "options": {
                            "temperature": 0.1,
                            "num_predict": 30,
                            "top_k": 20,
                        },
                    },
                    timeout=aiohttp.ClientTimeout(total=timeout_s),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        raw = data.get("response", "").strip()
                    else:
                        raw = ""
        except Exception as e:
            raw = ""
            self.fallback_count += 1

        elapsed_ms = (time.time() - t0) * 1000
        self.total_latency_ms += elapsed_ms
        self.decisions_made += 1

        decision = self._parse_response(raw, elapsed_ms)
        self.last_decision = decision
        self.last_decision_time = now
        return decision

    def decide_sync(self, sit: TacticalSituation,
                    timeout_s: float = 5.0) -> TacticalDecision:
        """Синхронная обёртка. Всегда использует urllib (надёжнее)."""
        return self._decide_sync_impl(sit, timeout_s)

    def _decide_sync_impl(self, sit: TacticalSituation,
                          timeout_s: float = 5.0) -> TacticalDecision:
        """Синхронная реализация через urllib (работает внутри asyncio loop)."""
        import urllib.request, urllib.error

        now = time.time()
        if (self.last_decision and
            now - self.last_decision_time < self.decision_timeout_s and
            sit.battery_pct > 15):
            self.cache_hits += 1
            return self.last_decision

        t0 = time.time()
        prompt = self._format_prompt(sit)

        try:
            data = json.dumps({
                "model": self.model,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.1, "num_predict": 30, "top_k": 20},
            }).encode()
            req = urllib.request.Request(
                f"{self.ollama_url}/api/generate",
                data=data,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                raw = json.loads(resp.read()).get("response", "").strip()
        except Exception as e:
            raw = f"ERROR: {str(e)[:100]}"
            self.fallback_count += 1

        elapsed_ms = (time.time() - t0) * 1000
        self.total_latency_ms += elapsed_ms
        self.decisions_made += 1

        decision = self._parse_response(raw, elapsed_ms)
        self.last_decision = decision
        self.last_decision_time = now
        return decision

    def _parse_response(self, raw: str, latency_ms: float) -> TacticalDecision:
        """Разобрать ответ Serafim в структуру TacticalDecision."""
        r = raw.lower().strip()

        # Действие
        if r.startswith("attack") or "attack" in r[:25]:
            action = SerafimAction.ATTACK
        elif r.startswith("rtb") or "rtb" in r[:25]:
            action = SerafimAction.RTB
        elif r.startswith("observe") or "observe" in r[:25]:
            action = SerafimAction.OBSERVE
        elif r.startswith("patrol") or "patrol" in r[:25]:
            action = SerafimAction.PATROL
        elif r.startswith("support") or "support" in r[:25]:
            action = SerafimAction.SUPPORT
        else:
            # Умолчание на основе ситуации
            action = SerafimAction.PATROL

        return TacticalDecision(
            action=action,
            reason=raw[:200] if raw else "no response",
            priority=self._extract_priority(r),
            speed_ms=self._extract_speed(r),
            altitude_m=self._extract_altitude(r),
            heading_deg=self._extract_heading(r),
            confidence=0.8 if raw else 0.3,
            latency_ms=latency_ms,
            raw_response=raw,
        )

    def _extract_priority(self, r: str) -> int:
        m = re.search(r'priority[:\s]*(\d+)', r)
        return int(m.group(1)) if m else 5

    def _extract_speed(self, r: str) -> float:
        m = re.search(r'speed[:\s]*(\d+)', r)
        return float(m.group(1)) if m else 20.0

    def _extract_altitude(self, r: str) -> float:
        m = re.search(r'alt[:\s]*(\d+)', r)
        return float(m.group(1)) if m else 100.0

    def _extract_heading(self, r: str) -> float:
        m = re.search(r'heading[:\s]*(\d+)', r)
        return float(m.group(1)) if m else 0.0

    # ═══════════════════════════════════════════════════════════
    # РЕШЕНИЕ → ДЕЙСТВИЕ ДРОНА
    # ═══════════════════════════════════════════════════════════

    def apply_decision(self, agent, decision: TacticalDecision,
                       nearest_enemy=None, nearest_dist: float = float('inf')):
        """
        Применить решение Serafim к дрону в симуляции.

        agent — CombatAgent из training_arena.py
        Модифицирует agent.vx, vy, vz, phase.
        """
        if decision.action == SerafimAction.ATTACK and nearest_enemy and nearest_dist < 2000:
            dx = nearest_enemy.x - agent.x
            dz = nearest_enemy.z - agent.z
            dist = max(nearest_dist, 1)
            speed = decision.speed_ms
            agent.vx = dx / dist * speed
            agent.vz = dz / dist * speed
            agent.phase = type(agent).phase.__class__("attack")  # CombatPhase hack
            if self.role in ("ФПВ", "КАМИКАДЗЕ"):
                agent.y = min(agent.y, 30 + nearest_dist * 0.05)

        elif decision.action == SerafimAction.RTB:
            # Возврат на базу (0,0)
            dist_to_base = math.sqrt(agent.x**2 + agent.z**2)
            if dist_to_base > 1:
                agent.vx = -agent.x / dist_to_base * 30
                agent.vz = -agent.z / dist_to_base * 30
            else:
                agent.vx = agent.vz = 0
            agent.phase = type(agent).phase.__class__("retreat")

        elif decision.action == SerafimAction.OBSERVE and nearest_enemy and nearest_dist < 1500:
            # Держать дистанцию, кружить
            if nearest_dist < 500:
                dx = agent.x - nearest_enemy.x
                dz = agent.z - nearest_enemy.z
                agent.vx = dx / max(nearest_dist, 1) * 25
                agent.vz = dz / max(nearest_dist, 1) * 25
            else:
                tick = int(time.time() * 10)
                agent.vx = -nearest_dist * 0.01 * math.sin(tick * 0.02)
                agent.vz = nearest_dist * 0.01 * math.cos(tick * 0.02)
            agent.phase = type(agent).phase.__class__("engage")

        else:
            # PATROL / умолчание
            tick = int(time.time() * 10)
            agent.vx = 20 * math.sin(tick * 0.005 + hash(agent.id) % 100)
            agent.vz = 20 * math.cos(tick * 0.005 + hash(agent.id) % 100)
            agent.phase = type(agent).phase.__class__("patrol")

    def get_stats(self) -> dict:
        return {
            "agent_id": self.id,
            "role": self.role,
            "decisions_made": self.decisions_made,
            "avg_latency_ms": round(self.total_latency_ms / max(1, self.decisions_made), 1),
            "cache_hits": self.cache_hits,
            "cache_ratio": round(self.cache_hits / max(1, self.decisions_made + self.cache_hits), 2),
            "fallback_count": self.fallback_count,
        }


# ═══════════════════════════════════════════════════════════════
# ФАБРИКА АГЕНТОВ: СОЗДАТЬ АГЕНТОВ ДЛЯ ФЛОТА
# ═══════════════════════════════════════════════════════════════

def create_serafim_fleet(fleet_spec: List[tuple], team: str = "blue") -> Dict[str, SerafimAgent]:
    """
    Создать агентов Serafim для флота.

    fleet_spec: [(id, role, name), ...] — из BLUE_FLEET или RED_FLEET
    """
    agents = {}
    for fid, role, name in fleet_spec:
        agents[fid] = SerafimAgent(agent_id=fid, role=role, team=team)
    return agents


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════╗")
    print("║  Serafim Agent — боевой LLM-агент   ║")
    print("╚══════════════════════════════════════╝")
    print()

    # Создать агента
    scout = SerafimAgent("test-1", "РАЗВ", "blue")

    # Построить обстановку
    sit = scout.build_situation(
        x=100, y=120, z=200,
        enemies=[
            {"id": "R1", "role": "танк", "dist_m": 400, "heading_rel_deg": 30, "y_rel": -20},
        ],
        nearest_enemy_dist=400,
        friendlies_alive=4,
        battery=80,
        comms_quality=0.9,
        mission_phase="patrol",
    )

    # Принять решение (синхронно, напрямую)
    print("Обстановка:", scout._format_prompt(sit)[:200])
    print()
    decision = scout._decide_sync_impl(sit)
    print(f"Решение: {decision.action.value}")
    print(f"Причина: {decision.reason[:200]}")
    print(f"Задержка: {decision.latency_ms:.0f}ms")
    print(f"Уверенность: {decision.confidence:.0%}")
    print()
    print(f"Статистика: {scout.get_stats()}")
