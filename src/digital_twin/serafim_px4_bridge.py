#!/usr/bin/env python3
"""
serafim_px4_bridge.py — Serafim + Суворов → PX4 + Gazebo

Полный игровой цикл:
  Serafim (LLM) → MAVSDK/PX4 → Gazebo → дрон летит в 3D-мире

Требования: PX4-Autopilot + Gazebo (или jMAVSim)

Запуск:
  1. Terminal 1: make px4_sitl gazebo   (или jmavsim)
  2. Terminal 2: python3 serafim_px4_bridge.py --connect udp://:14540

Архитектура:
  ┌──────────┐   MAVLink    ┌──────────┐   Physics   ┌──────────┐
  │ Serafim  │◄────────────►│ PX4      │◄──────────►│ Gazebo   │
  │ (LLM)    │   :14540     │ (SITL)   │   :14560    │ (3D мир) │
  └──────────┘              └──────────┘             └──────────┘
"""

import math, time, json, sys, os, struct, threading
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from collections import deque

sys.path.insert(0, os.path.dirname(__file__))
from serafim_agent import SerafimAgent, TacticalSituation
from suvorov_tactics import SUVOROV_SYSTEM_PROMPT, apply_suvorov_rules


# ═══════════════════════════════════════════════════════════════
# MAVLINK (лёгкий, без pymavlink)
# ═══════════════════════════════════════════════════════════════

MAVLINK_MAGIC = 0xFD

