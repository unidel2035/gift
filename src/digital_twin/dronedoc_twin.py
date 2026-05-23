#!/usr/bin/env python3
"""
dronedoc_twin.py — Цифровой двойник, совмещённый с логикой DronDoc

Выравнен с:
  nti.drondoc.ru/swarm-tactical — тактический движок (14 БАС, рой vs рой)
  nti.drondoc.ru/swarm-live — среда обучения агентов (имена, дары, сценарии)
  nti.drondoc.ru/drone-tracker — отслеживание флота

Архитектура:
  1. Флот: 14 дронов (3×РАЗВ, 4×ФПВ, 2×ПЕРЕ, 1×РЕТР, 3×БАЗА, 1×РЕЗЕРВ)
  2. Противник: 2×ПВО + 6 вражеских дронов
  3. Тактики: Периметр, Линия, Клин, Рой, Скрытность, Рассредоточение
  4. Сенсорный фьюжн: 👁камера + 🔥тепло + 📡радио + 💨движение + 🔊звук
  5. Коллективная память: вероятностная сетка, обмен знаниями
  6. Связность: λ₂ Фидлера, mesh-топология
  7. Конвейер решений: ТМН→СИГ→КОР→ВЕР→КЛС→ПЛН→ИСП→АДП
  8. Экономика дара: 🎁 акты между агентами
  9. Сценарии: Свободный, Атака, ПВО, Город, SIGINT
"""

import math, random, time, json, threading, sys, os
from http.server import HTTPServer, BaseHTTPRequestHandler
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from collections import deque

sys.path.insert(0, '/home/unidel/gift/src/digital_twin')
from lora_channel import LoRaMesh
from binary_protocol import BinaryProtocol
from all_algorithms import WaveletCodec, TelemetryCompressor

# ═══════════════════════════════════════════════════════════════
# 1. ФЛОТ ДРОНОВ
# ═══════════════════════════════════════════════════════════════

DRONE_FLEET = [
    # ID, Роль, Имя, Начальная позиция
    ("S1", "РАЗВ", "Ворон",    0, 0, 150, 0),
    ("S2", "РАЗВ", "Сова",     200, -100, 160, 180),
    ("S3", "РАЗВ", "Сокол",    -200, 100, 140, 90),
    ("F1", "ФПВ",  "Пчела",    300, 200, 80, 0),
    ("F2", "ФПВ",  "Волк",     -300, 200, 80, 0),
    ("F3", "ФПВ",  "Ласка",    300, -200, 80, 0),
    ("F4", "ФПВ",  "Барс",     -300, -200, 80, 0),
    ("P1", "ПЕРЕ", "Ястреб",   500, 0, 200, 270),
    ("P2", "ПЕРЕ", "Орёл",     -500, 0, 200, 90),
    ("L1", "ФПВ",  "Шершень",  0, 300, 90, 180),  # ещё один FPV
    ("R1", "РЕТР", "Заря",     0, -300, 300, 0),
    ("G1", "НАЗМ", "База-З",  -400, 400, 0, 0),
    ("G2", "НАЗМ", "База-Ц",   0, 0, 0, 0),
    ("G3", "НАЗМ", "База-В",  400, 400, 0, 0),
]

ENEMY_DRONES = [
    ("E1", "КАМИКАДЗЕ", 200, 500, 100, 180),
    ("E2", "РАЗВ", -300, -400, 150, 0),
    ("E3", "ФПВ", 400, -300, 80, 270),
    ("E4", "РАЗВ", -500, 200, 160, 45),
    ("E5", "ФПВ", 100, -500, 90, 135),
    ("E6", "РЕТР", -100, 500, 350, 0),
]

ENEMY_AIR_DEFENSE = [
    ("ПВО-1", 300, 600, 0),
    ("ПВО-2", -400, -500, 0),
]

# Тактики роя
TACTICS = {
    "perimeter": "Периметр — защитное кольцо вокруг объекта",
    "line": "Линия — фронтальное патрулирование",
    "wedge": "Клин — прорыв вглубь территории",
    "swarm": "Рой — распределённое покрытие с перекрытием",
    "stealth": "Скрытность — минимизация излучения",
    "disperse": "Рассредоточение — максимальное покрытие",
}

# ═══════════════════════════════════════════════════════════════
# 2. СЕНСОРНЫЙ ФЬЮЖН
# ═══════════════════════════════════════════════════════════════

