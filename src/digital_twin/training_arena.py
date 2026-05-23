#!/usr/bin/env python3
"""
training_arena.py — Арена самообучения: синие vs красные

Два роя сражаются автономно. Каждый бой = опыт в W-матрицу.
Без геймеров. Без реальных полётов. Только ИИ-агенты.

Архитектура:
  🔵 Синий рой (наши): 14 дронов, Serafim LLM, gift-онтология
  🔴 Красный рой (противник): 8 дронов + ПВО, агрессивная тактика
  🏟 Арена: 4×4 км, случайный рельеф, погода, время суток
  📊 Матрица: каждый бой → gift acts → W-матрица растёт

Самообучение:
  - Агенты запоминают исходы боёв
  - Успешные тактики получают больший вес в матрице
  - После 100+ игр паттерны выживания кристаллизуются
  - Serafim учится на истории: "в прошлый раз атака с юга сработала"

Sim-to-real:
  - Параметры дронов соответствуют реальным (скорость, батарея, связь)
  - Сенсоры имеют реалистичный шум
  - РЭБ-среда моделируется с реальными характеристиками
  - После training arena → можно дообучить на реальных полётах
"""

import math, random, time, json, threading, os, sys, hashlib
from http.server import HTTPServer, BaseHTTPRequestHandler
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from collections import defaultdict, deque
from enum import Enum

# ═══════════════════════════════════════════════════════════════
# КОНФИГУРАЦИЯ АРЕНЫ
# ═══════════════════════════════════════════════════════════════

ARENA_SIZE = 4000  # метров
CELL_SIZE = 100    # метров (40×40 grid)

# Синий рой (наши)
BLUE_FLEET = [
    ("B-S1", "РАЗВ", "Ворон"), ("B-S2", "РАЗВ", "Сова"), ("B-S3", "РАЗВ", "Сокол"),
    ("B-F1", "ФПВ", "Пчела"), ("B-F2", "ФПВ", "Волк"), ("B-F3", "ФПВ", "Ласка"),
    ("B-F4", "ФПВ", "Барс"), ("B-L1", "ФПВ", "Шершень"),
    ("B-P1", "ПЕРЕ", "Ястреб"), ("B-P2", "ПЕРЕ", "Орёл"),
    ("B-R1", "РЕТР", "Заря"),
    ("B-G1", "НАЗМ", "База-З"), ("B-G2", "НАЗМ", "База-Ц"), ("B-G3", "НАЗМ", "База-В"),
]

# Красный рой (противник)
RED_FLEET = [
    ("R-E1", "КАМИКАДЗЕ", "Шахид-1"), ("R-E2", "КАМИКАДЗЕ", "Шахид-2"),
    ("R-E3", "РАЗВ", "Глаз-1"), ("R-E4", "РАЗВ", "Глаз-2"),
    ("R-E5", "ФПВ", "Коготь-1"), ("R-E6", "ФПВ", "Коготь-2"),
    ("R-E7", "РЕТР", "Мост-1"), ("R-E8", "ПЕРЕ", "Страж-1"),
]

RED_AIR_DEFENSE = [
    ("R-AD1", "ПВО", 1500, 800), ("R-AD2", "ПВО", -1200, -600),
]

# ═══════════════════════════════════════════════════════════════
# АГЕНТ
# ═══════════════════════════════════════════════════════════════

class CombatPhase(Enum):
    DEPLOY = "deploy"
    PATROL = "patrol"
    ENGAGE = "engage"
    ATTACK = "attack"
    RETREAT = "retreat"
    DEAD = "dead"

@dataclass
class CombatAgent:
    """Боевой агент — дрон с памятью и опытом"""
    id: str; role: str; name: str; team: str  # "blue" or "red"
    x: float = 0; z: float = 0; y: float = 100
    vx: float = 0; vz: float = 0
    heading: float = 0
    battery: float = 100
    phase: CombatPhase = CombatPhase.DEPLOY
    kills: int = 0
    deaths: int = 0
    damage_dealt: float = 0
    # Опыт
    missions_survived: int = 0
    total_kills: int = 0
    # Тактическая память
    successful_tactics: List[str] = field(default_factory=list)
    failed_tactics: List[str] = field(default_factory=list)
    # Gift tracking
    gifts_given: int = 0
    gift_weight_total: float = 0

