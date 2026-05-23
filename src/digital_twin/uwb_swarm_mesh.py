#!/usr/bin/env python3
"""
uwb_swarm_mesh.py — UWB-сетка роя: как дроны видят друг друга

DW1000 UWB чип ($5, 10см точность, 500м радиус):
  - Каждый дрон измеряет дистанцию до N ближайших соседей
  - 3+ дронов → trilateration → относительные координаты
  - Если есть хотя бы 1 дрон с GPS → абсолютные координаты всего роя
  - Частота: 10 измерений/сек (можно чаще)
  - Невидим для врага (пассивный приём не выдаёт позицию)

Слои позиционирования роя:
  1. UWB ranging (основной)    — пассивный, точный, скрытный
  2. Camera + YOLO detection    — визуальный контакт, пассивный
  3. LoRa GPS broadcast         — активный, слышен врагу (только при необходимости)
  4. IMU dead reckoning         — базис, всегда работает
"""

import math, random, time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import numpy as np


@dataclass
class UWBRanging:
    """Одно измерение UWB между двумя дронами"""
    from_id: str
    to_id: str
    distance_m: float          # измеренная дистанция
    true_distance_m: float    # истинная дистанция
    rssi_dbm: float           # мощность сигнала
    quality: float            # качество измерения (0..1)
    timestamp: float