class SensorFusion:
    """5 модальностей сенсоров с корреляцией и обнаружением обмана"""

    MODALITIES = ["camera", "thermal", "radio", "motion", "sound"]

    def __init__(self, grid_size=40):
        self.grid_size = grid_size
        self.grid = [[{
            "camera": 0.0, "thermal": 0.0, "radio": 0.0,
            "motion": 0.0, "sound": 0.0, "correlated": 0.0,
            "decoy_prob": 0.0, "detections": 0,
        } for _ in range(grid_size)] for _ in range(grid_size)]
        self.detection_threshold = 0.6
        self.correlation_threshold = 2  # минимум модальности для корреляции

    def add_observation(self, gx, gy, modality, probability, world_size=2000):
        """Добавить наблюдение от сенсора"""
        i = int((gx + world_size/2) / world_size * self.grid_size)
        j = int((gy + world_size/2) / world_size * self.grid_size)
        i = max(0, min(self.grid_size-1, i))
        j = max(0, min(self.grid_size-1, j))

        cell = self.grid[j][i]
        cell[modality] = max(cell[modality], probability)
        cell["detections"] += 1

        # Корреляция: если несколько модальностей дают высокую вероятность
        active_modalities = sum(1 for m in self.MODALITIES if cell[m] > 0.3)
        if active_modalities >= self.correlation_threshold:
            cell["correlated"] = sum(cell[m] for m in self.MODALITIES) / len(self.MODALITIES)

        # Признаки обмана: radio без thermal при обнаружении "дрона"
        if cell["radio"] > 0.5 and cell["thermal"] < 0.2 and cell["motion"] < 0.2:
            cell["decoy_prob"] = min(1.0, cell["decoy_prob"] + 0.1)

    def get_detections(self, min_prob=0.6):
        """Получить все коррелированные обнаружения"""
        detections = []
        for j in range(self.grid_size):
            for i in range(self.grid_size):
                cell = self.grid[j][i]
                if cell["correlated"] >= min_prob:
                    detections.append({
                        "grid_x": i, "grid_y": j,
                        "probability": round(cell["correlated"], 3),
                        "modalities": {m: round(cell[m], 2) for m in self.MODALITIES if cell[m] > 0.1},
                        "decoy_prob": round(cell["decoy_prob"], 2),
                        "detections": cell["detections"],
                    })
        return sorted(detections, key=lambda d: d["probability"], reverse=True)

    def get_coverage_stats(self):
        """Статистика покрытия по модальностям"""
        stats = {}
        for m in self.MODALITIES:
            covered = sum(1 for row in self.grid for cell in row if cell[m] > 0.1)
            stats[m] = round(covered / (self.grid_size**2) * 100, 1)
        return stats

    def get_correlation_stats(self):
        correlated = sum(1 for row in self.grid for c in row if c["correlated"] > 0.3)
        high_prob = sum(1 for row in self.grid for c in row if c["correlated"] > 0.7)
        total_signals = sum(c["detections"] for row in self.grid for c in row)
        decoys = sum(1 for row in self.grid for c in row if c["decoy_prob"] > 0.5)
        return {
            "clusters": sum(1 for row in self.grid for c in row if c["correlated"] > 0.3),
            "high_prob": high_prob,
            "signals": total_signals,
            "decoys": decoys,
        }


# ═══════════════════════════════════════════════════════════════
# 3. КОЛЛЕКТИВНАЯ ПАМЯТЬ РОЯ
# ═══════════════════════════════════════════════════════════════

class CollectiveMemory:
    """Вероятностная карта — коллективная память роя"""

    def __init__(self, world_size=2000, cell_size=50):
        self.world_size = world_size
        self.cell_size = cell_size
        self.grid_w = world_size // cell_size
        self.exploration_grid = [[0.0] * self.grid_w for _ in range(self.grid_w)]
        self.threat_grid = [[0.0] * self.grid_w for _ in range(self.grid_w)]
        self.target_grid = [[0.0] * self.grid_w for _ in range(self.grid_w)]
        self.explored_percent = 0.0
        self.total_targets = 0
        self.total_threats = 0

    def mark_explored(self, x, z, radius=100):
        """Отметить исследованную область"""
        cx = int((x + self.world_size/2) / self.cell_size)
        cz = int((z + self.world_size/2) / self.cell_size)
        cells_r = int(radius / self.cell_size)
        for i in range(max(0, cx-cells_r), min(self.grid_w, cx+cells_r+1)):
            for j in range(max(0, cz-cells_r), min(self.grid_w, cz+cells_r+1)):
                dist = math.sqrt((i-cx)**2 + (j-cz)**2)
                if dist <= cells_r:
                    self.exploration_grid[j][i] = max(
                        self.exploration_grid[j][i],
                        math.exp(-0.5 * (dist / (cells_r/2))**2)
                    )

    def mark_threat(self, x, z, intensity=0.5):
        self._add_to_grid(self.threat_grid, x, z, intensity)
        self.total_threats += 1

    def mark_target(self, x, z, intensity=0.5):
        self._add_to_grid(self.target_grid, x, z, intensity)
        self.total_targets += 1

    def _add_to_grid(self, grid, x, z, intensity, radius=200):
        cx = int((x + self.world_size/2) / self.cell_size)
        cz = int((z + self.world_size/2) / self.cell_size)
        cells_r = int(radius / self.cell_size)
        for i in range(max(0, cx-cells_r), min(self.grid_w, cx+cells_r+1)):
            for j in range(max(0, cz-cells_r), min(self.grid_w, cz+cells_r+1)):
                dist = math.sqrt((i-cx)**2 + (j-cz)**2)
                grid[j][i] = max(grid[j][i],
                    intensity * math.exp(-0.5 * (dist / (cells_r/2))**2))

    def update_exploration(self):
        explored = sum(1 for row in self.exploration_grid for c in row if c > 0.1)
        self.explored_percent = round(explored / (self.grid_w**2) * 100, 1)

    def get_status(self):
        self.update_exploration()
        return {
            "explored_pct": self.explored_percent,
            "targets": self.total_targets,
            "threats": self.total_threats,
            "grid_size": self.grid_w,
        }


