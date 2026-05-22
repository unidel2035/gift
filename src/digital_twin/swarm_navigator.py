#!/usr/bin/env python3
"""
swarm_navigator.py — Навигация роя в условиях подавления GPS и активного РЭБ

Три слоя навигации:
  L1: IMU + мёртвый счёт (акселерометр + гироскоп) — всегда работает
  L2: UWB-сетка роя (DW1000) — относительное позиционирование
  L3: Визуальная одометрия (optical flow) — низкая высота

Режимы:
  GPS_OK      — GPS работает, все слои корректируются
  GPS_DENIED  — GPS подавлен, IMU + UWB + VO
  EW_ACTIVE   — РЭБ активен, радио подавлено, только IMU + VO
  FULL_AUTO   — полная тишина, только IMU + звёзды (если есть)

Эффекты РЭБ:
  - GPS jamming: радиус, мощность, тип (broadband/spot)
  - LoRa jamming: подавление канала связи
  - UWB jamming: подавление роевой сетки
"""

import math, random, time
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple

# ══════════════════════════════════════════════════════════════════════════
# 1. IMU — ИНЕРЦИАЛЬНАЯ НАВИГАЦИЯ (мёртвый счёт)
# ══════════════════════════════════════════════════════════════════════════

@dataclass
class IMUParams:
    """Параметры IMU (MPU-9250 / ICM-20689 класс)"""
    # Шум датчиков (стандартное отклонение)
    accel_noise: float = 0.01      # м/с² (акселерометр)
    gyro_noise: float = 0.005      # рад/с (гироскоп)
    # Систематические ошибки (bias)
    accel_bias: float = 0.02       # м/с²
    gyro_bias: float = 0.001       # рад/с
    # Температурный дрейф bias
    bias_drift_rate: float = 0.0001  # за секунду
    # Частота обновления
    update_rate: float = 100.0     # Гц

