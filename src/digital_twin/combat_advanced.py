#!/usr/bin/env python3
"""
combat_advanced.py — Оставшиеся 11 модулей боевого дрона

6.  FormationTactics — строй (конверт, клещи, колонна, рассыпной)
7.  WeatherSensors — влияние погоды на сенсоры
8.  DayNightPerformance — день/ночь характеристики
9.  AfterActionReview — просмотр и анализ боя
10. LessonsLearned — извлечение уроков в W-матрицу
11. CounterManeuvers — уклонение от FPV и ракет
12. UrbanEnvironment — городская среда (здания, улицы)
13. EWCounterMeasures — противодействие РЭБ
14. AlternateLanding — запасные аэродромы
15. AutoTakeoffLanding — автономный взлёт/посадка
16. ReattackLogic — логика добивания цели
"""

import math, random, time, json
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from enum import Enum
import numpy as np


# ═══════════════════════════════════════════════════════════════
# 6. FORMATION TACTICS (строй)
# ═══════════════════════════════════════════════════════════════

class FormationType(Enum):
    CONVERT = "convert"         # конверт (охват)
    KLESCHI = "kleschi"        # клещи (двусторонний охват)
    COLUMN = "column"           # колонна
    LINE = "line"              # линия (фронт)
    WEDGE = "wedge"            # клин
    DISPERSE = "disperse"       # рассыпной
    DIAMOND = "diamond"        # ромб (ПВО)

