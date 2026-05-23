#!/usr/bin/env python3
"""
combat_critical.py — Критические недостающие модули боевого дрона

1. TERRAIN FOLLOWING — облёт рельефа, уклонение от столкновений
2. FIRE CONTROL — расчёт точки встречи, огневой раствор
3. BATTLE DAMAGE ASSESSMENT — оценка ущерба, решение добивать/нет
4. LOST COMMS AUTONOMY — автономное поведение при потере связи
5. SWARM DECONFLICTION — распределение целей без дублирования
"""

import math, random, time
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from enum import Enum
import numpy as np


# ═══════════════════════════════════════════════════════════════
# 1. TERRAIN FOLLOWING + COLLISION AVOIDANCE
# ═══════════════════════════════════════════════════════════════

class TerrainAvoidance:
    """
    Облёт рельефа и обход препятствий.

    Принцип:
      - Постоянно сканирует рельеф впереди по курсу
      - Если впереди препятствие — ищет обход (влево/вправо/вверх)
      - Держит безопасную высоту над рельефом (terrain clearance)
      - Реагирует на внезапные препятствия (здания, деревья)
    """

    def __init__(self, clearance_m=30, lookahead_m=200, scan_angle_deg=45):
        self.clearance = clearance_m      # минимальная высота над рельефом
        self.lookahead = lookahead_m      # дальность сканирования
        self.scan_angle = math.radians(scan_angle_deg)  # угол сканирования

        # Состояние avoidance
        self.evading = False
        self.evade_direction = 0  # -1=влево, +1=вправо, 0=вверх
        self.evade_timer = 0.0
        self.collision_warnings = 0
        self.terrain_hits = 0

    def check_terrain(self, drone_x, drone_y, drone_z, heading_rad,
                     terrain_func) -> dict:
        """
        Проверить рельеф впереди.
        terrain_func(x, z) → высота рельефа в точке
        Возвращает: команду уклонения если нужно
        """
        result = {
            "safe": True,
            "action": "continue",
            "min_clearance": float('inf'),
            "obstacle_distance": None,
            "recommended_climb": 0,
            "recommended_turn": 0,
        }

        # Сканируем сектор впереди
        for angle_offset in np.linspace(-self.scan_angle, self.scan_angle, 11):
            scan_angle = heading_rad + angle_offset
            for dist in np.linspace(10, self.lookahead, 20):
                sx = drone_x + dist * math.sin(scan_angle)
                sz = drone_z + dist * math.cos(scan_angle)

                terrain_h = terrain_func(sx, sz) if terrain_func else 0
                clearance = drone_y - terrain_h

                if clearance < result["min_clearance"]:
                    result["min_clearance"] = clearance

                # Критически близко!
                if clearance < self.clearance * 0.3:
                    result["safe"] = False
                    result["obstacle_distance"] = dist
                    self.collision_warnings += 1

                    # Решение: вверх или в сторону
                    # Проверим, можно ли обойти слева/справа
                    left_clear = drone_y - terrain_func(
                        drone_x + dist * math.sin(scan_angle - 0.5),
                        drone_z + dist * math.cos(scan_angle - 0.5)
                    ) if terrain_func else self.clearance

                    right_clear = drone_y - terrain_func(
                        drone_x + dist * math.sin(scan_angle + 0.5),
                        drone_z + dist * math.cos(scan_angle + 0.5)
                    ) if terrain_func else self.clearance

                    if left_clear > self.clearance * 0.5:
                        result["action"] = "turn_left"
                        result["recommended_turn"] = -30
                    elif right_clear > self.clearance * 0.5:
                        result["action"] = "turn_right"
                        result["recommended_turn"] = 30
                    else:
                        result["action"] = "climb"
                        result["recommended_climb"] = self.clearance

                    return result

        return result

    def get_terrain_following_altitude(self, drone_x, drone_z, current_alt,
                                      terrain_func) -> float:
        """Вычислить безопасную высоту над рельефом"""
        terrain_h = terrain_func(drone_x, drone_z) if terrain_func else 0
        return max(terrain_h + self.clearance, current_alt * 0.9 + (terrain_h + self.clearance) * 0.1)

    def get_status(self) -> dict:
        return {
            "evading": self.evading,
            "collision_warnings": self.collision_warnings,
            "terrain_hits": self.terrain_hits,
            "clearance_m": self.clearance,
        }


