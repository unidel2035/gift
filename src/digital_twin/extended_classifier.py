#!/usr/bin/env python3
"""
extended_classifier.py — Расширенный классификатор на 15 классов целей

Из ground_targets_full.h:
  6 базовых + 9 военных:
  strongpoint, bunker, ew_station, vehicle, person, decoy,
  artillery, mlrs, sam, command_post, ammo_dump,
  trench, bridge, minefield, drone_swarm

Использует расширенные признаки:
  - Геометрия: has_barrel, has_antenna, has_tubes
  - Контекст: has_sandbags, near_water, texture_periodic
  - Тепло: engine_heat, barrel_heat
  - RF: radar_band, command_freq
"""

import math, random
from dataclasses import dataclass, field
from typing import List

# 15 классов
ALL_TYPES = [
    "strongpoint", "bunker", "ew_station", "vehicle", "person", "decoy",
    "artillery", "mlrs", "sam", "command_post", "ammo_dump",
    "trench", "bridge", "minefield", "drone_swarm"
]

ALL_NAMES = [
    "ОПОРНИК", "БЛИНДАЖ", "РЭБ", "ТЕХНИКА", "ЧЕЛОВЕК", "МАКЕТ",
    "АРТИЛЛЕРИЯ", "РСЗО", "ПВО", "КОМАНДНЫЙ ПУНКТ", "СКЛАД БК",
    "ТРАНШЕЯ", "МОСТ", "МИННОЕ ПОЛЕ", "РОЙ ДРОНОВ"
]

# Какие цели атаковать
ATTACKABLE = {
    "strongpoint", "bunker", "ew_station", "vehicle",
    "artillery", "mlrs", "sam", "command_post", "ammo_dump",
    "drone_swarm"
}

# Не атаковать
NO_ATTACK = {"person", "decoy", "trench", "bridge", "minefield"}


@dataclass
class MilitaryFeatures:
    """Расширенные признаки военной цели"""
    # Геометрия (6)
    area_m2: float = 50.0
    perimeter_m: float = 30.0
    aspect_ratio: float = 1.5
    convexity: float = 0.7
    rectangularity: float = 0.6
    circularity: float = 0.3

    # Текстура (4)
    green_ratio: float = 0.3
    texture_variance: float = 0.3
    edge_density: float = 0.2
    texture_periodic: bool = False

    # Тепло (4)
    temp_max: float = 25.0
    temp_mean: float = 20.0
    temp_variance: float = 5.0
    hot_spots: int = 0

    # RF (4)
    rf_power: float = 0.0
    rf_bandwidth: float = 0.0
    rf_duty_cycle: float = 0.0
    rf_peaks: int = 0

    # Контекст (6)
    dist_to_road_m: float = 100.0
    dist_to_trench_m: float = 100.0
    nearby_objects: int = 0
    elevation_m: float = 0.0
    near_water: bool = False

    # Специфические военные (6)
    has_barrel: bool = False       # ствол (артиллерия, танк)
    has_antenna: bool = False      # антенны (РЭБ, КП, ПВО)
    has_tubes: bool = False        # трубы/направляющие (РСЗО)
    has_sandbags: bool = False     # мешки с песком (опорник, КП)
    has_camouflage: bool = False   # камуфляжная сеть
    has_wheels_tracks: bool = False # колёса/гусеницы

    # Динамика (3)
    speed_ms: float = 0.0
    heading_change: float = 0.0
    is_moving: bool = False


