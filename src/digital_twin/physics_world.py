#!/usr/bin/env python3
"""
physics_world.py — Физическая модель мира (не рандом, а физика)

Реальные модели:
  1. Атмосфера:  ICAO Standard Atmosphere, ветер по высоте, турбулентность Драйдена
  2. RF propagation: Friis equation + Log-distance + Rayleigh fading + Nakagami-m
  3. Сенсоры: CMOS noise (shot+read+dark), thermal NETD, IMU Allan variance
  4. Баллистика: external ballistics (drag, wind drift, terminal effects)
  5. Акустика: sound propagation (spreading loss, atmospheric absorption)

Источники:
  - ICAO 7488 (стандартная атмосфера)
  - MIL-STD-1797 (Dryden turbulence)
  - ITU-R P.525 (free space path loss)
  - EMVA 1288 (CMOS noise model)
  - NATO STANAG 4355 (external ballistics)
"""

import math, random
from dataclasses import dataclass, field
from typing import Tuple, List

# ═══════════════════════════════════════════════════════════════
# 1. АТМОСФЕРА (ICAO Standard Atmosphere)
# ═══════════════════════════════════════════════════════════════

class Atmosphere:
    """ICAO Standard Atmosphere + ветер + турбулентность"""

    # Константы
    T0 = 288.15      # K на уровне моря
    P0 = 101325.0    # Pa на уровне моря
    RHO0 = 1.225     # kg/m³ на уровне моря
    G = 9.80665      # m/s²
    R = 287.058      # J/(kg·K) газовая постоянная
    LAPSE_RATE = 0.0065  # K/m до 11km

    @classmethod
    def pressure(cls, altitude_m: float) -> float:
        """Давление на высоте (ICAO)"""
        if altitude_m <= 11000:
            return cls.P0 * (1 - cls.LAPSE_RATE * altitude_m / cls.T0) ** (cls.G / (cls.R * cls.LAPSE_RATE))
        else:
            T11 = cls.T0 - cls.LAPSE_RATE * 11000
            P11 = cls.pressure(11000)
            return P11 * math.exp(-cls.G * (altitude_m - 11000) / (cls.R * T11))

    @classmethod
    def temperature(cls, altitude_m: float) -> float:
        if altitude_m <= 11000:
            return cls.T0 - cls.LAPSE_RATE * altitude_m
        return cls.T0 - cls.LAPSE_RATE * 11000

    @classmethod
    def density(cls, altitude_m: float) -> float:
        P = cls.pressure(altitude_m)
        T = cls.temperature(altitude_m)
        return P / (cls.R * T)

    @classmethod
    def speed_of_sound(cls, altitude_m: float) -> float:
        return math.sqrt(1.4 * cls.R * cls.temperature(altitude_m))


class WindModel:
    """Ветер с профилем по высоте + турбулентность Драйдена (MIL-STD-1797)"""

    def __init__(self, surface_speed=3.0, surface_dir=270, turbulence_level="moderate"):
        self.surface_speed = surface_speed
        self.surface_dir = math.radians(surface_dir)
        self.turbulence_level = turbulence_level

        # Dryden scale lengths (MIL-STD-1797)
        self.Lu = 533.4  # м — продольный масштаб
        self.Lv = 533.4  # м — боковой масштаб
        self.Lw = 533.4  # м — вертикальный масштаб

        # Интенсивность турбулентности (σ, м/с)
        levels = {"light": 1.5, "moderate": 3.0, "severe": 6.0}
        self.sigma = levels.get(turbulence_level, 3.0)

        # Состояние фильтра
        self._u_gauss = 0.0
        self._v_gauss = 0.0
        self._w_gauss = 0.0

    def get_wind(self, altitude_m: float, dt: float = 0.1) -> Tuple[float, float, float]:
        """Вектор ветра (vx, vy, vz) на заданной высоте"""
        # Профиль скорости (степенной закон)
        z_ref = 10.0
        alpha = 0.15  # exponent for neutral stability
        speed = self.surface_speed * (altitude_m / z_ref) ** alpha

        # Поворот с высотой (Экмановский разворот — упрощённо)
        ekman_angle = 0.1 * (altitude_m / 100.0)  # ~5° на 50м
        direction = self.surface_dir + ekman_angle

        # Турбулентность (Dryden forming filter)
        V = speed + 0.1
        tau_u = self.Lu / V
        tau_v = self.Lv / V
        tau_w = self.Lw / V

        # Формирующий фильтр Драйдена
        decay_u = math.exp(-dt / tau_u) if tau_u > 0 else 0
        decay_v = math.exp(-dt / tau_v) if tau_v > 0 else 0
        decay_w = math.exp(-dt / tau_w) if tau_w > 0 else 0

        excitation = self.sigma * math.sqrt(2 * V / self.Lu)
        self._u_gauss = self._u_gauss * decay_u + excitation * math.sqrt(1 - decay_u**2) * random.gauss(0, 1)
        self._v_gauss = self._v_gauss * decay_v + self.sigma * 0.8 * math.sqrt(1 - decay_v**2) * random.gauss(0, 1)
        self._w_gauss = self._w_gauss * decay_w + self.sigma * 0.5 * math.sqrt(1 - decay_w**2) * random.gauss(0, 1)

        wind_vx = -speed * math.sin(direction) + self._u_gauss
        wind_vz = -speed * math.cos(direction) + self._v_gauss
        wind_vy = self._w_gauss

        return wind_vx, wind_vy, wind_vz