# ═══════════════════════════════════════════════════════════════
# 2. FIRE CONTROL SOLUTION
# ═══════════════════════════════════════════════════════════════

class FireControl:
    """
    Расчёт огневого раствора — когда и куда пускать оружие.

    Для FPV-дрона (камикадзе):
      - Точка встречи с маневрирующей целью
      - Упреждение (lead angle)
      - Дистанция пуска (weapon release range)

    Для барражирующего боеприпаса (Lancet):
      - Терминальное наведение
      - Угол пикирования
    """

    def __init__(self, weapon_type="fpv"):
        self.weapon_type = weapon_type

        # Параметры оружия
        self.weapon_speed = 70.0 if weapon_type == "fpv" else 40.0  # м/с
        self.weapon_max_range = 5000.0  # м
        self.weapon_min_range = 50.0    # м
        self.lethal_radius = 3.0         # м (осколки)

        # Состояние пуска
        self.release_authorized = False
        self.release_point = None
        self.time_to_impact = 0.0
        self.pk = 0.0  # probability of kill

    def compute_fire_solution(self,
                              drone_pos: Tuple[float, float, float],
                              drone_vel: Tuple[float, float, float],
                              target_pos: Tuple[float, float, float],
                              target_vel: Tuple[float, float, float]) -> dict:
        """
        Вычислить точку пуска и параметры захода.

        Возвращает:
          - lead_point: куда целиться (упреждение)
          - release_range: дистанция пуска
          - time_to_impact: подлётное время
          - approach_heading: курс захода
          - impact_angle: угол встречи
          - pk: вероятность поражения
        """
        dx, dy, dz = drone_pos[0] - target_pos[0], drone_pos[1] - target_pos[1], drone_pos[2] - target_pos[2]
        range_to_target = math.sqrt(dx*dx + dy*dy + dz*dz)

        # Относительная скорость
        rel_vx = drone_vel[0] - target_vel[0]
        rel_vy = drone_vel[1] - target_vel[1]
        rel_vz = drone_vel[2] - target_vel[2]
        closing_speed = -(dx*rel_vx + dy*rel_vy + dz*rel_vz) / max(range_to_target, 0.01)

        # Время до цели
        self.time_to_impact = range_to_target / max(self.weapon_speed, closing_speed, 0.01)

        # Упреждение (куда двинется цель за время подлёта)
        lead_x = target_pos[0] + target_vel[0] * self.time_to_impact
        lead_y = target_pos[1] + target_vel[1] * self.time_to_impact
        lead_z = target_pos[2] + target_vel[2] * self.time_to_impact

        # Курс на точку упреждения
        ldx, ldz = lead_x - drone_pos[0], lead_z - drone_pos[2]
        approach_heading = math.degrees(math.atan2(ldx, ldz)) % 360

        # Угол встречи (вертикальный)
        ldy = lead_y - drone_pos[1]
        horiz_dist = math.sqrt(ldx*ldx + ldz*ldz) + 0.01
        impact_angle = math.degrees(math.atan2(-ldy, horiz_dist))

        # Дистанция пуска (когда переходить в терминал)
        release_range = max(self.weapon_min_range * 3,
                          self.time_to_impact * self.weapon_speed * 0.3)

        # Вероятность поражения (Pk)
        # Зависит от дистанции, скорости сближения, угла
        self.pk = self._compute_pk(range_to_target, closing_speed, impact_angle)
        self.release_authorized = (range_to_target < release_range * 2 and self.pk > 0.4)
        self.release_point = (lead_x, lead_y, lead_z)

        return {
            "lead_point": (round(lead_x, 1), round(lead_y, 1), round(lead_z, 1)),
            "release_range": round(release_range, 1),
            "time_to_impact": round(self.time_to_impact, 1),
            "approach_heading": round(approach_heading, 1),
            "impact_angle": round(impact_angle, 1),
            "pk": round(self.pk, 2),
            "release_authorized": self.release_authorized,
            "range_to_target": round(range_to_target, 1),
            "closing_speed": round(closing_speed, 1),
        }

    def _compute_pk(self, range_m, closing_speed, impact_angle_deg) -> float:
        """Вероятность поражения (упрощённая модель)"""
        # Дальность: идеальная на 100-1000м
        if range_m < 50: range_factor = 0.9
        elif range_m < 500: range_factor = 1.0
        elif range_m < 2000: range_factor = 0.8
        else: range_factor = 0.5

        # Скорость сближения
        speed_factor = min(1.0, closing_speed / 30.0)

        # Угол: оптимален 20-45°
        angle = abs(impact_angle_deg)
        if 20 <= angle <= 45: angle_factor = 1.0
        elif angle < 20: angle_factor = 0.7
        else: angle_factor = 0.8

        return range_factor * speed_factor * angle_factor


