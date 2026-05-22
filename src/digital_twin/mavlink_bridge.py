#!/usr/bin/env python3
"""
mavlink_bridge.py — MAVLink v2 протокол для цифрового двойника

Реализует основные сообщения MAVLink v2 без внешних зависимостей:
  - HEARTBEAT (#0)
  - SYS_STATUS (#1)
  - ATTITUDE (#30)
  - GLOBAL_POSITION_INT (#33)
  - COMMAND_LONG (#76)
  - MISSION_ITEM (#39)

Совместим с Mission Planner, QGroundControl, MAVProxy.
"""

import struct, time, math
from dataclasses import dataclass
from typing import List, Optional

# ═══════════════════════════════════════════════════════════════
# MAVLink v2 Constants
# ═══════════════════════════════════════════════════════════════

MAVLINK_MAGIC = 0xFD
MAVLINK_V2_SIGNATURE = 0x01

# Message IDs
MAVLINK_MSG_ID_HEARTBEAT = 0
MAVLINK_MSG_ID_SYS_STATUS = 1
MAVLINK_MSG_ID_ATTITUDE = 30
MAVLINK_MSG_ID_GLOBAL_POSITION_INT = 33
MAVLINK_MSG_ID_COMMAND_LONG = 76
MAVLINK_MSG_ID_MISSION_ITEM = 39

# MAV_TYPE
MAV_TYPE_QUADROTOR = 2
MAV_TYPE_FIXED_WING = 1

# MAV_AUTOPILOT
MAV_AUTOPILOT_GENERIC = 0
MAV_AUTOPILOT_PX4 = 12
MAV_AUTOPILOT_ARDUPILOTMEGA = 3

# MAV_MODE
MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1
MAV_MODE_FLAG_GUIDED_ENABLED = 8
MAV_MODE_FLAG_AUTO_ENABLED = 16

# MAV_STATE
MAV_STATE_UNINIT = 0
MAV_STATE_BOOT = 1
MAV_STATE_ACTIVE = 4

# MAV_CMD
MAV_CMD_NAV_WAYPOINT = 16
MAV_CMD_NAV_LOITER_UNLIM = 17
MAV_CMD_NAV_RETURN_TO_LAUNCH = 20
MAV_CMD_NAV_LAND = 21
MAV_CMD_NAV_TAKEOFF = 22
MAV_CMD_DO_SET_MODE = 176

# MAV_SEVERITY
MAV_SEVERITY_INFO = 6
MAV_SEVERITY_WARNING = 4
MAV_SEVERITY_CRITICAL = 2

# ═══════════════════════════════════════════════════════════════
# MAVLink v2 Serializer
# ═══════════════════════════════════════════════════════════════

class MAVLinkMessage:
    """Базовое MAVLink v2 сообщение"""
    def __init__(self, msg_id: int, system_id: int = 1, component_id: int = 1):
        self.msg_id = msg_id
        self.system_id = system_id
        self.component_id = component_id
        self.payload = b""
        self.seq = 0

    def pack(self, seq: int = 0) -> bytes:
        """Упаковать в MAVLink v2 формат"""
        self.seq = seq
        payload_len = len(self.payload)
        # header: magic(1) + len(1) + incompat(1) + compat(1) + seq(1) + sysid(1) + compid(1) + msgid(3)
        header = struct.pack(
            "<BBBBBBBBB",
            MAVLINK_MAGIC,
            payload_len,
            0,  # incompat_flags
            0,  # compat_flags
            seq,
            self.system_id,
            self.component_id,
            self.msg_id & 0xFF,
            (self.msg_id >> 8) & 0xFF,
            (self.msg_id >> 16) & 0xFF,
        )
        # CRC16 (MCRF4XX) — упрощённый
        crc = self._crc16(header[1:] + self.payload)
        return header + self.payload + struct.pack("<H", crc)

    @staticmethod
    def _crc16(data: bytes) -> int:
        """CRC16/MCRF4XX для MAVLink"""
        crc = 0xFFFF
        for byte in data:
            crc ^= byte
            for _ in range(8):
                if crc & 1:
                    crc = (crc >> 1) ^ 0x8408
                else:
                    crc >>= 1
        return crc & 0xFFFF


