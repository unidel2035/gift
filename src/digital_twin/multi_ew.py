#!/usr/bin/env python3
"""
multi_ew.py — Множественная РЭБ + Frequency Hopping Spread Spectrum

Сценарии:
  - Несколько станций РЭБ с перекрывающимися зонами
  - Адаптивная мощность подавления
  - FHSS: частотное скачкообразное перестроение
  - SIGINT: обнаружение и картографирование источников РЭБ
"""

import math, random, time
from dataclasses import dataclass, field
from typing import List, Dict, Tuple


@dataclass
class EWStation:
    """Станция РЭБ с адаптивной мощностью"""
    id: str
    x: float; z: float
    # Мощность
    max_gps_power: float = 10.0    # Вт
    max_lora_power: float = 5.0
    max_uwb_power: float = 2.0
    current_gps_power: float = 0.0
    current_lora_power: float = 0.0
    current_uwb_power: float = 0.0
    # Радиусы
    gps_radius: float = 5000.0
    lora_radius: float = 3000.0
    uwb_radius: float = 1500.0
    # Состояние
    active: bool = True
    adaptive: bool = True          # адаптивная мощность
    detected_by_swarm: bool = False
    # Тактика
    sweep_mode: bool = False       # режим сканирования
    sweep_angle: float = 0.0
    sweep_speed: float = 0.1       # рад/с
    # Частоты
    gps_freqs: list = field(default_factory=lambda: [1575.42e6, 1227.60e6])  # L1, L2
    lora_freqs: list = field(default_factory=lambda: [868.0e6, 868.5e6])
    uwb_freqs: list = field(default_factory=lambda: [3.5e9, 4.0e9, 6.5e9])


class FHSSController:
    """
    Frequency Hopping Spread Spectrum (FHSS) — защита от РЭБ.

    Принцип: передатчик и приёмник синхронно перескакивают
    по псевдослучайной последовательности частот.
    Если РЭБ глушит одну частоту — потерян только 1/N кадров.
    """

    def __init__(self, hop_rate=50, num_channels=20):
        self.hop_rate = hop_rate             # скачков/сек
        self.num_channels = num_channels     # число частотных каналов
        self.base_freq = 868.0e6             # базовая частота (Гц)
        self.channel_spacing = 250e3          # 250 kHz
        # Состояние
        self.sequence = self._generate_sequence()
        self.current_channel = 0
        self.last_hop_time = 0.0
        self.jammed_channels = set()
        self.packets_lost_to_jamming = 0
        self.total_packets = 0

    def _generate_sequence(self, seed=None):
        """Псевдослучайная последовательность каналов"""
        import random
        rng = random.Random(seed)
        seq = list(range(self.num_channels))
        rng.shuffle(seq)
        return seq

    def get_channel(self, current_time):
        """Текущий канал (с учётом скачков)"""
        hop_interval = 1.0 / self.hop_rate
        if current_time - self.last_hop_time >= hop_interval:
            self.current_channel = (self.current_channel + 1) % len(self.sequence)
            self.last_hop_time = current_time
        return self.sequence[self.current_channel]

    def get_frequency(self, current_time):
        return self.base_freq + self.get_channel(current_time) * self.channel_spacing

    def is_jammed(self, current_time, ew_env):
        """Проверить, перебит ли текущий канал"""
        freq = self.get_frequency(current_time)
        channel = self.get_channel(current_time)
        self.total_packets += 1

        if channel in self.jammed_channels:
            self.packets_lost_to_jamming += 1
            return True
        return False

    def update_jammed_channels(self, ew_stations: List[EWStation], drone_x, drone_z):
        """Обновить список подавленных каналов на основе позиции дрона"""
        self.jammed_channels.clear()
        for ew in ew_stations:
            if not ew.active:
                continue
            dist = math.sqrt((drone_x - ew.x)**2 + (drone_z - ew.z)**2)
            if dist < ew.lora_radius:
                # РЭБ глушит часть каналов
                jammed_frac = (1.0 - dist / ew.lora_radius) * (ew.current_lora_power / ew.max_lora_power)
                num_jammed = int(self.num_channels * jammed_frac)
                jammed = set(random.sample(range(self.num_channels), num_jammed))
                self.jammed_channels.update(jammed)

    def get_stats(self):
        return {
            "total_packets": self.total_packets,
            "lost_to_jamming": self.packets_lost_to_jamming,
            "loss_rate": self.packets_lost_to_jamming / max(self.total_packets, 1),
            "num_channels": self.num_channels,
            "hop_rate": self.hop_rate,
            "jammed_channels": len(self.jammed_channels),
        }