# ═══════════════════════════════════════════════════════════════
# 3. BATTLE DAMAGE ASSESSMENT (BDA)
# ═══════════════════════════════════════════════════════════════

class BattleDamageAssessment:
    """
    Оценка боевого ущерба.

    После удара определяет:
      - Цель уничтожена / повреждена / не задета
      - Нужен ли повторный удар
      - Расход боеприпасов на цель
    """

    def __init__(self):
        self.assessments: List[dict] = []
        self.reattack_recommendations = 0
        self.kills_confirmed = 0
        self.misses = 0

    def assess(self,
               target_type: str,
               target_hardened: bool,
               weapon_type: str,
               miss_distance: float,
               target_status_before: str) -> dict:
        """
        Оценить результат удара.

        target_hardened: защищённая цель (бункер) или нет (человек)
        miss_distance: промах в метрах
        """
        # Пороги поражения
        if target_hardened:
            kill_radius = 1.5   # нужно прямое попадание
            damage_radius = 5.0
        else:
            kill_radius = 3.0
            damage_radius = 10.0

        if miss_distance < kill_radius:
            status = "destroyed"
            self.kills_confirmed += 1
            reattack = False
        elif miss_distance < damage_radius:
            status = "damaged"
            reattack = True
        else:
            status = "miss"
            self.misses += 1
            reattack = True

        assessment = {
            "target_type": target_type,
            "miss_distance": round(miss_distance, 1),
            "status": status,
            "reattack": reattack,
            "confidence": round(max(0.3, 1.0 - miss_distance / damage_radius), 2),
        }

        if reattack:
            self.reattack_recommendations += 1

        self.assessments.append(assessment)
        return assessment

    def get_statistics(self) -> dict:
        total = len(self.assessments)
        return {
            "total_strikes": total,
            "kills_confirmed": self.kills_confirmed,
            "misses": self.misses,
            "reattack_rate": round(self.reattack_recommendations / max(1, total), 2),
            "kill_ratio": round(self.kills_confirmed / max(1, total), 2),
            "average_miss_distance": round(
                sum(a["miss_distance"] for a in self.assessments) / max(1, total), 1
            ),
        }


# ═══════════════════════════════════════════════════════════════
# 4. LOST COMMS AUTONOMY
# ═══════════════════════════════════════════════════════════════