# ═══════════════════════════════════════════════════════════════
# 4. СВЯЗНОСТЬ РОЯ (λ₂ Фидлера)
# ═══════════════════════════════════════════════════════════════

class MeshConnectivity:
    """Оценка связности mesh-сети через λ₂ (алгебраическая связность)"""

    def __init__(self, max_range=5000):
        self.max_range = max_range
        self.lambda2 = 0.0
        self.connectivity_pct = 0.0
        self.isolated_nodes = 0
        self.num_edges = 0

    def compute(self, drone_positions: Dict[str, Tuple[float, float, float]], jammed_pairs=None):
        """
        Вычислить λ₂ через матрицу Лапласа графа.
        Упрощённо: λ₂ ≈ минимальная степень графа для связного графа.
        """
        nodes = list(drone_positions.keys())
        n = len(nodes)
        if n < 2:
            self.lambda2 = 0
            return

        # Матрица смежности (взвешенная по расстоянию)
        edges = 0
        degrees = [0.0] * n
        laplacian = [[0.0] * n for _ in range(n)]

        for i in range(n):
            for j in range(i+1, n):
                n1, n2 = nodes[i], nodes[j]
                x1, y1, z1 = drone_positions[n1]
                x2, y2, z2 = drone_positions[n2]
                dist = math.sqrt((x1-x2)**2 + (y1-y2)**2 + (z1-z2)**2)

                if dist < self.max_range:
                    # Проверка на подавление канала
                    if jammed_pairs and (n1, n2) in jammed_pairs:
                        continue
                    weight = math.exp(-0.5 * (dist / (self.max_range/2))**2)
                    laplacian[i][j] = laplacian[j][i] = -weight
                    degrees[i] += weight
                    degrees[j] += weight
                    edges += 1

        for i in range(n):
            laplacian[i][i] = degrees[i]

        # Приближение λ₂: минимальная положительная степень
        positive_degrees = [d for d in degrees if d > 0.01]
        if positive_degrees:
            self.lambda2 = round(min(positive_degrees), 2)
        else:
            self.lambda2 = 0

        self.num_edges = edges
        self.isolated_nodes = sum(1 for d in degrees if d < 0.01)
        self.connectivity_pct = round((n - self.isolated_nodes) / n * 100, 1)


# ═══════════════════════════════════════════════════════════════
# 5. ТАКТИЧЕСКИЙ ДВИЖОК
# ═══════════════════════════════════════════════════════════════

class TacticalEngine:
    """Тактический движок: формации, стигмергия, PSO, подрои"""

    def __init__(self):
        self.current_tactic = "perimeter"
        self.formation_center = (0, 0)
        self.formation_radius = 500
        self.pheromone_grid = [[0.0] * 40 for _ in range(40)]
        self.sub_swarms = [{"id": "main", "members": [], "tactic": "perimeter"}]
        self.pso_particles = []

    def set_tactic(self, tactic_name):
        if tactic_name in TACTICS:
            self.current_tactic = tactic_name

    def get_waypoint(self, drone_id, drone_x, drone_z, drone_role, tick):
        """
        Вычислить waypoint для дрона согласно текущей тактике.
        Возвращает: (target_x, target_z, target_y)
        """
        n = len(DRONE_FLEET)
        drone_index = next((i for i, d in enumerate(DRONE_FLEET) if d[0] == drone_id), 0)
        angle_offset = (drone_index / n) * 2 * math.pi

        if self.current_tactic == "perimeter":
            # Защитное кольцо
            r = self.formation_radius
            angle = angle_offset + tick * 0.005  # медленное вращение
            tx = self.formation_center[0] + r * math.cos(angle)
            tz = self.formation_center[1] + r * math.sin(angle)
            ty = 150 if drone_role in ("РАЗВ", "ПЕРЕ") else 80

        elif self.current_tactic == "line":
            # Фронтальная линия
            spacing = 100
            line_x = drone_index * spacing - (n * spacing) / 2
            tx = line_x
            tz = self.formation_center[1] + tick * 2  # движение вперёд
            ty = 120

        elif self.current_tactic == "wedge":
            # Клин
            row = int(math.sqrt(drone_index))
            col = drone_index - row * row
            tx = col * 80 - row * 60
            tz = self.formation_center[1] + row * 100 + tick * 3
            ty = 120

        elif self.current_tactic == "swarm":
            # Распределённое покрытие с PSO-подобным движением
            r = 300 + 200 * math.sin(drone_index * 1.7 + tick * 0.01)
            angle = angle_offset + tick * 0.02
            tx = self.formation_center[0] + r * math.cos(angle)
            tz = self.formation_center[1] + r * math.sin(angle)
            ty = 100 + 60 * math.sin(drone_index * 0.9)

        elif self.current_tactic == "stealth":
            # Минимизация излучения — низкая высота, рассредоточение
            r = 600 + 200 * math.sin(drone_index)
            angle = angle_offset
            tx = r * math.cos(angle)
            tz = r * math.sin(angle)
            ty = 40  # низко

        else:  # disperse
            r = 400 + 300 * random.random()
            angle = angle_offset + random.uniform(-0.5, 0.5)
            tx = r * math.cos(angle)
            tz = r * math.sin(angle)
            ty = 120

        return tx, tz, ty

    def update_pheromones(self, drone_x, drone_z, intensity=0.1):
        """Оставить феромонный след (стигмергия)"""
        grid_sz = 40
        cx = int((drone_x + 1000) / 2000 * grid_sz)
        cz = int((drone_z + 1000) / 2000 * grid_sz)
        if 0 <= cx < grid_sz and 0 <= cz < grid_sz:
            self.pheromone_grid[cz][cx] = min(1.0,
                self.pheromone_grid[cz][cx] + intensity)
        # Испарение
        for i in range(grid_sz):
            for j in range(grid_sz):
                self.pheromone_grid[j][i] *= 0.999

    def split_sub_swarms(self, drone_positions):
        """Разделить рой на подрои при потере связности"""
        # Упрощённо: если есть изолированные узлы — создать подрой
        self.sub_swarms = [{"id": "main", "members": list(drone_positions.keys()),
                           "tactic": self.current_tactic}]

    def get_status(self):
        return {
            "tactic": self.current_tactic,
            "tactic_name": TACTICS.get(self.current_tactic, ""),
            "sub_swarms": len(self.sub_swarms),
            "formation_radius": self.formation_radius,
        }


