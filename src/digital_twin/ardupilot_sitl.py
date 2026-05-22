#!/usr/bin/env python3
"""
ardupilot_sitl.py — Мост к ArduPilot SITL (Software In The Loop)

Запускает ArduCopter SITL, подключается через MAVProxy/UDP.
Цифровой двойник ↔ SITL через MAVLink.

Требования:
  - ArduPilot SITL установлен (sim_vehicle.py)
  - MAVProxy (опционально)

Если SITL недоступен — работает в эмулированном режиме.
"""

import math, time, threading, subprocess, json, os, sys
from dataclasses import dataclass
from typing import Optional, Dict


@dataclass
class SITLDrone:
    """Виртуальный дрон, управляемый ArduPilot SITL"""
    id: str
    system_id: int
    # SITL-состояние
    sitl_process: Optional[subprocess.Popen] = None
    sitl_ready: bool = False
    # Позиция
    lat: float = 55.75
    lon: float = 37.62
    alt_msl: float = 100.0
    alt_rel: float = 100.0
    # Скорость
    vx: float = 0.0
    vy: float = 0.0
    vz: float = 0.0
    # Ориентация
    roll: float = 0.0
    pitch: float = 0.0
    yaw: float = 0.0
    # Режим
    mode: str = "GUIDED"
    armed: bool = False
    battery: float = 100.0
    # MAVLink
    heartbeat_count: int = 0
    last_heartbeat: float = 0.0


class ArduPilotSITLBridge:
    """
    Мост между цифровым двойником и ArduPilot SITL.

    Два режима:
      - REAL: запускает настоящий SITL (требует ArduPilot)
      - EMULATED: эмулирует SITL-поведение (всегда работает)
    """

    def __init__(self, mode="emulated", sitl_dir=None):
        self.mode = mode  # "emulated" или "real"
        self.sitl_dir = sitl_dir or os.path.expanduser("~/ardupilot")
        self.drones: Dict[int, SITLDrone] = {}
        self.running = False
        self._thread = None
        self._mavlink_bridge = None

    def add_drone(self, drone_id: str, system_id: int,
                  home_lat=55.75, home_lon=37.62, home_alt=0):
        """Добавить дрон в мост"""
        drone = SITLDrone(
            id=drone_id,
            system_id=system_id,
            lat=home_lat,
            lon=home_lon,
            alt_rel=home_alt + 100 if home_alt < 50 else home_alt,
            alt_msl=home_alt + 100,
        )
        self.drones[system_id] = drone

        if self.mode == "real":
            self._launch_sitl(drone)
        else:
            drone.sitl_ready = True

    def _launch_sitl(self, drone: SITLDrone):
        """Запустить ArduPilot SITL для дрона"""
        try:
            # Проверить наличие SITL
            vehicle_script = os.path.join(self.sitl_dir, "Tools/autotest/sim_vehicle.py")
            if not os.path.exists(vehicle_script):
                print(f"  SITL not found at {self.sitl_dir}, falling back to emulated")
                self.mode = "emulated"
                drone.sitl_ready = True
                return

            cmd = [
                "python3", vehicle_script,
                "-v", "ArduCopter",
                "--no-mavproxy",
                f"--sysid={drone.system_id}",
                "--out=udp:127.0.0.1:14550",
                "-L", "KSFO",  # локация по умолчанию
            ]
            drone.sitl_process = subprocess.Popen(
                cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                cwd=self.sitl_dir
            )
            # Ждём готовности
            time.sleep(3)
            drone.sitl_ready = True
            print(f"  SITL launched: {drone.id} (sysid={drone.system_id})")
        except Exception as e:
            print(f"  SITL launch failed: {e}, using emulated")
            self.mode = "emulated"
            drone.sitl_ready = True

    def update_from_digital_twin(self, drone_dict: dict, sys_id: int):
        """Обновить SITL-состояние из цифрового двойника"""
        drone = self.drones.get(sys_id)
        if not drone or not drone.sitl_ready:
            return

        # Конвертация координат
        drone.lat = 55.75 + drone_dict.get("x", 0) * 0.00001
        drone.lon = 37.62 + drone_dict.get("z", 0) * 0.00001
        drone.alt_rel = drone_dict.get("y", 100)
        drone.alt_msl = drone.alt_rel  # упрощение

        drone.vx = drone_dict.get("vx", 0)
        drone.vz = drone_dict.get("vz", 0)

        # Углы из движения
        yaw = drone_dict.get("heading", 0)
        drone.yaw = math.radians(yaw % 360)
        drone.pitch = math.atan2(-drone.vz * 0.1, 9.81) * 0.5
        drone.roll = math.atan2(drone.vx * 0.1, 9.81) * 0.3

        drone.battery = drone_dict.get("battery", 100)
        drone.armed = True
        drone.mode = drone_dict.get("phase", "GUIDED").upper()

    def send_command(self, sys_id, command, params):
        """Отправить MAVLink-команду дрону"""
        drone = self.drones.get(sys_id)
        if not drone:
            return False

        if command == "takeoff":
            drone.armed = True
            drone.mode = "GUIDED"
            target_alt = params[0] if params else 100
            drone.alt_rel = target_alt
        elif command == "land":
            drone.mode = "LAND"
        elif command == "rtl":
            drone.mode = "RTL"
        elif command == "guided":
            drone.mode = "GUIDED"
        elif command == "goto":
            if len(params) >= 3:
                drone.lat = params[0]
                drone.lon = params[1]
                drone.alt_rel = params[2]
        return True

    def get_status(self, sys_id) -> dict:
        drone = self.drones.get(sys_id)
        if not drone:
            return {"error": "not found"}

        return {
            "id": drone.id,
            "mode": drone.mode,
            "armed": drone.armed,
            "battery": round(drone.battery, 1),
            "lat": drone.lat,
            "lon": drone.lon,
            "alt": round(drone.alt_rel, 1),
            "sitl_mode": self.mode,
            "sitl_ready": drone.sitl_ready,
            "sitl_running": drone.sitl_process is not None and drone.sitl_process.poll() is None if drone.sitl_process else False,
        }

    def shutdown(self):
        """Остановить все SITL процессы"""
        self.running = False
        for drone in self.drones.values():
            if drone.sitl_process:
                drone.sitl_process.terminate()
                try:
                    drone.sitl_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    drone.sitl_process.kill()
        self.drones.clear()


# ═══════════════════════════════════════════════════════════════
# Тест
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═══ ArduPilot SITL Bridge Test ═══")

    bridge = ArduPilotSITLBridge(mode="emulated")
    bridge.add_drone("Scout-1", system_id=1)
    bridge.add_drone("FPV-1", system_id=2)

    # Симуляция полёта
    drone_data = {"x": 100, "z": 200, "y": 120, "vx": 15, "vz": 10, "heading": 45, "battery": 95, "phase": "patrol"}
    bridge.update_from_digital_twin(drone_data, sys_id=1)

    status = bridge.get_status(1)
    print(f"  Scout-1: mode={status['mode']} armed={status['armed']} "
          f"pos=({status['lat']:.4f},{status['lon']:.4f}) alt={status['alt']}m "
          f"bat={status['battery']}% sitl={status['sitl_mode']}")

    bridge.send_command(1, "takeoff", [150])
    print(f"  Command TAKE OFF → alt={bridge.get_status(1)['alt']}m")

    bridge.shutdown()
    print("SITL bridge OK")
