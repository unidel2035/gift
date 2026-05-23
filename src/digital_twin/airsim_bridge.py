#!/usr/bin/env python3
"""
airsim_bridge.py — Мост между нашим роем и AirSim протоколом

Два режима:
  1. REAL: подключается к настоящему AirSim (Windows .exe)
  2. EMULATED: наш рой притворяется AirSim (для тестов без UE)

AirSim RPC API (через msgpack):
  - getMultirotorState()
  - moveToPositionAsync()
  - moveByVelocityAsync()
  - hoverAsync()
  - takeoffAsync()
  - landAsync()
  - getImages()
  - simSetCameraOrientation()

Наш рой ↔ AirSim API — один интерфейс, два бэкенда.
"""

import math, time, json, struct, socket, threading
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass

# ═══════════════════════════════════════════════════════════════
# AIRSIM-СОВМЕСТИМЫЙ ИНТЕРФЕЙС
# ═══════════════════════════════════════════════════════════════

@dataclass
class AirSimState:
    """Состояние дрона в формате AirSim"""
    # Кинематика
    x: float = 0; y: float = 0; z: float = 0
    vx: float = 0; vy: float = 0; vz: float = 0
    ax: float = 0; ay: float = 0; az: float = 0
    # Ориентация (кватернион)
    qw: float = 1; qx: float = 0; qy: float = 0; qz: float = 0
    # Угловые скорости
    roll_rate: float = 0; pitch_rate: float = 0; yaw_rate: float = 0
    # Состояние
    landed: bool = True
    collision: bool = False
    timestamp: int = 0

    def to_dict(self):
        return {
            "kinematics_estimated": {
                "position": {"x_val": self.x, "y_val": self.y, "z_val": self.z},
                "linear_velocity": {"x_val": self.vx, "y_val": self.vy, "z_val": self.vz},
                "linear_acceleration": {"x_val": self.ax, "y_val": self.ay, "z_val": self.az},
                "orientation": {"w_val": self.qw, "x_val": self.qx, "y_val": self.qy, "z_val": self.qz},
                "angular_velocity": {"x_val": self.roll_rate, "y_val": self.pitch_rate, "z_val": self.yaw_rate},
            },
            "landed_state": 0 if self.landed else 1,
            "collision": {"has_collided": self.collision},
            "timestamp": self.timestamp,
        }