# ═══════════════════════════════════════════════════════════════
# 6. 8-СТАДИЙНЫЙ КОНВЕЙЕР РЕШЕНИЙ
# ═══════════════════════════════════════════════════════════════

DECISION_STAGES = [
    ("ТМН", "Тактический мониторинг — сбор данных от всех сенсоров"),
    ("СИГ", "Сигнатурный анализ — выделение признаков целей"),
    ("КОР", "Корреляция — сопоставление сигналов от разных дронов"),
    ("ВЕР", "Верификация — проверка гипотез, отсев ложных"),
    ("КЛС", "Классификация — определение типа цели"),
    ("ПЛН", "Планирование — расчёт оптимальной атаки/манёвра"),
    ("ИСП", "Исполнение — отправка команд дронам"),
    ("АДП", "Адаптация — обновление модели по результатам"),
]

class DecisionPipeline:
    """8-стадийный конвейер: ТМН→СИГ→КОР→ВЕР→КЛС→ПЛН→ИСП→АДП"""

    def __init__(self):
        self.current_stage = 0
        self.stage_outputs = [""] * 8
        self.stage_complete = [False] * 8
        self.cycle_count = 0
        self.llm_enabled = True
        self.llm_model = "serafim-1.5b"

    def advance(self, sensor_data, targets, drone_states):
        """Продвинуть конвейер на один шаг"""
        self.cycle_count += 1

        # ТМН: сбор данных
        self.stage_outputs[0] = f"Собрано сигналов: {len(sensor_data)}, целей: {len(targets)}"
        self.stage_complete[0] = True

        # СИГ: анализ сигнатур
        if self.stage_complete[0]:
            signatures = len([t for t in targets if t.get("detected")])
            self.stage_outputs[1] = f"Выделено сигнатур: {signatures}"
            self.stage_complete[1] = True

        # КОР: корреляция
        if self.stage_complete[1]:
            self.stage_outputs[2] = f"Корреляция: проверка {len(targets)} гипотез"
            self.stage_complete[2] = True

        # ВЕР: верификация
        if self.stage_complete[2]:
            verified = len([t for t in targets if t.get("confidence", 0) > 0.5])
            self.stage_outputs[3] = f"Верифицировано: {verified} целей"
            self.stage_complete[3] = True

        # КЛС: классификация
        if self.stage_complete[3]:
            classified = len([t for t in targets if t.get("classified")])
            self.stage_outputs[4] = f"Классифицировано: {classified}"
            self.stage_complete[4] = True

        # ПЛН: планирование
        if self.stage_complete[4]:
            attackable = len([t for t in targets if t.get("attack")])
            self.stage_outputs[5] = f"План: {attackable} целей для атаки"
            self.stage_complete[5] = True

        # ИСП: исполнение
        if self.stage_complete[5]:
            killed = len([t for t in targets if t.get("killed")])
            self.stage_outputs[6] = f"Исполнено: {killed} целей уничтожено"
            self.stage_complete[6] = True

        # АДП: адаптация
        if self.stage_complete[6]:
            self.stage_outputs[7] = "Адаптация: модель обновлена"
            self.stage_complete[7] = True

        # Сброс цикла
        if all(self.stage_complete):
            self.current_stage = 0
            self.stage_complete = [False] * 8
        else:
            self.current_stage = next(i for i, c in enumerate(self.stage_complete) if not c)

        return self.get_status()

    def get_status(self):
        return {
            "current_stage": DECISION_STAGES[self.current_stage][0],
            "stage_name": DECISION_STAGES[self.current_stage][1],
            "stages": [{"code": s[0], "name": s[1], "complete": c}
                      for s, c in zip(DECISION_STAGES, self.stage_complete)],
            "cycle": self.cycle_count,
            "llm_enabled": self.llm_enabled,
        }


# ═══════════════════════════════════════════════════════════════
# 7. ЭКОНОМИКА ДАРА
# ═══════════════════════════════════════════════════════════════

@dataclass
class GiftAct:
    giver: str
    receiver: str
    gift_type: str  # time, data, coverage, protection, kill
    amount: float
    timestamp: float
    description: str

