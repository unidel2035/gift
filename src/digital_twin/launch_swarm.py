#!/usr/bin/env python3
"""
launch_swarm.py — Единый запуск всего роя с пресетами

Полный флот (как в swarm-tactical + расширенный):
  🔵 СИНИЕ (наши): 20 дронов
    3×РАЗВ (разведчик)     — Ворон, Сова, Сокол
    5×ФПВ (ударный)        — Пчела, Волк, Ласка, Барс, Шершень
    2×ПЕРЕ (перехватчик)   — Ястреб, Орёл
    2×РЕТР (ретранслятор)  — Заря, Маяк
    3×НАЗМ (наземная база) — База-З, База-Ц, База-В
    2×РЭБ (постановщик помех) — Гроза, Шторм
    2×КАМИКАДЗЕ (одноразовые) — Искра, Факел
    1×ТЯЖ (тяжёлый носитель)  — Атлант

  🔴 КРАСНЫЕ (противник): 10 дронов + 3 ПВО
    2×КАМИКАДЗЕ — Шахид-1, Шахид-2
    2×РАЗВ — Глаз-1, Глаз-2
    2×ФПВ — Коготь-1, Коготь-2
    2×ПЕРЕ — Страж-1, Страж-2
    1×РЕТР — Мост-1
    1×РЭБ — Глушилка

  Пресеты поведения:
    stealth      — скрытное патрулирование (низкая высота, пассивные сенсоры)
    hunter       — активный поиск и уничтожение
    guardian     — защита периметра базы
    relay        — максимизация покрытия mesh-сети
    kamikaze     — одноразовая атака на цель
    jammer       — постановка помех
    logistics    — снабжение/зарядка

Каждый дрон получает:
  - Собственный экземпляр 3 плат (Cube Orange + Tang Nano + OPi5)
  - Изолированный Serafim LLM
  - Пресет поведения
  - Начальную позицию согласно тактике

Запуск: python3 src/digital_twin/launch_swarm.py
Веб:    http://localhost:8105
"""

import math, random, time, json, threading, os, sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from collections import deque

sys.path.insert(0, '/home/unidel/gift/src/digital_twin')
from board_emulator import BoardSystem

# ═══════════════════════════════════════════════════════════════
# ПРЕСЕТЫ ПОВЕДЕНИЯ
# ═══════════════════════════════════════════════════════════════

BEHAVIOR_PRESETS = {
    "stealth": {
        "altitude": 40, "speed": 20, "sensor_range": 300,
        "emission": "passive", "tactic": "avoid",
        "description": "Скрытный разведчик: низкая высота, пассивные сенсоры"
    },
    "hunter": {
        "altitude": 80, "speed": 55, "sensor_range": 600,
        "emission": "active", "tactic": "seek_and_destroy",
        "description": "Охотник: активный поиск, агрессивная атака"
    },
    "guardian": {
        "altitude": 100, "speed": 30, "sensor_range": 500,
        "emission": "active", "tactic": "defend_perimeter",
        "description": "Страж: защита базы, перехват нарушителей"
    },
    "relay": {
        "altitude": 350, "speed": 10, "sensor_range": 1000,
        "emission": "active", "tactic": "maximize_coverage",
        "description": "Ретранслятор: максимальная высота, mesh-покрытие"
    },
    "kamikaze": {
        "altitude": 30, "speed": 70, "sensor_range": 400,
        "emission": "passive", "tactic": "one_way_attack",
        "description": "Камикадзе: одноразовая атака, не возвращается"
    },
    "jammer": {
        "altitude": 120, "speed": 25, "sensor_range": 800,
        "emission": "active", "tactic": "area_denial",
        "description": "РЭБ: постановка помех, подавление связи"
    },
    "logistics": {
        "altitude": 150, "speed": 35, "sensor_range": 200,
        "emission": "passive", "tactic": "resupply",
        "description": "Снабжение: доставка заряда, ремонт на позиции"
    },
    "heavy_strike": {
        "altitude": 200, "speed": 40, "sensor_range": 700,
        "emission": "active", "tactic": "precision_strike",
        "description": "Тяжёлый ударный: большая полезная нагрузка"
    },
}

# ═══════════════════════════════════════════════════════════════
# ПОЛНЫЙ ФЛОТ (20 синих + 10 красных)
# ═══════════════════════════════════════════════════════════════