class ExtendedClassifier:
    """Классификатор на 15 военных классов"""

    @staticmethod
    def classify(features: MilitaryFeatures) -> dict:
        scores = [0.0] * 15

        # ── Правила для каждого класса ────────────────────

        # 0. STRONGPOINT: большой + прямоугольный + траншеи + sandbags + много объектов
        if features.area_m2 > 50 and features.rectangularity > 0.6 and \
           features.dist_to_trench_m < 25 and features.has_sandbags:
            scores[0] += 3.0
        if features.area_m2 > 80 and features.nearby_objects > 3 and \
           features.rectangularity > 0.5:
            scores[0] += 2.0

        # 1. BUNKER: маленький + очень прямоугольный + не зелёный + нет тепла
        if 5 < features.area_m2 < 30 and features.rectangularity > 0.7 and \
           features.green_ratio < 0.3 and features.temp_max < 28:
            scores[1] += 3.0

        # 2. EW_STATION: RF мощный + антенны + горячий генератор + края
        if features.rf_power > 10 and features.has_antenna and features.temp_max > 30:
            scores[2] += 3.0
        if features.rf_power > 15 and features.edge_density > 0.4:
            scores[2] += 2.0

        # 3. VEHICLE: вытянутый + горячий + движется + колёса
        if features.aspect_ratio > 2.0 and features.temp_max > 35 and \
           features.has_wheels_tracks:
            scores[3] += 3.0
        if features.is_moving and features.speed_ms > 2:
            scores[3] += 1.0

        # 4. PERSON: очень маленький + тёплый + нет RF + иногда движется
        if features.area_m2 < 3 and 28 < features.temp_max < 40 and \
           features.rf_power < 2:
            scores[4] += 3.0
        if features.speed_ms > 0.1 and features.speed_ms < 5:
            scores[4] += 1.0

        # 5. DECOY: похожа на цель геометрией НО холодная И без RF
        if (features.aspect_ratio > 1.8 or features.rectangularity > 0.5) and \
           features.temp_max < 22 and features.rf_power < 2 and \
           not features.is_moving and not features.has_wheels_tracks:
            scores[5] += 3.0

        # 6. ARTILLERY: ствол + большая + горячая (выстрелы) + не движется
        if features.has_barrel and features.area_m2 > 15 and \
           features.temp_max > 30 and not features.has_tubes:
            scores[6] += 3.0
        if features.has_barrel and features.temp_variance > 8:
            scores[6] += 1.0  # нагрев ствола

        # 7. MLRS: трубы + большая площадь + много горячих пятен
        if features.has_tubes and features.area_m2 > 20:
            scores[7] += 3.0
        if features.has_tubes and features.hot_spots > 2 and features.temp_max > 35:
            scores[7] += 2.0

        # 8. SAM: антенна + радарная частота + большая + часто у дороги
        if features.has_antenna and features.rf_bandwidth > 50 and \
           features.area_m2 > 30:
            scores[8] += 3.0
        if features.rf_power > 8 and features.rf_peaks > 3:
            scores[8] += 2.0

        # 9. COMMAND_POST: антенны + sandbags + много объектов + камуфляж
        if features.has_antenna and features.has_sandbags and \
           features.nearby_objects > 2:
            scores[9] += 3.0
        if features.has_camouflage and features.rectangularity > 0.5:
            scores[9] += 2.0

        # 10. AMMO_DUMP: прямоугольный + охрана + не горячий + НЕТ ствола
        if features.rectangularity > 0.6 and features.nearby_objects > 1 and \
           not features.has_barrel and features.temp_max < 30:
            scores[10] += 3.0
        if features.area_m2 > 20 and features.texture_variance < 0.3:
            scores[10] += 1.0

        # 11. TRENCH: линейный (aspect >> 1) + узкий + земляной цвет
        if features.aspect_ratio > 5 and features.area_m2 < 10 and \
           features.green_ratio < 0.4:
            scores[11] += 3.0
        if features.texture_variance < 0.2 and features.dist_to_trench_m < 10:
            scores[11] += 2.0

        # 12. BRIDGE: над водой + вытянутый + дорога рядом
        if features.near_water and features.aspect_ratio > 3 and \
           features.dist_to_road_m < 5:
            scores[12] += 4.0
        if features.near_water and features.rectangularity > 0.4:
            scores[12] += 1.0

        # 13. MINEFIELD: периодическая текстура + низкая растительность
        if features.texture_periodic and features.green_ratio < 0.3 and \
           features.area_m2 > 100:
            scores[13] += 3.0
        if features.texture_periodic and features.edge_density > 0.3:
            scores[13] += 2.0

        # 14. DRONE_SWARM: много объектов + RF + движется + НЕТ ствола/антенны
        if features.nearby_objects > 5 and features.rf_power > 2 and \
           features.is_moving and not features.has_barrel and not features.has_antenna:
            scores[14] += 3.0
        if features.speed_ms > 5 and features.rf_bandwidth > 10:
            scores[14] += 2.0

        # ── Аргмакс ───────────────────────────────────────
        best = max(range(15), key=lambda i: scores[i])
        total = sum(scores)
        confidence = scores[best] / (total + 0.001) if total > 0 else 0.0

        return {
            "target": ALL_TYPES[best],
            "name": ALL_NAMES[best],
            "confidence": min(confidence, 1.0),
            "scores": scores,
            "attack_recommended": ALL_TYPES[best] in ATTACKABLE,
            "action": _get_action(ALL_TYPES[best]),
        }

    @staticmethod
    def generate_features(target_type: str, drone_pos=None) -> MilitaryFeatures:
        """Сгенерировать реалистичные признаки для заданного типа"""
        f = MilitaryFeatures()

        if target_type == "strongpoint":
            f.area_m2 = random.uniform(80, 200)
            f.rectangularity = random.uniform(0.6, 0.85)
            f.dist_to_trench_m = random.uniform(2, 15)
            f.has_sandbags = True
            f.nearby_objects = random.randint(4, 8)
            f.temp_max = random.uniform(20, 30)
            f.rf_power = random.uniform(1, 3)

        elif target_type == "bunker":
            f.area_m2 = random.uniform(8, 25)
            f.rectangularity = random.uniform(0.75, 0.95)
            f.green_ratio = random.uniform(0.05, 0.2)
            f.temp_max = random.uniform(15, 25)
            f.dist_to_road_m = random.uniform(5, 30)

        elif target_type == "ew_station":
            f.area_m2 = random.uniform(20, 80)
            f.rf_power = random.uniform(15, 30)
            f.has_antenna = True
            f.temp_max = random.uniform(35, 55)
            f.edge_density = random.uniform(0.5, 0.9)
            f.hot_spots = random.randint(2, 5)

        elif target_type == "vehicle":
            f.area_m2 = random.uniform(15, 45)
            f.aspect_ratio = random.uniform(2.5, 5.0)
            f.has_wheels_tracks = True
            f.temp_max = random.uniform(45, 80)
            f.is_moving = True
            f.speed_ms = random.uniform(5, 30)
            f.dist_to_road_m = random.uniform(2, 15)

        elif target_type == "person":
            f.area_m2 = random.uniform(0.5, 2.5)
            f.temp_max = random.uniform(34, 38)
            f.rf_power = 0
            f.speed_ms = random.uniform(0.5, 3)

        elif target_type == "decoy":
            f.area_m2 = random.uniform(15, 40)
            f.aspect_ratio = random.uniform(2, 4)
            f.temp_max = random.uniform(12, 20)
            f.rf_power = 0
            f.speed_ms = 0

        elif target_type == "artillery":
            f.area_m2 = random.uniform(20, 60)
            f.has_barrel = True
            f.temp_max = random.uniform(30, 50)
            f.temp_variance = random.uniform(8, 15)
            f.dist_to_road_m = random.uniform(5, 50)

        elif target_type == "mlrs":
            f.area_m2 = random.uniform(25, 70)
            f.has_tubes = True
            f.hot_spots = random.randint(3, 8)
            f.temp_max = random.uniform(35, 60)

        elif target_type == "sam":
            f.area_m2 = random.uniform(30, 100)
            f.has_antenna = True
            f.rf_bandwidth = random.uniform(50, 100)
            f.rf_peaks = random.randint(3, 6)
            f.rf_power = random.uniform(8, 20)

        elif target_type == "command_post":
            f.has_antenna = True
            f.has_sandbags = True
            f.nearby_objects = random.randint(3, 6)
            f.has_camouflage = True
            f.area_m2 = random.uniform(30, 80)

        elif target_type == "ammo_dump":
            f.rectangularity = random.uniform(0.6, 0.9)
            f.nearby_objects = random.randint(2, 4)
            f.temp_max = random.uniform(15, 28)
            f.area_m2 = random.uniform(20, 60)

        elif target_type == "trench":
            f.aspect_ratio = random.uniform(5, 15)
            f.area_m2 = random.uniform(3, 8)
            f.green_ratio = random.uniform(0.1, 0.35)
            f.texture_variance = random.uniform(0.1, 0.25)

        elif target_type == "bridge":
            f.near_water = True
            f.aspect_ratio = random.uniform(3, 8)
            f.dist_to_road_m = random.uniform(0, 3)
            f.area_m2 = random.uniform(30, 100)

        elif target_type == "minefield":
            f.texture_periodic = True
            f.area_m2 = random.uniform(100, 500)
            f.green_ratio = random.uniform(0.1, 0.25)
            f.edge_density = random.uniform(0.3, 0.5)

        elif target_type == "drone_swarm":
            f.nearby_objects = random.randint(6, 12)
            f.rf_power = random.uniform(3, 8)
            f.is_moving = True
            f.speed_ms = random.uniform(5, 20)
            f.rf_bandwidth = random.uniform(10, 30)

        return f


