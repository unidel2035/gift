#!/usr/bin/env python3
"""
wind_model.py — Модель ветра и турбулентности (Dryden spectrum)

Влияние на:
  - Динамику полёта (снос, сопротивление)
  - Расход батареи (встречный/попутный)
  - Точность сенсоров (вибрации)
  - Визуальную одометрию (смаз изображения)
  - FPV точность (снос на терминале)

Модель Dryden: атмосферная турбулентность через формирующий фильтр.
ГОСТ 4401-81: стандартная атмосфера.
"""

import math, random, time
from dataclasses import dataclass

@dataclass
class WindField:
    """Поле ветра: средний ветер + турбулентность"""
    # Средний ветер (м/с, направление в градусах)
    base_speed: float = 3.0       # средняя скорость
    base_direction: float = 270.0  # откуда дует (метеорологический)
    gust_speed: float = 8.0        # скорость порывов
    gust_probability: float = 0.15  # вероятность порыва в секунду

    # Турбулентность (Dryden)
    turbulence_intensity: float = 0.1  # σ (лёгкая=0.1, умеренная=0.2, сильная=0.4)
    scale_length: float = 500.0        # масштаб турбулентности (м)

    # Сдвиг ветра (изменение с высотой)
    shear_rate: float = 0.02   # м/с на метр высоты (положительный = растёт с высотой)

    # Внутреннее состояние
    _gust_active: bool = False
    _gust_timer: float = 0.0
    _gust_duration: float = 0.0
    _gust_direction: float = 0.0
    _turbulence_state: list = None

    def __post_init__(self):
        self._turbulence_state = [0.0, 0.0, 0.0]

    def get_wind_at(self, x, y, z, time_step):
        """
        Получить вектор ветра в точке (x, y, z) в момент времени.
        Возвращает: (wind_vx, wind_vy, wind_vz) в м/с (мировая система)
        """
        # 1. Средний ветер
        dir_rad = math.radians(self.base_direction)
        # Ветер ДУЕТ ИЗ направления → вектор движения воздуха
        wind_vx = -self.base_speed * math.sin(dir_rad)
        wind_vy = 0.0   # вертикальный ветер — отдельно
        wind_vz = -self.base_speed * math.cos(dir_rad)

        # 2. Сдвиг ветра с высотой
        height_factor = 1.0 + self.shear_rate * max(0, z - 10) / 10.0
        wind_vx *= height_factor
        wind_vz *= height_factor

        # 3. Горизонтальная турбулентность (Dryden формирующий фильтр)
        # du/dt = -V/λ · u + σ·√(3V/λ)·w(t)
        # Для неподвижной точки: используем скорость ветра как V
        V = math.sqrt(wind_vx**2 + wind_vz**2) + 0.1
        tau = self.scale_length / V  # временной масштаб

        for i in range(2):  # только x и z (горизонтальная турбулентность)
            decay = math.exp(-time_step / tau) if tau > 0 else 0
            excitation = self.turbulence_intensity * math.sqrt(2 * V / self.scale_length)
            noise = random.gauss(0, 1)
            self._turbulence_state[i] = (
                self._turbulence_state[i] * decay +
                excitation * math.sqrt(1 - decay**2) * noise
            )

        wind_vx += self._turbulence_state[0]
        wind_vz += self._turbulence_state[1]

        # Вертикальная турбулентность (меньше)
        wind_vy += self.turbulence_intensity * 0.3 * random.gauss(0, 1)

        # 4. Порывы
        if not self._gust_active and random.random() < self.gust_probability * time_step:
            self._gust_active = True
            self._gust_duration = random.uniform(2.0, 8.0)  # 2-8 секунд
            self._gust_timer = 0.0
            self._gust_direction = random.uniform(-45, 45)  # ±45° от основного

        if self._gust_active:
            self._gust_timer += time_step
            # Форма порыва: 1-cos (плавный)
            phase = self._gust_timer / self._gust_duration
            gust_factor = (1 - math.cos(2 * math.pi * phase)) * 0.5 if phase < 1.0 else 0
            gust_dir = math.radians(self.base_direction + self._gust_direction)
            wind_vx += -self.gust_speed * math.sin(gust_dir) * gust_factor
            wind_vz += -self.gust_speed * math.cos(gust_dir) * gust_factor
            if phase >= 1.0:
                self._gust_active = False

        return wind_vx, wind_vy, wind_vz


class WindEffects:
    """Применение ветра к дрону"""

    @staticmethod
    def apply_to_drone(drone, wind_vx, wind_vy, wind_vz, dt, drag_coeff=0.02):
        """
        Применить силу ветра к дрону.
        drone: dict с vx, vz, battery
        """
        # Относительная скорость (дрон - ветер)
        rel_vx = drone.get("vx", 0) - wind_vx
        rel_vz = drone.get("vz", 0) - wind_vz

        # Сила аэродинамического сопротивления
        rel_speed = math.sqrt(rel_vx**2 + rel_vz**2)
        if rel_speed > 0.1:
            drag_force_x = drag_coeff * rel_vx * rel_speed
            drag_force_z = drag_coeff * rel_vz * rel_speed
            drone["vx"] = drone.get("vx", 0) - drag_force_x * dt
            drone["vz"] = drone.get("vz", 0) - drag_force_z * dt

        # Вертикальный ветер
        drone["y"] = drone.get("y", 120) + wind_vy * dt

        # Расход батареи зависит от встречного ветра
        headwind = -(wind_vx * drone.get("vx", 0) + wind_vz * drone.get("vz", 0)) / max(rel_speed, 0.1)
        battery_penalty = max(0, headwind * 0.001)
        drone["battery"] = drone.get("battery", 100) - battery_penalty * dt

        # Влияние на визуальную одометрию
        vo_quality = 1.0 / (1.0 + abs(wind_vx) * 0.1 + abs(wind_vy) * 0.1)
        drone["_vo_quality"] = vo_quality

        return drone


# ═══════════════════════════════════════════════════════════════
# Тест
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═══ Wind Model Test ═══")
    wind = WindField(base_speed=5.0, base_direction=315,
                     gust_speed=12.0, turbulence_intensity=0.15)

    print("Time | Wind(vx,vy,vz) | Gust")
    print("-" * 50)
    for t in range(50):
        dt = 0.1
        w = wind.get_wind_at(100, 0, 150, dt)
        gust = "GUST" if wind._gust_active else ""
        if t % 10 == 0 or wind._gust_active:
            print(f" {t*dt:4.1f}s | ({w[0]:+5.2f}, {w[1]:+5.2f}, {w[2]:+5.2f}) | {gust}")
    print("Wind model OK")