class DW1000Chip:
    """Эмуляция чипа DW1000 UWB на дроне"""

    def __init__(self, drone_id: str):
        self.drone_id = drone_id
        self.rangings: Dict[str, UWBRanging] = {}  # последние измерения до соседей
        self.position_estimate = np.zeros(3)        # своя оценка позиции по UWB
        self.position_uncertainty = 10.0            # метров (без якорей)
        self.anchors_visible = 0                    # сколько якорей видно
        self.mesh_quality = 0.0                     # качество позиционирования

        # Параметры DW1000
        self.tx_power_dbm = -14.3  # dBm (DW1000 default)
        self.rx_sensitivity = -106  # dBm @ 110kbps
        self.max_range = 500.0      # метров
        self.accuracy_cm = 10.0     # сантиметров (1σ)
        self.update_rate = 10       # Hz

    def measure_range(self, target_id: str, target_pos: np.ndarray,
                     own_pos: np.ndarray) -> UWBRanging:
        """Измерить дистанцию до другого дрона"""
        true_dist = np.linalg.norm(target_pos - own_pos)

        if true_dist > self.max_range:
            return None  # вне радиуса

        # Модель шума: accuracy + distance-dependent error
        noise = random.gauss(0, self.accuracy_cm / 100.0)
        noise += true_dist * 0.001 * random.gauss(0, 1)  # 0.1% от дистанции
        measured = true_dist + noise

        # RSSI model (free space path loss)
        rssi = self.tx_power_dbm - 20 * math.log10(max(true_dist, 0.1)) + random.gauss(0, 2)
        quality = min(1.0, max(0.0, (rssi + 100) / 60.0))

        ranging = UWBRanging(
            from_id=self.drone_id,
            to_id=target_id,
            distance_m=measured,
            true_distance_m=true_dist,
            rssi_dbm=rssi,
            quality=quality,
            timestamp=time.time(),
        )
        self.rangings[target_id] = ranging
        return ranging

    def update_position(self, all_rangings: Dict[str, 'DW1000Chip'],
                       anchor_positions: List[Tuple[str, np.ndarray]]):
        """
        Вычислить свою позицию методом trilateration.

        anchor_positions: дроны с известными GPS-координатами (якоря)
        """
        # Собираем все измерения до соседей
        measurements = []
        for neighbor_id, neighbor_chip in all_rangings.items():
            if neighbor_id == self.drone_id:
                continue
            ranging = neighbor_chip.rangings.get(self.drone_id)
            if ranging and ranging.quality > 0.3:
                pos_est = neighbor_chip.position_estimate
                measurements.append((pos_est, ranging.distance_m, ranging.quality))

        # Добавляем якоря (дроны с GPS)
        for anchor_id, anchor_pos in anchor_positions:
            if anchor_id != self.drone_id:
                dist = np.linalg.norm(anchor_pos - self.position_estimate)
                if dist < self.max_range:
                    measurements.append((anchor_pos, dist, 1.0))

        self.anchors_visible = len(anchor_positions) + len([m for m in measurements if m[2] > 0.8])

        if len(measurements) >= 3:
            # Трилатерация (least squares)
            self._trilaterate(measurements)
            self.mesh_quality = min(1.0, len(measurements) / 5.0)
        elif len(measurements) >= 1:
            # Хотя бы одна дистанция — уменьшаем неопределённость
            self.position_uncertainty = max(1.0, self.position_uncertainty * 0.7)
            self.mesh_quality = 0.3
        else:
            # Нет соседей — дрейф IMU
            self.position_uncertainty = min(50.0, self.position_uncertainty + 0.1)
            self.mesh_quality = 0.0

    def _trilaterate(self, measurements: List[Tuple[np.ndarray, float, float]]):
        """Решить trilateration методом наименьших квадратов"""
        if len(measurements) < 3:
            return

        # Взвешенный МНК
        A = []
        b = []
        weights = []

        # Используем первые 3 для начального приближения
        p1, r1, w1 = measurements[0]
        p2, r2, w2 = measurements[1]
        p3, r3, w3 = measurements[2]

        # Решаем 2D (x, z) — высота от барометра
        # Уравнения окружностей → линейная система
        x1, z1 = p1[0], p1[2]
        x2, z2 = p2[0], p2[2]
        x3, z3 = p3[0], p3[2]

        # (x - x_i)² + (z - z_i)² = r_i²
        # → 2(x_j - x_i)x + 2(z_j - z_i)z = r_i² - r_j² + x_j² - x_i² + z_j² - z_i²

        A = np.array([
            [2*(x2 - x1), 2*(z2 - z1)],
            [2*(x3 - x1), 2*(z3 - z1)],
        ])
        b = np.array([
            r1**2 - r2**2 + x2**2 - x1**2 + z2**2 - z1**2,
            r1**2 - r3**2 + x3**2 - x1**2 + z3**2 - z1**2,
        ])

        try:
            # Решаем Ax = b
            x = np.linalg.lstsq(A, b, rcond=None)[0]
            new_est = np.array([x[0], self.position_estimate[1], x[1]])

            # Фильтр: плавное обновление
            alpha = 0.7
            self.position_estimate = alpha * new_est + (1 - alpha) * self.position_estimate
            self.position_uncertainty = max(0.1, self.position_uncertainty * 0.5)

        except np.linalg.LinAlgError:
            pass


class UWBSwarmMesh:
    """Полная UWB-сетка роя"""

    def __init__(self):
        self.drones: Dict[str, DW1000Chip] = {}
        self.anchors: List[Tuple[str, np.ndarray]] = []  # дроны с GPS

    def add_drone(self, drone_id: str, position: Tuple[float, float, float] = None):
        chip = DW1000Chip(drone_id)
        if position:
            chip.position_estimate = np.array(position)
        self.drones[drone_id] = chip

    def add_anchor(self, drone_id: str, gps_position: Tuple[float, float, float]):
        """Добавить якорь — дрон с известной GPS-позицией"""
        self.anchors.append((drone_id, np.array(gps_position)))
        if drone_id in self.drones:
            self.drones[drone_id].position_estimate = np.array(gps_position)
            self.drones[drone_id].position_uncertainty = 0.5  # GPS точность

    def update(self, true_positions: Dict[str, np.ndarray]):
        """Один цикл обновления UWB-сетки"""
        # 1. Все дроны измеряют дистанции до соседей
        for did, chip in self.drones.items():
            pos = true_positions.get(did, chip.position_estimate)
            for nid, nchip in self.drones.items():
                if did == nid: continue
                npos = true_positions.get(nid, nchip.position_estimate)
                dist = np.linalg.norm(pos - npos)
                if dist < chip.max_range:
                    chip.measure_range(nid, npos, pos)

        # 2. Каждый дрон вычисляет свою позицию
        for did, chip in self.drones.items():
            chip.update_position(self.drones, self.anchors)

    def get_status(self) -> dict:
        drones_info = {}
        for did, chip in self.drones.items():
            drones_info[did] = {
                "position_est": [round(x, 1) for x in chip.position_estimate.tolist()],
                "uncertainty_m": round(chip.position_uncertainty, 1),
                "mesh_quality": round(chip.mesh_quality, 2),
                "neighbors_visible": sum(1 for r in chip.rangings.values() if r.quality > 0.3),
                "anchors_visible": chip.anchors_visible,
            }
        return {
            "total_drones": len(self.drones),
            "anchors": len(self.anchors),
            "drones": drones_info,
            "mesh_health": round(
                sum(1 for c in self.drones.values() if c.mesh_quality > 0.5) / max(1, len(self.drones)),
                2
            ),
        }