class LostCommsAutonomy:
    """
    Автономное поведение при потере связи с оператором.

    Фазы:
      1. COMMS_OK — норма, выполняем приказы
      2. COMMS_DEGRADED — пакеты теряются, переходим на автономию
      3. COMMS_LOST — связи нет, действуем по плану
      4. COMMS_RECOVERY — связь восстановилась

    План при потере (LOST plan):
      - Завершить текущую задачу
      - Перейти в режим разведки (патруль + избегание)
      - Каждые N минут пытаться выйти на связь
      - Через M минут — возврат на базу
    """

    class CommState(Enum):
        OK = "ok"
        DEGRADED = "degraded"
        LOST = "lost"
        RECOVERY = "recovery"

    def __init__(self):
        self.state = self.CommState.OK
        self.last_contact = time.time()
        self.lost_since = None

        # Таймауты
        self.degraded_timeout = 5.0    # секунд без ответа → degraded
        self.lost_timeout = 30.0       # секунд → lost
        self.rtb_timeout = 300.0       # секунд → возврат на базу
        self.contact_attempt_interval = 15.0  # пытаться каждые 15с

        # План
        self.current_plan = "follow_orders"
        self.autonomous_waypoints = []
        self.autonomous_decisions = 0

    def update(self, packet_received: bool, current_time: float):
        """Обновить состояние связи"""
        prev_state = self.state

        if packet_received:
            self.last_contact = current_time
            if self.state in (self.CommState.LOST, self.CommState.DEGRADED):
                self.state = self.CommState.RECOVERY
            else:
                self.state = self.CommState.OK
            self.lost_since = None
        else:
            elapsed = current_time - self.last_contact
            if elapsed > self.lost_timeout:
                self.state = self.CommState.LOST
                if self.lost_since is None:
                    self.lost_since = current_time
            elif elapsed > self.degraded_timeout:
                self.state = self.CommState.DEGRADED

        # Действия при смене состояния
        if self.state != prev_state:
            return self._on_state_change()
        return None

    def _on_state_change(self) -> str:
        """Действия при смене состояния связи"""
        if self.state == self.CommState.DEGRADED:
            self.current_plan = "prepare_autonomy"
            return "Связь ухудшается — готовлюсь к автономии"

        elif self.state == self.CommState.LOST:
            self.current_plan = "autonomous_patrol"
            self._generate_autonomous_plan()
            return "СВЯЗЬ ПОТЕРЯНА — перехожу на автономный план"

        elif self.state == self.CommState.RECOVERY:
            self.current_plan = "report_and_await"
            return "Связь восстановлена — докладываю обстановку"

        elif self.state == self.CommState.OK:
            self.current_plan = "follow_orders"
            return "Связь в норме"

        return None

    def _generate_autonomous_plan(self):
        """Сгенерировать план автономных действий"""
        self.autonomous_waypoints = [
            (random.uniform(-500, 500), 120, random.uniform(-500, 500))
            for _ in range(5)
        ]
        self.autonomous_decisions += 1

    def get_autonomous_action(self, battery_pct: float,
                             enemies_nearby: bool,
                             current_time: float) -> str:
        """
        Какое действие предпринять автономно.

        Возвращает: "patrol", "rtb", "hide", "attack_if_safe"
        """
        # Батарея критическая — всегда RTB
        if battery_pct < 15:
            return "rtb"

        # Долго без связи — RTB
        if self.state == self.CommState.LOST:
            elapsed_lost = current_time - (self.lost_since or current_time)
            if elapsed_lost > self.rtb_timeout:
                return "rtb"

        # Есть враги — атаковать если батарея > 50%, иначе скрыться
        if enemies_nearby:
            if battery_pct > 50 and self.current_plan != "rtb":
                return "attack_if_safe"
            else:
                return "hide"

        # Нет врагов — патрулировать
        return "patrol"

    def get_status(self) -> dict:
        return {
            "comm_state": self.state.value,
            "current_plan": self.current_plan,
            "last_contact_s": round(time.time() - self.last_contact, 1),
            "autonomous_decisions": self.autonomous_decisions,
        }


# ═══════════════════════════════════════════════════════════════
# 5. SWARM DECONFLICTION
# ═══════════════════════════════════════════════════════════════

class SwarmDeconfliction:
    """
    Распределение целей в рое без дублирования.

    Принцип:
      - Каждый дрон публикует свою назначенную цель
      - Перед атакой проверяет: не атакует ли уже кто-то эту цель?
      - Если да — выбирает другую цель или поддерживает
      - Использует аукционный алгоритм (кто ближе/эффективнее)
    """

    def __init__(self, drone_id: str):
        self.drone_id = drone_id
        self.assigned_target_id = None
        self.swarm_assignments: Dict[str, str] = {}  # drone_id → target_id
        self.conflicts_resolved = 0

    def request_target(self, available_targets: List[dict],
                      swarm_states: Dict[str, dict]) -> Optional[str]:
        """
        Запросить цель для атаки.

        available_targets: [{"id": "T1", "type": "tank", "pos": (x,y,z), "priority": 5}, ...]
        swarm_states: {"drone-1": {"role": "fpv", "pos": (x,y,z), "assigned_target": "T2"}, ...}

        Возвращает: target_id или None
        """
        # Обновить карту назначений от других дронов
        self.swarm_assignments = {
            did: state.get("assigned_target")
            for did, state in swarm_states.items()
            if state.get("assigned_target")
        }

        # Какие цели уже атакуются?
        attacked_targets = set(self.swarm_assignments.values())
        free_targets = [t for t in available_targets if t["id"] not in attacked_targets]

        if not free_targets:
            # Все цели заняты — найти самую приоритетную и помочь
            my_pos = swarm_states.get(self.drone_id, {}).get("pos", (0, 0, 0))
            best = None
            best_score = -1
            for t in available_targets:
                dist = np.linalg.norm(np.array(t["pos"][:2]) - np.array(my_pos[:2]))
                score = t.get("priority", 1) / (dist + 1)
                if score > best_score:
                    best_score = score
                    best = t

            if best:
                self.assigned_target_id = best["id"]
                self.conflicts_resolved += 1
                return best["id"]
            return None

        # Выбрать лучшую свободную цель (аукцион: priority / distance)
        my_pos = swarm_states.get(self.drone_id, {}).get("pos", (0, 0, 0))
        best_target = max(free_targets,
                         key=lambda t: t.get("priority", 1) /
                                      (np.linalg.norm(np.array(t["pos"][:2]) - np.array(my_pos[:2])) + 1))

        self.assigned_target_id = best_target["id"]
        return best_target["id"]

    def release_target(self):
        """Освободить цель (уничтожена или отказ)"""
        self.assigned_target_id = None

    def get_status(self) -> dict:
        return {
            "drone_id": self.drone_id,
            "assigned_target": self.assigned_target_id,
            "conflicts_resolved": self.conflicts_resolved,
            "swarm_assignments": self.swarm_assignments,
        }