class GiftEconomy:
    """Экономика дара между агентами роя"""

    def __init__(self):
        self.acts: List[GiftAct] = []
        self.balances: Dict[str, Dict[str, float]] = {}  # {agent: {gift_type: total}}

    def record_gift(self, giver, receiver, gift_type, amount, description=""):
        act = GiftAct(giver, receiver, gift_type, amount, time.time(), description)
        self.acts.append(act)
        if giver not in self.balances:
            self.balances[giver] = {}
        if receiver not in self.balances:
            self.balances[receiver] = {}
        self.balances[giver][gift_type] = self.balances[giver].get(gift_type, 0) + amount
        return act

    def get_total_gifts(self):
        return len(self.acts)

    def get_agent_stats(self, agent_id):
        given = sum(self.balances.get(agent_id, {}).values())
        return {"agent": agent_id, "total_given": round(given, 1), "acts": sum(1 for a in self.acts if a.giver == agent_id)}


# ═══════════════════════════════════════════════════════════════
# 8. СЦЕНАРИИ ОБУЧЕНИЯ
# ═══════════════════════════════════════════════════════════════

SCENARIOS = {
    "free": "Свободный полёт — 14 дронов, исследование",
    "attack": "Сц.1: Атака — прорыв обороны противника (ПВО + дроны)",
    "sigint": "Сц.1В: SIGINT — радиоразведка, поиск РЭБ",
    "air_defense": "Сц.2: ПВО — защита объекта от налёта",
    "urban": "Сц.4: Город — действия в городской застройке",
}

class ScenarioManager:
    """Менеджер сценариев обучения"""

    def __init__(self):
        self.current_scenario = "free"
        self.noise_enabled = True
        self.paused = False
        self.speed = 1.0
        self.tick = 0

    def set_scenario(self, name):
        if name in SCENARIOS:
            self.current_scenario = name
            self.tick = 0

    def toggle_noise(self):
        self.noise_enabled = not self.noise_enabled

    def get_noise_factor(self):
        return random.uniform(0.8, 1.2) if self.noise_enabled else 1.0


# ═══════════════════════════════════════════════════════════════
# 9. ГЛАВНЫЙ ЦИФРОВОЙ ДВОЙНИК (DronDoc-совместимый)
# ═══════════════════════════════════════════════════════════════