class IMU:
    """Инерциальный измерительный блок — симуляция MEMS IMU"""

    def __init__(self, params: IMUParams = None):
        self.p = params or IMUParams()
        self.accel_bias = [random.uniform(-0.03, 0.03) for _ in range(3)]
        self.gyro_bias = [random.uniform(-0.002, 0.002) for _ in range(3)]

        # Состояние оценивания
        self.position = [0.0, 0.0, 0.0]   # x, y, z (м) — оценка
        self.velocity = [0.0, 0.0, 0.0]   # vx, vy, vz (м/с)
        self.attitude = [0.0, 0.0, 0.0]    # roll, pitch, yaw (рад)

        # Истинное состояние (для сравнения в симуляции)
        self.true_position = [0.0, 0.0, 0.0]
        self.true_velocity = [0.0, 0.0, 0.0]
        self.true_attitude = [0.0, 0.0, 0.0]

        # Статистика дрейфа
        self.drift_distance = 0.0          # накопленная ошибка позиции (м)
        self.time_since_correction = 0.0   # секунд с последней коррекции
        self.position_uncertainty = 0.0    # радиус неопределённости (м)

    def update(self, ax_true, ay_true, az_true, gyro_true, dt):
        """Один шаг интегрирования IMU с шумом и дрейфом"""
        # ── Дрейф bias ──────────────────────────────────
        for i in range(3):
            self.accel_bias[i] += random.gauss(0, self.p.bias_drift_rate * dt)
            self.gyro_bias[i] += random.gauss(0, self.p.bias_drift_rate * dt * 0.1)

        # ── Измерения с шумом ───────────────────────────
        ax_meas = ax_true + self.accel_bias[0] + random.gauss(0, self.p.accel_noise)
        ay_meas = ay_true + self.accel_bias[1] + random.gauss(0, self.p.accel_noise)
        az_meas = az_true + self.accel_bias[2] + random.gauss(0, self.p.accel_noise)

        gx = gyro_true[0] + self.gyro_bias[0] + random.gauss(0, self.p.gyro_noise)
        gy = gyro_true[1] + self.gyro_bias[1] + random.gauss(0, self.p.gyro_noise)
        gz = gyro_true[2] + self.gyro_bias[2] + random.gauss(0, self.p.gyro_noise)

        # ── Интегрирование углов ────────────────────────
        self.attitude[0] += gx * dt  # roll
        self.attitude[1] += gy * dt  # pitch
        self.attitude[2] += gz * dt  # yaw

        # ── Поворот ускорений в мировую систему ─────────
        roll, pitch, yaw = self.attitude
        # Упрощённый поворот (малые углы)
        ax_world = ax_meas * math.cos(pitch) * math.cos(yaw) \
                 + ay_meas * (math.sin(roll)*math.sin(pitch)*math.cos(yaw) - math.cos(roll)*math.sin(yaw)) \
                 + az_meas * (math.cos(roll)*math.sin(pitch)*math.cos(yaw) + math.sin(roll)*math.sin(yaw))
        ay_world = ax_meas * math.cos(pitch) * math.sin(yaw) \
                 + ay_meas * (math.sin(roll)*math.sin(pitch)*math.sin(yaw) + math.cos(roll)*math.cos(yaw)) \
                 + az_meas * (math.cos(roll)*math.sin(pitch)*math.sin(yaw) - math.sin(roll)*math.cos(yaw))
        az_world = -ax_meas * math.sin(pitch) \
                 + ay_meas * math.sin(roll) * math.cos(pitch) \
                 + az_meas * math.cos(roll) * math.cos(pitch)

        # Компенсация гравитации
        az_world += 9.81

        # ── Интегрирование скорости и позиции ────────────
        for i, a in enumerate([ax_world, ay_world, az_world]):
            self.velocity[i] += a * dt
            self.position[i] += self.velocity[i] * dt

        # ── Истинное состояние (без шума) ────────────────
        self.true_attitude[0] += gyro_true[0] * dt
        self.true_attitude[1] += gyro_true[1] * dt
        self.true_attitude[2] += gyro_true[2] * dt
        for i in range(3):
            self.true_velocity[i] += [ax_true, ay_true, az_true][i] * dt
            self.true_position[i] += self.true_velocity[i] * dt

        # ── Оценка дрейфа ───────────────────────────────
        dx = self.position[0] - self.true_position[0]
        dy = self.position[1] - self.true_position[1]
        self.drift_distance = math.sqrt(dx*dx + dy*dy)
        self.time_since_correction += dt

        # Модель роста неопределённости: σ² ∝ t³ (бюджет Аллана)
        self.position_uncertainty = (
            0.1 * self.time_since_correction +           # bias instability
            0.01 * self.time_since_correction ** 1.5 +   # random walk
            0.001 * self.time_since_correction ** 2      # acceleration drift
        )

    def correct_position(self, ref_x, ref_y, ref_z=None):
        """Коррекция от внешнего источника (GPS, UWB, VO)"""
        self.position[0] = ref_x
        self.position[1] = ref_y
        if ref_z is not None:
            self.position[2] = ref_z
        self.time_since_correction = 0.0
        self.drift_distance = 0.0
        self.position_uncertainty = 0.1  # сброс до точности коррекции


# ══════════════════════════════════════════════════════════════════════════
# 2. UWB-СЕТКА РОЯ (DW1000, 3.5-6.5 ГГц, 10см точность, до 500м)
# ══════════════════════════════════════════════════════════════════════════

@dataclass
class UWBParams:
    """Параметры UWB-дальномера (DW1000/DWM3000)"""
    accuracy: float = 0.1            # точность измерения дистанции (м, 1σ)
    max_range: float = 500.0         # максимальная дальность (м)
    update_rate: float = 10.0        # Гц
    frequency: float = 4.0e9         # 4 ГГц (DW1000 channel 2)
    bandwidth: float = 500e6         # 500 МГц
    tx_power_dbm: float = -14.3      # dBm (DW1000)
    # Чувствительность
    rx_sensitivity: float = -106.0   # dBm @ 110 kbps