class FormationTactics:
    """Тактические построения роя"""

    def __init__(self):
        self.current_formation = FormationType.DIAMOND
        self.formation_center = (0, 0, 150)
        self.spacing = 100  # метров между дронами

    def get_position(self, drone_index: int, total_drones: int,
                    time_tick: int) -> Tuple[float, float, float]:
        """Позиция дрона в строю"""
        idx = drone_index
        n = total_drones

        if self.current_formation == FormationType.CONVERT:
            # Полукольцо, охватывающее цель
            angle = math.pi * (0.5 + idx / max(n-1, 1))
            r = self.spacing * (2 + idx % 3)
            return (self.formation_center[0] + r * math.cos(angle),
                    self.formation_center[2],
                    self.formation_center[1] + r * math.sin(angle))

        elif self.current_formation == FormationType.KLESCHI:
            # Две группы слева и справа
            side = 1 if idx < n // 2 else -1
            offset = idx % (n // 2 + 1)
            r = self.spacing * (1 + offset * 0.5)
            angle = math.radians(45 * side)
            return (self.formation_center[0] + r * math.cos(angle) * side,
                    self.formation_center[2],
                    self.formation_center[1] + r * math.sin(angle))

        elif self.current_formation == FormationType.COLUMN:
            return (self.formation_center[0],
                    self.formation_center[2] + idx * self.spacing,
                    self.formation_center[1])

        elif self.current_formation == FormationType.LINE:
            return (self.formation_center[0] + (idx - n/2) * self.spacing,
                    self.formation_center[2],
                    self.formation_center[1])

        elif self.current_formation == FormationType.WEDGE:
            row = int(math.sqrt(idx))
            col = idx - row * row
            return (self.formation_center[0] + col * self.spacing - row * self.spacing * 0.5,
                    self.formation_center[2] + row * self.spacing,
                    self.formation_center[1])

        elif self.current_formation == FormationType.DIAMOND:
            positions = [
                (0, 0, 1.0), (1, 0, 0.7), (-1, 0, 0.7),
                (0, 1, 0.5), (0, -1, 0.5), (1, 1, 0.3),
                (-1, 1, 0.3), (1, -1, 0.3), (-1, -1, 0.3),
            ]
            if idx < len(positions):
                p = positions[idx]
                return (self.formation_center[0] + p[0] * self.spacing,
                        self.formation_center[2] + p[1] * self.spacing,
                        self.formation_center[1] * p[2])

        # DISPERSE — случайное распределение
        r = self.spacing * (1 + random.random() * 2)
        angle = idx * 2 * math.pi / n + random.uniform(-0.3, 0.3)
        return (self.formation_center[0] + r * math.cos(angle),
                self.formation_center[2] + r * math.sin(angle),
                self.formation_center[1] * random.uniform(0.7, 1.3))

    def set_formation(self, formation_name: str):
        try:
            self.current_formation = FormationType(formation_name)
        except ValueError:
            pass


# ═══════════════════════════════════════════════════════════════
# 7. WEATHER SENSOR DEPENDENCY
# ═══════════════════════════════════════════════════════════════

class WeatherSensorModel:
    """Влияние погоды на сенсоры"""

    def __init__(self):
        self.weather = {"rain": 0, "fog": 0, "clouds": 0, "dust": 0, "snow": 0}

    def set_weather(self, **conditions):
        self.weather.update(conditions)

    def get_camera_degradation(self, distance_m: float) -> float:
        """Насколько погода ухудшает камеру (0=норма, 1=слепая)"""
        deg = 0.0
        deg += self.weather.get("rain", 0) * 0.4 * (1 - math.exp(-distance_m / 500))
        deg += self.weather.get("fog", 0) * 0.7 * (1 - math.exp(-distance_m / 300))
        deg += self.weather.get("dust", 0) * 0.5 * (1 - math.exp(-distance_m / 400))
        deg += self.weather.get("snow", 0) * 0.3 * (1 - math.exp(-distance_m / 600))
        deg += self.weather.get("clouds", 0) * 0.1  # облачность не зависит от дистанции
        return min(1.0, deg)

    def get_thermal_degradation(self, distance_m: float) -> float:
        """Ухудшение тепловизора"""
        deg = 0.0
        deg += self.weather.get("rain", 0) * 0.5 * (1 - math.exp(-distance_m / 200))
        deg += self.weather.get("fog", 0) * 0.6 * (1 - math.exp(-distance_m / 150))
        deg += self.weather.get("clouds", 0) * 0.05
        deg += self.weather.get("snow", 0) * 0.4
        return min(1.0, deg)

    def get_rf_degradation(self) -> float:
        """Ухудшение радиосвязи"""
        deg = 0.0
        deg += self.weather.get("rain", 0) * 0.3
        deg += self.weather.get("fog", 0) * 0.0  # RF не зависит от тумана
        deg += self.weather.get("dust", 0) * 0.1
        deg += self.weather.get("snow", 0) * 0.2
        return min(1.0, deg)


# ═══════════════════════════════════════════════════════════════
# 8. DAY/NIGHT PERFORMANCE
# ═══════════════════════════════════════════════════════════════

class DayNightPerformance:
    """Характеристики сенсоров в зависимости от времени суток"""

    @staticmethod
    def get_camera_range(hour: float, base_range_m=2000) -> float:
        """Дальность камеры в зависимости от времени"""
        if 6 <= hour <= 18:  # день
            return base_range_m
        elif 5 <= hour < 6 or 18 < hour <= 19:  # сумерки
            return base_range_m * 0.4
        else:  # ночь
            return base_range_m * 0.05  # только при ИК-подсветке

    @staticmethod
    def get_thermal_range(hour: float, base_range_m=1500) -> float:
        """Тепловизор лучше работает ночью (контраст выше)"""
        if 6 <= hour <= 18:
            return base_range_m * 0.8  # днём фон теплее
        else:
            return base_range_m * 1.2  # ночью больше контраст

    @staticmethod
    def get_visibility_factor(hour: float, weather_model=None) -> float:
        """Общий фактор видимости (0..1)"""
        factor = DayNightPerformance.get_camera_range(hour, 1.0)
        if weather_model:
            factor *= (1.0 - weather_model.get_camera_degradation(500))
        return factor


# ═══════════════════════════════════════════════════════════════
# 9+10. AFTER ACTION REVIEW + LESSONS LEARNED
# ═══════════════════════════════════════════════════════════════

class AfterActionReview:
    """
    Просмотр боя и извлечение уроков.

    После каждой миссии:
      - Что пошло правильно?
      - Что пошло не так?
      - Какие контрмеры эффективны?
      - Автоматическая запись в W-матрицу
    """

    def __init__(self):
        self.missions: List[dict] = []
        self.lessons: List[dict] = []
        self.patterns_detected = 0

    def record_mission(self, mission_data: dict) -> dict:
        """Записать миссию и извлечь уроки"""
        self.missions.append(mission_data)

        lessons = self._extract_lessons(mission_data)
        self.lessons.extend(lessons)
        self.patterns_detected += 1

        return {
            "mission_id": mission_data.get("id", "?"),
            "lessons_learned": len(lessons),
            "top_lesson": lessons[0]["insight"] if lessons else "nothing new",
        }

    def _extract_lessons(self, data: dict) -> List[dict]:
        """Извлечь уроки из данных миссии"""
        lessons = []

        # Анализ потерь
        losses = data.get("losses", 0)
        if losses > 0:
            lessons.append({
                "category": "survival",
                "insight": f"Потеряно {losses} дронов. Причина: {data.get('loss_cause', 'неизвестно')}",
                "recommendation": "Усилить контр-ПВО или изменить тактику захода",
                "weight": 5 * losses,
            })

        # Анализ эффективности оружия
        kills = data.get("kills", 0)
        shots = data.get("shots_fired", 1)
        hit_rate = kills / max(shots, 1)
        if hit_rate < 0.5:
            lessons.append({
                "category": "accuracy",
                "insight": f"Низкая точность: {hit_rate:.0%} попаданий",
                "recommendation": "Сближаться на меньшую дистанцию перед пуском",
                "weight": 3,
            })

        # Анализ выживаемости по типам дронов
        for drone_type, stats in data.get("per_type", {}).items():
            if stats.get("loss_rate", 0) > 0.3:
                lessons.append({
                    "category": "survival",
                    "insight": f"Высокие потери {drone_type}: {stats['loss_rate']:.0%}",
                    "recommendation": f"Пересмотреть тактику применения {drone_type}",
                    "weight": 4,
                })

        # Анализ времени миссии
        duration = data.get("duration_min", 0)
        if duration > 10:
            lessons.append({
                "category": "efficiency",
                "insight": f"Длительная миссия: {duration:.0f} мин",
                "recommendation": "Оптимизировать патрульные маршруты",
                "weight": 1,
            })

        return lessons

    def get_wmatrix_entries(self) -> List[dict]:
        """Записи для W-матрицы на основе уроков"""
        entries = []
        for lesson in self.lessons[-10:]:
            entries.append({
                "type": "knowledge",
                "content": lesson["insight"],
                "weight": lesson["weight"],
                "recommendation": lesson["recommendation"],
            })
        return entries

    def get_status(self) -> dict:
        return {
            "missions_analyzed": len(self.missions),
            "lessons_learned": len(self.lessons),
            "patterns_detected": self.patterns_detected,
            "recent_lessons": self.lessons[-5:],
        }


# ═══════════════════════════════════════════════════════════════
# 11. COUNTER-MANEUVERS
# ═══════════════════════════════════════════════════════════════

class CounterManeuvers:
    """Уклонение от атак противника"""

    @staticmethod
    def evade_fpv(threat_pos, threat_vel, own_pos, own_vel) -> dict:
        """Уклонение от FPV-камикадзе"""
        dx = own_pos[0] - threat_pos[0]
        dz = own_pos[2] - threat_pos[2]
        dist = math.sqrt(dx*dx + dz*dz)

        if dist < 50:
            return {"action": "dive", "intensity": 1.0}  # резкое пике
        elif dist < 200:
            # Перпендикулярно курсу угрозы
            threat_heading = math.atan2(threat_vel[0], threat_vel[2])
            evade_angle = threat_heading + math.pi / 2
            return {
                "action": "break",
                "heading": math.degrees(evade_angle) % 360,
                "intensity": 0.8,
            }
        elif dist < 500:
            return {"action": "evasive_maneuver", "intensity": 0.4}
        return {"action": "continue", "intensity": 0.0}

    @staticmethod
    def evade_sam(drone_pos, sam_pos, sam_range) -> dict:
        """Уклонение от ЗРК"""
        dx = drone_pos[0] - sam_pos[0]
        dz = drone_pos[2] - sam_pos[2]
        dist = math.sqrt(dx*dx + dz*dz)

        if dist < sam_range * 0.3:
            return {"action": "notch", "altitude": 10}  # прижаться к земле
        elif dist < sam_range * 0.7:
            return {"action": "weaving", "intensity": 0.6}
        elif dist < sam_range:
            return {"action": "descend_and_evade", "intensity": 0.3}
        return {"action": "continue", "intensity": 0.0}


# ═══════════════════════════════════════════════════════════════
# 12. URBAN ENVIRONMENT
# ═══════════════════════════════════════════════════════════════

class UrbanEnvironment:
    """Городская среда — здания, улицы, verticality"""

    def __init__(self, grid_size=100, cell_size_m=20):
        self.grid_size = grid_size
        self.cell_size = cell_size_m
        self.buildings: List[dict] = []
        self.streets: List[dict] = []
        self._generate_city()

    def _generate_city(self):
        rng = random.Random(42)
        # Уличная сетка
        for i in range(5):
            x = (i - 2) * self.grid_size * self.cell_size / 5
            self.streets.append({"x1": x, "z1": -1000, "x2": x, "z2": 1000, "width": 15})
            self.streets.append({"x1": -1000, "z1": x, "x2": 1000, "z2": x, "width": 15})

        # Здания
        for _ in range(200):
            bx = rng.uniform(-900, 900)
            bz = rng.uniform(-900, 900)
            # Проверка что не на улице
            on_street = False
            for s in self.streets:
                if (abs(bx - s["x1"]) < s["width"] or abs(bz - s["z1"]) < s["width"]):
                    on_street = True; break
            if on_street: continue

            w = rng.uniform(10, 60)
            d = rng.uniform(10, 60)
            h = rng.uniform(5, 100)
            self.buildings.append({
                "x": bx, "z": bz, "width": w, "depth": d, "height": h,
                "type": rng.choice(["residential", "commercial", "industrial", "military"]),
            })

    def is_line_of_sight(self, x1, z1, y1, x2, z2, y2) -> bool:
        """Проверка прямой видимости (учёт зданий)"""
        for b in self.buildings:
            if self._line_intersects_box(x1, z1, y1, x2, z2, y2,
                                        b["x"], b["z"], 0,
                                        b["x"]+b["width"], b["z"]+b["depth"], b["height"]):
                return False
        return True

    def _line_intersects_box(self, x1, z1, y1, x2, z2, y2,
                            bx1, bz1, by1, bx2, bz2, by2) -> bool:
        """Пересекает ли луч здание (упрощённо)"""
        if x1 < bx1 and x2 < bx1: return False
        if x1 > bx2 and x2 > bx2: return False
        if z1 < bz1 and z2 < bz1: return False
        if z1 > bz2 and z2 > bz2: return False
        return min(y1, y2) < by2

    def get_building_at(self, x, z) -> Optional[dict]:
        for b in self.buildings:
            if (b["x"] <= x <= b["x"] + b["width"] and
                b["z"] <= z <= b["z"] + b["depth"]):
                return b
        return None


# ═══════════════════════════════════════════════════════════════
# 13. EW COUNTER-MEASURES
# ═══════════════════════════════════════════════════════════════

class EWCounterMeasures:
    """Противодействие радиоэлектронной борьбе"""

    @staticmethod
    def detect_jamming(rssi_history: List[float], noise_floor_dbm=-110) -> bool:
        """Обнаружить глушение по аномалии RSSI"""
        if len(rssi_history) < 10: return False
        avg = sum(rssi_history) / len(rssi_history)
        return avg > noise_floor_dbm + 20  # на 20dB выше шума

    @staticmethod
    def frequency_hop(current_freq_hz: float, jammed_bands: List[Tuple[float, float]]) -> float:
        """Перескок частоты при глушении"""
        available = []
        for base in [433e6, 868e6, 915e6, 1200e6, 2400e6]:
            if not any(low <= base <= high for low, high in jammed_bands):
                available.append(base)
        return random.choice(available) if available else current_freq_hz

    @staticmethod
    def go_silent(drone_state: dict) -> dict:
        """Режим радиомолчания"""
        return {
            "rf_emission": False,
            "loRa_active": False,
            "gps_jamming_protection": True,
            "rely_on": "imu + visual_odometry",
            "max_silent_duration_s": 600,
        }

    @staticmethod
    def home_on_jam(jammer_bearing, drone_pos) -> Tuple[float, float, float]:
        """Наведение на источник помех (анти-РЭБ ракета)"""
        angle = math.radians(jammer_bearing)
        target_x = drone_pos[0] + 5000 * math.sin(angle)
        target_z = drone_pos[2] + 5000 * math.cos(angle)
        return target_x, 0, target_z


# ═══════════════════════════════════════════════════════════════
# 14. ALTERNATE LANDING SITES
# ═══════════════════════════════════════════════════════════════

class AlternateLanding:
    """Запасные аэродромы и аварийная посадка"""

    def __init__(self):
        self.primary_base = (0, 0, 0)
        self.alternates: List[dict] = []
        self.emergency_sites: List[dict] = []
        self._generate_sites()

    def _generate_sites(self):
        # Запасные аэродромы (подготовленные)
        for i in range(3):
            angle = i * 2 * math.pi / 3
            r = 2000
            self.alternates.append({
                "id": f"ALT-{i}",
                "x": self.primary_base[0] + r * math.cos(angle),
                "z": self.primary_base[2] + r * math.sin(angle),
                "y": 0,
                "type": "prepared",
                "condition": "operational",
                "fuel": 100,
                "repair": True,
            })

    def find_best_landing_site(self, drone_pos, battery_pct, damage_pct=0) -> dict:
        """Найти лучший аэродром для посадки"""
        all_sites = [{"id": "PRIMARY", "x": self.primary_base[0],
                     "z": self.primary_base[2], "y": 0,
                     "type": "primary"}] + self.alternates

        best = None
        best_score = float('-inf')
        for site in all_sites:
            dist = math.sqrt((drone_pos[0]-site["x"])**2 + (drone_pos[2]-site["z"])**2)
            range_available = battery_pct * 100  # ~метров на % батареи
            if dist > range_available: continue

            score = 5000 / (dist + 1)  # ближе = лучше
            if site["type"] == "primary": score += 500
            if site.get("repair"): score += 300
            if site.get("fuel", 0) > 50: score += 200

            if score > best_score:
                best_score = score
                best = site

        return best

    def mark_site_destroyed(self, site_id: str):
        for site in self.alternates:
            if site["id"] == site_id:
                site["condition"] = "destroyed"


# ═══════════════════════════════════════════════════════════════
# 15. AUTO TAKEOFF/LANDING
# ═══════════════════════════════════════════════════════════════

class AutoTakeoffLanding:
    """Автономный взлёт и посадка"""

    class Phase(Enum):
        GROUND = "ground"
        TAKEOFF = "takeoff"
        CLIMB = "climb"
        CRUISE = "cruise"
        APPROACH = "approach"
        LANDING = "landing"
        TOUCHDOWN = "touchdown"

    def __init__(self):
        self.phase = self.Phase.GROUND
        self.takeoff_altitude = 100
        self.landing_approach_angle = 6  # градусов (глиссада)
        self.landing_speed = 5  # м/с

    def takeoff_sequence(self, target_altitude=100) -> List[str]:
        """Последовательность взлёта"""
        self.takeoff_altitude = target_altitude
        self.phase = self.Phase.TAKEOFF
        return [
            "preflight_check: sensors OK, motors armed",
            "takeoff: vertical climb to 10m",
            "climb: transition to forward flight",
            f"cruise: reached {target_altitude}m",
        ]

    def landing_sequence(self, landing_site) -> List[str]:
        """Последовательность посадки"""
        self.phase = self.Phase.APPROACH
        return [
            "approach: aligned with runway",
            "descent: glideslope 6 degrees",
            "flare: reduce descent rate at 5m",
            "touchdown: contact, disarm motors",
        ]

    def get_landing_approach(self, drone_pos, landing_pos) -> dict:
        """Параметры захода на посадку"""
        dx = landing_pos[0] - drone_pos[0]
        dz = landing_pos[2] - drone_pos[2]
        dist = math.sqrt(dx*dx + dz*dz)
        heading = math.degrees(math.atan2(dx, dz)) % 360
        descent_angle = self.landing_approach_angle
        return {
            "heading": round(heading, 1),
            "distance": round(dist, 1),
            "descent_angle": descent_angle,
            "target_speed": self.landing_speed,
            "altitude": drone_pos[1],
        }


# ═══════════════════════════════════════════════════════════════
# 16. REATTACK LOGIC
# ═══════════════════════════════════════════════════════════════

class ReattackLogic:
    """Логика повторной атаки"""

    @staticmethod
    def should_reattack(bda_result: dict, available_weapons: int,
                       target_priority: int, own_damage: float) -> Tuple[bool, str]:
        """
        Решить, нужно ли добивать цель.

        Критерии:
          - BDA показал повреждение (не уничтожение)
          - Есть оставшиеся боеприпасы
          - Приоритет цели оправдывает расход
          - Собственные повреждения позволяют
        """
        if bda_result["status"] == "destroyed":
            return False, "Цель уничтожена"

        if bda_result["status"] == "miss":
            if available_weapons <= 0:
                return False, "Нет боеприпасов"
            if target_priority >= 7:  # высокий приоритет
                return True, "Добить приоритетную цель"
            elif target_priority >= 4 and available_weapons >= 2:
                return True, "Повторная атака (есть запас)"
            else:
                return False, "Нецелесообразно"

        if bda_result["status"] == "damaged":
            if own_damage > 50:
                return False, "Слишком повреждён для повторной атаки"
            if available_weapons > 0:
                return True, "Добить повреждённую цель"
            return False, "Нет боеприпасов для добивания"

        return False, "Решение не принято"


# ═══════════════════════════════════════════════════════════════
# ТЕСТ ВСЕХ 11 МОДУЛЕЙ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  ADVANCED COMBAT MODULES — ALL 11 TESTS         ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    print("6. Formation tactics:")
    ft = FormationTactics()
    for name in ["convert", "kleschi", "diamond", "wedge"]:
        ft.set_formation(name)
        p = ft.get_position(0, 6, 0)
        print(f"   {name}: drone-0 at ({p[0]:.0f}, {p[1]:.0f}, {p[2]:.0f})")

    print("\n7. Weather sensors:")
    ws = WeatherSensorModel()
    ws.set_weather(rain=0.6, fog=0.3)
    print(f"   Camera deg: {ws.get_camera_degradation(500):.0%}")
    print(f"   Thermal deg: {ws.get_thermal_degradation(500):.0%}")
    print(f"   RF deg: {ws.get_rf_degradation():.0%}")

    print("\n8. Day/night:")
    for h in [12, 18.5, 23]:
        print(f"   {h:.0f}h: camera={DayNightPerformance.get_camera_range(h,1000):.0f}m "
              f"thermal={DayNightPerformance.get_thermal_range(h,1000):.0f}m")

    print("\n9+10. After Action Review:")
    aar = AfterActionReview()
    result = aar.record_mission({
        "id": "mission-42", "losses": 2, "loss_cause": "SAM",
        "kills": 5, "shots_fired": 8, "duration_min": 15,
        "per_type": {"fpv": {"loss_rate": 0.4}, "scout": {"loss_rate": 0.1}},
    })
    print(f"   Lessons: {result['lessons_learned']}: {result['top_lesson']}")

    print("\n11. Counter-maneuvers:")
    cm = CounterManeuvers()
    r = cm.evade_fpv((500, 0, 300), (50, 0, 30), (100, 120, 50), (30, -2, 20))
    print(f"   FPV evade: {r['action']} intensity={r['intensity']}")
    r = cm.evade_sam((100, 120, 50), (0, 0, 0), 2000)
    print(f"   SAM evade: {r['action']}")

    print("\n12. Urban environment:")
    ue = UrbanEnvironment()
    print(f"   Buildings: {len(ue.buildings)}, Streets: {len(ue.streets)}")
    print(f"   LOS test: {ue.is_line_of_sight(0,0,100, 500,300,50)}")

    print("\n13. EW counter-measures:")
    jammed = EWCounterMeasures.detect_jamming([-90]*20, -110)
    print(f"   Jamming detected: {jammed}")
    new_freq = EWCounterMeasures.frequency_hop(868e6, [(860e6, 870e6)])
    print(f"   New frequency: {new_freq/1e6:.1f} MHz")

    print("\n14. Alternate landing:")
    al = AlternateLanding()
    best = al.find_best_landing_site((2000, 100, 2000), 60)
    print(f"   Best site: {best['id']} at ({best['x']:.0f}, {best['z']:.0f})")

    print("\n15. Auto takeoff/landing:")
    atl = AutoTakeoffLanding()
    print(f"   Takeoff: {atl.takeoff_sequence()[:2]}")
    print(f"   Approach: {atl.get_landing_approach((500,100,300),(0,0,0))}")

    print("\n16. Reattack logic:")
    rl = ReattackLogic()
    for bda, weapons, priority, damage in [
        ({"status":"damaged"}, 2, 8, 10),
        ({"status":"miss"}, 0, 9, 5),
        ({"status":"destroyed"}, 5, 10, 0),
    ]:
        ok, reason = rl.should_reattack(bda, weapons, priority, damage)
        print(f"   {bda['status']} w={weapons} p={priority}: {'🔄' if ok else '✖'} {reason}")

    print("\n═══ ALL 16 MODULES DONE ═══")
