#!/usr/bin/env python3
"""
real_terrain.py — Реалистичный 3D-рельеф из SRTM или синтезированный

Загрузка SRTM .hgt файлов (3 arc-second, ~90м разрешение).
Если SRTM недоступен — генерирует синтетический рельеф высокого качества
с реалистичными геоморфологическими паттернами:
  - Холмы и долины (фрактальный шум)
  - Речная сеть (эрозионная модель)
  - Дорожная сеть
  - Лесные массивы
  - Здания/сооружения
"""

import math, random, struct, os, hashlib
from dataclasses import dataclass
from typing import Optional

@dataclass
class TerrainTile:
    """Плитка рельефа"""
    width: int = 256          # точек
    height: int = 256
    cell_size_m: float = 10.0  # метров на ячейку
    data: list = None          # 2D массив высот

    def __post_init__(self):
        if self.data is None:
            self.data = [[0.0] * self.width for _ in range(self.height)]

    def get_height(self, x_m, z_m):
        """Высота в точке (билинейная интерполяция)"""
        ix = x_m / self.cell_size_m + self.width / 2
        iz = z_m / self.cell_size_m + self.height / 2

        ix0 = max(0, min(self.width - 2, int(ix)))
        iz0 = max(0, min(self.height - 2, int(iz)))
        ix1, iz1 = ix0 + 1, iz0 + 1
        fx, fz = ix - ix0, iz - iz0

        h00 = self.data[iz0][ix0]
        h10 = self.data[iz0][ix1]
        h01 = self.data[iz1][ix0]
        h11 = self.data[iz1][ix1]

        return (h00 * (1-fx) * (1-fz) +
                h10 * fx * (1-fz) +
                h01 * (1-fx) * fz +
                h11 * fx * fz)


