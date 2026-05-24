#!/usr/bin/env python3
"""
social_metrics.py — Метрики социального поведения LLM-агентов

Измеряет эмерджентное поведение: cooperation, conflict, consensus, role emergence.

Использование:
  tracker = SocialMetricsTracker()
  tracker.record_decision(tick, agent_id, decision, context)
  report = tracker.report()  # после симуляции
"""

import math, time, json
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set, Tuple
from collections import defaultdict, Counter
import statistics


@dataclass
class AgentDecision:
    """Одно решение агента."""
    tick: int
    agent_id: str
    agent_role: str
    action: str            # attack/observe/rtb/patrol/support
    target_id: str = ""
    priority: int = 5
    reasoning: str = ""
    latency_ms: float = 0.0


@dataclass
class SocialEvent:
    """Социальное событие между агентами."""
    tick: int
    event_type: str        # cooperation, conflict, consensus, role_change, kill
    agents: List[str]
    description: str
    metrics: dict = field(default_factory=dict)


class SocialMetricsTracker:
    """
    Отслеживает и измеряет социальное поведение LLM-агентов.

    Ключевые метрики:
      - Cooperation Index: доля совместных действий
      - Conflict Rate: доля конфликтов (два агента → одна цель)
      - Consensus Time: время до консенсуса роя (мс)
      - Role Distribution: энтропия распределения ролей
      - Survival Rate: вернувшиеся / ушедшие
      - Mission Success: поражённые цели / заданные
      - Communication Efficiency: байт/решение
      - Emergent Complexity: незапрограммированные паттерны
    """

    def __init__(self):
        self.decisions: List[AgentDecision] = []
        self.events: List[SocialEvent] = []
        self.tick = 0

        # Аккумуляторы
        self._cooperative_actions: int = 0
        self._total_actions: int = 0
        self._conflicts: int = 0
        self._consensus_attempts: int = 0
        self._consensus_total_time: float = 0.0
        self._role_assignments: List[Dict[str, str]] = []  # [{agent_id: role}]
        self._survivors_start: int = 0
        self._survivors_end: int = 0
        self._targets_assigned: int = 0
        self._targets_destroyed: int = 0
        self._bytes_sent: int = 0
        self._decisions_count: int = 0
        self._emergent_patterns: List[dict] = []  # незапрограммированные поведения

        # История для анализа
        self._target_claims: Dict[int, List[Tuple[int, str]]] = defaultdict(list)  # tick→{target: [agent]}
        self._agent_trajectories: Dict[str, List[dict]] = defaultdict(list)
        self._role_history: List[Dict[str, str]] = []

    # ═══════════════════════════════════════════════════════════
    # ЗАПИСЬ
    # ═══════════════════════════════════════════════════════════

    def record_decision(self, tick: int, agent_id: str, role: str,
                        action: str, target_id: str = "", priority: int = 5,
                        reasoning: str = "", latency_ms: float = 0.0):
        """Записать одно решение агента."""
        d = AgentDecision(
            tick=tick, agent_id=agent_id, agent_role=role,
            action=action, target_id=target_id,
            priority=priority, reasoning=reasoning,
            latency_ms=latency_ms,
        )
        self.decisions.append(d)
        self._total_actions += 1

        # Отслеживание претензий на цели (для detection конфликтов)
        if action == "attack" and target_id:
            self._target_claims[tick].append((target_id, agent_id))

        # Траектория агента
        self._agent_trajectories[agent_id].append({
            "tick": tick, "action": action, "target": target_id, "priority": priority,
        })

    def record_cooperation(self, tick: int, agents: List[str], description: str):
        """Два+ агента выполняют совместное действие."""
        self._cooperative_actions += 1
        self.events.append(SocialEvent(
            tick=tick, event_type="cooperation",
            agents=agents, description=description,
        ))

    def record_conflict(self, tick: int, target_id: str, agents: List[str]):
        """Конфликт: несколько агентов претендуют на одну цель."""
        self._conflicts += 1
        self.events.append(SocialEvent(
            tick=tick, event_type="conflict",
            agents=agents, description=f"Target {target_id} claimed by {agents}",
            metrics={"target_id": target_id},
        ))

    def record_consensus(self, tick: int, start_tick: int, agents: List[str],
                         decision: str):
        """Рой достиг консенсуса."""
        self._consensus_attempts += 1
        time_ms = (tick - start_tick) * 100  # assuming 10Hz tick rate
        self._consensus_total_time += time_ms
        self.events.append(SocialEvent(
            tick=tick, event_type="consensus",
            agents=agents, description=decision,
            metrics={"consensus_time_ms": time_ms},
        ))

    def record_role_change(self, tick: int, agent_id: str,
                           old_role: str, new_role: str, reason: str):
        """Агент спонтанно сменил роль."""
        self.events.append(SocialEvent(
            tick=tick, event_type="role_change",
            agents=[agent_id], description=f"{old_role} → {new_role}: {reason}",
        ))
        # Это эмерджентное поведение — агент не запрограммирован менять роль
        self._emergent_patterns.append({
            "type": "role_change",
            "tick": tick,
            "agent": agent_id,
            "old_role": old_role,
            "new_role": new_role,
            "reason": reason,
        })

    def record_emergent(self, tick: int, pattern_type: str,
                         agents: List[str], description: str):
        """Зафиксировано незапрограммированное поведение."""
        self._emergent_patterns.append({
            "type": pattern_type,
            "tick": tick,
            "agents": agents,
            "description": description,
        })

    def set_initial_conditions(self, agents_count: int, targets_count: int):
        self._survivors_start = agents_count
        self._targets_assigned = targets_count

    def set_final_conditions(self, survivors: int, targets_destroyed: int):
        self._survivors_end = survivors
        self._targets_destroyed = targets_destroyed

    def add_bytes_sent(self, bytes_count: int):
        self._bytes_sent += bytes_count
        self._decisions_count += 1

    def update_role_distribution(self, tick: int, agent_roles: Dict[str, str]):
        """Записать распределение ролей в рое на текущий момент."""
        self._role_history.append(agent_roles.copy())

    # ═══════════════════════════════════════════════════════════
    # АНАЛИЗ КОНФЛИКТОВ (post-hoc)
    # ═══════════════════════════════════════════════════════════

    def analyze_conflicts(self):
        """Проанализировать все претензии на цели и найти конфликты."""
        self._conflicts = 0
        for tick, claims in self._target_claims.items():
            targets_claimed = defaultdict(list)
            for target_id, agent_id in claims:
                targets_claimed[target_id].append(agent_id)
            for target_id, agents in targets_claimed.items():
                if len(agents) > 1:
                    self._conflicts += 1

    # ═══════════════════════════════════════════════════════════
    # ОТЧЁТ
    # ═══════════════════════════════════════════════════════════

    def report(self) -> dict:
        """Полный отчёт по метрикам социального поведения."""
        # Анализируем конфликты
        self.analyze_conflicts()

        # Cooperation Index
        coop_idx = (self._cooperative_actions / max(1, self._total_actions))

        # Conflict Rate
        conflict_rate = self._conflicts / max(1, self._total_actions)

        # Consensus Time
        avg_consensus_ms = (self._consensus_total_time / max(1, self._consensus_attempts))

        # Role Distribution entropy
        if self._role_history:
            all_roles = []
            for snapshot in self._role_history:
                all_roles.extend(snapshot.values())
            role_counter = Counter(all_roles)
            total = sum(role_counter.values())
            entropy = -sum((c/total) * math.log2(c/total) for c in role_counter.values() if c > 0)
        else:
            entropy = 0.0

        # Survival Rate
        survival_rate = self._survivors_end / max(1, self._survivors_start)

        # Mission Success
        mission_success = self._targets_destroyed / max(1, self._targets_assigned)

        # Communication Efficiency
        bytes_per_decision = self._bytes_sent / max(1, self._decisions_count)

        # Decision distribution
        action_distribution = Counter(d.action for d in self.decisions)

        # Emergent Complexity Score (нормированный)
        emergent_score = len(self._emergent_patterns) / max(1, self._total_actions / 100)

        # Average latency
        avg_latency = statistics.mean([d.latency_ms for d in self.decisions]) if self.decisions else 0

        return {
            "cooperation": {
                "index": round(coop_idx, 3),
                "cooperative_actions": self._cooperative_actions,
                "total_actions": self._total_actions,
            },
            "conflict": {
                "rate": round(conflict_rate, 3),
                "total_conflicts": self._conflicts,
            },
            "consensus": {
                "attempts": self._consensus_attempts,
                "avg_time_ms": round(avg_consensus_ms, 1),
            },
            "roles": {
                "distribution": dict(role_counter.most_common()) if self._role_history else {},
                "entropy": round(entropy, 3),
                "changes": len([e for e in self.events if e.event_type == "role_change"]),
            },
            "survival": {
                "rate": round(survival_rate, 3),
                "start": self._survivors_start,
                "end": self._survivors_end,
            },
            "mission": {
                "success_rate": round(mission_success, 3),
                "targets_assigned": self._targets_assigned,
                "targets_destroyed": self._targets_destroyed,
            },
            "communication": {
                "bytes_per_decision": round(bytes_per_decision, 1),
                "total_bytes": self._bytes_sent,
                "total_decisions": self._decisions_count,
            },
            "emergent": {
                "patterns_count": len(self._emergent_patterns),
                "complexity_score": round(emergent_score, 3),
                "patterns": self._emergent_patterns[:10],  # top 10
            },
            "decisions": {
                "total": len(self.decisions),
                "distribution": dict(action_distribution.most_common()),
                "avg_latency_ms": round(avg_latency, 1),
            },
            "events": {
                "total": len(self.events),
                "by_type": dict(Counter(e.event_type for e in self.events).most_common()),
            },
        }

    def summary(self) -> str:
        """Краткая текстовая сводка."""
        r = self.report()
        return (
            f"Cooperation: {r['cooperation']['index']:.2f} | "
            f"Conflict: {r['conflict']['rate']:.2f} | "
            f"Consensus: {r['consensus']['avg_time_ms']:.0f}ms | "
            f"Survival: {r['survival']['rate']:.0%} | "
            f"Mission: {r['mission']['success_rate']:.0%} | "
            f"Emergent: {r['emergent']['patterns_count']} patterns | "
            f"Avg latency: {r['decisions']['avg_latency_ms']:.0f}ms"
        )


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    tracker = SocialMetricsTracker()
    tracker.set_initial_conditions(agents_count=5, targets_count=3)

    # Симулируем несколько решений
    tracker.record_decision(1, "B1", "РАЗВ", "patrol", "", 5, "патрулирую", 320)
    tracker.record_decision(2, "B2", "ФПВ", "attack", "R1", 9, "атакую танк", 280)
    tracker.record_decision(2, "B3", "ФПВ", "attack", "R1", 8, "тоже танк", 350)
    tracker.record_cooperation(3, ["B2", "B3"], "Совместная атака на R1")
    tracker.record_conflict(2, "R1", ["B2", "B3"])
    tracker.record_consensus(5, 1, ["B1","B2","B3"], "Атакуем R1 с юга")
    tracker.record_role_change(6, "B3", "ФПВ", "РАЗВ", "батарея низкая, перехожу в разведку")
    tracker.update_role_distribution(1, {"B1": "РАЗВ", "B2": "ФПВ", "B3": "ФПВ"})
    tracker.update_role_distribution(6, {"B1": "РАЗВ", "B2": "ФПВ", "B3": "РАЗВ"})

    tracker.set_final_conditions(survivors=4, targets_destroyed=3)

    print(tracker.summary())
    print()
    print(json.dumps(tracker.report(), indent=2, ensure_ascii=False))