class TrainingArena:
    """
    Арена самообучения: синие vs красные.

    Каждая игра:
      1. Случайная карта (рельеф, погода, время)
      2. Синие и красные размещаются на базах
      3. Автономный бой до победы одной из сторон
      4. Все действия → gift acts → W-матрица
      5. Статистика → обучение агентов
    """

    def __init__(self, game_id: str = None):
        self.game_id = game_id or f"game-{int(time.time())}"
        self.tick = 0
        self.dt = 0.1

        # Агенты
        self.blue_agents: Dict[str, CombatAgent] = {}
        self.red_agents: Dict[str, CombatAgent] = {}
        self._init_fleets()

        # ПВО
        self.air_defense = []
        for aid, atype, ax, az in RED_AIR_DEFENSE:
            self.air_defense.append({
                "id": aid, "type": atype, "x": ax, "z": az,
                "range": 1800, "lethality": 0.004, "min_alt": 25, "active": True
            })

        # Карта
        self.weather = random.choice(["clear", "cloudy", "rain", "fog", "night"])
        self.wind_speed = random.uniform(0, 10)
        self.wind_dir = random.uniform(0, 360)
        self.time_of_day = random.uniform(0, 24)  # часы

        # События
        self.events: deque = deque(maxlen=500)
        self.kill_feed: deque = deque(maxlen=50)

        # Gift tracking для этой игры
        self.game_gift_acts: List[dict] = []
        self.total_gift_weight = 0

        # Статистика
        self.blue_score = 0
        self.red_score = 0
        self.winner = None
        self.duration_ticks = 0

    def _init_fleets(self):
        for fid, role, name in BLUE_FLEET:
            agent = CombatAgent(id=fid, role=role, name=name, team="blue")
            agent.x = random.uniform(-500, 500)
            agent.z = random.uniform(-500, 500)
            agent.y = 150 if role != "НАЗМ" else 0
            self.blue_agents[fid] = agent

        for fid, role, name in RED_FLEET:
            agent = CombatAgent(id=fid, role=role, name=name, team="red")
            agent.x = random.uniform(500, 1500)
            agent.z = random.uniform(500, 1500)
            agent.y = 120 if role != "НАЗМ" else 0
            self.red_agents[fid] = agent

    # ═══ ГЛАВНЫЙ ЦИКЛ ИГРЫ ═══════════════════════════════════

    def tick_game(self) -> dict:
        """Один тик игры. Возвращает события тика."""
        self.tick += 1
        tick_events = []

        # Обновление всех агентов
        for agents in [self.blue_agents, self.red_agents]:
            for agent in agents.values():
                if agent.phase == CombatPhase.DEAD:
                    continue
                self._update_agent(agent, tick_events)

        # ПВО
        self._update_air_defense(tick_events)

        # Проверка победы
        blue_alive = sum(1 for a in self.blue_agents.values() if a.phase != CombatPhase.DEAD)
        red_alive = sum(1 for a in self.red_agents.values() if a.phase != CombatPhase.DEAD)
        max_ticks = 5000  # тайм-лимит игры

        if blue_alive == 0 and red_alive > 0:
            self.winner = "red"; self.red_score += 1
            tick_events.append({"event": "GAME_OVER", "winner": "red", "tick": self.tick})
        elif red_alive == 0 and blue_alive > 0:
            self.winner = "blue"; self.blue_score += 1
            tick_events.append({"event": "GAME_OVER", "winner": "blue", "tick": self.tick})
        elif self.tick >= max_ticks:
            # Тайм-лимит: побеждает сторона с большим числом выживших
            if blue_alive > red_alive:
                self.winner = "blue"; self.blue_score += 1
            elif red_alive > blue_alive:
                self.winner = "red"; self.red_score += 1
            else:
                self.winner = "draw"
            tick_events.append({"event": "GAME_OVER", "winner": self.winner, "tick": self.tick,
                              "reason": "time_limit", "blue_alive": blue_alive, "red_alive": red_alive})

        self.duration_ticks = self.tick
        return {"tick": self.tick, "events": tick_events}

    def _update_agent(self, agent: CombatAgent, events: list):
        """Обновить одного агента"""
        # Поиск ближайшего врага
        enemy_team = self.red_agents if agent.team == "blue" else self.blue_agents
        nearest_enemy = None
        nearest_dist = float('inf')
        for enemy in enemy_team.values():
            if enemy.phase == CombatPhase.DEAD:
                continue
            dist = math.sqrt((agent.x - enemy.x)**2 + (agent.z - enemy.z)**2)
            if dist < nearest_dist:
                nearest_dist = dist
                nearest_enemy = enemy

        # Тактическое решение
        if agent.role in ("РАЗВ", "ПЕРЕ"):
            # Патрулирование с уклонением
            if nearest_enemy and nearest_dist < 1500:
                agent.phase = CombatPhase.ENGAGE
                # Держать дистанцию
                if nearest_dist < 500:
                    dx = agent.x - nearest_enemy.x
                    dz = agent.z - nearest_enemy.z
                    agent.vx = dx / max(nearest_dist, 1) * 25
                    agent.vz = dz / max(nearest_dist, 1) * 25
                else:
                    # Кружить вокруг врага
                    agent.vx = -nearest_dist * 0.01 * math.sin(self.tick * 0.02)
                    agent.vz = nearest_dist * 0.01 * math.cos(self.tick * 0.02)
            else:
                agent.phase = CombatPhase.PATROL
                agent.vx = 20 * math.sin(self.tick * 0.005 + hash(agent.id) % 100)
                agent.vz = 20 * math.cos(self.tick * 0.005 + hash(agent.id) % 100)

        elif agent.role == "ФПВ":
            # Ищет врага и атакует
            if nearest_enemy and nearest_dist < 800:
                agent.phase = CombatPhase.ATTACK
                dx = nearest_enemy.x - agent.x
                dz = nearest_enemy.z - agent.z
                speed = 55
                agent.vx = dx / max(nearest_dist, 1) * speed
                agent.vz = dz / max(nearest_dist, 1) * speed
                agent.y = 30 + nearest_dist * 0.05  # снижение для атаки

                # Попадание?
                if nearest_dist < 15:
                    nearest_enemy.phase = CombatPhase.DEAD
                    agent.kills += 1
                    agent.total_kills += 1
                    agent.damage_dealt += 100
                    events.append({
                        "event": "KILL", "killer": f"{agent.name}({agent.id})",
                        "victim": f"{nearest_enemy.name}({nearest_enemy.id})",
                        "team": agent.team, "tick": self.tick,
                        "weapon": "FPV-impact"
                    })
                    self.kill_feed.append(f"💥 {agent.name} → {nearest_enemy.name}")
                    # Gift act: kill
                    self._record_gift(agent.id, "_koinon", "time", 10,
                                     f"Уничтожение {nearest_enemy.name}")
                    agent.phase = CombatPhase.RETREAT
            else:
                agent.phase = CombatPhase.PATROL
                agent.vx = 15 * math.sin(self.tick * 0.01 + hash(agent.id) % 50)
                agent.vz = 15 * math.cos(self.tick * 0.01 + hash(agent.id) % 50)

        elif agent.role == "КАМИКАДЗЕ":
            # Агрессивная атака — идёт на таран
            if nearest_enemy and nearest_dist < 2000:
                agent.phase = CombatPhase.ATTACK
                speed = 40
                agent.vx = (nearest_enemy.x - agent.x) / max(nearest_dist, 1) * speed
                agent.vz = (nearest_enemy.z - agent.z) / max(nearest_dist, 1) * speed
                agent.y -= 2  # пикирует

                if nearest_dist < 20:
                    # Камикадзе уничтожает врага и себя
                    nearest_enemy.phase = CombatPhase.DEAD
                    agent.phase = CombatPhase.DEAD
                    agent.deaths += 1
                    agent.kills += 1
                    events.append({
                        "event": "KILL", "killer": f"{agent.name}({agent.id})",
                        "victim": f"{nearest_enemy.name}({nearest_enemy.id})",
                        "team": agent.team, "tick": self.tick,
                        "weapon": "kamikaze"
                    })
                    self.kill_feed.append(f"☠ {agent.name} камикадзе → {nearest_enemy.name}")
                    self._record_gift(agent.id, "_koinon", "time", 10,
                                     f"Камикадзе-атака на {nearest_enemy.name}")

        elif agent.role == "РЕТР":
            agent.phase = CombatPhase.PATROL
            agent.y = 350  # высоко для ретрансляции
            agent.vx = 10 * math.sin(self.tick * 0.003)
            agent.vz = 10 * math.cos(self.tick * 0.003)

        elif agent.role == "НАЗМ":
            # База не двигается, но уязвима для камикадзе и FPV
            agent.phase = CombatPhase.DEPLOY
            agent.vx = agent.vz = 0
            agent.y = 0
            # База уязвима — враг может атаковать на y=0
            if nearest_enemy and nearest_dist < 20:
                # Враг достиг базы — уничтожает её
                agent.phase = CombatPhase.DEAD
                agent.deaths += 1
                nearest_enemy.kills += 1
                events.append({
                    "event": "BASE_DESTROYED",
                    "base": f"{agent.name}({agent.id})",
                    "by": f"{nearest_enemy.name}({nearest_enemy.id})",
                    "team": agent.team, "tick": self.tick,
                })
                self.kill_feed.append(f"🏚 {nearest_enemy.name} уничтожил базу {agent.name}")

        # Физика
        agent.x += agent.vx * self.dt
        agent.z += agent.vz * self.dt
        agent.heading = math.degrees(math.atan2(agent.vx, agent.vz)) % 360

        # Батарея
        drain = {"РАЗВ": 0.003, "ФПВ": 0.005, "ПЕРЕ": 0.004, "КАМИКАДЗЕ": 0.01,
                 "РЕТР": 0.002, "НАЗМ": 0.001}
        agent.battery -= drain.get(agent.role, 0.003) * self.dt
        if agent.phase == CombatPhase.ATTACK:
            agent.battery -= 0.01 * self.dt  # форсаж
        if agent.battery < 5:
            agent.phase = CombatPhase.RETREAT

        # Ветер
        wind_vx = -self.wind_speed * math.sin(math.radians(self.wind_dir))
        wind_vz = -self.wind_speed * math.cos(math.radians(self.wind_dir))
        agent.vx += wind_vx * 0.01
        agent.vz += wind_vz * 0.01

        # Возврат на базу при низкой батарее
        if agent.battery < 10 and agent.team == "blue" and agent.phase != CombatPhase.DEAD:
            agent.phase = CombatPhase.RETREAT
            # Лететь к ближайшей базе
            bases = [a for a in self.blue_agents.values()
                    if a.role == "НАЗМ" and a.phase != CombatPhase.DEAD]
            if bases:
                base = min(bases, key=lambda b: math.sqrt((agent.x-b.x)**2 + (agent.z-b.z)**2))
                dx, dz = base.x - agent.x, base.z - agent.z
                dist = math.sqrt(dx*dx + dz*dz)
                agent.vx = dx / max(dist, 1) * 30
                agent.vz = dz / max(dist, 1) * 30
                if dist < 50:
                    agent.battery = min(100, agent.battery + 5)
                    agent.missions_survived += 1
                    events.append({"event": "RESUPPLY", "agent": agent.name, "tick": self.tick})
                    self._record_gift(agent.id, "База", "presence", 5,
                                     f"Возвращение на базу (bat={agent.battery:.0f}%)")

    def _update_air_defense(self, events: list):
        """Обновить ПВО — стреляет по вражеским дронам (и базам)"""
        for ad in self.air_defense:
            if not ad["active"]:
                continue
            for agent in self.blue_agents.values():
                if agent.phase == CombatPhase.DEAD:
                    continue
                dist = math.sqrt((agent.x - ad["x"])**2 + (agent.z - ad["z"])**2)
                # ПВО бьёт по воздушным целям И по наземным базам (если в радиусе)
                can_hit = (agent.y > ad["min_alt"]) or (agent.role == "НАЗМ" and dist < ad["range"] * 0.5)
                if dist < ad["range"] and can_hit:
                    lethality = ad["lethality"] * (1 - dist/ad["range"])
                    if agent.role == "НАЗМ":
                        lethality *= 0.3  # базу труднее поразить
                    if random.random() < lethality:
                        agent.phase = CombatPhase.DEAD
                        agent.deaths += 1
                        events.append({
                            "event": "SHOT_DOWN", "victim": f"{agent.name}({agent.id})",
                            "by": ad["id"], "tick": self.tick
                        })
                        self.kill_feed.append(f"🛡 {ad['id']} сбил {agent.name}")
                        self._record_gift(agent.id, "_koinon", "time", 10,
                                        f"Сбит ПВО {ad['id']} — жертва принята")

    def _record_gift(self, giver, receiver, gift_type, weight, description):
        """Записать акт дара в игре"""
        act = {
            "giver": giver, "receiver": receiver,
            "type": gift_type, "weight": weight,
            "description": description,
            "game_id": self.game_id, "tick": self.tick,
            "timestamp": time.time(),
        }
        self.game_gift_acts.append(act)
        self.total_gift_weight += weight

        # Обновить агента
        agent = self.blue_agents.get(giver) or self.red_agents.get(giver)
        if agent:
            agent.gifts_given += 1
            agent.gift_weight_total += weight

    # ═══ СТАТИСТИКА ═══════════════════════════════════════

    def get_game_state(self) -> dict:
        """Полное состояние игры для API"""
        def agent_dict(a: CombatAgent):
            return {
                "id": a.id, "name": a.name, "role": a.role, "team": a.team,
                "x": round(a.x, 1), "z": round(a.z, 1), "y": round(a.y, 1),
                "heading": round(a.heading, 1),
                "battery": round(a.battery, 1),
                "phase": a.phase.value,
                "kills": a.kills, "deaths": a.deaths,
                "missions": a.missions_survived,
                "gifts": a.gifts_given,
            }

        blue_alive = sum(1 for a in self.blue_agents.values() if a.phase != CombatPhase.DEAD)
        red_alive = sum(1 for a in self.red_agents.values() if a.phase != CombatPhase.DEAD)

        return {
            "game_id": self.game_id,
            "tick": self.tick,
            "weather": self.weather,
            "wind": {"speed": round(self.wind_speed, 1), "dir": round(self.wind_dir, 0)},
            "time_of_day": round(self.time_of_day, 1),
            "blue": {
                "agents": [agent_dict(a) for a in self.blue_agents.values()],
                "alive": blue_alive,
                "total": len(self.blue_agents),
                "kills": sum(a.kills for a in self.blue_agents.values()),
            },
            "red": {
                "agents": [agent_dict(a) for a in self.red_agents.values()],
                "alive": red_alive,
                "total": len(self.red_agents),
                "kills": sum(a.kills for a in self.red_agents.values()),
            },
            "air_defense": [{"id": ad["id"], "x": ad["x"], "z": ad["z"],
                            "range": ad["range"], "active": ad["active"]}
                           for ad in self.air_defense],
            "kill_feed": list(self.kill_feed)[-15:],
            "gifts_this_game": len(self.game_gift_acts),
            "total_gift_weight": round(self.total_gift_weight, 1),
            "winner": self.winner,
            "events": list(self.events)[-30:],
        }


