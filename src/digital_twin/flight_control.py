#!/usr/bin/env python3
"""
flight_control.py — Настоящее управление дроном

Не просто "лететь туда", а:
  - ПИД-регулятор по курсу, высоте, скорости
  - Тактические манёвры: заход с фланга, горка, пикирование, уклонение
  - Геометрия атаки: угол захода, дистанция пуска, вектор сближения
  - Ограничения: крен ≤ 30°, тангаж ≤ 20°, скорость ≤ 20 м/с
  - Визуализация траектории и векторов

Каждая LLM-команда → конкретный манёвр → ПИД → управление.
"""

import math, random, time
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from enum import Enum

# ═══════════════════════════════════════════════════════════════
# ТАКТИЧЕСКИЕ МАНЁВРЫ
# ═══════════════════════════════════════════════════════════════

class ManeuverType(Enum):
    STRAIGHT = "straight"           # прямой полёт
    TURN_LEFT = "turn_left"        # левый разворот
    TURN_RIGHT = "turn_right"      # правый разворот
    CLIMB = "climb"                # набор высоты
    DESCEND = "descend"            # снижение
    ORBIT = "orbit"                # кружение вокруг точки
    FLANK_LEFT = "flank_left"      # заход с левого фланга
    FLANK_RIGHT = "flank_right"    # заход с правого фланга
    POPUP = "popup"                # горка перед атакой
    DIVE = "dive"                  # пикирование на цель
    EVASIVE = "evasive"            # противоракетный манёвр
    LOITER = "loiter"              # барражирование


class TacticalApproach(Enum):
    """Тактика захода на цель"""
    DIRECT = "direct"              # прямой заход — быстро, предсказуемо
    FLANKING = "flanking"          # фланговый — сбоку, дольше, безопаснее
    POPUP = "popup"               # горка — снизу-вверх, неожиданно
    HIGH_TO_LOW = "high_to_low"   # сверху-вниз — скрытно от радара
    TERRAIN_MASK = "terrain_mask" # за рельефом — максимально скрытно


@dataclass
class FlightState:
    """Состояние полёта с реальной динамикой"""
    # Позиция (м)
    x: float = 0.0
    y: float = 100.0
    z: float = 0.0

    # Скорость (м/с) — в системе координат дрона
    vx: float = 0.0
    vy: float = 0.0
    vz: float = 0.0
    airspeed: float = 15.0  # приборная скорость

    # Углы (радианы)
    roll: float = 0.0       # крен (-0.5..0.5)
    pitch: float = 0.0      # тангаж (-0.35..0.35)
    yaw: float = 0.0        # курс (0..2π)

    # Угловые скорости (рад/с)
    roll_rate: float = 0.0
    pitch_rate: float = 0.0
    yaw_rate: float = 0.0

    # Управление (нормированное -1..1)
    throttle: float = 0.5
    aileron: float = 0.0    # крен
    elevator: float = 0.0   # тангаж
    rudder: float = 0.0     # рысканье

    # Тактическое
    maneuver: ManeuverType = ManeuverType.STRAIGHT
    approach: TacticalApproach = TacticalApproach.DIRECT
    target_lock: Optional[Tuple[float, float, float]] = None
    waypoint: Optional[Tuple[float, float, float]] = None