class AirSimBridge:
    """
    Универсальный мост: работает и с реальным AirSim, и с нашим роем.
    """

    def __init__(self, mode="emulated", airsim_host="127.0.0.1", airsim_port=41451):
        self.mode = mode  # "emulated" or "real"
        self.host = airsim_host
        self.port = airsim_port
        self.connected = False
        self.drones: Dict[str, AirSimState] = {}
        self._sock = None
        self._rpc_id = 0

    def connect(self):
        if self.mode == "real":
            try:
                self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self._sock.settimeout(5)
                self._sock.connect((self.host, self.port))
                self.connected = True
                print(f"Connected to AirSim at {self.host}:{self.port}")
            except Exception as e:
                print(f"AirSim not available: {e}, falling back to emulated")
                self.mode = "emulated"
                self.connected = True
        else:
            self.connected = True

    def _rpc_call(self, method: str, args: dict = None) -> dict:
        """Вызов AirSim RPC (упрощённый JSON вместо msgpack для совместимости)"""
        self._rpc_id += 1
        request = {
            "id": self._rpc_id,
            "method": method,
            "params": args or {},
        }
        if self._sock:
            body = json.dumps(request).encode()
            self._sock.send(struct.pack("<I", len(body)) + body)
            size = struct.unpack("<I", self._sock.recv(4))[0]
            return json.loads(self._sock.recv(size))
        return {"error": "not connected"}

    # ═══ AIRSIM API ═══════════════════════════════════════

    def getMultirotorState(self, drone_name="Drone1"):
        if self.mode == "real":
            return self._rpc_call("getMultirotorState", {"vehicle_name": drone_name})
        state = self.drones.get(drone_name, AirSimState())
        return state.to_dict()

    def moveToPositionAsync(self, x, y, z, velocity=5, drone_name="Drone1",
                           yaw_mode=None, lookahead=-1, adaptive_lookahead=1):
        if yaw_mode is None:
            yaw_mode = {"is_rate": False, "yaw_or_rate": 0}
        if self.mode == "real":
            return self._rpc_call("moveToPositionAsync", {
                "x": x, "y": y, "z": z, "velocity": velocity,
                "vehicle_name": drone_name, "yaw_mode": yaw_mode,
                "lookahead": lookahead, "adaptive_lookahead": adaptive_lookahead,
            })
        # Emulated: просто обновить цель
        return {"status": "ok", "path": [(x, y, z)]}

    def moveByVelocityAsync(self, vx, vy, vz, duration, drone_name="Drone1"):
        if self.mode == "real":
            return self._rpc_call("moveByVelocityAsync", {
                "vx": vx, "vy": vy, "vz": vz, "duration": duration,
                "vehicle_name": drone_name,
            })
        state = self.drones.get(drone_name)
        if state and duration > 0:
            state.vx, state.vy, state.vz = vx, vy, vz
        return {"status": "ok"}

    def hoverAsync(self, drone_name="Drone1"):
        return self.moveByVelocityAsync(0, 0, 0, 1, drone_name)

    def takeoffAsync(self, timeout_sec=10, drone_name="Drone1"):
        if drone_name in self.drones:
            self.drones[drone_name].landed = False
        return {"status": "ok"}

    def landAsync(self, timeout_sec=10, drone_name="Drone1"):
        if drone_name in self.drones:
            self.drones[drone_name].landed = True
        return {"status": "ok"}

    def getImages(self, camera_name="0", image_type=0, pixels_as_float=False,
                  vehicle_name="Drone1", external=False):
        """Запрос изображения с камеры (эмулируется через наш camera_streams)"""
        # В эмуляции возвращаем ссылку на наш MJPEG стрим
        return {
            "status": "ok",
            "image_url": f"http://localhost:8110/camera/{vehicle_name}/snapshot",
            "stream_url": f"http://localhost:8110/camera/{vehicle_name}/stream",
        }

    def simSetCameraOrientation(self, camera_name, orientation, vehicle_name=""):
        return {"status": "ok"}

    # ═══ ИНТЕГРАЦИЯ С НАШИМ РОЕМ ═══════════════════════════

    def swarm_to_airsim(self, drone_id: str, drone_data: dict):
        """Обновить AirSim-состояние из нашего дрона"""
        state = self.drones.get(drone_id, AirSimState())
        state.x = drone_data.get("x", 0)
        state.y = drone_data.get("y", 100)
        state.z = drone_data.get("z", 0)
        state.vx = drone_data.get("vx", 0)
        state.vy = 0
        state.vz = drone_data.get("vz", 0)
        heading = drone_data.get("heading", 0)
        # Euler → quaternion (yaw only)
        half_yaw = math.radians(heading) / 2
        state.qw = math.cos(half_yaw)
        state.qx = 0
        state.qy = 0
        state.qz = math.sin(half_yaw)
        state.landed = drone_data.get("phase", "") == "land"
        state.timestamp = int(time.time() * 1e9)
        self.drones[drone_id] = state

    def get_swarm_as_airsim(self, swarm_data: dict) -> List[dict]:
        """Конвертировать весь рой в формат AirSim"""
        result = []
        for drone in swarm_data.get("drones", []):
            self.swarm_to_airsim(drone["id"], drone)
            result.append({
                "name": drone["id"],
                "state": self.drones[drone["id"]].to_dict(),
                "role": drone.get("role", "?"),
            })
        return result

    def execute_llm_command(self, drone_name: str, llm_decision: dict):
        """Исполнить LLM-решение через AirSim API"""
        action = llm_decision.get("action", "patrol")

        if action == "attack":
            target = llm_decision.get("target", {})
            tx, tz = target.get("x", 0), target.get("z", 0)
            return self.moveToPositionAsync(tx, 80, tz, velocity=15, drone_name=drone_name)
        elif action == "rtb":
            return self.moveToPositionAsync(0, 5, 0, velocity=10, drone_name=drone_name)
        elif action == "patrol":
            state = self.drones.get(drone_name, AirSimState())
            return self.moveToPositionAsync(
                state.x + 100, state.y, state.z + 100,
                velocity=8, drone_name=drone_name
            )
        return self.hoverAsync(drone_name)


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════╗")
    print("║  AIRSIM BRIDGE — Swarm ↔ AirSim Protocol    ║")
    print("╚══════════════════════════════════════════════╝")
    print()

    bridge = AirSimBridge(mode="emulated")
    bridge.connect()
    print(f"Mode: {bridge.mode} | Connected: {bridge.connected}")

    # Тест API
    bridge.takeoffAsync(drone_name="Scout-1")
    bridge.moveToPositionAsync(500, 150, 300, velocity=10, drone_name="Scout-1")

    # Эмуляция дрона
    bridge.swarm_to_airsim("Scout-1", {
        "x": 200, "y": 150, "z": 300, "vx": 15, "vz": 10, "heading": 45
    })
    state = bridge.getMultirotorState("Scout-1")
    pos = state["kinematics_estimated"]["position"]
    print(f"Scout-1: ({pos['x_val']:.0f}, {pos['y_val']:.0f}, {pos['z_val']:.0f})")
    print(f"Camera: {bridge.getImages(vehicle_name='Scout-1')['stream_url']}")

    # LLM-команда через AirSim API
    result = bridge.execute_llm_command("Scout-1", {"action": "patrol"})
    print(f"LLM command: {result}")

    print("\nBridge ready for AirSim integration.")
