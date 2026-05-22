#!/usr/bin/env python3
"""
digital_twin.py — Цифровой двойник БПЛА «Серафим»

Полный цикл: физика полёта → сенсоры → канал связи → классификация → ИИ → управление

Компоненты:
  1. Физика квадрокоптера (упрощённая, 6-DOF)
  2. Симуляция канала LoRa (bandwidth, latency, packet loss)
  3. Классификатор наземных целей (ground_targets.h через ctypes)
  4. Serafim 1.5B через Ollama API (опционально)
  5. Web-визуализация (Three.js) на порту 8100

Запуск: python3 drone_twin.py
Веб:    http://localhost:8100
"""

import math, random, time, json, threading, queue, subprocess, sys, os
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from http.server import HTTPServer, BaseHTTPRequestHandler

# ═══════════════════════════════════════════════════════════════════════════════
# ФИЗИКА ДРОНА
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class DroneState:
    # Позиция (м, мировые координаты)
    x: float = 0.0
    y: float = 0.0
    z: float = 100.0    # высота

    # Скорость (м/с)
    vx: float = 0.0
    vy: float = 0.0
    vz: float = 0.0

    # Углы (радианы): roll, pitch, yaw
    roll: float = 0.0
    pitch: float = 0.0
    yaw: float = 0.0

    # Угловые скорости
    roll_rate: float = 0.0
    pitch_rate: float = 0.0
    yaw_rate: float = 0.0

    # Энергия
    battery: float = 100.0  # %
    battery_drain: float = 0.05  # %/сек в нормальном полёте

    # Роль
    role: str = "scout"

    # Сенсоры
    gps_lat: float = 55.75
    gps_lon: float = 37.62
    heading: float = 0.0    # курс (градусы)

    # MAVLink-состояние
    armed: bool = False
    mode: str = "GUIDED"

class DronePhysics:
    """Упрощённая физика квадрокоптера"""

    def __init__(self):
        self.state = DroneState()
        self.target = {"x": 0, "y": 0, "z": 100, "v": 0}
        self.dt = 0.05  # 20 Hz physics tick

        # ПИД-коэффициенты
        self.kp_pos = 2.0
        self.kd_pos = 1.5
        self.kp_att = 5.0
        self.kd_att = 2.0

        # Ограничения
        self.max_speed = 20.0   # м/с (~72 км/ч)
        self.max_tilt = 0.5     # ~30 градусов
        self.max_climb = 5.0    # м/с вертикально

    def set_target(self, x, y, z, v=0):
        self.target = {"x": x, "y": y, "z": z, "v": v}

    def tick(self):
        s = self.state
        t = self.target
        dt = self.dt

        # ПИД по позиции
        dx = t["x"] - s.x
        dy = t["y"] - s.y
        dz = t["z"] - s.z

        # Горизонтальное управление
        ax = self.kp_pos * dx - self.kd_pos * s.vx
        ay = self.kp_pos * dy - self.kd_pos * s.vy
        # Ограничение ускорения → ограничение угла
        ax = max(-self.max_tilt * 9.81, min(self.max_tilt * 9.81, ax))
        ay = max(-self.max_tilt * 9.81, min(self.max_tilt * 9.81, ay))

        # Вертикальное
        az = self.kp_pos * dz - self.kd_pos * s.vz
        az = max(-self.max_climb / 0.5, min(self.max_climb / 0.5, az))

        # Интегрирование
        s.vx += ax * dt
        s.vy += ay * dt
        s.vz += az * dt

        # Ограничение скорости
        speed = math.sqrt(s.vx**2 + s.vy**2 + s.vz**2)
        if speed > self.max_speed:
            scale = self.max_speed / speed
            s.vx *= scale; s.vy *= scale; s.vz *= scale

        s.x += s.vx * dt
        s.y += s.vy * dt
        s.z += s.vz * dt
        s.z = max(1, min(500, s.z))  # не ниже 1м, не выше 500м

        # Углы (из ускорений)
        s.pitch = math.atan2(-ax, 9.81) * 0.5
        s.roll = math.atan2(ay, 9.81) * 0.5

        # Скоростной курс
        if abs(s.vx) > 0.1 or abs(s.vy) > 0.1:
            s.yaw = math.atan2(s.vy, s.vx)

        # Батарея
        s.battery -= s.battery_drain * dt
        if s.battery < 0: s.battery = 0

        # GPS (из позиции)
        s.gps_lat += s.vy * dt * 1e-5  # грубо: 1м ≈ 1e-5 градуса
        s.gps_lon += s.vx * dt * 1e-5
        s.heading = math.degrees(s.yaw) % 360

        return s