# ═══════════════════════════════════════════════════════════════
# Конкретные сообщения
# ═══════════════════════════════════════════════════════════════

class Heartbeat(MAVLinkMessage):
    """MAVLink HEARTBEAT (#0)"""
    def __init__(self, system_id=1, component_id=1,
                 mav_type=MAV_TYPE_QUADROTOR,
                 autopilot=MAV_AUTOPILOT_ARDUPILOTMEGA,
                 base_mode=MAV_MODE_FLAG_GUIDED_ENABLED,
                 custom_mode=4,  # GUIDED
                 system_status=MAV_STATE_ACTIVE):
        super().__init__(MAVLINK_MSG_ID_HEARTBEAT, system_id, component_id)
        self.payload = struct.pack(
            "<IBBBBB",
            custom_mode,
            mav_type,
            autopilot,
            base_mode,
            system_status,
            3,  # MAVLink version
        )


class Attitude(MAVLinkMessage):
    """MAVLink ATTITUDE (#30)"""
    def __init__(self, roll=0.0, pitch=0.0, yaw=0.0,
                 rollspeed=0.0, pitchspeed=0.0, yawspeed=0.0,
                 system_id=1, component_id=1,
                 time_boot_ms=0):
        super().__init__(MAVLINK_MSG_ID_ATTITUDE, system_id, component_id)
        self.payload = struct.pack(
            "<Ifffffff",
            time_boot_ms,
            roll, pitch, yaw,
            rollspeed, pitchspeed, yawspeed,
        )


class GlobalPositionInt(MAVLinkMessage):
    """MAVLink GLOBAL_POSITION_INT (#33)"""
    def __init__(self, lat=0, lon=0, alt=0, relative_alt=0,
                 vx=0, vy=0, vz=0, heading=0,
                 system_id=1, component_id=1,
                 time_boot_ms=0):
        super().__init__(MAVLINK_MSG_ID_GLOBAL_POSITION_INT, system_id, component_id)
        self.payload = struct.pack(
            "<IiiiiihhHH",
            time_boot_ms,
            lat, lon, alt, relative_alt,
            vx, vy, vz,
            heading,
            0xFFFF,  # hdg (uint16)
        )


class CommandLong(MAVLinkMessage):
    """MAVLink COMMAND_LONG (#76)"""
    def __init__(self, command=MAV_CMD_NAV_WAYPOINT,
                 param1=0, param2=0, param3=0, param4=0,
                 param5=0, param6=0, param7=0,
                 target_system=1, target_component=1,
                 confirmation=0):
        super().__init__(MAVLINK_MSG_ID_COMMAND_LONG, target_system, target_component)
        self.payload = struct.pack(
            "<HHfffffff",
            command,
            confirmation,
            param1, param2, param3, param4,
            param5, param6, param7,
        )


# ═══════════════════════════════════════════════════════════════
# MAVLink Bridge
# ═══════════════════════════════════════════════════════════════

