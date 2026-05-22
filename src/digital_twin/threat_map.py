#!/usr/bin/env python3
"""
threat_map.py — Тепловая карта угроз поля боя

Реализует:
  - Kernel Density Estimation (KDE) угроз
  - Зоны контроля (Zones of Control)
  - Опасные зоны (Danger Areas)
  - Безопасные коридоры (Safe Corridors)
  - A* pathfinding через поле угроз
  - Real-time обновление для визуализации
"""

import math, random
from dataclasses import dataclass
from typing import List, Tuple, Optional


@dataclass
class ThreatSource:
    """Источник угрозы на поле боя"""
    x: float; z: float
    threat_type: str           # enemy, ew, sam, artillery, unknown
    intensity: float = 1.0     # 0..1
    radius: float = 1000.0     # радиус влияния (м)
    mobile: bool = False
    velocity: Tuple[float, float] = (0, 0)


class ThreatMap:
    """
    Тепловая карта угроз.

    Использует взвешенную сумму Гауссовых ядер (KDE)
    для построения непрерывного поля угроз.
    """

    def __init__(self, grid_size=100, world_size=2000):
        self.grid_size = grid_size        # разрешение сетки
        self.world_size = world_size      # размер мира (м)
        self.cell_size = world_size / grid_size
        self.sources: List[ThreatSource] = []
        # Сетка
        self.grid = [[0.0] * grid_size for _ in range(grid_size)]
        self.normalized_grid = [[0.0] * grid_size for _ in range(grid_size)]
        # Зоны
        self.danger_zones: List[dict] = []
        self.safe_corridors: List[dict] = []

    def add_source(self, source: ThreatSource):
        self.sources.append(source)

    def clear_sources(self):
        self.sources.clear()

    def update(self, dt=0.1):
        """Обновить тепловую карту"""
        # Движение мобильных источников
        for src in self.sources:
            if src.mobile:
                src.x += src.velocity[0] * dt
                src.z += src.velocity[1] * dt

        # Пересчитать сетку
        max_val = 0.001
        for i in range(self.grid_size):
            wx = (i - self.grid_size / 2) * self.cell_size
            for j in range(self.grid_size):
                wz = (j - self.grid_size / 2) * self.cell_size
                threat = 0.0

                for src in self.sources:
                    dist = math.sqrt((wx - src.x)**2 + (wz - src.z)**2)
                    # Гауссово ядро
                    sigma = src.radius / 3.0  # 3σ ≈ радиус
                    if dist < src.radius * 1.5:
                        threat += src.intensity * math.exp(-0.5 * (dist ** 2) / (sigma ** 2))

                self.grid[i][j] = threat
                max_val = max(max_val, threat)

        # Нормализация
        if max_val > 0:
            for i in range(self.grid_size):
                for j in range(self.grid_size):
                    self.normalized_grid[i][j] = self.grid[i][j] / max_val

        # Выделение зон
        self._extract_zones()

    def _extract_zones(self):
        """Выделить опасные зоны и безопасные коридоры"""
        self.danger_zones = []
        self.safe_corridors = []

        # Опасные зоны: ячейки с threat > 0.7
        danger_cells = []
        for i in range(self.grid_size):
            for j in range(self.grid_size):
                if self.normalized_grid[i][j] > 0.7:
                    wx = (i - self.grid_size / 2) * self.cell_size
                    wz = (j - self.grid_size / 2) * self.cell_size
                    danger_cells.append((wx, wz, self.normalized_grid[i][j]))

        # Кластеризация опасных ячеек (простейшая: группировка по близости)
        if danger_cells:
            self.danger_zones = self._cluster_cells(danger_cells, threshold=self.cell_size * 3)

        # Безопасные коридоры: проходы между опасными зонами (упрощённо)
        if len(self.danger_zones) >= 2:
            for i in range(len(self.danger_zones)):
                for j in range(i + 1, len(self.danger_zones)):
                    z1 = self.danger_zones[i]
                    z2 = self.danger_zones[j]
                    mid_x = (z1["center"][0] + z2["center"][0]) / 2
                    mid_z = (z1["center"][1] + z2["center"][1]) / 2
                    dist = math.sqrt(
                        (z1["center"][0] - z2["center"][0])**2 +
                        (z1["center"][1] - z2["center"][1])**2
                    )
                    # Если зоны разделены промежутком
                    if dist > (z1["radius"] + z2["radius"]) * 0.5:
                        self.safe_corridors.append({
                            "between": (z1["center"], z2["center"]),
                            "midpoint": (mid_x, mid_z),
                            "width": max(50, dist - z1["radius"] - z2["radius"]),
                        })

    def _cluster_cells(self, cells, threshold):
        """Простейшая кластеризация ячеек"""
        zones = []
        used = set()

        for i, (cx, cz, cval) in enumerate(cells):
            if i in used:
                continue
            cluster = [(cx, cz, cval)]
            used.add(i)

            # Добавляем соседние ячейки
            changed = True
            while changed:
                changed = False
                for j, (ox, oy, oval) in enumerate(cells):
                    if j in used:
                        continue
                    for (ccx, ccz, _) in list(cluster):
                        if math.sqrt((ox - ccx)**2 + (oy - ccz)**2) < threshold:
                            cluster.append((ox, oy, oval))
                            used.add(j)
                            changed = True
                            break

            if len(cluster) >= 3:
                cx_avg = sum(c[0] for c in cluster) / len(cluster)
                cz_avg = sum(c[1] for c in cluster) / len(cluster)
                radius = max(
                    math.sqrt((c[0] - cx_avg)**2 + (c[1] - cz_avg)**2)
                    for c in cluster
                ) + self.cell_size

                zones.append({
                    "center": (cx_avg, cz_avg),
                    "radius": radius,
                    "intensity": sum(c[2] for c in cluster) / len(cluster),
                    "cell_count": len(cluster),
                })

        return zones

    def get_threat_at(self, x, z) -> float:
        """Получить уровень угрозы в точке (интерполяция)"""
        i = int((x + self.world_size / 2) / self.cell_size)
        j = int((z + self.world_size / 2) / self.cell_size)

        i = max(0, min(self.grid_size - 1, i))
        j = max(0, min(self.grid_size - 1, j))
        return self.normalized_grid[i][j]

    def find_safe_path(self, start, end, num_waypoints=5):
        """
        A*-подобный поиск безопасного пути.
        Упрощённо: оптимизация waypoints через поле угроз.
        """
        sx, sz = start
        ex, ez = end

        # Генерируем waypoints-кандидаты (равномерно по линии + смещения)
        best_path = None
        best_cost = float('inf')

        for attempt in range(20):
            waypoints = []
            for k in range(1, num_waypoints):
                t = k / (num_waypoints)
                wx = sx + (ex - sx) * t
                wz = sz + (ez - sz) * t
                # Случайное смещение
                offset = random.uniform(-300, 300) * (1 - abs(t - 0.5) * 2)
                wx += offset * random.uniform(-1, 1)
                wz += offset * random.uniform(-1, 1)
                waypoints.append((wx, wz))

            # Оценка стоимости пути: сумма угроз + длина
            cost = 0
            prev = (sx, sz)
            for wp in waypoints:
                cost += self.get_threat_at(wp[0], wp[1]) * 500
                cost += math.sqrt((wp[0] - prev[0])**2 + (wp[1] - prev[1])**2) * 0.01
                prev = wp

            if cost < best_cost:
                best_cost = cost
                best_path = waypoints

        return best_path if best_path else []

    def get_grid_data(self) -> dict:
        """Получить данные сетки для визуализации (API)"""
        return {
            "grid_size": self.grid_size,
            "world_size": self.world_size,
            "cell_size": self.cell_size,
            "grid": [row[:] for row in self.normalized_grid],
            "max_threat": max(max(row) for row in self.normalized_grid),
            "danger_zones": self.danger_zones,
            "safe_corridors": self.safe_corridors,
            "sources": [{
                "x": s.x, "z": s.z,
                "type": s.threat_type,
                "intensity": s.intensity,
                "radius": s.radius,
                "mobile": s.mobile,
            } for s in self.sources],
        }