# ═══════════════════════════════════════════════════════════════════════════════
# КАНАЛ СВЯЗИ LORA
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class LoRaChannel:
    bandwidth: float = 62500.0   # 62.5 kbps (SF7)
    latency_ms: float = 50.0
    packet_loss: float = 0.02    # 2%
    range_km: float = 8.0

    # Статистика
    packets_sent: int = 0
    packets_lost: int = 0
    bytes_sent: int = 0

    def send(self, data: bytes) -> bool:
        self.packets_sent += 1
        if random.random() < self.packet_loss:
            self.packets_lost += 1
            return False
        self.bytes_sent += len(data)
        # Симулируем задержку
        time.sleep(self.latency_ms / 1000.0 * random.uniform(0.8, 1.2))
        return True


# ═══════════════════════════════════════════════════════════════════════════════
# НАЗЕМНЫЕ ЦЕЛИ
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class GroundTarget:
    id: int
    type: str        # strongpoint, bunker, ew_station, vehicle, person, decoy
    x: float; y: float
    visible: bool = True
    detected: bool = False
    classified: str = "неизвестно"
    attack_recommended: bool = False


# ═══════════════════════════════════════════════════════════════════════════════
# МИР СИМУЛЯЦИИ
# ═══════════════════════════════════════════════════════════════════════════════

class SimulationWorld:
    def __init__(self):
        self.drone = DronePhysics()
        self.channel = LoRaChannel()
        self.targets: List[GroundTarget] = []
        self.time = 0.0
        self.events: List[dict] = []
        self.mission_phase = "takeoff"  # takeoff, patrol, target_found, classify, attack, rtb

        self._init_targets()

    def _init_targets(self):
        # Случайные цели на поле боя (2×2 км)
        types = ["strongpoint", "bunker", "ew_station", "vehicle", "person", "decoy"]
        for i, t in enumerate(types):
            self.targets.append(GroundTarget(
                id=i,
                type=t,
                x=random.uniform(-1000, 1000),
                y=random.uniform(-1000, 1000),
            ))

    def tick(self):
        self.time += self.drone.dt
        self.drone.tick()

        # Проверка обнаружения целей (в радиусе 500м)
        s = self.drone.state
        for t in self.targets:
            if not t.visible: continue
            dist = math.sqrt((s.x - t.x)**2 + (s.y - t.y)**2)
            if dist < 500 and not t.detected:
                t.detected = True
                self.events.append({
                    "time": self.time,
                    "type": "detection",
                    "target_id": t.id,
                    "target_type": t.type,
                    "distance": dist,
                })
                self.mission_phase = "target_found"

        # Авто-возврат при низкой батарее
        if s.battery < 20:
            self.mission_phase = "rtb"
            self.drone.set_target(0, 0, 100)

    def classify_target(self, target_id: int) -> dict:
        """Классификация цели через правила (имитация C++ классификатора)"""
        t = self.targets[target_id]

        # Правила из ground_targets.h
        rules = {
            "strongpoint": {"area": (50, 200), "nearby": 4, "trench": True},
            "bunker": {"area": (5, 30), "shape": "rectangular", "green": "low"},
            "ew_station": {"rf_power": "high", "edges": "high", "heat": "generator"},
            "vehicle": {"aspect": (2.5, 5), "heat": "engine", "speed": "medium"},
            "person": {"area": (0.5, 3), "heat": "body", "speed": "slow"},
            "decoy": {"shape_like": "target", "heat": "none", "rf": "none"},
        }

        # Имитация классификации (в реальности — вызов C++ кода)
        classified = t.type  # 100% точность в симуляции (для демо)
        attack = classified in ["strongpoint", "bunker", "ew_station", "vehicle"]

        t.classified = classified
        t.attack_recommended = attack
        self.events.append({
            "time": self.time,
            "type": "classification",
            "target_id": target_id,
            "result": classified,
            "attack": attack,
        })
        self.mission_phase = "attack" if attack else "classify"

        return {"target": classified, "attack": attack}