BLUE_FLEET_FULL = [
    # ID, Роль, Имя, Пресет, x, z, y, heading
    ("B-S1", "РАЗВ", "Ворон", "stealth", -200, -200, 50, 45),
    ("B-S2", "РАЗВ", "Сова", "stealth", 200, -300, 55, 135),
    ("B-S3", "РАЗВ", "Сокол", "stealth", 0, 200, 60, 270),

    ("B-F1", "ФПВ", "Пчела", "hunter", 400, 300, 80, 0),
    ("B-F2", "ФПВ", "Волк", "hunter", -400, 300, 80, 0),
    ("B-F3", "ФПВ", "Ласка", "hunter", 400, -300, 80, 0),
    ("B-F4", "ФПВ", "Барс", "hunter", -400, -300, 80, 0),
    ("B-L1", "ФПВ", "Шершень", "hunter", 0, 400, 85, 180),

    ("B-P1", "ПЕРЕ", "Ястреб", "guardian", 600, 0, 120, 90),
    ("B-P2", "ПЕРЕ", "Орёл", "guardian", -600, 0, 120, 270),

    ("B-R1", "РЕТР", "Заря", "relay", 0, -500, 350, 0),
    ("B-R2", "РЕТР", "Маяк", "relay", 0, 500, 360, 180),

    ("B-G1", "НАЗМ", "База-З", "guardian", -500, -500, 0, 0),
    ("B-G2", "НАЗМ", "База-Ц", "guardian", 0, 0, 0, 0),
    ("B-G3", "НАЗМ", "База-В", "guardian", 500, 500, 0, 0),

    ("B-E1", "РЭБ", "Гроза", "jammer", 300, -500, 130, 45),
    ("B-E2", "РЭБ", "Шторм", "jammer", -300, 500, 130, 225),

    ("B-K1", "КАМИКАДЗЕ", "Искра", "kamikaze", 500, -400, 25, 0),
    ("B-K2", "КАМИКАДЗЕ", "Факел", "kamikaze", -500, 400, 25, 180),

    ("B-H1", "ТЯЖ", "Атлант", "heavy_strike", 700, 0, 200, 90),
]

RED_FLEET_FULL = [
    ("R-E1", "КАМИКАДЗЕ", "Шахид-1", "kamikaze", 1200, 800, 25, 180),
    ("R-E2", "КАМИКАДЗЕ", "Шахид-2", "kamikaze", 1000, -700, 25, 180),
    ("R-E3", "РАЗВ", "Глаз-1", "stealth", 800, 1000, 60, 270),
    ("R-E4", "РАЗВ", "Глаз-2", "stealth", -900, 900, 65, 90),
    ("R-E5", "ФПВ", "Коготь-1", "hunter", 1100, 300, 80, 0),
    ("R-E6", "ФПВ", "Коготь-2", "hunter", -1000, -400, 80, 0),
    ("R-E7", "РЕТР", "Мост-1", "relay", 500, 1200, 350, 0),
    ("R-E8", "ПЕРЕ", "Страж-1", "guardian", 1300, 0, 100, 90),
    ("R-E9", "ПЕРЕ", "Страж-2", "guardian", -1200, 0, 100, 270),
    ("R-E10","РЭБ", "Глушилка", "jammer", 0, -1100, 140, 0),
]

RED_AIR_DEFENSE_FULL = [
    ("R-AD1", "ПВО-ЗРК", 1500, 800, 2000, 0.005),
    ("R-AD2", "ПВО-ЗРК", -1200, -600, 2000, 0.005),
    ("R-AD3", "ПВО-РЛС", 0, 1500, 2500, 0.002),  # радар дальнего обнаружения
]

# ═══════════════════════════════════════════════════════════════
# ДРОН С ПОЛНЫМ БОРТОМ
# ═══════════════════════════════════════════════════════════════