# ═══════════════════════════════════════════════════════════════
# Тест
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═══ Threat Map Test ═══")

    threat_map = ThreatMap(grid_size=50, world_size=2000)

    # Добавляем источники угроз
    threat_map.add_source(ThreatSource(300, 200, "strongpoint", 1.0, 500))
    threat_map.add_source(ThreatSource(-400, -300, "ew_station", 0.8, 800))
    threat_map.add_source(ThreatSource(500, -200, "sam", 1.0, 1200))
    threat_map.add_source(ThreatSource(-200, 400, "artillery", 0.6, 600, mobile=True, velocity=(5, -3)))

    threat_map.update()

    # Тест нескольких точек
    test_points = [(0, 0), (300, 200), (500, -200), (-400, -300)]
    for x, z in test_points:
        threat = threat_map.get_threat_at(x, z)
        print(f"  ({x:4.0f}, {z:4.0f}): threat={threat:.3f}")

    # Безопасный путь
    path = threat_map.find_safe_path((-500, -500), (500, 500))
    print(f"  Safe path: {len(path)} waypoints")
    for i, (wx, wz) in enumerate(path):
        t = threat_map.get_threat_at(wx, wz)
        print(f"    WP{i}: ({wx:.0f}, {wz:.0f}) threat={t:.3f}")

    zones = threat_map.danger_zones
    corridors = threat_map.safe_corridors
    print(f"  Danger zones: {len(zones)}")
    print(f"  Safe corridors: {len(corridors)}")

    grid_data = threat_map.get_grid_data()
    print(f"  Grid: {grid_data['grid_size']}² max_threat={grid_data['max_threat']:.2f}")
    print("Threat map OK")