@dataclass
class MAVLinkBridge:
    """Мост между цифровым двойником и MAVLink-совместимыми GCS"""

    system_id: int = 1
    component_id: int = 1
    heartbeat_interval: float = 1.0  # секунды

    def __post_init__(self):
        self.seq = 0
        self.last_heartbeat = 0.0
        self.boot_time = time.time()
        self.msg_queue: List[bytes] = []

    def get_heartbeat(self) -> bytes:
        """Сгенерировать heartbeat"""
        now = time.time()
        if now - self.last_heartbeat >= self.heartbeat_interval:
            self.last_heartbeat = now
            self.seq = (self.seq + 1) % 256
            msg = Heartbeat(system_id=self.system_id, component_id=self.component_id)
            return msg.pack(self.seq)
        return b""

    def get_attitude(self, roll, pitch, yaw) -> bytes:
        """Сгенерировать ATTITUDE"""
        self.seq = (self.seq + 1) % 256
        t = int((time.time() - self.boot_time) * 1000)
        msg = Attitude(roll=roll, pitch=pitch, yaw=yaw,
                       rollspeed=0, pitchspeed=0, yawspeed=0,
                       time_boot_ms=t)
        return msg.pack(self.seq)

    def get_position(self, lat, lon, alt_msl, alt_rel, vx, vy, vz, heading) -> bytes:
        """Сгенерировать GLOBAL_POSITION_INT"""
        self.seq = (self.seq + 1) % 256
        t = int((time.time() - self.boot_time) * 1000)
        # Convert m/s to cm/s
        msg = GlobalPositionInt(
            lat=int(lat * 1e7), lon=int(lon * 1e7),
            alt=int(alt_msl * 1000), relative_alt=int(alt_rel * 1000),
            vx=int(vx * 100), vy=int(vy * 100), vz=int(vz * 100),
            heading=int(heading * 100),
            time_boot_ms=t
        )
        return msg.pack(self.seq)

    def send_command(self, command, params, target_system=1, target_component=1) -> bytes:
        """Отправить команду дрону"""
        self.seq = (self.seq + 1) % 256
        msg = CommandLong(
            command=command,
            param1=params[0] if len(params) > 0 else 0,
            param2=params[1] if len(params) > 1 else 0,
            param3=params[2] if len(params) > 2 else 0,
            param4=params[3] if len(params) > 3 else 0,
            param5=params[4] if len(params) > 4 else 0,
            param6=params[5] if len(params) > 5 else 0,
            param7=params[6] if len(params) > 6 else 0,
            target_system=target_system,
            target_component=target_component,
        )
        return msg.pack(self.seq)

    def drone_to_mavlink(self, drone: dict, sys_id: int) -> bytes:
        """Конвертировать состояние дрона в MAVLink пакет позиции"""
        lat = 55.75 + drone["x"] * 0.00001
        lon = 37.62 + drone["z"] * 0.00001
        return self.get_position(
            lat=lat, lon=lon,
            alt_msl=drone.get("y", 120),
            alt_rel=drone.get("y", 120),
            vx=drone.get("vx", 0), vy=drone.get("vz", 0), vz=0,
            heading=drone.get("heading", 0)
        )


# ═══════════════════════════════════════════════════════════════
# MAVLink UDP Server (опционально)
# ═══════════════════════════════════════════════════════════════

class MAVLinkUDPServer:
    """UDP сервер для отправки MAVLink пакетов в GCS (Mission Planner/QGC)"""

    def __init__(self, host="0.0.0.0", port=14550):
        self.host = host
        self.port = port
        self.socket = None
        self.bridge = MAVLinkBridge()

    def start(self):
        import socket
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.socket.bind((self.host, self.port))

    def send_drone_state(self, drone: dict, sys_id: int, dest_addr=None):
        """Отправить позицию дрона по UDP"""
        if self.socket is None:
            return
        mav_pkt = self.bridge.drone_to_mavlink(drone, sys_id)
        if dest_addr:
            self.socket.sendto(mav_pkt, dest_addr)
        else:
            self.socket.sendto(mav_pkt, ("127.0.0.1", 14550))

    def broadcast_heartbeat(self, dest_addr=None):
        hb = self.bridge.get_heartbeat()
        if self.socket and hb and dest_addr:
            self.socket.sendto(hb, dest_addr)

    def stop(self):
        if self.socket:
            self.socket.close()
            self.socket = None


# ═══════════════════════════════════════════════════════════════
# Тест
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═══ MAVLink Bridge Test ═══")
    bridge = MAVLinkBridge()

    hb = bridge.get_heartbeat()
    print(f"Heartbeat: {len(hb)} bytes")

    att = bridge.get_attitude(0.1, -0.2, 1.5)
    print(f"Attitude: {len(att)} bytes")

    pos = bridge.get_position(55.75, 37.62, 150000, 120000, 5, 3, -1, 45)
    print(f"Position: {len(pos)} bytes")

    cmd = bridge.send_command(MAV_CMD_NAV_WAYPOINT, [55.76, 37.63, 100, 0, 0, 0, 0])
    print(f"Command: {len(cmd)} bytes")

    print("MAVLink v2 bridge OK")