class SwarmDrone:
    """Дрон с собственными платами, пресетом и состоянием"""

    def __init__(self, drone_id: str, role: str, name: str, preset_name: str,
                 x: float, z: float, y: float, heading: float, team: str):
        self.id = drone_id
        self.role = role
        self.name = name
        self.team = team  # "blue" or "red"

        # Пресет поведения
        self.preset = BEHAVIOR_PRESETS.get(preset_name, BEHAVIOR_PRESETS["stealth"])
        self.preset_name = preset_name

        # Позиция
        self.x = x; self.z = z; self.y = y
        self.vx = 0.0; self.vz = 0.0
        self.heading = heading
        self.battery = 100.0
        self.phase = "deploy"
        self.alive = True

        # Бортовые платы — lazy init (только когда нужна классификация)
        self.boards = None

        # Статистика
        self.kills = 0
        self.deaths = 0
        self.distance_traveled = 0
        self.targets_detected = 0
        self.gifts_given = 0

        # Сенсорные данные (последние)
        self.last_detection = None
        self.last_classification = None

    def get_speed(self) -> float:
        return self.preset["speed"]

    def get_altitude(self) -> float:
        return self.preset["altitude"]

    def get_sensor_range(self) -> float:
        return self.preset["sensor_range"]

    def get_boards(self):
        """Lazy init плат — только когда нужна классификация"""
        if self.boards is None:
            self.boards = BoardSystem(self.id, self.role)
            self.boards.start_all()
        return self.boards

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "role": self.role, "team": self.team,
            "x": round(self.x, 1), "z": round(self.z, 1), "y": round(self.y, 1),
            "heading": round(self.heading, 1),
            "battery": round(self.battery, 1),
            "phase": self.phase, "alive": self.alive,
            "preset": self.preset_name,
            "preset_desc": self.preset["description"],
            "tactic": self.preset["tactic"],
            "emission": self.preset["emission"],
            "kills": self.kills, "gifts": self.gifts_given,
            "boards_ready": self.boards is not None,
        }


# ═══════════════════════════════════════════════════════════════
# МЕНЕДЖЕР РОЯ
# ═══════════════════════════════════════════════════════════════

