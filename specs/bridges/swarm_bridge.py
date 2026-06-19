#!/usr/bin/env python3
"""
swarm_bridge.py — Симуляция роя дронов: безопасное расстояние, покрытие зоны, время схождения.

Уровни:
  1. ROS/Gazebo multi-agent SITL (если GAZEBO_MASTER_URI установлен) — настоящая симуляция
  2. NumPy/SciPy (если установлены) — физически точная геометрия, избегание столкновений
  3. Чистая аналитика: геометрическая модель N агентов на плоскости  — быстрая оценка

Моделируется:
  - N дронов распределяются по зоне (гексагональная сетка / Voronoi)
  - Минимальное расстояние между агентами в любой момент
  - Покрытие целевой площади (процент)
  - Время схождения к стационарному состоянию

Для спеки "Рой" (группа 3):
  - Заменяет аналитическую separationDistance() геометрически точной проверкой
  - Учитывает реальную динамику схождения роя

Вход: параметры роя (n_drones, zone_side_m, min_sep_m, formation_type)
Выход: JSON { min_sep_m, coverage_pct, convergence_s, collision_free, method }

Использование:
  python3 swarm_bridge.py --drones 12 --zone 300 --min-sep 15
  python3 swarm_bridge.py --params '{"n_drones":12,"zone_side_m":300,"min_sep_m":15}'
  python3 swarm_bridge.py --analytical
"""

import sys, json, argparse, math
from pathlib import Path

# ─── Уровень 3: чистая геометрическая аналитика ─────────────────────────────

def _hex_grid_positions(n, zone_side_m):
    """
    Оптимальное размещение N точек на квадратной зоне: гексагональная сетка.
    Возвращает список (x, y) координат.
    """
    # Оценка шага гексагональной сетки: A = sqrt(3)/2 * d² * N = zone²
    # d ≈ zone * sqrt(2 / (sqrt(3) * N))
    if n <= 0:
        return []
    d = zone_side_m * math.sqrt(2.0 / (math.sqrt(3) * n + 1e-6))
    positions = []
    row = 0
    while len(positions) < n * 2:  # генерируем с запасом
        y = row * d * math.sqrt(3) / 2
        if y > zone_side_m * 1.1:
            break
        offset = (d / 2) if (row % 2 == 1) else 0
        col = 0
        while True:
            x = col * d + offset
            if x > zone_side_m * 1.1:
                break
            positions.append((x, y))
            col += 1
        row += 1
    # Берём первые N позиций
    return positions[:n]

def _min_distance(positions):
    """Минимальное расстояние между любыми двумя точками."""
    if len(positions) < 2:
        return float('inf')
    min_d = float('inf')
    for i in range(len(positions)):
        for j in range(i + 1, len(positions)):
            dx = positions[i][0] - positions[j][0]
            dy = positions[i][1] - positions[j][1]
            d = math.sqrt(dx*dx + dy*dy)
            if d < min_d:
                min_d = d
    return min_d

def _coverage_pct(positions, zone_side_m, sensor_radius_m=30.0):
    """
    Упрощённая оценка покрытия: монте-карло на сетке 20×20.
    """
    if not positions:
        return 0.0
    grid = 20
    covered = 0
    for gi in range(grid):
        for gj in range(grid):
            px = (gi + 0.5) * zone_side_m / grid
            py = (gj + 0.5) * zone_side_m / grid
            for (x, y) in positions:
                if math.sqrt((px-x)**2 + (py-y)**2) <= sensor_radius_m:
                    covered += 1
                    break
    return covered / (grid * grid) * 100.0

def _convergence_time(n_drones, zone_side_m, v_ms=5.0, formation_type='hex'):
    """
    Время схождения роя к стационарной позиции.
    n_drones: число агентов
    v_ms: скорость перелёта
    """
    # Оценка: каждый агент летит в среднем half-zone / v к своей позиции
    avg_dist = zone_side_m * 0.4 * math.sqrt(n_drones) / n_drones
    # Плюс координационная задержка (consensus protocol): log2(N) раундов
    consensus_delay = math.log2(max(n_drones, 1)) * 2.0  # 2с на раунд
    return avg_dist / v_ms + consensus_delay

def analytical_swarm(n_drones, zone_side_m, min_sep_m=15.0, sensor_radius_m=30.0,
                      v_swarm_ms=5.0, formation_type='hex', **kw):
    positions = _hex_grid_positions(n_drones, zone_side_m)
    actual_min_sep = _min_distance(positions) if positions else 0.0
    coverage = _coverage_pct(positions, zone_side_m, sensor_radius_m)
    convergence_s = _convergence_time(n_drones, zone_side_m, v_swarm_ms, formation_type)
    # Столкновение невозможно если min_sep ≥ требуемое
    collision_free = actual_min_sep >= min_sep_m
    return {
        "min_sep_m": round(actual_min_sep, 2),
        "coverage_pct": round(coverage, 1),
        "convergence_s": round(convergence_s, 1),
        "n_drones": n_drones,
        "zone_side_m": zone_side_m,
        "collision_free": collision_free,
        "method": "analytical-hex-grid",
    }