# ═══════════════════════════════════════════════════════════════
# 2. RF PROPAGATION
# ═══════════════════════════════════════════════════════════════

class RFChannel:
    """
    Модель радиоканала: Friis + Log-distance + Rayleigh fading
    ITU-R P.525 (free space), ITU-R P.1238 (indoor), Nakagami-m fading
    """

    def __init__(self, frequency_hz=868e6, tx_power_dbm=14, tx_gain_dbi=2, rx_gain_dbi=2):
        self.freq = frequency_hz
        self.tx_power_dbm = tx_power_dbm
        self.tx_gain = tx_gain_dbi
        self.rx_gain = rx_gain_dbi
        self.wavelength = 3e8 / frequency_hz  # metres

        # Fading parameters (Nakagami-m)
        self.m_parameter = 1.0   # m=1 → Rayleigh, m>1 → less fading
        self._fading_state = 1.0

    def free_space_path_loss(self, distance_m: float) -> float:
        """Friis equation: FSPL (dB)"""
        if distance_m < 1: distance_m = 1
        return 20 * math.log10(4 * math.pi * distance_m / self.wavelength)

    def log_distance_path_loss(self, distance_m: float, n=2.8, d0=100.0) -> float:
        """Log-distance path loss with exponent n"""
        fspl_d0 = self.free_space_path_loss(d0)
        return fspl_d0 + 10 * n * math.log10(distance_m / d0)

    def nakagami_fading(self, dt: float = 0.1) -> float:
        """Nakagami-m fading — коррелированное во времени"""
        # Clarke's model: correlation ~ J0(2π·fd·τ)
        fd = 10.0  # Hz — Doppler spread (max 10 Hz for drone)
        coherence_time = 1.0 / (fd + 0.01)
        alpha = math.exp(-dt / coherence_time)

        # Generate new Nakagami-m sample
        # m=1: Rayleigh = sqrt(chi2(2)/2)
        # m>1: Nakagami via gamma distribution
        if self.m_parameter <= 1.0:
            new_fading = math.sqrt(random.gauss(0, 1)**2 + random.gauss(0, 1)**2) / math.sqrt(2)
        else:
            # Approximate Nakagami via Gamma
            shape = self.m_parameter
            # Simple gamma via sum of exponentials
            new_fading = sum(-math.log(max(1e-10, random.random())) for _ in range(int(shape)))
            new_fading /= shape

        self._fading_state = self._fading_state * alpha + new_fading * math.sqrt(1 - alpha**2)
        return self._fading_state

    def get_rssi(self, distance_m: float, dt: float = 0.1) -> float:
        """Received Signal Strength Indicator (dBm)"""
        path_loss = self.log_distance_path_loss(distance_m)
        fading_db = 20 * math.log10(max(0.01, self.nakagami_fading(dt)))
        shadowing_db = random.gauss(0, 3.0)  # log-normal shadowing σ=3dB

        rssi = (self.tx_power_dbm + self.tx_gain + self.rx_gain
                - path_loss + fading_db - shadowing_db)
        return rssi

    def packet_loss_rate(self, distance_m: float, bandwidth_hz=125000) -> float:
        """Вероятность потери пакета на основе RSSI"""
        rssi = self.get_rssi(distance_m)
        noise_floor = -174 + 10 * math.log10(bandwidth_hz) + 6  # dBm (6dB NF)
        snr = rssi - noise_floor

        # BPSK BER → PER (simplified)
        if snr > 15: return 0.001
        elif snr > 10: return 0.01
        elif snr > 5: return 0.05
        elif snr > 0: return 0.20
        else: return 0.90


# ═══════════════════════════════════════════════════════════════
# 3. СЕНСОРЫ (физические модели шума)
# ═══════════════════════════════════════════════════════════════