class SwarmManager:
    """Управление всем роем: синие + красные + ПВО + арена"""

    def __init__(self):
        self.tick = 0
        self.dt = 0.1
        self.events: deque = deque(maxlen=500)
        self.kill_feed: deque = deque(maxlen=50)

        # Флоты
        self.blue_drones: Dict[str, SwarmDrone] = {}
        self.red_drones: Dict[str, SwarmDrone] = {}
        self._init_fleets()

        # ПВО
        self.air_defense = []
        for aid, atype, ax, az, arange, aleth in RED_AIR_DEFENSE_FULL:
            self.air_defense.append({
                "id": aid, "type": atype, "x": ax, "z": az,
                "range": arange, "lethality": aleth, "min_alt": 25,
                "active": True, "targets_engaged": 0,
            })

        # Среда
        self.weather = random.choice(["clear", "cloudy", "rain", "fog", "night"])
        self.wind_speed = random.uniform(0, 8)
        self.wind_dir = random.uniform(0, 360)

        # Счёт
        self.blue_score = 0
        self.red_score = 0
        self.winner = None

        # Gift tracking
        self.total_gifts = 0
        self.total_gift_weight = 0.0

    def _init_fleets(self):
        for args in BLUE_FLEET_FULL:
            self.blue_drones[args[0]] = SwarmDrone(*args, team="blue")
        for args in RED_FLEET_FULL:
            self.red_drones[args[0]] = SwarmDrone(*args, team="red")

    def tick_all(self):
        """Один тик всего роя"""
        self.tick += 1

        for drone in self.blue_drones.values():
            if drone.alive:
                self._update_drone(drone, self.red_drones)

        for drone in self.red_drones.values():
            if drone.alive:
                self._update_drone(drone, self.blue_drones)

        self._update_air_defense()
        self._check_winner()

    def _update_drone(self, drone: SwarmDrone, enemy_fleet: Dict[str, SwarmDrone]):
        """Обновить один дрон согласно пресету"""
        preset = drone.preset
        tactic = drone.preset_name  # ключ пресета, не описание

        # Поиск ближайшего врага
        nearest_enemy = None
        nearest_dist = float('inf')
        for enemy in enemy_fleet.values():
            if not enemy.alive:
                continue
            dist = math.sqrt((drone.x - enemy.x)**2 + (drone.z - enemy.z)**2)
            if dist < nearest_dist:
                nearest_dist = dist
                nearest_enemy = enemy

        # ═══ ПОВЕДЕНИЕ ПО ПРЕСЕТУ ═══════════════════════════

        if tactic == "stealth":
            # Скрытное патрулирование: низкая высота, избегает контакта
            drone.y += (preset["altitude"] - drone.y) * 0.1
            if nearest_enemy and nearest_dist < 400:
                drone.phase = "evade"
                # Уклонение
                dx = drone.x - nearest_enemy.x
                dz = drone.z - nearest_enemy.z
                drone.vx = dx / max(nearest_dist, 1) * preset["speed"] * 0.7
                drone.vz = dz / max(nearest_dist, 1) * preset["speed"] * 0.7
            else:
                drone.phase = "patrol"
                # Патруль по синусоиде для покрытия
                drone.vx = preset["speed"] * 0.5 * math.sin(self.tick * 0.005 + hash(drone.id) % 100)
                drone.vz = preset["speed"] * 0.5 * math.cos(self.tick * 0.005 + hash(drone.id) % 100)

        elif tactic == "hunter":
            # Активный поиск и уничтожение
            if nearest_enemy and nearest_dist < preset["sensor_range"]:
                drone.phase = "engage"
                # Атака!
                dx = nearest_enemy.x - drone.x
                dz = nearest_enemy.z - drone.z
                speed = preset["speed"]
                drone.vx = dx / max(nearest_dist, 1) * speed
                drone.vz = dz / max(nearest_dist, 1) * speed
                drone.y += (30 + nearest_dist * 0.02 - drone.y) * 0.1

                # Выстрел / таран при сближении
                if nearest_dist < 15:
                    nearest_enemy.alive = False
                    nearest_enemy.phase = "dead"
                    drone.kills += 1
                    self.kill_feed.append(f"💥 {drone.name} → {nearest_enemy.name}")
                    self._record_gift(drone, "kill", 10)
                    drone.phase = "rtb"
            else:
                drone.phase = "patrol"
                drone.vx = preset["speed"] * 0.6 * math.sin(self.tick * 0.008)
                drone.vz = preset["speed"] * 0.6 * math.cos(self.tick * 0.008)

        elif tactic == "guardian":
            # Защита периметра базы
            home_x, home_z = 0, 0  # точка защиты
            patrol_angle = hash(drone.id) % 360
            patrol_r = 400
            target_x = home_x + patrol_r * math.cos(math.radians(patrol_angle + self.tick * 0.3))
            target_z = home_z + patrol_r * math.sin(math.radians(patrol_angle + self.tick * 0.3))

            if nearest_enemy and nearest_dist < 600:
                # Перехват нарушителя
                dx = nearest_enemy.x - drone.x
                dz = nearest_enemy.z - drone.z
                drone.vx = dx / max(nearest_dist, 1) * preset["speed"] * 1.2
                drone.vz = dz / max(nearest_dist, 1) * preset["speed"] * 1.2
                drone.phase = "intercept"
                # Атака при сближении
                if nearest_dist < 20:
                    nearest_enemy.alive = False
                    nearest_enemy.phase = "dead"
                    drone.kills += 1
                    self.kill_feed.append(f"🛡 {drone.name} перехватил {nearest_enemy.name}")
                    self._record_gift(drone, "kill", 10)
            else:
                drone.phase = "guard"
                dx, dz = target_x - drone.x, target_z - drone.z
                dist = math.sqrt(dx*dx + dz*dz)
                if dist > 10:
                    drone.vx = dx / dist * preset["speed"] * 0.5
                    drone.vz = dz / dist * preset["speed"] * 0.5

        elif tactic == "relay":
            # Максимизация покрытия — высоко и медленно
            drone.y += (preset["altitude"] - drone.y) * 0.05
            drone.vx = preset["speed"] * 0.3 * math.sin(self.tick * 0.002 + hash(drone.id) % 50)
            drone.vz = preset["speed"] * 0.3 * math.cos(self.tick * 0.002 + hash(drone.id) % 50)
            drone.phase = "relay"

        elif tactic == "kamikaze":
            # Одноразовая атака — летит на ближайшего врага и взрывается
            if nearest_enemy and nearest_dist < preset["sensor_range"] * 2:
                drone.phase = "kamikaze_run"
                speed = preset["speed"]
                drone.vx = (nearest_enemy.x - drone.x) / max(nearest_dist, 1) * speed
                drone.vz = (nearest_enemy.z - drone.z) / max(nearest_dist, 1) * speed
                drone.y -= 3  # пикирует

                if nearest_dist < 15:
                    # Взрыв! Уничтожает врага и себя
                    nearest_enemy.alive = False
                    nearest_enemy.phase = "dead"
                    drone.alive = False
                    drone.phase = "dead"
                    drone.kills += 1
                    self.kill_feed.append(f"☠ {drone.name} камикадзе → {nearest_enemy.name}")
                    self._record_gift(drone, "sacrifice", 15)  # высший дар
                    # Взрывная волна — повреждает соседей
                    for other in enemy_fleet.values():
                        if other.alive and other.id != nearest_enemy.id:
                            dist2 = math.sqrt((drone.x - other.x)**2 + (drone.z - other.z)**2)
                            if dist2 < 80:
                                other.battery -= 30
            else:
                drone.phase = "seek"
                drone.vx = preset["speed"] * 0.4 * math.sin(self.tick * 0.005)
                drone.vz = preset["speed"] * 0.4 * math.cos(self.tick * 0.005)

        elif tactic == "jammer":
            # Постановка помех — кружит над областью
            drone.y += (preset["altitude"] - drone.y) * 0.1
            center_x, center_z = drone.x, drone.z  # держит позицию
            drone.vx = preset["speed"] * 0.3 * math.sin(self.tick * 0.01)
            drone.vz = preset["speed"] * 0.3 * math.cos(self.tick * 0.01)
            drone.phase = "jamming"
            # Эффект подавления на врагов в радиусе
            for enemy in enemy_fleet.values():
                if enemy.alive:
                    dist = math.sqrt((drone.x - enemy.x)**2 + (drone.z - enemy.z)**2)
                    if dist < preset["sensor_range"]:
                        enemy.battery -= 0.001  # помехи разряжают батарею врага

        elif tactic == "heavy_strike":
            # Тяжёлый ударный — высокая высота, точный удар
            drone.y += (preset["altitude"] - drone.y) * 0.05
            if nearest_enemy and nearest_dist < preset["sensor_range"]:
                drone.phase = "strike"
                dx = nearest_enemy.x - drone.x
                dz = nearest_enemy.z - drone.z
                drone.vx = dx / max(nearest_dist, 1) * preset["speed"]
                drone.vz = dz / max(nearest_dist, 1) * preset["speed"]
                if nearest_dist < 30:
                    nearest_enemy.alive = False
                    nearest_enemy.phase = "dead"
                    drone.kills += 1
                    self.kill_feed.append(f"💣 {drone.name} удар → {nearest_enemy.name}")
                    self._record_gift(drone, "strike", 12)
            else:
                drone.phase = "cruise"
                drone.vx = preset["speed"] * 0.4 * math.sin(self.tick * 0.003)
                drone.vz = preset["speed"] * 0.4 * math.cos(self.tick * 0.003)

        # ═══ ФИЗИКА ═══════════════════════════════════════
        drone.x += drone.vx * self.dt
        drone.z += drone.vz * self.dt
        drone.distance_traveled += math.sqrt(drone.vx**2 + drone.vz**2) * self.dt
        drone.heading = math.degrees(math.atan2(drone.vx, drone.vz)) % 360

        # Батарея
        drain_rate = {"stealth": 0.002, "hunter": 0.006, "guardian": 0.004,
                      "relay": 0.001, "kamikaze": 0.015, "jammer": 0.008,
                      "heavy_strike": 0.005}
        drone.battery -= drain_rate.get(drone.preset_name, 0.003)
        if drone.phase in ("engage", "intercept", "kamikaze_run", "strike"):
            drone.battery -= 0.005  # боевой форсаж

        # Ветер
        w_vx = -self.wind_speed * math.sin(math.radians(self.wind_dir))
        w_vz = -self.wind_speed * math.cos(math.radians(self.wind_dir))
        drone.vx += w_vx * 0.02
        drone.vz += w_vz * 0.02

        # Возврат при разряде
        if drone.battery < 5 and drone.preset_name != "kamikaze":
            drone.phase = "rtb_low_battery"
            # Лететь к центру
            dx, dz = -drone.x, -drone.z
            dist = math.sqrt(dx*dx + dz*dz)
            if dist > 30:
                drone.vx = dx / dist * 20
                drone.vz = dz / dist * 20
            if dist < 100:
                drone.battery = min(100, drone.battery + 10)
                drone.phase = "resupplied"
                self._record_gift(drone, "presence", 5)

    def _update_air_defense(self):
        for ad in self.air_defense:
            if not ad["active"]:
                continue
            for drone in self.blue_drones.values():
                if not drone.alive:
                    continue
                dist = math.sqrt((drone.x - ad["x"])**2 + (drone.z - ad["z"])**2)
                if dist < ad["range"] and drone.y > ad["min_alt"]:
                    if random.random() < ad["lethality"] * (1 - dist/ad["range"]):
                        drone.alive = False
                        drone.phase = "dead"
                        ad["targets_engaged"] += 1
                        self.kill_feed.append(f"🛡 {ad['id']} сбил {drone.name}")
                        self._record_gift(drone, "sacrifice", 10)

    def _check_winner(self):
        blue_alive = sum(1 for d in self.blue_drones.values() if d.alive)
        red_alive = sum(1 for d in self.red_drones.values() if d.alive)
        if blue_alive == 0:
            self.winner = "red"
            self.red_score += 1
        elif red_alive == 0:
            self.winner = "blue"
            self.blue_score += 1

    def _record_gift(self, drone: SwarmDrone, gift_type: str, weight: float):
        drone.gifts_given += 1
        self.total_gifts += 1
        self.total_gift_weight += weight
        self.events.append({
            "tick": self.tick, "event": "GIFT",
            "giver": drone.name, "giver_id": drone.id,
            "type": gift_type, "weight": weight, "team": drone.team,
        })

    def get_state(self) -> dict:
        blue_alive = sum(1 for d in self.blue_drones.values() if d.alive)
        red_alive = sum(1 for d in self.red_drones.values() if d.alive)

        def drone_dict(d: SwarmDrone):
            return {
                "id": d.id, "name": d.name, "role": d.role, "team": d.team,
                "x": round(d.x, 1), "z": round(d.z, 1), "y": round(d.y, 1),
                "heading": round(d.heading, 1),
                "battery": round(d.battery, 1),
                "phase": d.phase, "alive": d.alive,
                "preset": d.preset_name, "tactic": d.preset["tactic"],
                "emission": d.preset["emission"],
                "speed": round(math.sqrt(d.vx**2 + d.vz**2), 1),
                "kills": d.kills, "gifts": d.gifts_given,
            }

        return {
            "tick": self.tick,
            "weather": self.weather,
            "wind": {"speed": round(self.wind_speed, 1), "dir": round(self.wind_dir, 0)},
            "blue": {
                "drones": [drone_dict(d) for d in self.blue_drones.values()],
                "total": len(self.blue_drones),
                "alive": blue_alive,
                "kills": sum(d.kills for d in self.blue_drones.values()),
                "by_role": self._count_by_role(self.blue_drones),
            },
            "red": {
                "drones": [drone_dict(d) for d in self.red_drones.values()],
                "total": len(self.red_drones),
                "alive": red_alive,
                "kills": sum(d.kills for d in self.red_drones.values()),
                "by_role": self._count_by_role(self.red_drones),
            },
            "air_defense": [{"id": ad["id"], "type": ad["type"], "x": ad["x"], "z": ad["z"],
                            "kills": ad["targets_engaged"], "active": ad["active"]}
                           for ad in self.air_defense],
            "kill_feed": list(self.kill_feed)[-20:],
            "gifts": {"total": self.total_gifts, "weight": round(self.total_gift_weight, 1)},
            "winner": self.winner,
            "presets_available": list(BEHAVIOR_PRESETS.keys()),
        }

    def _count_by_role(self, fleet: Dict[str, SwarmDrone]) -> dict:
        counts = {}
        for d in fleet.values():
            if d.alive:
                counts[d.role] = counts.get(d.role, 0) + 1
        return counts