def mav_crc(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= (b << 8)
        for _ in range(8):
            crc = (crc << 1) ^ 0x1021 if crc & 0x8000 else crc << 1
    return crc & 0xFFFF

def mav_pack(msg_id: int, payload: bytes, sys_id=1, comp_id=1, seq=0) -> bytes:
    """Упаковать MAVLink v2 сообщение."""
    h = struct.pack('<BBBBBB', MAVLINK_MAGIC, len(payload), 0, 0, seq, sys_id)
    h += struct.pack('<BB', comp_id, msg_id)
    crc = mav_crc(h[1:] + payload)
    return h + payload + struct.pack('<H', crc)


# ═══════════════════════════════════════════════════════════════
# PX4 BRIDGE
# ═══════════════════════════════════════════════════════════════

@dataclass
class PX4State:
    """Состояние PX4 дрона."""
    armed: bool = False
    mode: str = "MANUAL"
    lat: float = 47.397742; lon: float = 8.545594; alt: float = 488.0
    alt_rel: float = 0.0
    vx: float = 0; vy: float = 0; vz: float = 0
    roll: float = 0; pitch: float = 0; yaw: float = 0
    battery: float = 100
    gps_fix: int = 3
    satellites: int = 12
    connected: bool = False
    heartbeat_count: int = 0


class PX4Bridge:
    """Мост к PX4 SITL через MAVLink UDP/TCP."""

    def __init__(self, connection_string: str = "udp://:14540"):
        import socket
        self.conn_str = connection_string
        self.state = PX4State()
        self.sock = None
        self.seq = 0

        # Парсить connection string
        self._parse_conn_str()

    def _parse_conn_str(self):
        cs = self.conn_str
        if cs.startswith("udp://"):
            host_part = cs[6:]
            if host_part.startswith(":"):
                self.host = "127.0.0.1"
                self.port = int(host_part[1:])
            else:
                parts = host_part.split(":")
                self.host = parts[0]
                self.port = int(parts[1]) if len(parts) > 1 else 14550
            self._is_udp = True
        elif cs.startswith("tcp://"):
            host_part = cs[6:]
            self.host, port_str = host_part.split(":") if ":" in host_part else (host_part, "5760")
            self.port = int(port_str)
            self._is_udp = False
        else:
            self.host = "127.0.0.1"
            self.port = 14540
            self._is_udp = True

    def connect(self) -> bool:
        """Подключиться к PX4."""
        import socket
        try:
            if self._is_udp:
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self.sock.settimeout(0.5)
                self.sock.bind(("0.0.0.0", 0))
                self.sock.connect((self.host, self.port))
            else:
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self.sock.settimeout(0.5)
                self.sock.connect((self.host, self.port))

            self.state.connected = True
            print(f"PX4 connected: {self.host}:{self.port}")

            # Поток чтения
            def reader():
                while self.state.connected:
                    try:
                        data = self.sock.recv(4096)
                        self._parse_mavlink(data)
                    except socket.timeout:
                        pass
                    except:
                        break

            t = threading.Thread(target=reader, daemon=True)
            t.start()

            # Ждать первый heartbeat
            for _ in range(30):
                time.sleep(0.3)
                if self.state.heartbeat_count > 0:
                    print(f"PX4 heartbeat received: mode={self.state.mode}")
                    return True
            return True
        except Exception as e:
            print(f"PX4 connect error: {e}")
            return False

    def _parse_mavlink(self, data: bytes):
        """Разобрать MAVLink-пакет."""
        if len(data) < 10:
            return
        i = 0
        while i < len(data) - 5:
            if data[i] == MAVLINK_MAGIC:
                payload_len = data[i+1]
                if i + payload_len + 12 <= len(data):
                    msg_id = data[i+7]
                    payload = data[i+10:i+10+payload_len]
                    self._handle_msg(msg_id, payload)
                    i += payload_len + 12
                else:
                    break
            else:
                i += 1

    def _handle_msg(self, msg_id: int, payload: bytes):
        if msg_id == 0 and len(payload) >= 5:  # HEARTBEAT
            self.state.heartbeat_count += 1
            self.state.mode = f"MODE{payload[0]}"
            self.state.armed = (payload[1] & 0x80) != 0

        elif msg_id == 33 and len(payload) >= 28:  # GLOBAL_POSITION_INT
            self.state.lat = struct.unpack_from('<i', payload, 4)[0] / 1e7
            self.state.lon = struct.unpack_from('<i', payload, 8)[0] / 1e7
            self.state.alt = struct.unpack_from('<i', payload, 12)[0] / 1000.0
            self.state.alt_rel = struct.unpack_from('<i', payload, 16)[0] / 1000.0
            self.state.vx = struct.unpack_from('<h', payload, 20)[0] / 100.0
            self.state.vy = struct.unpack_from('<h', payload, 22)[0] / 100.0
            self.state.vz = struct.unpack_from('<h', payload, 24)[0] / 100.0

        elif msg_id == 30 and len(payload) >= 28:  # ATTITUDE
            self.state.roll = struct.unpack_from('<f', payload, 4)[0]
            self.state.pitch = struct.unpack_from('<f', payload, 8)[0]
            self.state.yaw = struct.unpack_from('<f', payload, 12)[0]

    def send(self, msg_id: int, payload: bytes):
        if self.sock:
            msg = mav_pack(msg_id, payload, seq=self.seq)
            self.seq = (self.seq + 1) % 256
            try:
                self.sock.send(msg)
            except:
                pass

    def arm(self):
        self.send(76, struct.pack('<fffffffHHBB',
            1.0, 0, 0, 0, 0, 0, 0, 400, 1, 1, 0))

    def disarm(self):
        self.send(76, struct.pack('<fffffffHHBB',
            0.0, 0, 0, 0, 0, 0, 0, 400, 1, 1, 0))

    def takeoff(self, alt=50.0):
        self.send(76, struct.pack('<fffffffHHBB',
            0, 0, 0, 0, 0, 0, alt, 22, 1, 1, 0))

    def land(self):
        self.send(76, struct.pack('<fffffffHHBB',
            0, 0, 0, 0, 0, 0, 0, 21, 1, 1, 0))

    def set_mode(self, mode_name: str = "AUTO.LOITER"):
        # MAV_CMD_DO_SET_MODE = 176
        # mode mapping is complex - simplified
        self.send(76, struct.pack('<fffffffHHBB',
            1, 4, 0, 0, 0, 0, 0, 176, 1, 1, 0))

    def goto(self, lat: float, lon: float, alt: float):
        """Лететь к точке."""
        self.send(76, struct.pack('<fffffffHHBB',
            0, 0, 0, 0, lat, lon, alt, 16, 1, 1, 0))

    def close(self):
        self.state.connected = False
        if self.sock:
            self.sock.close()


# ═══════════════════════════════════════════════════════════════
# Serafim + Суворов → PX4
# ═══════════════════════════════════════════════════════════════

class SerafimPX4:
    """
    Serafim + Суворов управляют PX4 дроном в Gazebo.
    """

    def __init__(self, connection_string: str = "udp://:14540"):
        self.px4 = PX4Bridge(connection_string)
        self.serafim = SerafimAgent("px4-1", "РАЗВ", "blue")
        self.tick_count = 0
        self.last_decision = None
        self.mission_active = False
        self.log: deque = deque(maxlen=200)

        # Виртуальные цели в мире Gazebo
        self.targets = [
            {"id": "T1", "role": "танк", "lat": 47.3980, "lon": 8.5460, "destroyed": False},
            {"id": "T2", "role": "РЭБ", "lat": 47.3970, "lon": 8.5440, "destroyed": False},
            {"id": "T3", "role": "опорник", "lat": 47.3985, "lon": 8.5470, "destroyed": False},
        ]

    def connect(self) -> bool:
        return self.px4.connect()

    def start_mission(self):
        """Взлёт и автономная миссия."""
        self.px4.set_mode("AUTO.LOITER")
        time.sleep(1)
        self.px4.arm()
        time.sleep(2)
        self.px4.takeoff(alt=100)
        self.mission_active = True
        self.log.append("🚀 Миссия начата: Serafim + Суворов → PX4 + Gazebo")
        print("🚀 Миссия начата")

    def tick(self) -> dict:
        """Один цикл: читаем PX4 → Serafim решает → отправляем команду."""
        self.tick_count += 1
        state = self.px4.state

        if not self.mission_active or not state.armed:
            return {"tick": self.tick_count, "px4": state.__dict__, "decision": None}

        # Каждые 3 секунды — решение
        if self.tick_count % 30 == 0:
            self._decide(state)

        self._execute(state)

        return {
            "tick": self.tick_count,
            "px4": state.__dict__,
            "decision": self.last_decision.action.value if self.last_decision and hasattr(self.last_decision, 'action') else None,
            "targets": [{"id": t["id"], "role": t["role"], "destroyed": t["destroyed"]} for t in self.targets],
        }

    def _decide(self, state: PX4State):
        """Serafim + Суворов принимают решение."""
        active = [t for t in self.targets if not t["destroyed"]]
        if not active:
            self.last_decision = None
            self.log.append("🏁 Все цели уничтожены!")
            return

        # Суворовская приоритезация
        suvorov = apply_suvorov_rules(
            [{"role": t["role"], "dist_m": 500} for t in active],
            battery=state.battery,
            enemies_alive=len(active),
        )

        # Serafim
        sit = TacticalSituation(
            agent_id="px4-1", agent_role="РАЗВ", agent_team="blue",
            x=state.lat, y=state.alt_rel, z=state.lon,
            battery_pct=state.battery,
            heading_deg=math.degrees(state.yaw),
            enemies=[{"id": t["id"], "role": t["role"], "dist_m": 500} for t in active[:3]],
            nearest_enemy_dist=500,
            enemies_alive=len(active),
            mission_phase="attack",
        )

        try:
            self.last_decision = self.serafim.decide_sync(sit, timeout_s=5)
            sv_advice = suvorov['reason']
            self.log.append(f"🤖 Serafim: {self.last_decision.action.value.upper()} | Суворов: {sv_advice[:60]}")
        except:
            self.last_decision = None

    def _execute(self, state: PX4State):
        """Выполнить решение через PX4."""
        if not self.last_decision:
            return

        action = self.last_decision.action.value
        active = [t for t in self.targets if not t["destroyed"]]

        if action == "attack" and active:
            target = active[0]
            self.px4.goto(target["lat"], target["lon"], 80)

            # Проверка попадания
            dist = math.sqrt((state.lat - target["lat"])**2 + (state.lon - target["lon"])**2)
            if dist < 0.0002:  # ~20 метров
                target["destroyed"] = True
                self.log.append(f"💥 {target['role']} уничтожен! Суворов: натиск!")

        elif action == "rtb":
            self.px4.goto(47.397742, 8.545594, 100)
            dist_home = math.sqrt((state.lat - 47.397742)**2 + (state.lon - 8.545594)**2)
            if dist_home < 0.0001 and state.alt_rel < 5:
                self.px4.land()
                self.log.append("🛬 Посадка. Миссия завершена.")

    def land(self):
        self.px4.land()
        self.mission_active = False

    def close(self):
        self.px4.close()


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description="Serafim + Суворов → PX4 + Gazebo")
    p.add_argument("--connect", default="udp://:14540", help="PX4 connection string")
    p.add_argument("--auto", action="store_true", help="Авто-миссия")
    args = p.parse_args()

    print("╔══════════════════════════════════════════════╗")
    print("║  Serafim + Суворов → PX4 + Gazebo           ║")
    print("╚══════════════════════════════════════════════╝")
    print(f"  PX4: {args.connect}")
    print()

    drone = SerafimPX4(args.connect)

    if not drone.connect():
        print("❌ PX4 не отвечает. Запусти сначала:")
        print("   cd ~/PX4-Autopilot && make px4_sitl jmavsim")
        sys.exit(1)

    if args.auto:
        drone.start_mission()
        time.sleep(8)

        for i in range(300):
            state = drone.tick()
            if i % 30 == 0:
                s = state["px4"]
                d = state.get("decision")
                targets_alive = sum(1 for t in drone.targets if not t["destroyed"])
                print(f"  t={state['tick']:4d} | alt={s['alt_rel']:6.1f}m "
                      f"armed={s['armed']} | action={d or '—':8s} | targets={targets_alive}")
                if targets_alive == 0:
                    print("  🏁 Все цели уничтожены!")
                    break
            time.sleep(0.1)

        drone.land()
        time.sleep(3)
        print(f"\nУничтожено: {sum(1 for t in drone.targets if t['destroyed'])}/{len(drone.targets)}")

    else:
        print("Ожидание команд...")
        print("  drone.start_mission()  — взлёт")
        print("  drone.tick()           — цикл управления")
        print("  drone.land()           — посадка")
        try:
            while True:
                time.sleep(1)
                if drone.mission_active:
                    state = drone.tick()
                    if drone.tick_count % 30 == 0:
                        d = state.get("decision")
                        print(f"  t={state['tick']} action={d or '—'}")
        except KeyboardInterrupt:
            print("\nStopped")

    drone.close()
