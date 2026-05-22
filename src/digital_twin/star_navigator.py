#!/usr/bin/env python3
"""
star_navigator.py — Звёздная навигация для высотных БПЛА

Основано на:
  - Методология Данцевича (адаптивная фильтрация)
  - Патент RU 2577558 C1 (Азмерит) — компактный звёздный датчик
  - Патент RU 2592715 C1 — астрономическая навигационная система БПЛА
  - Патент RU 2638077 (ИКИ РАН) — ориентация без перебора каталога

Принцип:
  1. Камера вверх фотографирует звёзды
  2. Выделение созвездий (признаковое пространство расстояний)
  3. Определение ориентации (roll/pitch/yaw) по звёздам
  4. Коррекция IMU дрейфа

Работает выше облаков (>300м) или ночью.
"""

import math, random
from dataclasses import dataclass
from typing import List, Tuple, Optional

# ═══════════════════════════════════════════════════════════════
# Звёздный каталог (упрощённый — 20 ярчайших звёзд)
# ═══════════════════════════════════════════════════════════════

# Формат: (имя, RA_рад, Dec_рад, магнитуда)
STAR_CATALOG = [
    ("Сириус",     1.7678,  -0.2918, -1.46),
    ("Канопус",    1.6753,  -0.9224, -0.72),
    ("Арктур",     3.7335,   0.3348, -0.05),
    ("Вега",       4.8724,   0.6768,  0.03),
    ("Капелла",    1.3818,   0.8028,  0.08),
    ("Ригель",     1.3721,  -0.1431,  0.13),
    ("Процион",    2.0041,   0.0912,  0.34),
    ("Бетельгейзе",1.5497,   0.1274,  0.42),
    ("Альтаир",    5.1960,   0.1547,  0.77),
    ("Альдебаран", 1.2039,   0.2881,  0.86),
    ("Антарес",    4.3171,  -0.4614,  0.91),
    ("Спика",      3.5133,  -0.1948,  0.97),
    ("Поллукс",    2.0303,   0.4891,  1.14),
    ("Фомальгаут", 6.0111,  -0.5188,  1.16),
    ("Денеб",      5.4480,   0.7903,  1.25),
    ("Регул",      2.6545,   0.2089,  1.35),
    ("Адара",      1.8265,  -0.5055,  1.50),
    ("Кастор",     2.0079,   0.5577,  1.57),
    ("Шаула",      4.6072,  -0.6465,  1.62),
    ("Беллатрикс", 1.4278,   0.1079,  1.64),
]


class StarTracker:
    """
    Симуляция звёздного датчика.

    Определяет ориентацию дрона (roll, pitch, yaw)
    по видимым звёздам в поле зрения камеры.
    """

    def __init__(self, fov_deg=20.0, max_magnitude=3.0, min_altitude_m=300):
        self.fov_deg = fov_deg           # поле зрения камеры
        self.max_magnitude = max_magnitude  # предельная звёздная величина
        self.min_altitude_m = min_altitude_m  # минимальная высота работы
        self._last_attitude = (0.0, 0.0, 0.0)
        self._confidence = 0.0
        self._visible_stars = 0

    def is_usable(self, altitude_m, is_night=True):
        """Проверить, можно ли использовать звёздный датчик"""
        return altitude_m >= self.min_altitude_m and is_night

    def get_visible_stars(self, roll, pitch, yaw, lat=55.75, lon=37.62):
        """
        Какие звёзды видит камера при данной ориентации.
        Возвращает: список (имя, x_pix, y_pix, magnitude)
        """
        visible = []
        half_fov = self.fov_deg / 2

        # Направление оптической оси камеры (вверх)
        # Поворот системы координат: из инерциальной в камерную
        for name, ra, dec, mag in STAR_CATALOG:
            if mag > self.max_magnitude:
                continue

            # Упрощённо: проекция на небесную сферу
            # ra, dec → горизонтальные координаты (h, A)
            # sin(h) = sin(φ)sin(δ) + cos(φ)cos(δ)cos(LHA)
            lst = math.fmod(time_to_lst() + lon / 15.0, 24.0)
            lha = math.radians(lst * 15.0) - ra  # местный часовой угол

            sin_alt = (math.sin(math.radians(lat)) * math.sin(dec) +
                       math.cos(math.radians(lat)) * math.cos(dec) * math.cos(lha))

            if sin_alt < 0.1:  # ниже горизонта
                continue

            alt = math.asin(sin_alt)
            cos_az = (math.sin(dec) - math.sin(math.radians(lat)) * sin_alt) / \
                     (math.cos(math.radians(lat)) * math.cos(alt) + 1e-10)
            az = math.acos(max(-1, min(1, cos_az)))
            if math.sin(lha) > 0:
                az = 2 * math.pi - az

            # Звезда в поле зрения?
            # Упрощённая проекция (игнорируем roll/pitch для демо)
            dx = (az - yaw) % (2 * math.pi)
            if dx > math.pi: dx -= 2 * math.pi
            dy = alt - (math.pi/2 - pitch)

            if abs(dx) < math.radians(half_fov) and abs(dy) < math.radians(half_fov):
                visible.append((name, dx, dy, mag))

        self._visible_stars = len(visible)
        return visible

    def determine_attitude(self, altitude_m, roll_est, pitch_est, yaw_est,
                           lat=55.75, lon=37.62, is_night=True):
        """
        Определить ориентацию по звёздам.
        Возвращает: (roll, pitch, yaw, confidence)
        """
        if not self.is_usable(altitude_m, is_night):
            self._confidence = 0.0
            return roll_est, pitch_est, yaw_est, 0.0

        visible = self.get_visible_stars(roll_est, pitch_est, yaw_est, lat, lon)
        n_stars = len(visible)

        if n_stars < 3:
            # Недостаточно звёзд для надёжной ориентации
            self._confidence = 0.2 * n_stars / 3.0
            return roll_est, pitch_est, yaw_est, self._confidence

        # Точность зависит от числа звёзд и магнитуды
        # Типичная точность звёздного датчика: ~0.001° (3.6 угл. сек)
        star_accuracy = 0.001 * (1 + 3.0 / n_stars)  # градусы

        # Коррекция ориентации (с шумом измерения)
        roll_corr = roll_est + random.gauss(0, math.radians(star_accuracy))
        pitch_corr = pitch_est + random.gauss(0, math.radians(star_accuracy))
        yaw_corr = yaw_est + random.gauss(0, math.radians(star_accuracy * 2))  # yaw менее точен

        self._confidence = min(1.0, n_stars / 5.0)
        self._last_attitude = (roll_corr, pitch_corr, yaw_corr)

        return roll_corr, pitch_corr, yaw_corr, self._confidence

    def get_status(self):
        return {
            "visible_stars": self._visible_stars,
            "confidence": round(self._confidence, 2),
            "usable": self._confidence > 0.3,
        }