class UWBMesh:
    """UWB-сетка для относительного позиционирования роя"""

    def __init__(self, drone_id: str, params: UWBParams = None):
        self.drone_id = drone_id
        self.p = params or UWBParams()
        # Дистанции до соседей: {neighbor_id: (distance, timestamp, quality)}
        self.rangings: Dict[str, Tuple[float, float, float]] = {}
        # Позиция по UWB (если есть 3+ якорей с известными координатами)
        self.uwb_position = [0.0, 0.0, 0.0]
        self.position_valid = False
        self.num_anchors = 0
        self.last_update = 0.0

    def measure_range(self, neighbor_id: str, true_distance: float, time: float) -> float:
        """Измерить дальность до соседа (с шумом)"""
        if true_distance > self.p.max_range:
            return -1.0  # нет сигнала

        # Модель шума: accuracy + distance-dependent error (0.1% от дистанции)
        noise = random.gauss(0, self.p.accuracy + true_distance * 0.001)
        measured = true_distance + noise

        # Качество сигнала (RSSI-based, 0..1)
        rssi = self.p.tx_power_dbm - 20 * math.log10(max(true_distance, 0.1)) + random.gauss(0, 2)
        quality = min(1.0, max(0.0, (rssi + 100) / 60.0))  # нормализация

        self.rangings[neighbor_id] = (measured, time, quality)
        return measured

    def solve_multilateration(self, anchors: List[Tuple[float, float, float, float]]) -> Tuple[float, float, float, bool]:
        """
        Решить 3D-мультилатерацию по измерениям дальностей до якорей.
        anchors: [(x, y, z, measured_range), ...]
        Возвращает: (x, y, z, valid)
        """
        if len(anchors) < 3:
            return 0, 0, 0, False

        # Least-squares estimation (Gauss-Newton, 1 итерация)
        # Начальное приближение — центр масс якорей
        x0 = sum(a[0] for a in anchors) / len(anchors)
        y0 = sum(a[1] for a in anchors) / len(anchors)
        z0 = sum(a[2] for a in anchors) / len(anchors)

        # Одна итерация Ньютона-Гаусса
        A = []  # Jacobian matrix
        b = []  # Residual vector

        for ax, ay, az, r_meas in anchors:
            r_est = math.sqrt((x0-ax)**2 + (y0-ay)**2 + (z0-az)**2)
            if r_est < 0.01:
                continue
            # Частные производные
            dx = (x0 - ax) / r_est
            dy = (y0 - ay) / r_est
            dz = (z0 - az) / r_est
            A.append([dx, dy, dz])
            b.append(r_meas - r_est)

        if len(A) < 3:
            return 0, 0, 0, False

        # Решение AᵀA Δx = Aᵀb
        try:
            # Normal equations
            ATA = [[sum(A[i][j]*A[i][k] for i in range(len(A))) for k in range(3)] for j in range(3)]
            ATb = [sum(A[i][j]*b[i] for i in range(len(A))) for j in range(3)]

            # Решение 3×3 системы (правило Крамера)
            det = (ATA[0][0]*(ATA[1][1]*ATA[2][2]-ATA[1][2]*ATA[2][1])
                 - ATA[0][1]*(ATA[1][0]*ATA[2][2]-ATA[1][2]*ATA[2][0])
                 + ATA[0][2]*(ATA[1][0]*ATA[2][1]-ATA[1][1]*ATA[2][0]))

            if abs(det) < 1e-10:
                return 0, 0, 0, False

            # Cramer's rule
            def det3x3(m):
                return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) \
                     - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) \
                     + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0])

            dx = det3x3([[ATb[0], ATA[0][1], ATA[0][2]],
                         [ATb[1], ATA[1][1], ATA[1][2]],
                         [ATb[2], ATA[2][1], ATA[2][2]]]) / det
            dy = det3x3([[ATA[0][0], ATb[0], ATA[0][2]],
                         [ATA[1][0], ATb[1], ATA[1][2]],
                         [ATA[2][0], ATb[2], ATA[2][2]]]) / det
            dz = det3x3([[ATA[0][0], ATA[0][1], ATb[0]],
                         [ATA[1][0], ATA[1][1], ATb[1]],
                         [ATA[2][0], ATA[2][1], ATb[2]]]) / det

            self.uwb_position = [x0 + dx, y0 + dy, z0 + dz]
            self.position_valid = True
            return self.uwb_position[0], self.uwb_position[1], self.uwb_position[2], True

        except (ZeroDivisionError, IndexError):
            return 0, 0, 0, False


