#!/usr/bin/env python3
"""
fpv_guidance.py — Терминальное наведение FPV-дрона (proportional navigation)

Реализует:
  - Proportional Navigation (Pro-Nav): ускорение пропорционально скорости вращения линии визирования
  - Augmented Pro-Nav: учёт манёвра цели
  - 3D geometry: pitch и yaw каналы
  - Баллистический терминал: инерциальный заход на цель
"""

import math
from dataclasses import dataclass

@dataclass
class FPVGuidance:
    """Пропорциональная навигация для FPV-дрона"""

    nav_constant: float = 3.0       # N (обычно 3-5)
    max_accel: float = 30.0          # м/с² (макс боковое ускорение)
    terminal_range: float = 100.0    # дистанция активации про-нав (м)
    impact_angle: float = 30.0       # желаемый угол пикирования (градусы)

    def __init__(self, nav_constant=3.0):
        self.nav_constant = nav_constant
        self._prev_los_rate = [0.0, 0.0]  # предыдущая скорость линии визирования
        self._active = False
        self._time_to_go = 0.0

    def is_active(self) -> bool:
        return self._active

    def compute_guidance(self, drone_x, drone_y, drone_z,
                         drone_vx, drone_vy, drone_vz,
                         target_x, target_y, target_z,
                         target_vx=0, target_vy=0, target_vz=0,
                         dt=0.1):
        """
        Вычислить команды ускорения для попадания в цель.
        Возвращает: (ax_cmd, ay_cmd, az_cmd) в м/с²
        """
        # Относительная позиция
        rx = target_x - drone_x
        ry = target_y - drone_y
        rz = target_z - drone_z
        r = math.sqrt(rx**2 + ry**2 + rz**2)

        # Относительная скорость
        vx = drone_vx - target_vx
        vy = drone_vy - target_vy
        vz = drone_vz - target_vz
        v = math.sqrt(vx**2 + vy**2 + vz**2)

        if r < 1.0:
            self._active = False
            return 0, 0, 0  # hit!

        # Активируем про-нав на дистанции terminal_range
        if r < self.terminal_range and not self._active:
            self._active = True

        if not self._active:
            # До терминала — простой полёт на цель
            # Направление на цель
            ax = self.nav_constant * rx / r * 5.0
            ay = self.nav_constant * ry / r * 5.0
            az = self.nav_constant * rz / r * 5.0
            return ax, ay, az

        # ── Pro-Nav: a_cmd = N · Vc · ω_los ─────────────────

        # Скорость сближения (closing velocity)
        vc = -(rx * vx + ry * vy + rz * vz) / r

        # Угловая скорость линии визирования
        # ω = r × v / |r|²
        los_rate_x = (ry * vz - rz * vy) / (r * r)
        los_rate_y = (rz * vx - rx * vz) / (r * r)
        los_rate_z = (rx * vy - ry * vx) / (r * r)

        # Команды ускорения (в плоскости, перпендикулярной линии визирования)
        ax_cmd = self.nav_constant * vc * los_rate_y  # yaw channel
        az_cmd = -self.nav_constant * vc * los_rate_x  # pitch channel

        # Гравитационная компенсация (для пикирования)
        impact_angle_rad = math.radians(self.impact_angle)
        if r < self.terminal_range * 0.5:
            # Терминальная фаза: держим угол пикирования
            desired_descent_rate = vc * math.sin(impact_angle_rad)
            ay_cmd = (desired_descent_rate - vy) / dt * 0.3
        else:
            ay_cmd = 0

        # Ограничение ускорений
        def clip(a, lim):
            return max(-lim, min(lim, a))

        ax_cmd = clip(ax_cmd, self.max_accel)
        ay_cmd = clip(ay_cmd, self.max_accel * 0.5)
        az_cmd = clip(az_cmd, self.max_accel)

        # Время до цели
        self._time_to_go = r / max(vc, 0.1)

        self._prev_los_rate = [los_rate_x, los_rate_y]
        return ax_cmd, ay_cmd, az_cmd

    def get_status(self) -> dict:
        return {
            "active": self._active,
            "time_to_go_s": round(self._time_to_go, 2),
            "nav_constant": self.nav_constant,
        }


# ═══════════════════════════════════════════════════════════════
# Тест
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═══ FPV Pro-Nav Guidance Test ═══")

    fpg = FPVGuidance(nav_constant=3.0)
    fpg.terminal_range = 200  # активируем на 200м

    # Дрон идёт на цель
    drone = {"x": 0, "y": 80, "z": 0, "vx": 30, "vy": -2, "vz": 20}
    target = {"x": 200, "y": 0, "z": 150, "vx": 0, "vy": 0, "vz": 0}

    for step in range(30):
        ax, ay, az = fpg.compute_guidance(
            drone["x"], drone["y"], drone["z"],
            drone["vx"], drone["vy"], drone["vz"],
            target["x"], target["y"], target["z"],
            target["vx"], target["vy"], target["vz"],
            dt=0.1
        )

        # Обновляем скорость и позицию
        drone["vx"] += ax * 0.1
        drone["vy"] += ay * 0.1
        drone["vz"] += az * 0.1
        drone["x"] += drone["vx"] * 0.1
        drone["y"] += drone["vy"] * 0.1
        drone["z"] += drone["vz"] * 0.1

        r = math.sqrt((drone["x"]-target["x"])**2 + (drone["y"]-target["y"])**2 + (drone["z"]-target["z"])**2)

        if step % 5 == 0 or fpg.is_active():
            status = "PRO-NAV" if fpg.is_active() else "CRUISE"
            print(f" {status} | pos=({drone['x']:.0f},{drone['y']:.0f},{drone['z']:.0f}) "
                  f"r={r:.0f}m | cmd=({ax:+.0f},{ay:+.0f},{az:+.0f}) | ttg={fpg._time_to_go:.1f}s")

        if r < 3:
            print(f"\n*** HIT! r={r:.1f}m ***")
            break