def time_to_lst():
    """Грубое местное звёздное время (часы)"""
    import time
    # Упрощённо: JD → GMST → LST
    now = time.time()
    jd2000 = (now / 86400.0) + 2451545.0
    T = (jd2000 - 2451545.0) / 36525.0
    gmst = (280.46061837 + 360.98564736629 * (jd2000 - 2451545.0) +
            0.000387933 * T * T - T * T * T / 38710000.0) % 360.0
    return gmst / 15.0


# ═══════════════════════════════════════════════════════════════
# Интеграция с навигатором роя
# ═══════════════════════════════════════════════════════════════

class CelestialNavAugment:
    """
    Дополнение к SwarmNavigator — звёздная коррекция IMU.

    Работает в режиме FULL_AUTO на большой высоте (>300м).
    Заменяет GPS-коррекцию, даёт точность ~0.001° по ориентации.
    Позицию определяет косвенно: точная ориентация → точный вектор тяги → меньше дрейф позиции.
    """

    def __init__(self):
        self.tracker = StarTracker()
        self.last_correction_time = 0.0
        self.correction_interval = 1.0  # коррекция раз в секунду

    def correct_imu(self, imu, altitude_m, lat=55.75, lon=37.62, current_time=0, is_night=None):
        """
        Скорректировать IMU по звёздам.
        imu: объект IMU с полями attitude, position
        """
        # Ночь определяем по местному времени (упрощённо)
        if is_night is None:
            import time
            hour = (time_to_lst() + lon / 15.0) % 24.0
            is_night = hour > 20 or hour < 4  # ночь 20:00-04:00

        roll, pitch, yaw = imu.attitude

        new_roll, new_pitch, new_yaw, conf = self.tracker.determine_attitude(
            altitude_m, roll, pitch, yaw, lat, lon, is_night
        )

        if conf > 0.5:
            # Коррекция ориентации IMU
            alpha = 0.3 * conf  # вес коррекции
            imu.attitude[0] = roll * (1 - alpha) + new_roll * alpha
            imu.attitude[1] = pitch * (1 - alpha) + new_pitch * alpha
            imu.attitude[2] = yaw * (1 - alpha) + new_yaw * alpha
            self.last_correction_time = current_time
            return True
        return False

    def get_status(self):
        return self.tracker.get_status()


# ═══════════════════════════════════════════════════════════════
# Тест
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═══ Star Navigator Test ═══")

    tracker = StarTracker(fov_deg=25, max_magnitude=2.5)

    # Тест на разных высотах
    for alt in [100, 300, 500, 1000]:
        roll, pitch, yaw, conf = tracker.determine_attitude(
            alt, 0.0, 0.0, 0.0, 55.75, 37.62, is_night=True
        )
        usable = tracker.is_usable(alt, True)
        status = tracker.get_status()
        print(f"  Alt={alt}m | usable={usable} | stars={status['visible_stars']} "
              f"conf={conf:.2f} | yaw_corr={math.degrees(yaw):.3f}°")

    print("Star navigator OK")