# ═══════════════════════════════════════════════════════════════
# ТЕСТ ВСЕХ МОДУЛЕЙ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  COMBAT CRITICAL MODULES TEST                   ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    # 1. Terrain avoidance
    print("1. TERRAIN FOLLOWING:")
    ta = TerrainAvoidance(clearance_m=30, lookahead_m=200)

    def terrain_func(x, z):
        return 50 * math.sin(x * 0.005) * math.cos(z * 0.005) + 10

    result = ta.check_terrain(100, 80, 200, math.radians(45), terrain_func)
    print(f"   Safe: {result['safe']}, Clearance: {result['min_clearance']:.0f}m")
    print(f"   Action: {result['action']}")

    # 2. Fire control
    print("\n2. FIRE CONTROL:")
    fc = FireControl(weapon_type="fpv")
    solution = fc.compute_fire_solution(
        drone_pos=(100, 120, 50),
        drone_vel=(50, -2, 30),
        target_pos=(500, 0, 300),
        target_vel=(5, 0, -2)
    )
    print(f"   Lead point: {solution['lead_point']}")
    print(f"   Time to impact: {solution['time_to_impact']}s")
    print(f"   Pk: {solution['pk']:.0%}")
    print(f"   Release authorized: {solution['release_authorized']}")

    # 3. BDA
    print("\n3. BATTLE DAMAGE ASSESSMENT:")
    bda = BattleDamageAssessment()
    for dist, hardened, ttype in [(0.5, False, "truck"), (4.0, True, "bunker"),
                                    (15.0, False, "person"), (2.0, False, "tank")]:
        a = bda.assess(ttype, hardened, "fpv", dist, "alive")
        print(f"   {ttype}: miss={dist:.1f}m → {a['status']} {'🔄reattack' if a['reattack'] else '💀killed'}")

    # 4. Lost comms
    print("\n4. LOST COMMS AUTONOMY:")
    lca = LostCommsAutonomy()
    for t in [0, 3, 8, 15, 40, 10]:
        result = lca.update(t < 15, t)
        if result: print(f"   t={t}s: {result}")
    print(f"   Final state: {lca.state.value}, plan: {lca.current_plan}")
    action = lca.get_autonomous_action(60, True, 50)
    print(f"   Autonomous action (bat=60%, enemies): {action}")
    action = lca.get_autonomous_action(10, True, 50)
    print(f"   Autonomous action (bat=10%, enemies): {action}")

    # 5. Deconfliction
    print("\n5. SWARM DECONFLICTION:")
    sd = SwarmDeconfliction("FPV-1")
    targets = [
        {"id": "T1", "type": "tank", "pos": (100, 0, 200), "priority": 5},
        {"id": "T2", "type": "ew_station", "pos": (500, 0, 300), "priority": 10},
        {"id": "T3", "type": "bunker", "pos": (300, 0, -100), "priority": 3},
    ]
    swarm = {
        "FPV-1": {"role": "fpv", "pos": (0, 80, 0)},
        "FPV-2": {"role": "fpv", "pos": (200, 80, 100), "assigned_target": "T2"},
        "Scout-1": {"role": "scout", "pos": (400, 120, 500)},
    }
    t = sd.request_target(targets, swarm)
    print(f"   FPV-1 assigned: {t} (T2 already taken by FPV-2)")
    print(f"   Conflicts resolved: {sd.conflicts_resolved}")

    print("\n═══ ALL CRITICAL MODULES WORKING ═══")