# ══════════════════════════════════════════════════════════════════════════
# 3. ВИЗУАЛЬНАЯ ОДОМЕТРИЯ (optical flow, работает < 200м высоты)
# ══════════════════════════════════════════════════════════════════════════

@dataclass
class VOParams:
    """Параметры визуальной одометрии"""
    max_altitude: float = 200.0       # макс высота для VO (м)
    min_features: int = 50            # минимум точек для трекинга
    feature_track_error: float = 0.5  # ошибка трекинга (пиксель)
    camera_fov: float = 85.0          # поле зрения (градусы)
    camera_resolution: tuple = (640, 480)
    pixel_size: float = 3.0e-6        # размер пикселя (м)
    focal_length: float = 3.6e-3      # фокусное расстояние (м)
    update_rate: float = 30.0         # Гц

class VisualOdometry:
    """Визуальная одометрия — оценка движения по камере вниз"""

    def __init__(self, params: VOParams = None):
        self.p = params or VOParams()
        self.velocity_estimate = [0.0, 0.0, 0.0]  # vx, vy, vz
        self.position_delta = [0.0, 0.0, 0.0]     # смещение с последнего кадра
        self.confidence = 0.0                       # уверенность (0..1)
        self.features_tracked = 0
        self.last_frame_time = 0.0
        self.altitude_m = 100.0  # высота (от барометра)
        self.ground_texture_quality = 0.5  # качество текстуры земли (0..1)

    def update(self, true_vx, true_vy, true_vz, altitude, dt, time):
        """Оценить скорость по оптическому потоку"""
        self.altitude_m = altitude

        # VO работает только на низкой высоте
        if altitude > self.p.max_altitude:
            self.confidence = 0.0
            self.features_tracked = 0
            return

        # Масштабный фактор: метр/пиксель на данной высоте
        # GSD (Ground Sample Distance) = altitude * pixel_size / focal_length
        gsd = altitude * self.p.pixel_size / self.p.focal_length

        # Оптический поток: пиксель/с → м/с
        # Шум зависит от: высоты, текстуры, освещения, вибраций
        tracking_noise = self.p.feature_track_error * (1 + altitude / 100.0)

        # Измерение с шумом
        vx_meas = true_vx + random.gauss(0, tracking_noise * gsd * 30)
        vy_meas = true_vy + random.gauss(0, tracking_noise * gsd * 30)
        vz_meas = true_vz + random.gauss(0, tracking_noise * gsd * 5)

        self.velocity_estimate = [vx_meas, vy_meas, vz_meas]

        # Интегрирование позиции
        for i in range(3):
            self.position_delta[i] = self.velocity_estimate[i] * dt

        # Уверенность: зависит от высоты и текстуры
        self.confidence = max(0.0, 1.0 - altitude / self.p.max_altitude) \
                        * self.ground_texture_quality

        # Число отслеживаемых точек (симулируем)
        self.features_tracked = max(0, int(self.p.min_features * self.confidence))
        self.last_frame_time = time


# ══════════════════════════════════════════════════════════════════════════
# 4. ЭФФЕКТЫ РЭБ (GPS jamming, LoRa jamming, UWB jamming)
# ══════════════════════════════════════════════════════════════════════════