class CMOSCamera:
    """Физическая модель CMOS-камеры (EMVA 1288)"""

    def __init__(self, resolution=(1920, 1080), pixel_size_um=3.0, f_number=2.0,
                 focal_length_mm=4.0, quantum_efficiency=0.6, read_noise_e=5.0):
        self.res = resolution
        self.pixel_size = pixel_size_um * 1e-6  # metres
        self.f_number = f_number
        self.focal_length = focal_length_mm * 1e-3
        self.qe = quantum_efficiency
        self.read_noise = read_noise_e  # electrons RMS

        self.dark_current = 100  # electrons/sec at 25°C
        self.full_well = 15000   # electrons
        self.bit_depth = 12

    def get_snr(self, target_distance_m: float, target_size_m: float,
                target_contrast: float, ambient_light_lux=50000) -> float:
        """SNR для цели заданного размера на заданной дистанции"""
        # GSD (Ground Sample Distance)
        pixel_fov = 2 * math.atan(self.pixel_size / (2 * self.focal_length))
        gsd = target_distance_m * math.tan(pixel_fov)

        # Пикселей на цели
        pixels_on_target = (target_size_m / gsd) ** 2

        # Световой поток (упрощённый)
        aperture_area = math.pi * (self.focal_length / self.f_number / 2) ** 2
        photon_flux = ambient_light_lux * 1e4 * aperture_area * self.qe  # photons/sec

        signal_e = photon_flux * (target_size_m / target_distance_m) ** 2 * 0.01  # integration
        dark_noise = math.sqrt(self.dark_current * 0.01)  # 10ms integration
        shot_noise = math.sqrt(signal_e)
        total_noise = math.sqrt(shot_noise**2 + self.read_noise**2 + dark_noise**2)

        snr = signal_e / (total_noise + 1)
        return min(50.0, snr)

    def detection_probability(self, target_distance_m: float, target_size_m=2.0,
                             target_contrast=0.5, ambient_lux=50000) -> float:
        """Вероятность обнаружения (через SNR → PD)"""
        snr = self.get_snr(target_distance_m, target_size_m, target_contrast, ambient_lux)
        if snr < 1: return 0.05
        elif snr < 3: return 0.2
        elif snr < 5: return 0.5
        elif snr < 10: return 0.8
        else: return 0.99


class ThermalCamera:
    """Физическая модель тепловизора"""

    def __init__(self, resolution=(640, 480), pixel_pitch_um=12, f_number=1.0,
                 focal_length_mm=25, NETD_mK=50):
        self.res = resolution
        self.pixel_pitch = pixel_pitch_um * 1e-6
        self.f_number = f_number
        self.focal_length = focal_length_mm * 1e-3
        self.NETD = NETD_mK / 1000.0  # K

    def get_temperature_sensitivity(self, target_distance_m: float,
                                   target_temp_diff_K: float) -> float:
        """Чувствительность к температурному контрасту на дистанции"""
        # Атмосферное пропускание (LWIR 8-14μm)
        atm_transmission = math.exp(-target_distance_m * 0.0002)  # ~0.2/km

        effective_diff = target_temp_diff_K * atm_transmission
        snr = effective_diff / (self.NETD + 0.001)
        return min(20.0, snr)


class IMUSensor:
    """Физическая модель IMU с шумом Аллана (IEEE Std 952-1997)"""

    def __init__(self):
        # Angle Random Walk (ARW) — белый шум
        self.arw = 0.15  # deg/√hr → 0.0025 deg/√s → 4.4e-5 rad/√s

        # Bias Instability (BI) — фликкер-шум
        self.bi = 3.5  # deg/hr → 1.7e-5 rad/s

        # Rate Random Walk (RRW)
        self.rrw = 0.05  # deg/√hr³

        self._bias = [random.gauss(0, self.bi) for _ in range(3)]
        self._bias_drift = [0.0, 0.0, 0.0]

    def measure_gyro(self, true_rate: Tuple[float, float, float], dt: float) -> Tuple[float, float, float]:
        """Измерить угловую скорость с шумом Аллана"""
        result = []
        for i in range(3):
            # Bias instability (random walk bias)
            self._bias_drift[i] += random.gauss(0, self.rrw * math.sqrt(dt))
            self._bias[i] += self._bias_drift[i] * dt

            # Angle Random Walk
            arw_noise = self.arw / math.sqrt(dt + 1e-10) * random.gauss(0, 1)

            result.append(true_rate[i] + self._bias[i] + arw_noise)
        return tuple(result)


# ═══════════════════════════════════════════════════════════════
# 4. БАЛЛИСТИКА
# ═══════════════════════════════════════════════════════════════