class FlightController:
    """
    Настоящий полётный контроллер с ПИД-регуляторами.

    Управляет:
      - Курсом (rudder + aileron через координированный разворот)
      - Высотой (elevator + throttle)
      - Скоростью (throttle)
      - Тактическими манёврами (последовательность команд)
    """

    def __init__(self):
        self.state = FlightState()

        # ПИД-коэффициенты
        self.kp_heading = 2.0    # курс
        self.kd_heading = 1.0
        self.kp_altitude = 1.5   # высота
        self.kd_altitude = 0.8
        self.kp_speed = 0.5      # скорость
        self.kp_roll = 3.0       # стабилизация крена

        # Ограничения
        self.max_roll = math.radians(30)     # 30°
        self.max_pitch = math.radians(20)    # 20°
        self.max_yaw_rate = math.radians(90) # 90°/с
        self.max_speed = 22.0                # м/с (~80 км/ч)
        self.min_speed = 5.0
        self.max_climb = 8.0                 # м/с
        self.max_descent = 6.0

        # Тактический планировщик
        self.maneuver_queue: List[ManeuverType] = []
        self.maneuver_progress = 0.0
        self.maneuver_duration = 0.0
        self.approach_phase = 0  # 0=навигация, 1=заход, 2=терминал, 3=выход

        # Лог действий
        self.action_log: List[str] = []

    # ═══ LLM-КОМАНДА → МАНЁВР ═══════════════════════════════

    def execute_llm_command(self, llm_action: str, target_data: dict = None) -> str:
        """
        Преобразовать LLM-решение в конкретный манёвр.

        LLM говорит → контроллер делает:
          "attack"      → выбрать тактику захода, выйти на цель
          "observe"     → кружить на безопасной дистанции
          "rtb"         → разворот на базу, набор безопасной высоты
          "patrol"      → барражирование по маршруту
          "stealth"     → снижение, минимальная скорость
          "evade"       → противоракетный манёвр
        """
        self.action_log.append(f"LLM: {llm_action}")

        if llm_action == "attack" and target_data:
            self._plan_attack(target_data)
            return f"ATTACK: заход {self.state.approach.value} на ({target_data.get('x',0):.0f},{target_data.get('z',0):.0f})"

        elif llm_action == "observe":
            if target_data:
                self.state.waypoint = (target_data.get("x", 0) + 300,
                                      target_data.get("y", 100),
                                      target_data.get("z", 0) + 300)
            self.state.approach = TacticalApproach.DIRECT
            self.maneuver_queue = [ManeuverType.ORBIT]
            self.maneuver_duration = 30.0
            return "OBSERVE: кружение на безопасной дистанции"

        elif llm_action == "rtb":
            self.state.waypoint = (0, 50, 0)  # база
            self.state.approach = TacticalApproach.DIRECT
            self.maneuver_queue = [ManeuverType.CLIMB, ManeuverType.TURN_LEFT]
            return "RTB: возврат на базу, набор 50м"

        elif llm_action == "patrol":
            angle = random.uniform(0, 2 * math.pi)
            r = 400
            self.state.waypoint = (self.state.x + r * math.cos(angle),
                                  100,
                                  self.state.z + r * math.sin(angle))
            self.maneuver_queue = [ManeuverType.LOITER]
            return f"PATROL: новая точка ({self.state.waypoint[0]:.0f},{self.state.waypoint[2]:.0f})"

        elif llm_action == "stealth":
            self.state.waypoint = None
            self.maneuver_queue = [ManeuverType.DESCEND]
            self.state.approach = TacticalApproach.TERRAIN_MASK
            return "STEALTH: снижение до 30м, скрытное перемещение"

        elif llm_action == "evade":
            self.maneuver_queue = [ManeuverType.EVASIVE,
                                  random.choice([ManeuverType.TURN_LEFT, ManeuverType.TURN_RIGHT]),
                                  ManeuverType.DIVE]
            self.maneuver_duration = 5.0
            return "EVADE: противоракетный манёвр!"

        return f"Unknown LLM action: {llm_action}"

    def _plan_attack(self, target: dict):
        """Спланировать заход на цель"""
        tx, ty, tz = target.get("x", 0), target.get("y", 0), target.get("z", 0)
        dist = math.sqrt((self.state.x - tx)**2 + (self.state.z - tz)**2)

        # Выбор тактики в зависимости от дистанции и типа цели
        target_type = target.get("type", "")

        if target_type in ("ew_station", "sam"):
            # РЭБ и ПВО — заход с фланга, ниже радара
            self.state.approach = TacticalApproach.FLANKING
            self.maneuver_queue = [
                ManeuverType.DESCEND,
                ManeuverType.FLANK_LEFT if random.random() > 0.5 else ManeuverType.FLANK_RIGHT,
                ManeuverType.POPUP,
                ManeuverType.DIVE,
            ]
        elif dist < 300:
            # Близко — горка и пикирование
            self.state.approach = TacticalApproach.POPUP
            self.maneuver_queue = [ManeuverType.POPUP, ManeuverType.DIVE]
        elif dist > 1000:
            # Далеко — прямой заход на высокой скорости
            self.state.approach = TacticalApproach.DIRECT
            self.maneuver_queue = [ManeuverType.CLIMB, ManeuverType.STRAIGHT, ManeuverType.DIVE]
        else:
            self.state.approach = TacticalApproach.FLANKING
            self.maneuver_queue = [ManeuverType.FLANK_RIGHT, ManeuverType.STRAIGHT]

        self.state.target_lock = (tx, ty, tz)
        self.state.waypoint = (tx, ty, tz)
        self.approach_phase = 1

    # ═══ ПИД-УПРАВЛЕНИЕ ════════════════════════════════════

    def update(self, dt: float = 0.1):
        """Один такт управления — ПИД по курсу, высоте, скорости"""
        s = self.state

        # 1. ТЕКУЩИЙ МАНЁВР
        if self.maneuver_queue:
            s.maneuver = self.maneuver_queue[0]
            self.maneuver_progress += dt
            if self.maneuver_progress >= self.maneuver_duration:
                self.maneuver_queue.pop(0)
                self.maneuver_progress = 0.0
        else:
            s.maneuver = ManeuverType.STRAIGHT

        # 2. КУРС НА WAYPOINT (если есть)
        target_heading = s.yaw
        if s.waypoint:
            wx, wy, wz = s.waypoint
            dx, dz = wx - s.x, wz - s.z
            target_heading = math.atan2(dx, dz)
            # Упреждение при атаке (pro-nav)
            if s.target_lock and self.approach_phase == 2:
                los_rate = (dx * s.vz - dz * s.vx) / (dx*dx + dz*dz + 1)
                target_heading += 3.0 * los_rate * 0.5  # N=3 pro-nav

        # 3. ОШИБКА КУРСА
        heading_error = target_heading - s.yaw
        # Нормализация ±π
        while heading_error > math.pi: heading_error -= 2 * math.pi
        while heading_error < -math.pi: heading_error += 2 * math.pi

        # 4. ПИД ПО КУРСУ → крен + рысканье
        s.yaw_rate = self.kp_heading * heading_error - self.kd_heading * s.yaw_rate
        s.yaw_rate = max(-self.max_yaw_rate, min(self.max_yaw_rate, s.yaw_rate))

        # Координированный разворот: крен зависит от угловой скорости
        target_roll = s.yaw_rate * 0.5  # ~2с на 180°
        target_roll = max(-self.max_roll, min(self.max_roll, target_roll))
        s.roll += (target_roll - s.roll) * self.kp_roll * dt

        # 5. ПИД ПО ВЫСОТЕ
        if s.waypoint:
            alt_error = s.waypoint[1] - s.y
            target_pitch = self.kp_altitude * alt_error / 100.0
            target_pitch = max(-self.max_pitch, min(self.max_pitch, target_pitch))
            s.pitch += (target_pitch - s.pitch) * 0.5 * dt

        # 6. СКОРОСТЬ
        speed = math.sqrt(s.vx**2 + s.vz**2) + 0.01
        target_speed = self.min_speed + (self.max_speed - self.min_speed) * s.throttle

        # Тактическая скорость
        if self.approach_phase == 2:  # терминал — максимальная
            target_speed = self.max_speed
        elif s.maneuver == ManeuverType.DESCEND:
            target_speed = self.min_speed

        speed_error = target_speed - speed
        s.throttle += self.kp_speed * speed_error * dt
        s.throttle = max(0.1, min(1.0, s.throttle))

        # 7. МАНЁВРЫ
        if s.maneuver == ManeuverType.CLIMB:
            s.pitch = -self.max_pitch * 0.7
        elif s.maneuver == ManeuverType.DESCEND:
            s.pitch = self.max_pitch * 0.5
        elif s.maneuver == ManeuverType.DIVE:
            s.pitch = self.max_pitch * 1.0
        elif s.maneuver == ManeuverType.POPUP:
            s.pitch = -self.max_pitch * 1.0
        elif s.maneuver == ManeuverType.TURN_LEFT:
            s.roll = -self.max_roll
        elif s.maneuver == ManeuverType.TURN_RIGHT:
            s.roll = self.max_roll
        elif s.maneuver == ManeuverType.EVASIVE:
            s.roll = self.max_roll * math.sin(time.time() * 5)  # змейка
            s.pitch = self.max_pitch * math.cos(time.time() * 7)
        elif s.maneuver == ManeuverType.ORBIT:
            wx, wz = s.waypoint[0], s.waypoint[2] if s.waypoint else (s.x, s.z)
            dx, dz = wx - s.x, wz - s.z
            orbit_heading = math.atan2(dx, dz) + math.pi / 2  # перпендикулярно
            heading_error = orbit_heading - s.yaw
            s.roll = self.max_roll * 0.5 * (1 if heading_error > 0 else -1)
        elif s.maneuver == ManeuverType.FLANK_LEFT:
            if s.waypoint:
                wx, wz = s.waypoint[0], s.waypoint[2]
                dx, dz = wx - s.x, wz - s.z
                flank_heading = math.atan2(dx, dz) + math.radians(60)  # +60° фланг
                heading_error = flank_heading - s.yaw
                s.roll = self.max_roll * 0.6 * (1 if heading_error > 0 else -1)
        elif s.maneuver == ManeuverType.FLANK_RIGHT:
            if s.waypoint:
                wx, wz = s.waypoint[0], s.waypoint[2]
                dx, dz = wx - s.x, wz - s.z
                flank_heading = math.atan2(dx, dz) - math.radians(60)  # -60° фланг
                heading_error = flank_heading - s.yaw
                s.roll = self.max_roll * 0.6 * (1 if heading_error > 0 else -1)

        # 8. ИНТЕГРИРОВАНИЕ
        s.yaw += s.yaw_rate * dt
        s.airspeed += (target_speed - s.airspeed) * 0.5 * dt
        s.airspeed = max(self.min_speed, min(self.max_speed, s.airspeed))

        # Вектор скорости из курса и тангажа
        s.vx = s.airspeed * math.sin(s.yaw) * math.cos(s.pitch)
        s.vz = s.airspeed * math.cos(s.yaw) * math.cos(s.pitch)
        s.vy = -s.airspeed * math.sin(s.pitch)

        # Позиция
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.z += s.vz * dt
        s.y = max(1, min(500, s.y))  # ограничение высоты

        # 9. ФАЗЫ ЗАХОДА
        if s.target_lock:
            tx, ty, tz = s.target_lock
            dist = math.sqrt((s.x - tx)**2 + (s.z - tz)**2)
            if dist < 100 and self.approach_phase == 1:
                self.approach_phase = 2  # терминал
                self.maneuver_queue = [ManeuverType.DIVE]
            elif dist < 5 and self.approach_phase == 2:
                self.approach_phase = 3  # попадание
                s.target_lock = None
                self.action_log.append("TARGET HIT!")

    def get_state(self) -> dict:
        s = self.state
        return {
            "position": {"x": round(s.x, 1), "y": round(s.y, 1), "z": round(s.z, 1)},
            "velocity": {"vx": round(s.vx, 1), "vy": round(s.vy, 1), "vz": round(s.vz, 1),
                        "airspeed": round(s.airspeed, 1)},
            "attitude": {"roll_deg": round(math.degrees(s.roll), 1),
                        "pitch_deg": round(math.degrees(s.pitch), 1),
                        "yaw_deg": round(math.degrees(s.yaw) % 360, 1)},
            "controls": {"throttle_pct": round(s.throttle * 100),
                        "aileron": round(s.aileron, 2),
                        "elevator": round(s.elevator, 2)},
            "maneuver": s.maneuver.value,
            "approach": s.approach.value,
            "approach_phase": self.approach_phase,
            "target_lock": s.target_lock is not None,
            "action_log": self.action_log[-10:],
        }


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════════╗")
    print("║  FLIGHT CONTROL — Тактические манёвры              ║")
    print("╚══════════════════════════════════════════════════════╝")
    print()

    fc = FlightController()
    fc.state.x, fc.state.y, fc.state.z = 0, 120, 0
    fc.state.yaw = math.radians(45)

    # Тест: LLM говорит ATTACK на цель
    target = {"x": 500, "y": 0, "z": 300, "type": "ew_station"}
    result = fc.execute_llm_command("attack", target)
    print(f"LLM→контроллер: {result}")
    print()

    print("Тактическая симуляция (10 секунд):")
    print(f"{'t':>4s} {'x':>7s} {'z':>7s} {'y':>7s} {'speed':>6s} {'roll':>6s} {'pitch':>6s} {'heading':>7s} {'maneuver':>12s} {'phase':>6s}")
    print("-" * 90)

    for step in range(100):
        fc.update(0.1)
        if step % 10 == 0:
            s = fc.state
            print(f"{step*0.1:4.1f}s {s.x:7.0f} {s.z:7.0f} {s.y:7.0f} {s.airspeed:6.1f} "
                  f"{math.degrees(s.roll):+6.1f}° {math.degrees(s.pitch):+6.1f}° "
                  f"{math.degrees(s.yaw)%360:7.1f}° {s.maneuver.value:12s} {fc.approach_phase}")

    print()
    print("Лог действий:")
    for a in fc.action_log[-5:]:
        print(f"  {a}")

    # Тест 2: RTB
    fc2 = FlightController()
    result = fc2.execute_llm_command("rtb", {})
    print(f"\nLLM→контроллер: {result}")
    for _ in range(50):
        fc2.update(0.1)
    s = fc2.state
    print(f"RTB: pos=({s.x:.0f},{s.z:.0f}) y={s.y:.0f} speed={s.airspeed:.0f}")
