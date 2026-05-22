#!/usr/bin/env python3
"""
failure_model.py — Модель отказов и деградации дрона

Типы отказов:
  - Мотор: потеря тяги (один или несколько)
  - Пропеллер: вибрация, дисбаланс
  - Батарея: прокол, утечка, перегрев
  - Канал связи: потеря, деградация
  - Сенсоры: шум, отказ, калибровка
  - GPS: отказ модуля (отдельно от РЭБ)
  - IMU: дрейф, насыщение

Модель: вероятностная, с каскадными эффектами.
"""

import math, random, time
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


class FailureType(Enum):
    MOTOR = "motor"               # потеря мотора
    PROPELLER = "propeller"       # винт
    BATTERY = "battery"           # батарея
    COMMS = "comms"               # связь
    GPS = "gps_module"            # GPS-модуль
    IMU = "imu"                   # инерциальный модуль
    CAMERA = "camera"             # камера
    MAGNETOMETER = "magnetometer" # магнитометр


@dataclass
class Failure:
    type: FailureType
    severity: float         # 0..1 (0=лёгкая деградация, 1=полный отказ)
    onset_time: float       # время возникновения
    duration: float = float('inf')  # длительность (∞ = необратимый)
    cascade_probability: float = 0.1  # вероятность каскада на другой компонент

    def is_active(self, current_time):
        return current_time >= self.onset_time and \
               current_time < self.onset_time + self.duration

    def get_effect(self, current_time):
        """Эффект отказа: 0=нет, 1=полный"""
        if not self.is_active(current_time):
            return 0.0
        elapsed = current_time - self.onset_time
        # Нарастание отказа (экспоненциальное)
        ramp = 1.0 - math.exp(-elapsed / 1.0)  # 1с постоянная времени
        return self.severity * ramp


class FailureModel:
    """Модель отказов для одного дрона"""

    def __init__(self, drone_id: str, role: str = "scout"):
        self.drone_id = drone_id
        self.role = role
        self.failures: List[Failure] = []

        # Базовые вероятности отказов (в час)
        self.base_failure_rates = {
            FailureType.MOTOR: 0.001,
            FailureType.PROPELLER: 0.002,
            FailureType.BATTERY: 0.0005,
            FailureType.COMMS: 0.003,
            FailureType.GPS: 0.0003,
            FailureType.IMU: 0.0001,
            FailureType.CAMERA: 0.001,
            FailureType.MAGNETOMETER: 0.0005,
        }

        # Модификаторы (боевые условия)
        self.combat_multiplier = 5.0     # ×5 в бою
        self.ew_multiplier = 3.0         # ×3 под РЭБ
        self.low_battery_multiplier = 2.0  # ×2 при батарее <20%

        # Статистика
        self.total_failures = 0
        self.critical_failures = 0
        self.last_failure_time = 0

    def update(self, dt, battery, in_combat=False, under_ew=False, current_time=None):
        """
        Проверить и обновить отказы.
        Возвращает: список новых отказов.
        """
        if current_time is None:
            current_time = time.time()

        new_failures = []
        multiplier = 1.0

        if in_combat:
            multiplier *= self.combat_multiplier
        if under_ew:
            multiplier *= self.ew_multiplier
        if battery < 20:
            multiplier *= self.low_battery_multiplier

        # Проверка новых отказов
        for ftype, base_rate in self.base_failure_rates.items():
            prob = base_rate * multiplier * dt / 3600.0  # нормализация на dt
            if random.random() < prob:
                severity = random.uniform(0.2, 1.0)
                failure = Failure(
                    type=ftype,
                    severity=severity,
                    onset_time=current_time,
                    cascade_probability=0.1 * severity
                )
                self.failures.append(failure)
                new_failures.append(failure)
                self.total_failures += 1
                if severity > 0.7:
                    self.critical_failures += 1
                self.last_failure_time = current_time

        # Проверка каскадных отказов
        for f in self.failures:
            if f.is_active(current_time) and random.random() < f.cascade_probability * dt:
                # Выбрать случайный компонент для каскада
                cascade_type = random.choice(list(FailureType))
                if not any(ex.type == cascade_type and ex.is_active(current_time)
                          for ex in self.failures):
                    cascade = Failure(
                        type=cascade_type,
                        severity=random.uniform(0.1, 0.5),
                        onset_time=current_time,
                        cascade_probability=0.05,
                    )
                    self.failures.append(cascade)
                    new_failures.append(cascade)
                    self.total_failures += 1

        return new_failures

    def get_active_failures(self, current_time=None):
        """Список активных отказов"""
        if current_time is None:
            current_time = time.time()
        return [f for f in self.failures if f.is_active(current_time)]

    def apply_effects(self, drone, current_time=None):
        """
        Применить эффекты отказов к дрону.
        Модифицирует drone dict на месте.
        """
        active = self.get_active_failures(current_time)
        effects = {}

        for f in active:
            eff = f.get_effect(current_time or time.time())
            effects[f.type.value] = eff

            if f.type == FailureType.MOTOR:
                # Потеря тяги → снижение скорости
                drone["vx"] *= (1.0 - eff * 0.7)
                drone["vz"] *= (1.0 - eff * 0.7)
                drone["vy"] = drone.get("_prev_y", drone.get("y", 120)) - 5.0 * eff  # падение

            elif f.type == FailureType.PROPELLER:
                # Вибрация → шум в сенсорах
                drone["_sensor_noise"] = eff * 3.0

            elif f.type == FailureType.BATTERY:
                # Ускоренный разряд
                drone["battery"] -= eff * 0.5  # %/сек

            elif f.type == FailureType.COMMS:
                # Потеря пакетов
                drone["_comms_loss"] = eff

            elif f.type == FailureType.GPS:
                # GPS шум
                drone["_gps_noise"] = eff * 50.0  # метров

            elif f.type == FailureType.IMU:
                # Дрейф IMU
                drone["_imu_drift_mult"] = 1.0 + eff * 10.0

        return effects

    def get_status(self, current_time=None):
        active = self.get_active_failures(current_time)
        return {
            "active_failures": len(active),
            "failures": [{"type": f.type.value, "severity": round(f.severity, 2),
                         "effect": round(f.get_effect(current_time or time.time()), 2)}
                        for f in active],
            "total_failures": self.total_failures,
            "critical_failures": self.critical_failures,
            "health": max(0.0, 1.0 - sum(f.get_effect(current_time or time.time()) for f in active)),
        }


# ═══════════════════════════════════════════════════════════════
# Тест
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═══ Failure Model Test ═══")
    fm = FailureModel("Scout-1", "scout")

    drone = {"vx": 20, "vz": 15, "y": 120, "battery": 80, "_prev_y": 120}
    current = time.time()

    # Симулируем 2 часа полёта
    for hour in range(2):
        for minute in range(60):
            dt = 1.0
            in_combat = (minute > 30 and minute < 45)  # бой 15 минут в час
            under_ew = (minute > 45)
            new = fm.update(dt, drone["battery"], in_combat, under_ew, current)
            effects = fm.apply_effects(drone, current)
            current += dt

            if new:
                for f in new:
                    print(f"  FAILURE: {f.type.value} severity={f.severity:.2f} "
                          f"t={hour}h{minute}m combat={in_combat} ew={under_ew}")

        status = fm.get_status(current)
        print(f"  Hour {hour+1}: health={status['health']:.2%} "
              f"active={status['active_failures']} total={status['total_failures']}")
        print(f"  Drone: vx={drone['vx']:.0f} vy={drone['y']:.0f} bat={drone['battery']:.1f}%")