class Ballistics:
    """Внешняя баллистика осколочного БП (NATO STANAG 4355)"""

    # Стандартные профили
    @staticmethod
    def drag_coefficient(mach: float) -> float:
        """G1 drag model (упрощённо)"""
        if mach < 0.5: return 0.15
        elif mach < 0.8: return 0.20
        elif mach < 1.0: return 0.50  # transonic
        elif mach < 1.2: return 0.45
        else: return 0.35

    @classmethod
    def trajectory(cls, start_pos: Tuple[float, float, float],
                   velocity: float, angle_deg: float, heading_deg: float,
                   mass_kg=0.3, calibre_m=0.03, dt=0.01, max_time=10.0) -> List[Tuple[float, float, float]]:
        """Рассчитать траекторию снаряда"""
        x, y, z = start_pos
        angle = math.radians(angle_deg)
        heading = math.radians(heading_deg)

        vx = velocity * math.cos(angle) * math.sin(heading)
        vy = velocity * math.sin(angle)
        vz = velocity * math.cos(angle) * math.cos(heading)

        rho = 1.225  # air density at sea level
        area = math.pi * (calibre_m / 2) ** 2

        points = [(x, y, z)]
        t = 0.0

        while t < max_time and y > 0:
            speed = math.sqrt(vx**2 + vy**2 + vz**2)
            mach = speed / 340.0

            cd = cls.drag_coefficient(mach)
            drag_force = 0.5 * rho * speed**2 * cd * area
            drag_accel = drag_force / mass_kg

            # Drag direction
            if speed > 0.01:
                vx -= drag_accel * (vx / speed) * dt
                vy -= (drag_accel * (vy / speed) + 9.81) * dt
                vz -= drag_accel * (vz / speed) * dt

            x += vx * dt
            y += vy * dt
            z += vz * dt
            t += dt
            points.append((x, y, z))

        return points

    @classmethod
    def lethal_radius(cls, warhead_mass_kg=0.3, explosive_type="TNT") -> float:
        """Радиус поражения осколочного БП"""
        TNT_equiv = {"TNT": 1.0, "RDX": 1.6, "HMX": 1.7, "C4": 1.34}
        eq = TNT_equiv.get(explosive_type, 1.0)
        tnt_kg = warhead_mass_kg * eq * 0.4  # 40% — ВВ, остальное — корпус

        # Маршалл (Marshall) equation for fragmentation radius
        # R = K * W^(1/3), K ≈ 3.5 for personnel, 1.5 for light vehicles
        r_personnel = 3.5 * tnt_kg ** (1/3)  # metres
        r_light_vehicle = 1.5 * tnt_kg ** (1/3)
        return r_personnel, r_light_vehicle

    @classmethod
    def hit_probability(cls, distance_m: float, cep_m=2.0) -> float:
        """Вероятность попадания (круговое вероятное отклонение)"""
        # CEP → σ conversion: σ ≈ CEP / 1.1774
        sigma = cep_m / 1.1774
        # R² distribution with 2 DOF
        return math.exp(-0.5 * (distance_m ** 2) / (sigma ** 2))


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═══ PHYSICS WORLD TEST ═══")
    print()

    # Атмосфера
    for alt in [0, 100, 500, 2000]:
        print(f"Alt {alt:5d}m: T={Atmosphere.temperature(alt):.1f}K "
              f"P={Atmosphere.pressure(alt)/1000:.1f}kPa "
              f"ρ={Atmosphere.density(alt):.3f}kg/m³ "
              f"c={Atmosphere.speed_of_sound(alt):.0f}m/s")

    # Ветер
    wind = WindModel(surface_speed=5.0, surface_dir=315, turbulence_level="moderate")
    print(f"\nWind at 200m: {[f'{x:.1f}' for x in wind.get_wind(200)]} m/s")

    # RF
    rf = RFChannel(frequency_hz=868e6)
    for dist in [100, 500, 2000, 5000]:
        print(f"RF at {dist:5d}m: RSSI={rf.get_rssi(dist):.0f}dBm PER={rf.packet_loss_rate(dist):.3f}")

    # Камера
    cam = CMOSCamera()
    for dist in [100, 300, 800, 2000]:
        print(f"Camera at {dist:5d}m: Pd={cam.detection_probability(dist):.2f}")

    # Баллистика
    traj = Ballistics.trajectory((0, 100, 0), velocity=80, angle_deg=5, heading_deg=45)
    end = traj[-1]
    print(f"\nBallistics: impact at ({end[0]:.0f}, {end[2]:.0f}) {len(traj)} points")
    r_p, r_v = Ballistics.lethal_radius(0.3, "TNT")
    print(f"Lethal radius: {r_p:.1f}m (personnel), {r_v:.1f}m (vehicle)")