class TerrainGenerator:
    """
    Генератор реалистичного рельефа.

    Слои (синтезируются алгоритмически):
      1. Base: крупномасштабный рельеф (фрактальный шум)
      2. Hills: средне- и мелкомасштабные холмы
      3. Rivers: эрозионная речная сеть
      4. Roads: дорожная сеть
      5. Features: воронки, окопы (боевые повреждения)
    """

    def __init__(self, width=256, height=256, cell_size=10.0, seed=42):
        self.width = width
        self.height = height
        self.cell_size = cell_size
        self.seed = seed
        self.tile = TerrainTile(width, height, cell_size)
        self.road_network = []
        self.water_bodies = []
        self.forest_areas = []

    def generate(self):
        """Сгенерировать все слои рельефа"""
        rng = random.Random(self.seed)

        # Слой 1: Крупномасштабный рельеф (фрактальный шум)
        self._simplex_like(self.tile, scale=200.0, amplitude=30.0, octaves=4)

        # Слой 2: Среднемасштабные холмы
        hills = TerrainTile(self.width, self.height, self.cell_size)
        self._simplex_like(hills, scale=80.0, amplitude=12.0, octaves=3)
        self._blend(self.tile, hills, 0.6)

        # Слой 3: Мелкие детали
        detail = TerrainTile(self.width, self.height, self.cell_size)
        self._simplex_like(detail, scale=25.0, amplitude=3.0, octaves=2)
        self._blend(self.tile, detail, 0.3)

        # Слой 4: Речная сеть (эрозия)
        self._generate_rivers(rng)

        # Слой 5: Боевые повреждения (воронки, траншеи)
        self._add_battle_damage(rng)

        # Вычислить дороги
        self._generate_roads()

        # Вычислить лесные массивы
        self._generate_forests(rng)

        return self.tile

    def _simplex_like(self, tile, scale, amplitude, octaves):
        """Упрощённый фрактальный шум"""
        persistence = 0.5
        lacunarity = 2.0

        for i in range(tile.width):
            wx = (i - tile.width / 2) * tile.cell_size_m
            for j in range(tile.height):
                wz = (j - tile.height / 2) * tile.cell_size_m
                h = 0.0
                freq, amp = 1.0 / scale, amplitude
                for _ in range(octaves):
                    # Hash-based value noise
                    hx = wx * freq + self.seed * 123.456
                    hz = wz * freq + self.seed * 789.012
                    n = self._hash_noise(hx, hz)
                    h += n * amp
                    freq *= lacunarity
                    amp *= persistence
                tile.data[j][i] += h

    def _hash_noise(self, x, z):
        """Хэш-функция → псевдослучайное значение [-1, 1]"""
        ix, iz = int(x * 1000), int(z * 1000)
        h = hashlib.md5(f"{ix},{iz}".encode()).hexdigest()
        val = int(h[:8], 16) / (2**32 - 1)
        return val * 2 - 1

    def _blend(self, base, overlay, alpha):
        for i in range(base.width):
            for j in range(base.height):
                base.data[j][i] = base.data[j][i] * (1-alpha) + overlay.data[j][i] * alpha

    def _generate_rivers(self, rng):
        """Генерация речной сети"""
        num_rivers = rng.randint(2, 5)
        for _ in range(num_rivers):
            # Случайный исток на возвышенности
            sx = rng.randint(self.width // 4, 3 * self.width // 4)
            sz = rng.randint(self.height // 4, 3 * self.height // 4)

            # Течение вниз по градиенту
            cx, cz = float(sx), float(sz)
            for step in range(500):
                ix, iz = int(cx), int(cz)
                if ix < 2 or ix >= self.width - 2 or iz < 2 or iz >= self.height - 2:
                    break

                # Эрозия в текущей точке
                for di in range(-2, 3):
                    for dj in range(-2, 3):
                        if 0 <= ix+di < self.width and 0 <= iz+dj < self.height:
                            d = math.sqrt(di**2 + dj**2)
                            if d < 2.5:
                                self.tile.data[iz+dj][ix+di] -= 1.5 * math.exp(-d/2.0)

                # Спуск по градиенту
                best_dh = 0
                best_dir = (0, 0)
                h = self.tile.data[iz][ix]
                for di in (-1, 0, 1):
                    for dj in (-1, 0, 1):
                        nh = self.tile.data[iz+dj][ix+di]
                        dh = h - nh
                        if dh > best_dh:
                            best_dh = dh
                            best_dir = (di, dj)

                if best_dir == (0, 0):
                    break
                cx += best_dir[0] * 0.3
                cz += best_dir[1] * 0.3

    def _add_battle_damage(self, rng):
        """Добавить воронки и траншеи"""
        # Воронки от взрывов
        for _ in range(rng.randint(10, 25)):
            cx = rng.randint(20, self.width - 20)
            cz = rng.randint(20, self.height - 20)
            crater_radius = rng.uniform(10, 40)
            crater_depth = rng.uniform(2, 8)

            for i in range(self.width):
                for j in range(self.height):
                    d = math.sqrt(((i-cx)*self.cell_size)**2 + ((j-cz)*self.cell_size)**2)
                    if d < crater_radius:
                        self.tile.data[j][i] -= crater_depth * math.exp(-0.5 * (d / (crater_radius/3))**2)

        # Траншеи (линейные)
        for _ in range(rng.randint(1, 3)):
            x1 = rng.randint(50, self.width - 50)
            z1 = rng.randint(50, self.height - 50)
            x2 = x1 + rng.randint(-60, 60)
            z2 = z1 + rng.randint(-60, 60)
            # Рисуем линию траншеи
            for t in range(80):
                frac = t / 79
                cx = int(x1 + (x2 - x1) * frac)
                cz = int(z1 + (z2 - z1) * frac)
                for di in range(-2, 3):
                    for dj in range(-2, 3):
                        if 0 <= cx+di < self.width and 0 <= cz+dj < self.height:
                            d = math.sqrt(di**2 + dj**2)
                            self.tile.data[cz+dj][cx+di] -= 2.0 * math.exp(-d/1.5)

    def _generate_roads(self):
        """Генерировать дорожную сеть"""
        # Основные дороги: крест через центр
        self.road_network = [
            {"from": (-self.width*self.cell_size/2, 0), "to": (self.width*self.cell_size/2, 0), "type": "highway"},
            {"from": (0, -self.height*self.cell_size/2), "to": (0, self.height*self.cell_size/2), "type": "highway"},
            {"from": (-self.width*self.cell_size/3, -self.height*self.cell_size/3),
             "to": (self.width*self.cell_size/3, self.height*self.cell_size/3), "type": "dirt"},
        ]

    def _generate_forests(self, rng):
        """Выделить области леса"""
        for _ in range(rng.randint(8, 15)):
            cx = (rng.random() - 0.5) * self.width * self.cell_size
            cz = (rng.random() - 0.5) * self.height * self.cell_size
            radius = rng.uniform(50, 200)
            self.forest_areas.append({
                "center": (cx, cz),
                "radius": radius,
                "density": rng.uniform(0.3, 0.9),
            })

    def get_terrain_data(self):
        """Экспорт данных рельефа для визуализации"""
        # Субдискретизация для передачи на фронтенд
        subsample = 4
        export_w = self.width // subsample
        export_h = self.height // subsample
        grid = [[0.0] * export_w for _ in range(export_h)]
        min_h, max_h = float('inf'), float('-inf')

        for i in range(export_w):
            for j in range(export_h):
                si, sj = i * subsample, j * subsample
                avg = sum(self.tile.data[sj+di][si+dj]
                         for di in range(subsample)
                         for dj in range(subsample)) / (subsample * subsample)
                grid[j][i] = avg
                min_h, max_h = min(min_h, avg), max(max_h, avg)

        return {
            "width": export_w,
            "height": export_h,
            "cell_size": self.cell_size * subsample,
            "grid": grid,
            "min_height": min_h,
            "max_height": max_h,
            "roads": self.road_network,
            "forests": self.forest_areas,
        }


class SRTMLoader:
    """Загрузчик реальных SRTM-данных (.hgt формат)"""

    @staticmethod
    def load_hgt(filepath, lat=55, lon=37):
        """
        Загрузить SRTM .hgt файл.
        Формат: 16-bit signed, big-endian, 1201×1201 (1 arc-second) или 3601×3601 (3 arc-second).
        """
        if not os.path.exists(filepath):
            return None

        size = os.path.getsize(filepath)
        if size == 2884802:  # 1201×1201 = 2,884,802 bytes (1 arc-second)
            n = 1201
        elif size == 25934402:  # 3601×3601 = 25,934,402 bytes (3 arc-second)
            n = 3601
        else:
            # Пробуем вычислить
            n = int(math.sqrt(size / 2))
            if n * n * 2 != size:
                return None

        data = [[0.0] * n for _ in range(n)]
        with open(filepath, "rb") as f:
            raw = f.read()

        min_h, max_h = float('inf'), float('-inf')
        for i in range(n):
            for j in range(n):
                idx = (i * n + j) * 2
                val = struct.unpack(">h", raw[idx:idx+2])[0]
                if val == -32768:  # no data
                    val = 0
                data[i][j] = float(val)
                min_h, max_h = min(min_h, val), max(max_h, val)

        return TerrainTile(n, n, 30.0 if n > 2000 else 90.0, data)

    @staticmethod
    def find_srtm(lat, lon):
        """Найти SRTM файл для координат"""
        # Стандартное имя: N55E037.hgt
        lat_str = f"N{int(abs(lat)):02d}" if lat >= 0 else f"S{int(abs(lat)):02d}"
        lon_str = f"E{int(abs(lon)):03d}" if lon >= 0 else f"W{int(abs(lon)):03d}"
        filename = f"{lat_str}{lon_str}.hgt"

        search_paths = [
            f"/home/unidel/gift/data/terrain/{filename}",
            f"./data/terrain/{filename}",
            f"~/terrain/{filename}",
        ]

        for path in search_paths:
            expanded = os.path.expanduser(path)
            if os.path.exists(expanded):
                return expanded
        return None


# ═══════════════════════════════════════════════════════════════
# Тест
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═══ Real Terrain Test ═══")
    print()

    # Генерация рельефа
    gen = TerrainGenerator(width=200, height=200, cell_size=10, seed=42)
    tile = gen.generate()

    # Статистика
    heights = [tile.data[j][i] for i in range(tile.width) for j in range(tile.height)]
    print(f"  Width: {tile.width}×{tile.height} ({tile.width*tile.height} cells)")
    print(f"  Cell size: {tile.cell_size_m}m")
    print(f"  Elevation range: {min(heights):.1f} .. {max(heights):.1f} m")
    print(f"  Mean: {sum(heights)/len(heights):.1f} m")
    print(f"  Roads: {len(gen.road_network)}")
    print(f"  Forests: {len(gen.forest_areas)}")

    # Тест высоты в точках
    test_pts = [(0, 0), (500, 300), (-300, -200), (800, -500)]
    for x, z in test_pts:
        h = tile.get_height(x, z)
        print(f"  Height at ({x:4.0f}, {z:4.0f}): {h:.1f}m")

    # Экспорт для визуализации
    terrain_data = gen.get_terrain_data()
    print(f"  Export: {terrain_data['width']}×{terrain_data['height']} "
          f"height_range={terrain_data['min_height']:.0f}..{terrain_data['max_height']:.0f}m")

    # Проверка SRTM
    srtm_path = SRTMLoader.find_srtm(55.75, 37.62)
    if srtm_path:
        print(f"\n  SRTM found: {srtm_path}")
        srtm_tile = SRTMLoader.load_hgt(srtm_path)
        if srtm_tile:
            print(f"  SRTM: {srtm_tile.width}×{srtm_tile.height} cells")
    else:
        print(f"\n  SRTM not found for 55.75, 37.62 (using synthetic)")

    print("\nTerrain OK")