class DronDocDigitalTwin:
    """Главный класс — интеграция всех компонентов по логике DronDoc"""

    def __init__(self):
        # Флот
        self.drones = []
        self._init_fleet()

        # Противник
        self.enemy_drones = []
        self.enemy_air_defense = []
        self._init_enemy()

        # Компоненты
        self.sensors = SensorFusion()
        self.memory = CollectiveMemory()
        self.mesh = MeshConnectivity()
        self.tactical = TacticalEngine()
        self.pipeline = DecisionPipeline()
        self.gifts = GiftEconomy()
        self.scenario = ScenarioManager()

        # Связь
        self.lora = LoRaMesh()
        for d in self.drones:
            self.lora.add_node(d["id"])
        for e in self.enemy_drones:
            self.lora.add_node(e["id"])
        self.lora.add_node("GroundStation")

        # Статистика
        self.tick = 0
        self.events: deque = deque(maxlen=200)
        self.targets_killed = 0
        self.enemy_killed = 0

        # Цели на карте (вражеские объекты)
        self.targets = self._init_targets()

    def _init_fleet(self):
        for sid, role, name, x, z, y, heading in DRONE_FLEET:
            self.drones.append({
                "id": sid, "role": role, "name": name,
                "x": float(x), "z": float(z), "y": float(y),
                "vx": 0.0, "vz": 0.0,
                "heading": float(heading),
                "battery": 100.0,
                "phase": "preflight",
                "mission": "готов к взлёту",
                "killed": False,
                "gifts_given": 0,
                "target_id": None,
                "_patrol_target": (0, 0, 150),
                "_scan_angle": 0,
            })

    def _init_enemy(self):
        for eid, etype, x, z, y, heading in ENEMY_DRONES:
            self.enemy_drones.append({
                "id": eid, "type": etype,
                "x": float(x), "z": float(z), "y": float(y),
                "vx": 0.0, "vz": 0.0,
                "heading": float(heading),
                "battery": 100.0,
                "phase": "patrol",
                "killed": False,
                "_patrol_target": (float(x), float(z), float(y)),
            })
        for aid, ax, az, _ in ENEMY_AIR_DEFENSE:
            self.enemy_air_defense.append({
                "id": aid, "x": float(ax), "z": float(az),
                "range": 1500.0, "lethality": 0.003,  # 0.3% за тик (30% за 100 тиков)
                "min_altitude": 30,  # не видит ниже 30м
                "active": True,
            })

    def _init_targets(self):
        types = ["strongpoint", "bunker", "ew_station", "vehicle", "command_post",
                 "artillery", "sam", "ammo_dump", "drone_swarm"]
        targets = []
        for i, t in enumerate(types):
            targets.append({
                "id": f"T{i+1}", "type": t,
                "x": random.uniform(-800, 800), "z": random.uniform(-800, 800),
                "detected": False, "classified": "", "confidence": 0,
                "attack": False, "killed": False,
                "name": t, "classifier_name": "",
            })
        return targets

    def tick_simulation(self, dt=0.1):
        """Один тик симуляции"""
        if self.scenario.paused:
            return

        self.tick += 1
        tick_time = self.tick * dt

        # ═══ 1. ДВИЖЕНИЕ ДРОНОВ ═══════════════════════════
        for d in self.drones:
            if d["killed"]:
                continue

            # Waypoint от тактического движка
            tx, tz, ty = self.tactical.get_waypoint(
                d["id"], d["x"], d["z"], d["role"], self.tick)

            # ПИД к waypoint
            dx, dz = tx - d["x"], tz - d["z"]
            dist = math.sqrt(dx*dx + dz*dz)
            if dist > 30:
                spd = 40 if d["role"] in ("ФПВ",) else 30
                d["vx"] = dx/dist * spd * self.scenario.get_noise_factor()
                d["vz"] = dz/dist * spd * self.scenario.get_noise_factor()
                d["heading"] = math.degrees(math.atan2(d["vx"], d["vz"]))
                d["phase"] = "patrol"
                d["mission"] = f"→ ({tx:.0f},{tz:.0f})"
            else:
                d["vx"] *= 0.9
                d["vz"] *= 0.9
                d["mission"] = "на позиции"

            # Физика
            d["x"] += d["vx"] * dt * self.scenario.speed
            d["z"] += d["vz"] * dt * self.scenario.speed
            d["y"] += (ty - d["y"]) * 0.1 * dt * self.scenario.speed
            d["battery"] -= 0.003 * self.scenario.speed * dt
            if d["battery"] < 0:
                d["battery"] = 0

            # Сенсорное наблюдение (только для РАЗВ и ПЕРЕ)
            if d["role"] in ("РАЗВ", "ПЕРЕ", "РЕТР") and d["y"] > 50:
                self._drone_observe(d)
                self.memory.mark_explored(d["x"], d["z"], 150)

            # Стигмергия
            self.tactical.update_pheromones(d["x"], d["z"])

            # Отметка угроз в коллективной памяти
            for t in self.targets:
                if t["detected"] and not t["killed"]:
                    self.memory.mark_target(t["x"], t["z"], 0.5)

        # ═══ 2. ДВИЖЕНИЕ ВРАГА ════════════════════════════
        for e in self.enemy_drones:
            if e["killed"]:
                continue
            # Простое патрулирование
            et = e["_patrol_target"]
            dx, dz = et[0] - e["x"], et[2] - e["z"]
            dist = math.sqrt(dx*dx + dz*dz)
            if dist > 100:
                spd = 25
                e["vx"] = dx/dist * spd
                e["vz"] = dz/dist * spd
            else:
                e["vx"] *= 0.95
                e["vz"] *= 0.95
                e["_patrol_target"] = (
                    random.uniform(-900, 900),
                    e["y"],
                    random.uniform(-900, 900),
                )
            e["x"] += e["vx"] * dt
            e["z"] += e["vz"] * dt
            e["heading"] = math.degrees(math.atan2(e["vx"], e["vz"]))

            # Отметка вражеских угроз в памяти
            self.memory.mark_threat(e["x"], e["z"], 0.3)

        # ═══ 3. FPV-АТАКИ ═════════════════════════════════
        for d in self.drones:
            if d["killed"] or d["role"] != "ФПВ":
                continue
            if d["target_id"] is None:
                # Ищем ближайшую обнаруженную цель
                best = None
                best_dist = 300  # радиус атаки
                for t in self.targets:
                    if t["detected"] and t["attack"] and not t["killed"]:
                        dist = math.sqrt((d["x"]-t["x"])**2 + (d["z"]-t["z"])**2)
                        if dist < best_dist:
                            best_dist = dist
                            best = t
                if best:
                    d["target_id"] = best["id"]
                    d["phase"] = "attack"
                    d["mission"] = f"АТАКА {best['type']}"

            if d["target_id"]:
                t = next((t for t in self.targets if t["id"] == d["target_id"]), None)
                if t and not t["killed"]:
                    dx, dz = t["x"] - d["x"], t["z"] - d["z"]
                    dist = math.sqrt(dx*dx + dz*dz)
                    if dist < 10:
                        t["killed"] = True
                        self.targets_killed += 1
                        d["phase"] = "rtb"
                        d["target_id"] = None
                        d["mission"] = "ЦЕЛЬ УНИЧТОЖЕНА"
                        self.events.append({
                            "ts": tick_time, "event": "TARGET_KILLED",
                            "target": t["type"], "by": d["id"]
                        })
                        # Запись дара
                        self.gifts.record_gift(d["name"], "рой", "kill", 1.0,
                                             f"Уничтожение {t['type']}")
                    else:
                        spd = 60
                        d["vx"] = dx/dist * spd
                        d["vz"] = dz/dist * spd
                        d["y"] = 40 + dist * 0.1
                else:
                    d["target_id"] = None
                    d["phase"] = "rtb"

        # ═══ 4. ПВО ПРОТИВНИКА ═══════════════════════════
        for ad in self.enemy_air_defense:
            if not ad["active"]:
                continue
            for d in self.drones:
                if d["killed"]:
                    continue
                dist = math.sqrt((d["x"]-ad["x"])**2 + (d["z"]-ad["z"])**2)
                # ПВО эффективно только по целям выше минимальной высоты
                if dist < ad["range"] and d["y"] > ad.get("min_altitude", 30):
                    # Летальность зависит от дистанции и высоты
                    effective_lethality = ad["lethality"] * (1 - dist/ad["range"]) * dt
                    if random.random() < effective_lethality:
                        d["killed"] = True
                        d["phase"] = "dead"
                        d["mission"] = "СБИТ ПВО"
                        self.events.append({
                            "ts": tick_time, "event": "DRONE_KILLED",
                            "drone": d["id"], "by": ad["id"]
                        })

        # ═══ 5. СВЯЗНОСТЬ ═══════════════════════════════
        positions = {}
        for d in self.drones:
            if not d["killed"]:
                positions[d["id"]] = (d["x"], d["z"], d["y"])
        self.mesh.compute(positions)

        # ═══ 6. КОНВЕЙЕР РЕШЕНИЙ ═════════════════════════
        if self.tick % 30 == 0:  # каждые 30 тиков
            sensor_data = self.sensors.get_detections()
            self.pipeline.advance(sensor_data, self.targets, self.drones)

        # ═══ 7. ОБНАРУЖЕНИЕ ЦЕЛЕЙ ═══════════════════════
        for t in self.targets:
            if t["detected"] or t["killed"]:
                continue
            for d in self.drones:
                if d["killed"] or d["role"] not in ("РАЗВ", "ПЕРЕ"):
                    continue
                dist = math.sqrt((d["x"]-t["x"])**2 + (d["z"]-t["z"])**2)
                if dist < 80:
                    t["detected"] = True
                    t["classified"] = t["type"]
                    t["confidence"] = random.uniform(0.5, 1.0)
                    t["attack"] = t["type"] not in ("person", "decoy", "trench", "bridge", "minefield")
                    t["classifier_name"] = t["type"].upper()
                    self.events.append({
                        "ts": tick_time, "event": "DETECT",
                        "target": t["type"], "grid": f"[{t['x']:.0f},{t['z']:.0f}]",
                        "prob": f"{t['confidence']*100:.0f}%",
                        "sensors": "motion+thermal"
                    })
                    break

    def _drone_observe(self, drone):
        """Дрон ведёт наблюдение"""
        # Каждый сенсор с некоторой вероятностью
        for sensor, base_prob in [
            ("camera", 0.15), ("thermal", 0.1), ("radio", 0.05),
            ("motion", 0.08), ("sound", 0.03)
        ]:
            if random.random() < base_prob * self.scenario.speed:
                # Наблюдение в некоторой области вокруг дрона
                ox = drone["x"] + random.uniform(-200, 200)
                oz = drone["z"] + random.uniform(-200, 200)
                prob = base_prob * random.uniform(0.5, 1.0)
                self.sensors.add_observation(ox, oz, sensor, prob)

        # Проверка: есть ли вражеский дрон в зоне видимости?
        for e in self.enemy_drones:
            if e["killed"]:
                continue
            dist = math.sqrt((drone["x"]-e["x"])**2 + (drone["z"]-e["z"])**2)
            if dist < 500:
                prob = max(0.3, 0.9 - dist / 500)
                self.sensors.add_observation(e["x"], e["z"], "motion", prob)
                if random.random() < 0.3:
                    self.sensors.add_observation(e["x"], e["z"], "thermal", prob * 0.8)

    def get_state(self) -> dict:
        """Полное состояние для API"""
        drone_list = []
        for d in self.drones:
            drone_list.append({
                "id": d["id"], "name": d["name"], "role": d["role"],
                "x": round(d["x"], 1), "z": round(d["z"], 1),
                "y": round(d["y"], 1),
                "heading": round(d["heading"], 1),
                "battery": round(d["battery"], 1),
                "phase": d["phase"], "mission": d["mission"],
                "killed": d["killed"], "gifts": d["gifts_given"],
            })

        enemy_list = []
        for e in self.enemy_drones:
            enemy_list.append({
                "id": e["id"], "type": e["type"],
                "x": round(e["x"], 1), "z": round(e["z"], 1),
                "y": round(e["y"], 1),
                "heading": round(e["heading"], 1),
                "phase": e["phase"], "killed": e["killed"],
            })

        air_defense_list = [{"id": ad["id"], "x": ad["x"], "z": ad["z"],
                            "range": ad["range"], "active": ad["active"]}
                          for ad in self.enemy_air_defense]

        return {
            "tick": self.tick,
            "fleet": {
                "total": len(self.drones),
                "online": sum(1 for d in self.drones if not d["killed"]),
                "battery_avg": round(sum(d["battery"] for d in self.drones if not d["killed"]) / max(1, sum(1 for d in self.drones if not d["killed"])), 1),
                "drones": drone_list,
            },
            "enemy": {
                "drones": enemy_list,
                "air_defense": air_defense_list,
                "total": len(self.enemy_drones),
                "active": sum(1 for e in self.enemy_drones if not e["killed"]),
            },
            "tactical": self.tactical.get_status(),
            "sensors": {
                "coverage": self.sensors.get_coverage_stats(),
                "correlation": self.sensors.get_correlation_stats(),
                "detections": self.sensors.get_detections()[:10],
            },
            "memory": self.memory.get_status(),
            "mesh": {
                "lambda2": self.mesh.lambda2,
                "connectivity": self.mesh.connectivity_pct,
                "isolated": self.mesh.isolated_nodes,
                "edges": self.mesh.num_edges,
            },
            "pipeline": self.pipeline.get_status(),
            "gifts": {
                "total": self.gifts.get_total_gifts(),
                "agents": [self.gifts.get_agent_stats(d["id"]) for d in self.drones[:5]],
            },
            "scenario": {
                "name": self.scenario.current_scenario,
                "noise": self.scenario.noise_enabled,
                "paused": self.scenario.paused,
                "speed": self.scenario.speed,
                "description": SCENARIOS.get(self.scenario.current_scenario, ""),
            },
            "targets": self.targets,
            "targets_killed": self.targets_killed,
            "events": list(self.events)[-30:],
            "stats": {
                "explored_pct": self.memory.explored_percent,
                "iq": min(100, int(self.tick * 0.5 + self.targets_killed * 10)),
                "tactic": self.tactical.current_tactic,
            },
        }