# ═══════════════════════════════════════════════════════════════
# HTTP API
# ═══════════════════════════════════════════════════════════════

swarm_mgr = SwarmManager()

class SwarmHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global swarm_mgr
        path = self.path.split("?")[0]

        if path == "/api/swarm":
            self.send_json(swarm_mgr.get_state())
        elif path == "/api/drones":
            state = swarm_mgr.get_state()
            self.send_json({"blue": state["blue"]["drones"], "red": state["red"]["drones"]})
        elif path == "/api/presets":
            self.send_json(BEHAVIOR_PRESETS)
        elif path == "/api/stats":
            state = swarm_mgr.get_state()
            self.send_json({
                "tick": state["tick"],
                "weather": state["weather"],
                "blue_alive": state["blue"]["alive"],
                "red_alive": state["red"]["alive"],
                "winner": state["winner"],
                "gifts": state["gifts"],
                "kill_feed": state["kill_feed"],
            })
        elif path == "/":
            self.send_html()
        elif path == "/api/cmd/restart":
            swarm_mgr = SwarmManager()
            self.send_json({"status": "restarted"})
        elif path == "/api/cmd/weather":
            swarm_mgr.weather = random.choice(["clear", "cloudy", "rain", "fog", "night"])
            self.send_json({"weather": swarm_mgr.weather})
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
        self.wfile.write(("""<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Swarm Fleet</title><meta http-equiv="refresh" content="2">
<style>body{background:#0a0f1e;color:#aaa;font:11px monospace;padding:15px}
.panel{background:#111;border:1px solid #333;padding:12px;margin:8px 0;border-radius:4px}
h2{color:#0ff;margin:0 0 8px} .blue{color:#48f} .red{color:#f44} .kill{color:#f66}
.gift{color:#ff0} .dead{opacity:0.4} .stat{display:inline-block;margin:4px 16px 4px 0}
.role-tag{background:#222;padding:2px 6px;border-radius:3px;margin:2px}</style></head>
<body><h1>Swarm Fleet - 30 Drones</h1><div id="s"></div>
<script>setInterval(async()=>{try{const r=await fetch('/api/swarm');const d=await r.json();
let h=`<div class="panel"><span class="stat">Tick: ${d.tick}</span><span class="stat">Weather: ${d.weather}</span><span class="stat">Wind: ${d.wind.speed}m/s</span><span class="stat">Gifts: ${d.gifts.total} (${d.gifts.weight})</span><span class="stat">Winner: ${d.winner||'...'}</span></div>`;
h+=`<div class="panel"><h2>Blue Fleet (${d.blue.alive}/${d.blue.total}) Kills:${d.blue.kills}</h2>`;
d.blue.drones.forEach(dr=>{h+=`<span class="blue ${dr.alive?'':'dead'}">${dr.name}(${dr.role}/${dr.preset})</span> bat:${dr.battery}% ${dr.phase} kills:${dr.kills} `});
h+=`</div><div class="panel"><h2>Red Fleet (${d.red.alive}/${d.red.total}) Kills:${d.red.kills}</h2>`;
d.red.drones.forEach(dr=>{h+=`<span class="red ${dr.alive?'':'dead'}">${dr.name}(${dr.role}/${dr.preset})</span> bat:${dr.battery}% ${dr.phase} kills:${dr.kills} `});
h+=`</div><div class="panel"><h2>Kill Feed</h2>${(d.kill_feed||[]).slice(-15).map(k=>`<div class="kill">${k}</div>`).join('')||'no kills yet'}</div>`;
document.getElementById('s').innerHTML=h;}catch(e){}},1000)</script></body></html>""").encode())

    def log_message(self, *args): pass


def sim_thread():
    while True:
        swarm_mgr.tick_all()
        time.sleep(0.05)

def main():
    print("╔══════════════════════════════════════════════════════════╗")
    print("║  SWARM FLEET — 30 дронов с пресетами поведения          ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print(f"  🔵 Синий флот: {len(BLUE_FLEET_FULL)} дронов")
    roles = {}
    for _, role, _, preset, *_ in BLUE_FLEET_FULL:
        roles[role] = roles.get(role, 0) + 1
    for role, count in sorted(roles.items()):
        print(f"     {role}: {count}")
    print(f"  🔴 Красный флот: {len(RED_FLEET_FULL)} дронов + {len(RED_AIR_DEFENSE_FULL)} ПВО")
    print(f"  🎯 Пресеты: {list(BEHAVIOR_PRESETS.keys())}")
    print(f"  🌐 http://localhost:8105")
    print()

    threading.Thread(target=sim_thread, daemon=True).start()
    HTTPServer(("0.0.0.0", 8105), SwarmHandler).serve_forever()

if __name__ == "__main__":
    main()