@dataclass
class EWJammer:
    """Станция РЭБ на поле боя"""
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    # Мощность
    gps_jammer_power: float = 10.0    # Вт (GPS L1/L2)
    lora_jammer_power: float = 5.0    # Вт (868 МГц)
    uwb_jammer_power: float = 2.0     # Вт (3.5-6.5 ГГц)
    # Радиус эффективного подавления (зависит от высоты дрона)
    gps_jamming_radius: float = 5000.0   # м (GPS сигнал очень слабый)
    lora_jamming_radius: float = 3000.0
    uwb_jamming_radius: float = 1500.0
    active: bool = True


class EWEnvironment:
    """Среда радиоэлектронной борьбы"""

    def __init__(self):
        self.jammers: List[EWJammer] = []
        self.ambient_noise = -110.0  # dBm тепловой шум

    def add_jammer(self, jammer: EWJammer):
        self.jammers.append(jammer)

    def gps_jammed(self, drone_x, drone_y, drone_z) -> Tuple[bool, float]:
        """Проверить, подавлен ли GPS у дрона. Возвращает (jammed, jamming_power_dbm)"""
        total_jamming = 0.0
        for j in self.jammers:
            if not j.active:
                continue
            dist = math.sqrt((drone_x-j.x)**2 + (drone_y-j.y)**2 + (drone_z-j.z)**2)
            if dist < j.gps_jamming_radius:
                # Свободное пространство: мощность падает как 1/r²
                rx_power_w = j.gps_jammer_power / (4 * math.pi * dist**2) * 0.01  # эффективная апертура
                total_jamming += rx_power_w

        gps_signal_power = 1e-16  # ~-160 dBW (типичный GPS на земле)
        jammed = total_jamming > gps_signal_power * 10  # 10dB J/S порог
        jamming_power = 10 * math.log10(max(total_jamming, self.ambient_noise / 1000)) if total_jamming > 0 else -200
        return jammed, jamming_power

    def lora_jammed(self, drone_x, drone_y, drone_z) -> Tuple[bool, float]:
        """Проверить, подавлен ли LoRa-канал"""
        for j in self.jammers:
            if not j.active:
                continue
            dist = math.sqrt((drone_x-j.x)**2 + (drone_y-j.y)**2 + (drone_z-j.z)**2)
            if dist < j.lora_jamming_radius:
                return True, j.lora_jammer_power
        return False, -200

    def uwb_jammed(self, drone_x, drone_y, drone_z) -> Tuple[bool, float]:
        """Проверить, подавлена ли UWB-сетка"""
        for j in self.jammers:
            if not j.active:
                continue
            dist = math.sqrt((drone_x-j.x)**2 + (drone_y-j.y)**2 + (drone_z-j.z)**2)
            if dist < j.uwb_jamming_radius:
                return True, j.uwb_jammer_power
        return False, -200


# ══════════════════════════════════════════════════════════════════════════
# 5. НАВИГАТОР РОЯ — fusion всех слоёв
# ══════════════════════════════════════════════════════════════════════════