# ═══════════════════════════════════════════════════════════════
# ДЕМОНСТРАЦИЯ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  UWB SWARM MESH — Как дроны видят друг друга    ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    mesh = UWBSwarmMesh()

    # 6 дронов в рое
    true_positions = {
        "Scout-1": np.array([0.0, 120.0, 0.0]),
        "Scout-2": np.array([200.0, 130.0, -100.0]),
        "FPV-1": np.array([-150.0, 80.0, 200.0]),
        "FPV-2": np.array([300.0, 90.0, -250.0]),
        "Interceptor-1": np.array([-300.0, 140.0, -300.0]),
        "Repeater-1": np.array([0.0, 350.0, 0.0]),
    }

    for did in true_positions:
        mesh.add_drone(did)
    # Repeater имеет GPS (якорь)
    mesh.add_anchor("Repeater-1", (0.0, 350.0, 0.0))
    # Interceptor тоже с GPS
    mesh.add_anchor("Interceptor-1", (-300.0, 140.0, -300.0))

    print("Рой из 6 дронов. 2 с GPS (якоря), 4 без GPS.")
    print()

    # 5 циклов обновления
    for cycle in range(5):
        mesh.update(true_positions)

        # Движение дронов
        for did in true_positions:
            true_positions[did] += np.array([
                random.uniform(-20, 20), random.uniform(-5, 5), random.uniform(-20, 20)
            ])

        if cycle >= 2:  # показать после стабилизации
            status = mesh.get_status()
            print(f"Цикл {cycle+1} | Mesh health: {status['mesh_health']:.0%}")
            for did, info in status['drones'].items():
                has_gps = "📍" if did in ["Repeater-1", "Interceptor-1"] else "  "
                print(f"  {has_gps} {did:16s}: pos=({info['position_est'][0]:6.0f},{info['position_est'][2]:6.0f}) "
                      f"±{info['uncertainty_m']:.1f}m "
                      f"qual={info['mesh_quality']:.2f} "
                      f"nbr={info['neighbors_visible']}")
            print()

    # Тест: потеря якоря
    print("═══ ПОТЕРЯ GPS-ЯКОРЯ ═══")
    print("Repeater-1 выключился — остался 1 якорь")
    mesh.anchors = [a for a in mesh.anchors if a[0] != "Repeater-1"]
    del mesh.drones["Repeater-1"]
    del true_positions["Repeater-1"]

    for cycle in range(3):
        mesh.update(true_positions)
        if cycle == 2:
            status = mesh.get_status()
            print(f"Mesh health: {status['mesh_health']:.0%}")
            for did, info in status['drones'].items():
                print(f"  {did:16s}: ±{info['uncertainty_m']:.1f}m qual={info['mesh_quality']:.2f} nbr={info['neighbors_visible']}")

    print()
    print("Вывод: 2+ якоря с GPS → весь рой знает свои координаты с точностью ~1м.")
    print("Потеря якорей → точность падает, но рой держит относительную геометрию через UWB.")