# ═══════════════════════════════════════════════════════════════
# 10. HTTP API
# ═══════════════════════════════════════════════════════════════

twin = DronDocDigitalTwin()

class DronDocHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]

        if path == "/api/state":
            self.send_json(twin.get_state())
        elif path == "/api/drones":
            self.send_json(twin.get_state()["fleet"])
        elif path == "/api/enemy":
            self.send_json(twin.get_state()["enemy"])
        elif path == "/api/sensors":
            self.send_json(twin.get_state()["sensors"])
        elif path == "/api/memory":
            self.send_json(twin.get_state()["memory"])
        elif path == "/api/mesh":
            self.send_json(twin.get_state()["mesh"])
        elif path == "/api/pipeline":
            self.send_json(twin.get_state()["pipeline"])
        elif path == "/api/gifts":
            self.send_json(twin.get_state()["gifts"])
        elif path == "/api/scenario":
            self.send_json(twin.get_state()["scenario"])
        elif path == "/api/targets":
            self.send_json(twin.targets)
        elif path == "/api/events":
            self.send_json(list(twin.events)[-30:])
        elif path == "/" or path == "/index.html":
            self.send_html()
        elif path == "/api/tactics":
            self.send_json({"tactics": list(TACTICS.keys()), "current": twin.tactical.current_tactic})
        elif path == "/api/scenarios":
            self.send_json({"scenarios": list(SCENARIOS.keys()), "current": twin.scenario.current_scenario})
        else:
            # Команды
            if path.startswith("/api/cmd/"):
                self._handle_command(path)
            else:
                self.send_error(404)

    def _handle_command(self, path):
        cmd = path.replace("/api/cmd/", "")
        if cmd == "pause":
            twin.scenario.paused = not twin.scenario.paused
            self.send_json({"paused": twin.scenario.paused})
        elif cmd == "reset":
            twin.__init__()
            self.send_json({"status": "reset"})
        elif cmd == "speed-0.5":
            twin.scenario.speed = 0.5
            self.send_json({"speed": 0.5})
        elif cmd == "speed-1":
            twin.scenario.speed = 1
            self.send_json({"speed": 1})
        elif cmd == "speed-2":
            twin.scenario.speed = 2
            self.send_json({"speed": 2})
        elif cmd == "speed-5":
            twin.scenario.speed = 5
            self.send_json({"speed": 5})
        elif cmd.startswith("tactic-"):
            tactic = cmd.replace("tactic-", "")
            if tactic in TACTICS:
                twin.tactical.set_tactic(tactic)
                self.send_json({"tactic": tactic})
        elif cmd.startswith("scenario-"):
            sc = cmd.replace("scenario-", "")
            if sc in SCENARIOS:
                twin.scenario.set_scenario(sc)
                self.send_json({"scenario": sc})
        elif cmd == "noise":
            twin.scenario.toggle_noise()
            self.send_json({"noise": twin.scenario.noise_enabled})
        else:
            self.send_json({"error": "unknown command"})

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
        html_path = os.path.join(os.path.dirname(__file__), "index_dronedoc.html")
        if os.path.exists(html_path):
            with open(html_path) as f:
                self.wfile.write(f.read().encode())
        else:
            self.wfile.write(b"<h1>DronDoc Digital Twin</h1>")

    def log_message(self, *args): pass


def simulation_thread():
    """Фоновый поток симуляции"""
    while True:
        twin.tick_simulation(0.1)
        time.sleep(0.05)  # 20 Hz


def main():
    print("╔════════════════════════════════════════════════════╗")
    print("║  DRONDOC DIGITAL TWIN — 14 БАС + ПВО + ВРАГ       ║")
    print("║  Тактика + Сенсоры + Память + Дары + LLM          ║")
    print("╚════════════════════════════════════════════════════╝")
    print(f"  Флот: {len(twin.drones)} дронов")
    print(f"  Противник: {len(twin.enemy_drones)} дронов + {len(twin.enemy_air_defense)} ПВО")
    print(f"  Целей: {len(twin.targets)}")
    print(f"  Веб: http://localhost:8101")
    print(f"  API: http://localhost:8101/api/state")

    sim = threading.Thread(target=simulation_thread, daemon=True)
    sim.start()

    server = HTTPServer(("0.0.0.0", 8101), DronDocHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        print("\nОстановка...")


if __name__ == "__main__":
    main()