class SwarmNavigator:
    """
    Навигатор отдельного дрона в условиях GPS-подавления.

    Режимы:
      GPS_OK     — GPS + IMU (каждые 0.1с коррекция)
      GPS_DENIED — IMU + UWB + VO (fusion)
      EW_ACTIVE  — только IMU + VO (UWB тоже подавлен)
      FULL_AUTO  — только IMU (автономный полёт)
    """

    def __init__(self, drone_id: str, drone_role: str = "scout", init_pos: tuple = None):
        self.drone_id = drone_id
        self.drone_role = drone_role
        self.imu = IMU()
        self.uwb = UWBMesh(drone_id)
        self.vo = VisualOdometry()

        # Установить начальную позицию
        if init_pos:
            self.imu.position = [float(init_pos[0]), float(init_pos[1]), float(init_pos[2])]
            self.imu.true_position = [float(init_pos[0]), float(init_pos[1]), float(init_pos[2])]

        # Режим навигации
        self.mode = "GPS_OK"
        self.gps_available = True
        self.gps_jamming_power = -200

        # Fusion-позиция (наилучшая оценка)
        init = init_pos if init_pos else (0.0, 0.0, 0.0)
        self.position = [float(init[0]), float(init[1]), float(init[2])]   # x, y, z
        self.velocity = [0.0, 0.0, 0.0]   # vx, vy, vz
        self.heading = 0.0                  # курс (градусы)

        # Неопределённость позиции
        self.position_error = 0.5           # метров (CEP)
        self.position_error_ellipse = (0.5, 0.5)  # major, minor axis

        # Статистика
        self.total_drift = 0.0
        self.uwb_corrections = 0
        self.vo_corrections = 0
        self.gps_corrections = 0
        self.time_in_gps_denied = 0.0

        # Доплеровская скорость (если GPS работает частично)
        self.gps_velocity = [0.0, 0.0, 0.0]

    def update(self, true_ax, true_ay, true_az, gyro_true,
               true_x, true_y, true_z,
               dt, time, ew_env: EWEnvironment = None):
        """
        Главный цикл навигации. Принимает истинные значения (из симуляции)
        и выдаёт навигационную оценку с шумами и дрейфом.
        """
        # ── 1. IMU обновление (всегда работает) ───────────
        self.imu.update(true_ax, true_ay, true_az, gyro_true, dt)

        # ── 2. Проверка РЭБ окружения ─────────────────────
        if ew_env:
            gps_jammed, self.gps_jamming_power = ew_env.gps_jammed(true_x, true_y, true_z)
            lora_jammed, _ = ew_env.lora_jammed(true_x, true_y, true_z)
            uwb_jammed, _ = ew_env.uwb_jammed(true_x, true_y, true_z)
        else:
            gps_jammed = False
            lora_jammed = False
            uwb_jammed = False

        # ── 3. Определение режима ─────────────────────────
        if not gps_jammed:
            self.mode = "GPS_OK"
            self.gps_available = True
        elif not uwb_jammed:
            self.mode = "GPS_DENIED"
            self.gps_available = False
            self.time_in_gps_denied += dt
        elif not lora_jammed:
            self.mode = "EW_ACTIVE"
            self.gps_available = False
            self.time_in_gps_denied += dt
        else:
            self.mode = "FULL_AUTO"
            self.gps_available = False
            self.time_in_gps_denied += dt

        # ── 4. Коррекция от доступных источников ──────────
        correction_applied = False

        if self.mode == "GPS_OK":
            # GPS коррекция: каждые 0.1с (10 Гц)
            if time % 0.1 < dt:
                gps_noise = 1.5  # CEP ≈ 1.5м
                self.imu.correct_position(
                    true_x + random.gauss(0, gps_noise),
                    true_y + random.gauss(0, gps_noise),
                    true_z + random.gauss(0, gps_noise * 0.5)
                )
                self.gps_corrections += 1
                correction_applied = True

        elif self.mode in ("GPS_DENIED", "EW_ACTIVE"):
            # UWB коррекция: если есть 3+ якорей
            if self.mode == "GPS_DENIED":
                correction_applied = self._apply_uwb_correction(time)

            # Визуальная одометрия
            if not correction_applied:
                self.vo.update(
                    true_ax * dt, true_ay * dt, true_az * dt,
                    true_z, dt, time
                )
                if self.vo.confidence > 0.3:
                    # Коррекция от VO (только горизонтальная)
                    self.imu.position[0] += self.vo.position_delta[0] * 0.5
                    self.imu.position[1] += self.vo.position_delta[1] * 0.5
                    self.vo_corrections += 1
                    correction_applied = True

        # ── 5. Fusion: наилучшая оценка позиции ────────────
        if correction_applied:
            self.position = self.imu.position[:]
        else:
            # Только IMU (FULL_AUTO)
            self.position = self.imu.position[:]
            self.total_drift = self.imu.drift_distance

        self.velocity = self.imu.velocity[:]
        self.position_error = self.imu.position_uncertainty

        # Курс из скорости
        if abs(self.velocity[0]) > 0.01 or abs(self.velocity[1]) > 0.01:
            self.heading = math.degrees(math.atan2(self.velocity[1], self.velocity[0])) % 360

        return self.position

    def _apply_uwb_correction(self, time) -> bool:
        """Применить UWB-коррекцию от якорей"""
        # В реальности якоря — другие дроны с известными позициями
        # Здесь: если достаточно измерений — корректируем
        if self.uwb.num_anchors >= 3 and self.uwb.position_valid:
            ux, uy, uz = self.uwb.uwb_position
            self.imu.correct_position(ux, uy, uz)
            self.uwb_corrections += 1
            return True
        return False

    def get_status(self) -> dict:
        """Статус навигации для API"""
        return {
            "mode": self.mode,
            "gps_available": self.gps_available,
            "gps_jamming_dbm": round(self.gps_jamming_power, 1),
            "position": [round(p, 2) for p in self.position],
            "position_error_m": round(self.position_error, 2),
            "heading": round(self.heading, 1),
            "imu_drift_m": round(self.imu.drift_distance, 2),
            "imu_uncertainty_m": round(self.imu.position_uncertainty, 2),
            "vo_confidence": round(self.vo.confidence, 2),
            "vo_features": self.vo.features_tracked,
            "uwb_anchors": self.uwb.num_anchors,
            "uwb_valid": self.uwb.position_valid,
            "corrections": {
                "gps": self.gps_corrections,
                "uwb": self.uwb_corrections,
                "vo": self.vo_corrections,
            },
            "time_gps_denied_s": round(self.time_in_gps_denied, 1),
        }