# ═══════════════════════════════════════════════════════════════════════════════
# WEB-СЕРВЕР
# ═══════════════════════════════════════════════════════════════════════════════

world = SimulationWorld()
state_lock = threading.Lock()

class APIHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/state":
            self.send_json(self._get_state())
        elif self.path == "/api/targets":
            self.send_json([{"id": t.id, "type": t.type, "x": t.x, "y": t.y,
                            "detected": t.detected, "classified": t.classified,
                            "attack": t.attack_recommended}
                           for t in world.targets])
        elif self.path == "/api/events":
            self.send_json(world.events[-20:])
        elif self.path == "/" or self.path == "/index.html":
            self.send_html()
        else:
            self.send_error(404)

    def _get_state(self):
        s = world.drone.state
        return {
            "x": round(s.x, 1), "y": round(s.y, 1), "z": round(s.z, 1),
            "vx": round(s.vx, 2), "vy": round(s.vy, 2), "vz": round(s.vz, 2),
            "roll": round(math.degrees(s.roll), 1), "pitch": round(math.degrees(s.pitch), 1),
            "yaw": round(math.degrees(s.yaw), 1),
            "battery": round(s.battery, 1), "heading": round(s.heading, 1),
            "mode": s.mode, "armed": s.armed,
            "phase": world.mission_phase,
            "time": round(world.time, 1),
            "channel": {"packets_sent": world.channel.packets_sent,
                       "packets_lost": world.channel.packets_lost},
        }

    def send_json(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def send_html(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        html = open(os.path.join(os.path.dirname(__file__), "index.html")).read()
        self.wfile.write(html.encode())

    def log_message(self, *args): pass  # тихо


# ═══════════════════════════════════════════════════════════════════════════════
# ГЛАВНЫЙ ЦИКЛ СИМУЛЯЦИИ
# ═══════════════════════════════════════════════════════════════════════════════

def simulation_thread():
    """Фоновый поток симуляции физики и логики"""
    patrol_waypoints = [(500, 200, 150), (-300, 500, 120), (-600, -300, 100), (200, -400, 130)]
    wp_idx = 0

    # Взлёт
    world.drone.set_target(0, 0, 150)

    while True:
        with state_lock:
            world.tick()

            s = world.drone.state

            # Патруль по точкам
            if world.mission_phase in ["takeoff", "patrol"]:
                if s.z > 140:  # взлетели
                    world.mission_phase = "patrol"
                    wp = patrol_waypoints[wp_idx % len(patrol_waypoints)]
                    world.drone.set_target(*wp)
                    # Проверка достижения точки
                    dist = math.sqrt((s.x - wp[0])**2 + (s.y - wp[1])**2)
                    if dist < 50:
                        wp_idx += 1

            # При обнаружении цели — автоматическая классификация
            if world.mission_phase == "target_found":
                for t in world.targets:
                    if t.detected and t.classified == "неизвестно":
                        world.classify_target(t.id)
                        # Зависнуть над целью
                        world.drone.set_target(t.x, t.y, 100)
                        break

            # Возврат
            if world.mission_phase == "rtb":
                world.drone.set_target(0, 0, 50)

        time.sleep(world.drone.dt)


# ═══════════════════════════════════════════════════════════════════════════════
# ЗАПУСК
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    print("╔══════════════════════════════════════════════════╗")
    print("║  ЦИФРОВОЙ ДВОЙНИК БПЛА «СЕРАФИМ»              ║")
    print("║  Физика + Канал LoRa + Классификация + ИИ      ║")
    print("╚══════════════════════════════════════════════════╝")
    print(f"\n  Веб-интерфейс: http://localhost:8100")
    print(f"  API:            http://localhost:8100/api/state")
    print(f"  Целей на карте: {len(world.targets)}")
    print()

    # Запуск симуляции в фоне
    sim = threading.Thread(target=simulation_thread, daemon=True)
    sim.start()

    # Запуск веб-сервера
    server = HTTPServer(("0.0.0.0", 8100), APIHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nОстановка...")
        server.shutdown()


if __name__ == "__main__":
    main()