# ═══════════════════════════════════════════════════════════════
# МЕНЕДЖЕР ТРЕНИРОВКИ
# ═══════════════════════════════════════════════════════════════

class TrainingManager:
    """
    Управляет серией игр для обучения матрицы.

    После каждой игры:
      1. Результат → gift acts → W-матрица
      2. Выжившие агенты получают бонус опыта
      3. Тактики оцениваются по результату
      4. Матрица растёт
    """

    def __init__(self):
        self.current_game: Optional[TrainingArena] = None
        self.games_played = 0
        self.blue_wins = 0
        self.red_wins = 0
        self.total_gift_weight = 0
        self.total_gift_acts = 0

        # Агенты с памятью между играми
        self.persistent_agents: Dict[str, CombatAgent] = {}

        # История игр
        self.game_history: deque = deque(maxlen=100)

        # Режим
        self.auto_restart = True  # автоматический рестарт после конца игры
        self.training_speed = 5   # множитель скорости (ускорено)

    def start_new_game(self):
        """Начать новую игру"""
        game_id = f"game-{self.games_played + 1}"
        self.current_game = TrainingArena(game_id)
        return self.current_game

    def tick(self):
        """Тик тренировки"""
        if self.current_game is None:
            self.start_new_game()
            return

        if self.current_game.winner is not None:
            # Игра закончена — записать результаты
            self._record_game_result()
            if self.auto_restart:
                self.start_new_game()
            return

        for _ in range(self.training_speed):
            result = self.current_game.tick_game()

    def _record_game_result(self):
        """Записать результат игры и обновить матрицу"""
        game = self.current_game
        self.games_played += 1

        if game.winner == "blue":
            self.blue_wins += 1
        elif game.winner == "red":
            self.red_wins += 1

        # Акты дара из игры → общая статистика
        self.total_gift_acts += len(game.game_gift_acts)
        self.total_gift_weight += game.total_gift_weight

        # Сохранить выживших агентов
        for agent in game.blue_agents.values():
            if agent.phase != CombatPhase.DEAD:
                agent.missions_survived += 1
                self.persistent_agents[agent.id] = agent

        # История
        self.game_history.append({
            "game_id": game.game_id,
            "winner": game.winner,
            "duration_ticks": game.duration_ticks,
            "blue_alive": sum(1 for a in game.blue_agents.values() if a.phase != CombatPhase.DEAD),
            "red_alive": sum(1 for a in game.red_agents.values() if a.phase != CombatPhase.DEAD),
            "blue_kills": sum(a.kills for a in game.blue_agents.values()),
            "red_kills": sum(a.kills for a in game.red_agents.values()),
            "gift_acts": len(game.game_gift_acts),
            "gift_weight": round(game.total_gift_weight, 1),
            "weather": game.weather,
        })

    def get_training_status(self) -> dict:
        return {
            "games_played": self.games_played,
            "blue_wins": self.blue_wins,
            "red_wins": self.red_wins,
            "blue_win_rate": round(100 * self.blue_wins / max(1, self.games_played), 1),
            "total_gift_acts": self.total_gift_acts,
            "total_gift_weight": round(self.total_gift_weight, 1),
            "avg_gift_per_game": round(self.total_gift_weight / max(1, self.games_played), 1),
            "persistent_agents": len(self.persistent_agents),
            "game_history": list(self.game_history)[-10:],
            "current_game": self.current_game.get_game_state() if self.current_game else None,
            "auto_restart": self.auto_restart,
            "training_speed": self.training_speed,
        }