# ══════════════════════════════════════════════════════════════════════════
# 6. ТЕСТ
# ══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═══ ТЕСТ НАВИГАТОРА РОЯ ═══")
    print()

    # Создаём РЭБ-среду с одной станцией
    ew = EWEnvironment()
    ew.add_jammer(EWJammer(x=500, y=300, z=0, active=True))

    # Создаём навигаторы для 3 дронов
    navs = [
        SwarmNavigator("Scout-1", "scout"),
        SwarmNavigator("Interceptor-1", "interceptor"),
        SwarmNavigator("FPV-1", "fpv"),
    ]

    # Симуляция 60 секунд полёта
    dt = 0.01
    positions = [[0.0, 0.0, 120.0] for _ in navs]

    for step in range(6000):
        t = step * dt
        for i, nav in enumerate(navs):
            # Истинное движение: полёт вперёд
            ax = 2.0 * math.sin(t * 0.5)
            ay = 1.5 * math.cos(t * 0.3)
            az = 0.1 * math.sin(t * 0.2)
            gyro = [0.01 * math.sin(t), 0.01 * math.cos(t), 0.02 * math.sin(t * 0.5)]

            # Интегрируем истинную позицию
            positions[i][0] += ax * dt * 10  # упрощение
            positions[i][1] += ay * dt * 10
            px, py, pz = positions[i]

            pos = nav.update(ax, ay, az, gyro, px, py, pz, dt, t, ew)

    # Результаты
    for nav in navs:
        s = nav.get_status()
        print(f"{nav.drone_id} ({nav.drone_role}):")
        print(f"  Mode: {s['mode']} | GPS: {s['gps_available']}")
        print(f"  Position error: {s['position_error_m']}m")
        print(f"  IMU drift: {s['imu_drift_m']}m | Uncertainty: {s['imu_uncertainty_m']}m")
        print(f"  VO confidence: {s['vo_confidence']} | Features: {s['vo_features']}")
        print(f"  UWB anchors: {s['uwb_anchors']} | Valid: {s['uwb_valid']}")
        print(f"  Corrections: {s['corrections']}")
        print(f"  Time GPS-denied: {s['time_gps_denied_s']}s")
        print()