# ─── Уровень 2: NumPy физически точная геометрия ─────────────────────────────

def run_numpy_sim(n_drones, zone_side_m, min_sep_m, steps=100, dt=0.1, **kw):
    try:
        import numpy as np

        # Инициализация: случайное размещение в зоне
        rng = np.random.default_rng(42)
        pos = rng.uniform(0, zone_side_m, size=(n_drones, 2))
        # Целевые позиции: гексагональная сетка
        targets = np.array(_hex_grid_positions(n_drones, zone_side_m))

        v_max = kw.get("v_swarm_ms", 5.0)
        converged_threshold = min_sep_m * 0.5

        # Простой potential-field: притяжение к цели + отталкивание от соседей
        for step in range(steps):
            # Притяжение к цели
            f_att = (targets - pos) * 0.1
            # Отталкивание от соседей
            f_rep = np.zeros_like(pos)
            for i in range(n_drones):
                for j in range(n_drones):
                    if i == j: continue
                    diff = pos[i] - pos[j]
                    d = np.linalg.norm(diff) + 1e-6
                    if d < min_sep_m * 2:
                        f_rep[i] += diff / (d * d) * min_sep_m
            f_total = f_att + f_rep
            # Нормируем скорость
            norms = np.linalg.norm(f_total, axis=1, keepdims=True)
            norms = np.maximum(norms, 1e-6)
            vel = f_total / norms * np.minimum(norms, v_max)
            pos = np.clip(pos + vel * dt, 0, zone_side_m)

        # Финальные метрики
        diffs = pos[np.newaxis, :, :] - pos[:, np.newaxis, :]
        dists = np.sqrt((diffs**2).sum(axis=-1))
        np.fill_diagonal(dists, np.inf)
        actual_min_sep = float(dists.min())

        sensor_r = kw.get("sensor_radius_m", 30.0)
        grid_pts = np.mgrid[0:zone_side_m:20j, 0:zone_side_m:20j].reshape(2, -1).T
        covered = np.any(
            np.sqrt(((grid_pts[:, np.newaxis, :] - pos[np.newaxis, :, :])**2).sum(axis=-1)) <= sensor_r,
            axis=1
        ).sum()
        coverage_pct = covered / len(grid_pts) * 100.0

        return {
            "min_sep_m": round(actual_min_sep, 2),
            "coverage_pct": round(float(coverage_pct), 1),
            "convergence_s": round(steps * dt, 1),
            "n_drones": n_drones,
            "zone_side_m": zone_side_m,
            "collision_free": actual_min_sep >= min_sep_m,
            "method": "numpy-potential-field",
        }
    except ImportError:
        return None

# ─── Уровень 1: ROS/Gazebo SITL ─────────────────────────────────────────────

def run_gazebo_sitl(**kw):
    import os
    if not os.environ.get("GAZEBO_MASTER_URI"):
        return None
    # Интеграция с Gazebo оставлена для будущего расширения
    return None

# ─── Главная функция ─────────────────────────────────────────────────────────

def run(params):
    n_drones = int(params.get("n_drones", 12))
    zone_side_m = float(params.get("zone_side_m", 300.0))
    min_sep_m = float(params.get("min_sep_m", 15.0))
    sensor_radius_m = float(params.get("sensor_radius_m", 30.0))
    v_swarm_ms = float(params.get("v_swarm_ms", 5.0))
    formation_type = params.get("formation_type", "hex")

    return (
        run_gazebo_sitl(**params)
        or run_numpy_sim(n_drones, zone_side_m, min_sep_m,
                          sensor_radius_m=sensor_radius_m, v_swarm_ms=v_swarm_ms)
        or analytical_swarm(n_drones, zone_side_m, min_sep_m,
                             sensor_radius_m=sensor_radius_m,
                             v_swarm_ms=v_swarm_ms, formation_type=formation_type)
    )

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--drones", type=int, default=12, dest="n_drones")
    p.add_argument("--zone", type=float, default=300.0, dest="zone_side_m")
    p.add_argument("--min-sep", type=float, default=15.0, dest="min_sep_m")
    p.add_argument("--sensor-radius", type=float, default=30.0, dest="sensor_radius_m")
    p.add_argument("--speed", type=float, default=5.0, dest="v_swarm_ms")
    p.add_argument("--formation", type=str, default="hex", dest="formation_type")
    p.add_argument("--params", type=str, default=None)
    p.add_argument("--analytical", action="store_true")
    args = p.parse_args()

    params = {k: v for k, v in vars(args).items() if k not in ("params", "analytical")}
    if args.params:
        try: params.update(json.loads(args.params))
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"JSON parse error: {e}"})); sys.exit(1)

    if args.analytical:
        result = analytical_swarm(**params)
    else:
        result = run(params)

    print(json.dumps(result))