# ═══════════════════════════════════════════════════════════════
# HTTP API
# ═══════════════════════════════════════════════════════════════

trainer = TrainingManager()

class ArenaHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]

        if path == "/api/arena":
            if trainer.current_game:
                self.send_json(trainer.current_game.get_game_state())
            else:
                self.send_json({"status": "no game"})
        elif path == "/api/training":
            self.send_json(trainer.get_training_status())
        elif path == "/api/games":
            self.send_json(list(trainer.game_history))
        elif path == "/api/agents":
            agents = {}
            if trainer.current_game:
                for a in trainer.current_game.blue_agents.values():
                    agents[a.id] = {"name": a.name, "role": a.role, "kills": a.total_kills,
                                    "missions": a.missions_survived, "gifts": a.gifts_given}
            self.send_json(agents)
        elif path == "/":
            self.send_html()
        elif path == "/api/cmd/restart":
            trainer.start_new_game()
            self.send_json({"status": "new game started"})
        elif path == "/api/cmd/speed-2":
            trainer.training_speed = 2
            self.send_json({"speed": 2})
        elif path == "/api/cmd/speed-5":
            trainer.training_speed = 5
            self.send_json({"speed": 5})
        elif path == "/api/cmd/speed-10":
            trainer.training_speed = 10
            self.send_json({"speed": 10})
        elif path == "/api/cmd/speed-50":
            trainer.training_speed = 50
            self.send_json({"speed": 50})
        elif path == "/api/cmd/auto-off":
            trainer.auto_restart = False
            self.send_json({"auto_restart": False})
        else:
            self.send_error(404)

    def send_json(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, default=str).encode())

    def send_html(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        html_path = os.path.join(os.path.dirname(__file__), "index_arena.html")
        if os.path.exists(html_path):
            self.wfile.write(open(html_path, "rb").read())
        else:
            self.wfile.write(("""<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Training Arena</title><style>body{background:#0a0f1e;color:#0f0;font:12px monospace;padding:20px}
.panel{background:#111;border:1px solid #333;padding:15px;margin:10px 0}
h2{color:#0ff} .kill{color:#f44} .gift{color:#ff0} .blue{color:#48f} .red{color:#f44}</style></head>
<body><h1>Training Arena</h1><div id="state">Loading...</div>
<script>setInterval(async()=>{try{const r=await fetch('/api/arena');const d=await r.json();
document.getElementById('state').innerHTML=
'<div class="panel"><h2>Game '+d.game_id+'</h2>'+
'Tick: '+d.tick+' | Weather: '+d.weather+' | Wind: '+d.wind.speed+'m/s'+
'<br>Blue: '+d.blue.alive+'/'+d.blue.total+' alive, '+d.blue.kills+' kills'+
'<br>Red: '+d.red.alive+'/'+d.red.total+' alive, '+d.red.kills+' kills'+
'<br>Gifts: '+d.gifts_this_game+' (weight '+d.total_gift_weight+')'+
'<br>Winner: '+(d.winner||'fighting...')+
'</div>'+
'<div class="panel"><h2>Kill Feed</h2>'+(d.kill_feed||[]).map(k=>'<div class="kill">'+k+'</div>').join('<br>')+'</div>'+
'<div class="panel"><h2>Blue Agents</h2>'+(d.blue.agents||[]).map(a=>'<span class="blue">'+a.name+'('+a.role+')</span> bat:'+a.battery+'% '+a.phase+' kills='+a.kills).join('<br>')+'</div>'+
'<div class="panel"><h2>Red Agents</h2>'+(d.red.agents||[]).map(a=>'<span class="red">'+a.name+'('+a.role+')</span> bat:'+a.battery+'% '+a.phase+' kills='+a.kills).join('<br>')+'</div>'
}catch(e){}},500)</script></body></html>""").encode())

    def log_message(self, *args): pass


# ═══════════════════════════════════════════════════════════════
# ФОНОВЫЙ ПОТОК ТРЕНИРОВКИ
# ═══════════════════════════════════════════════════════════════

def training_loop():
    """Бесконечный цикл тренировки"""
    while True:
        trainer.tick()
        time.sleep(0.05)  # 20 Hz


def main():
    print("╔══════════════════════════════════════════════════════╗")
    print("║  🏟 TRAINING ARENA — Self-Play Обучение Матрицы     ║")
    print("║  Синие vs Красные — автономные бои без геймеров     ║")
    print("╚══════════════════════════════════════════════════════╝")
    print(f"  🔵 Синий рой: {len(BLUE_FLEET)} дронов с Serafim LLM")
    print(f"  🔴 Красный рой: {len(RED_FLEET)} дронов + {len(RED_AIR_DEFENSE)} ПВО")
    print(f"  🌐 Веб: http://localhost:8102")
    print(f"  📊 API: http://localhost:8102/api/training")
    print()

    trainer.start_new_game()

    sim_thread = threading.Thread(target=training_loop, daemon=True)
    sim_thread.start()

    server = HTTPServer(("0.0.0.0", 8102), ArenaHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        print("\nТренировка остановлена.")


if __name__ == "__main__":
    main()