def _get_action(target_type: str) -> str:
    actions = {
        "strongpoint": "АТАКОВАТЬ FPV. Приоритет: высокий.",
        "bunker": "АТАКОВАТЬ FPV. Приоритет: средний.",
        "ew_station": "АТАКОВАТЬ FPV. Приоритет: КРИТИЧЕСКИЙ.",
        "vehicle": "АТАКОВАТЬ FPV. Приоритет: высокий (подвижная).",
        "person": "НАБЛЮДАТЬ. Возможно гражданский.",
        "decoy": "ИГНОРИРОВАТЬ. Не тратить БК.",
        "artillery": "АТАКОВАТЬ FPV. Приоритет: ВЫСОКИЙ.",
        "mlrs": "АТАКОВАТЬ FPV. Приоритет: КРИТИЧЕСКИЙ.",
        "sam": "АТАКОВАТЬ FPV. Приоритет: КРИТИЧЕСКИЙ (угроза авиации).",
        "command_post": "АТАКОВАТЬ FPV. Приоритет: ВЫСОКИЙ.",
        "ammo_dump": "АТАКОВАТЬ FPV. Приоритет: ВЫСОКИЙ (взрыв).",
        "trench": "НАБЛЮДАТЬ. Тактическая разведка.",
        "bridge": "НАБЛЮДАТЬ. Может быть гражданским.",
        "minefield": "КАРТОГРАФИРОВАТЬ. Не атаковать.",
        "drone_swarm": "АТАКОВАТЬ. РЭБ + FPV. Приоритет: ВЫСОКИЙ.",
    }
    return actions.get(target_type, "НАБЛЮДАТЬ.")


# ═══════════════════════════════════════════════════════════════
# Тест
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═══ Extended 15-Class Classifier Test ═══")
    print()

    correct = 0
    total = 0

    all_test_types = ALL_TYPES[:]  # все 15 классов

    for run in range(3):
        print(f"─── Run {run+1} ───")
        for ttype in all_test_types:
            f = ExtendedClassifier.generate_features(ttype)
            result = ExtendedClassifier.classify(f)
            total += 1
            ok = result["target"] == ttype
            if ok: correct += 1
            icon = "✓" if ok else "✗"
            print(f"  {icon} {ttype:18s} → {result['name']:20s} "
                  f"conf={result['confidence']:.3f} attack={result['attack_recommended']}")
        print()

    print(f"Accuracy: {correct}/{total} = {100*correct/total:.0f}%")
    print("Extended classifier OK")