class MultiEWEnvironment:
    """
    Расширенная РЭБ-среда:
    - Несколько станций с перекрытием
    - Адаптивная мощность
    - Режимы сканирования
    - FHSS контроллеры для дронов
    """

    def __init__(self):
        self.stations: List[EWStation] = []
        self.fhss_controllers: Dict[str, FHSSController] = {}
        self.sigint_detections: List[Dict] = []

    def add_station(self, station: EWStation):
        self.stations.append(station)

    def add_fhss(self, drone_id: str, fhss: FHSSController):
        self.fhss_controllers[drone_id] = fhss

    def update(self, dt, drone_positions: Dict[str, Tuple[float, float]]):
        """Обновить РЭБ-среду"""
        # Адаптивная мощность: станции усиливают подавление если дроны рядом
        for st in self.stations:
            if not st.active:
                continue

            nearest_drone_dist = float('inf')
            for did, (dx, dz) in drone_positions.items():
                dist = math.sqrt((dx - st.x)**2 + (dz - st.z)**2)
                nearest_drone_dist = min(nearest_drone_dist, dist)

            # Адаптивная мощность: обратно пропорциональна расстоянию до ближайшего дрона
            if st.adaptive and nearest_drone_dist < st.gps_radius:
                target_level = max(0.1, 1.0 - nearest_drone_dist / st.gps_radius)
                # Плавное изменение
                alpha = 0.1
                st.current_gps_power += (st.max_gps_power * target_level - st.current_gps_power) * alpha
                st.current_lora_power += (st.max_lora_power * target_level - st.current_lora_power) * alpha
                st.current_uwb_power += (st.max_uwb_power * target_level - st.current_uwb_power) * alpha
            else:
                # Затухание
                st.current_gps_power *= 0.95
                st.current_lora_power *= 0.95
                st.current_uwb_power *= 0.95

            # Режим сканирования
            if st.sweep_mode:
                st.sweep_angle += st.sweep_speed * dt

        # FHSS обновление
        for did, fhss in self.fhss_controllers.items():
            if did in drone_positions:
                dx, dz = drone_positions[did]
                fhss.update_jammed_channels(self.stations, dx, dz)

    def get_jamming_at(self, drone_x, drone_z, drone_y=100):
        """Суммарное подавление в точке"""
        total_gps_jamming = 0.0
        total_lora_jamming = 0.0
        total_uwb_jamming = 0.0

        for st in self.stations:
            if not st.active:
                continue
            dist = math.sqrt((drone_x - st.x)**2 + (drone_z - st.z)**2 + drone_y**2)

            if dist < st.gps_radius and dist > 0.1:
                total_gps_jamming += st.current_gps_power / (4 * math.pi * dist**2)
            if dist < st.lora_radius and dist > 0.1:
                total_lora_jamming += st.current_lora_power / (4 * math.pi * dist**2)
            if dist < st.uwb_radius and dist > 0.1:
                total_uwb_jamming += st.current_uwb_power / (4 * math.pi * dist**2)

        return total_gps_jamming, total_lora_jamming, total_uwb_jamming

    # SIGINT методы
    def detect_jammers(self, drone_x, drone_z, sensitivity=1e-12):
        """SIGINT: засечь источники РЭБ"""
        detections = []
        for st in self.stations:
            if not st.active or st.detected_by_swarm:
                continue
            dist = math.sqrt((drone_x - st.x)**2 + (drone_z - st.z)**2)
            received_power = st.current_lora_power / (4 * math.pi * dist**2 + 1)
            if received_power > sensitivity:
                bearing = math.degrees(math.atan2(st.x - drone_x, st.z - drone_z)) % 360
                detections.append({
                    "bearing_deg": bearing,
                    "power_dbm": 10 * math.log10(received_power) + 30,
                    "est_distance": st.lora_radius * (1 - received_power / sensitivity),
                    "type": "ew_jammer",
                })
        return detections

    def get_status(self):
        return {
            "stations": [{
                "id": s.id,
                "x": s.x, "z": s.z,
                "active": s.active,
                "gps_power": round(s.current_gps_power, 1),
                "lora_power": round(s.current_lora_power, 1),
                "adaptive": s.adaptive,
                "sweep_mode": s.sweep_mode,
                "detected": s.detected_by_swarm,
            } for s in self.stations],
            "fhss_controllers": {
                did: fhss.get_stats() for did, fhss in self.fhss_controllers.items()
            },
            "sigint_detections": self.sigint_detections[-10:],
        }


# ═══════════════════════════════════════════════════════════════
# Тест
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═══ Multi-EW + FHSS Test ═══")

    env = MultiEWEnvironment()
    env.add_station(EWStation("ew1", 500, 300, sweep_mode=True))
    env.add_station(EWStation("ew2", -400, -200, sweep_mode=True))

    env.add_fhss("Scout-1", FHSSController(hop_rate=50, num_channels=20))

    # Симуляция
    drone_positions = {"Scout-1": (100.0, 50.0)}

    for t in range(100):
        dt = 0.1
        drone_positions["Scout-1"] = (
            drone_positions["Scout-1"][0] + random.gauss(0, 5),
            drone_positions["Scout-1"][1] + random.gauss(0, 5),
        )
        env.update(dt, drone_positions)

        if t % 20 == 0:
            fhss = env.fhss_controllers["Scout-1"]
            stats = fhss.get_stats()
            jammed = env.get_jamming_at(*drone_positions["Scout-1"])
            print(f"  t={t*dt:.1f}s | FHSS loss={stats['loss_rate']:.2%} "
                  f"jammed_ch={stats['jammed_channels']}/{stats['num_channels']} "
                  f"gps_jam={jammed[0]*1e12:.1f}e-12W")

    status = env.get_status()
    print(f"  Stations: {len(status['stations'])}")
    for s in status['stations']:
        print(f"    {s['id']}: active={s['active']} gps_pwr={s['gps_power']}W")
    print("Multi-EW OK")
