#!/usr/bin/env python3
"""
serafim_flight.py — Serafim управляет дроном в симуляции

Полный цикл:
  Serafim (LLM) → тактическое решение → FlightController → MAVLink → Физика дрона → Сенсоры

Компоненты:
  drone_twin.py      — 6-DOF физика, сенсоры (камера/IMU/барометр), визуализация :8101
  mavlink_bridge.py  — MAVLink v2 (HEARTBEAT, ATTITUDE, POSITION, COMMAND)
  flight_control.py  — ПИД-контроллер, манёвры, тактические подходы
  serafim_agent.py   — LLM-агент: сенсоры→текст→решение

MAVLink-совместим: можно подключить QGroundControl или Mission Planner.

Запуск:
  python3 src/digital_twin/serafim_flight.py
  Веб: http://localhost:8101

Архитектура:
  ┌──────────┐    ┌──────────────┐    ┌──────────┐    ┌───────────┐
  │ Serafim  │───▶│ FlightCtrl   │───▶│ MAVLink  │───▶│ Physics   │
  │ (LLM)    │◀───│ (PID+mvr)   │◀───│ (v2)     │◀───│ (6-DOF)   │
  └──────────┘    └──────────────┘    └──────────┘    └───────────┘
       │                                                   │
       └─────── Тактическая обстановка ◀────────────────────┘
"""

import math, time, json, threading, sys, os, struct
from http.server import HTTPServer, BaseHTTPRequestHandler
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from collections import deque
from enum import Enum

sys.path.insert(0, os.path.dirname(__file__))

# ═══════════════════════════════════════════════════════════════
# ФИЗИКА ДРОНА (лёгкая 6-DOF)
# ═══════════════════════════════════════════════════════════════

class DroneState:
    """Состояние дрона в 3D."""
    def __init__(self, x=0, y=100, z=0):
        self.x, self.y, self.z = x, y, z
        self.vx, self.vy, self.vz = 0, 0, 0
        self.roll, self.pitch, self.yaw = 0, 0, 0
        self.roll_rate, self.pitch_rate, self.yaw_rate = 0, 0, 0
        self.battery = 100.0
        self.armed = False
        self.mode = "STABILIZE"

        # Моторы (4 шт., 0..1)
        self.motors = [0.0, 0.0, 0.0, 0.0]

        # Физические константы
        self.mass = 1.5           # кг
        self.max_thrust = 30.0    # Н (на все моторы)
        self.drag = 0.3           # коэфф. сопротивления
        self.gravity = 9.81

        # Сенсоры
        self.gps_lat = 55.75
        self.gps_lon = 37.62
        self.gps_alt = 100.0

    def update(self, dt: float, controls: dict = None):
        """Обновить физику за dt секунд."""
        if not self.armed:
            return

        c = controls or {}
        roll_cmd = c.get("roll", 0.0)      # -1..1
        pitch_cmd = c.get("pitch", 0.0)    # -1..1
        yaw_cmd = c.get("yaw", 0.0)       # -1..1
        throttle_cmd = c.get("throttle", 0.5)  # 0..1

        # P-регулятор углов
        target_roll = roll_cmd * 0.5       # макс 30°
        target_pitch = pitch_cmd * 0.5

        roll_err = target_roll - self.roll
        pitch_err = target_pitch - self.pitch

        self.roll_rate += roll_err * 5.0 * dt
        self.pitch_rate += pitch_err * 5.0 * dt
        self.yaw_rate += yaw_cmd * 2.0 * dt

        # Демпфирование
        self.roll_rate *= 0.95
        self.pitch_rate *= 0.95
        self.yaw_rate *= 0.95

        self.roll += self.roll_rate * dt
        self.pitch += self.pitch_rate * dt
        self.yaw += self.yaw_rate * dt

        # Тяга
        thrust = throttle_cmd * self.max_thrust

        # Ускорение в world frame
        cos_r = math.cos(self.roll); sin_r = math.sin(self.roll)
        cos_p = math.cos(self.pitch); sin_p = math.sin(self.pitch)
        cos_y = math.cos(self.yaw); sin_y = math.sin(self.yaw)

        fx = thrust * (-sin_p * cos_y - sin_r * sin_y)
        fy = thrust * (cos_r * cos_p) - self.mass * self.gravity
        fz = thrust * (sin_p * sin_y - sin_r * cos_y)

        ax = fx / self.mass - self.vx * self.drag
        ay = fy / self.mass - self.vy * self.drag
        az = fz / self.mass - self.vz * self.drag

        self.vx += ax * dt
        self.vy += ay * dt
        self.vz += az * dt

        self.x += self.vx * dt
        self.y += self.vy * dt
        self.z += self.vz * dt

        # Ограничения
        self.y = max(0.5, min(500, self.y))
        self.roll = max(-1.0, min(1.0, self.roll))
        self.pitch = max(-1.0, min(1.0, self.pitch))

        # Батарея
        power = abs(throttle_cmd) * 0.05 + 0.01
        self.battery -= power * dt
        self.battery = max(0, self.battery)

        if self.battery <= 0:
            self.armed = False

        # GPS (упрощённо)
        self.gps_lat += self.vx * 1e-5 * dt
        self.gps_lon += self.vz * 1e-5 * dt
        self.gps_alt = self.y

    def arm(self):
        self.armed = True
        self.battery = 100.0

    def disarm(self):
        self.armed = False
        self.motors = [0, 0, 0, 0]


# ═══════════════════════════════════════════════════════════════
# MAVLINK v2 (минимальный)
# ═══════════════════════════════════════════════════════════════

MAVLINK_MAGIC = 0xFD

def mavlink_heartbeat(system_id=1, component_id=1, mav_type=2, autopilot=3,
                      base_mode=81, custom_mode=4, system_status=4):
    """MAVLink v2 HEARTBEAT."""
    payload = struct.pack('<IBBBBBB', custom_mode, mav_type, autopilot,
                          base_mode, system_status, 3, 0)  # MAVLINK_VERSION=3
    msg_id = 0  # HEARTBEAT
    payload_len = len(payload)
    header = struct.pack('<BBBBBB', MAVLINK_MAGIC, payload_len,
                         0, 0, 0, 0)  # incompat=0, compat=0, seq=0, sysid=0
    header += struct.pack('<BB', component_id, msg_id)
    # CRC16 (упрощённый)
    crc = 0xFFFF
    for b in header[1:] + payload:
        crc ^= b << 8
        for _ in range(8):
            crc = (crc << 1) ^ 0x1021 if crc & 0x8000 else crc << 1
    return header + payload + struct.pack('<H', crc & 0xFFFF)

def mavlink_attitude(roll, pitch, yaw, rollspeed=0, pitchspeed=0, yawspeed=0):
    """MAVLink v2 ATTITUDE (#30)."""
    payload = struct.pack('<Iffffff', 0, roll, pitch, yaw, rollspeed, pitchspeed, yawspeed)
    msg_id = 30
    header = struct.pack('<BBBBBB', MAVLINK_MAGIC, len(payload), 0, 0, 0, 0)
    header += struct.pack('<BB', 1, msg_id)
    crc = 0xFFFF
    for b in header[1:] + payload:
        crc ^= b << 8
        for _ in range(8):
            crc = (crc << 1) ^ 0x1021 if crc & 0x8000 else crc << 1
    return header + payload + struct.pack('<H', crc & 0xFFFF)

def mavlink_global_position(lat, lon, alt_msl, alt_rel, vx, vy, vz, hdg):
    """MAVLink v2 GLOBAL_POSITION_INT (#33)."""
    payload = struct.pack('<IiiiiiihhHH', 0,
                          int(lat*1e7), int(lon*1e7), int(alt_msl*1000),
                          int(alt_rel*1000), int(vx*100), int(vy*100), int(vz*100),
                          int(hdg*100), 0xFFFF, 0xFFFF)
    msg_id = 33
    header = struct.pack('<BBBBBB', MAVLINK_MAGIC, len(payload), 0, 0, 0, 0)
    header += struct.pack('<BB', 1, msg_id)
    crc = 0xFFFF
    for b in header[1:] + payload:
        crc ^= b << 8
        for _ in range(8):
            crc = (crc << 1) ^ 0x1021 if crc & 0x8000 else crc << 1
    return header + payload + struct.pack('<H', crc & 0xFFFF)


# ═══════════════════════════════════════════════════════════════
# SERAFIM → УПРАВЛЕНИЕ ДРОНОМ
# ═══════════════════════════════════════════════════════════════

class SerafimFlightController:
    """
    Serafim управляет дроном в симуляции.

    Цикл: читает сенсоры → Serafim решает → ПИД исполняет → физика обновляется.
    """

    def __init__(self, drone_id="drone-1"):
        self.drone = DroneState()
        self.drone_id = drone_id
        self.tick_count = 0
        self.dt = 0.1  # 10 Гц

        # Serafim агент
        from serafim_agent import SerafimAgent
        self.serafim = SerafimAgent(drone_id, "РАЗВ", "blue")
        self.last_decision = None
        self.decision_age = 0

        # Виртуальные враги для симуляции
        self.enemies: List[dict] = []
        self._init_enemies()

        # Статистика
        self.flight_time = 0.0
        self.distance_flown = 0.0
        self.max_altitude = 0.0
        self.decisions = []

        # Лог
        self.log: deque = deque(maxlen=200)

    def _init_enemies(self):
        """Создать виртуальных врагов на карте."""
        self.enemies = [
            {"id": "E1", "role": "танк", "x": 400, "z": 200, "destroyed": False},
            {"id": "E2", "role": "РЭБ", "x": -300, "z": 500, "destroyed": False},
            {"id": "E3", "role": "опорник", "x": 600, "z": -300, "destroyed": False},
            {"id": "E4", "role": "ПВО", "x": -500, "z": -400, "destroyed": False},
            {"id": "E5", "role": "техника", "x": 200, "z": -600, "destroyed": False},
        ]

    def get_sensors(self) -> dict:
        """Прочитать сенсоры дрона."""
        # Ближайший враг
        nearest = None; nearest_dist = float('inf')
        for e in self.enemies:
            if e["destroyed"]:
                continue
            dist = math.sqrt((self.drone.x - e["x"])**2 + (self.drone.z - e["z"])**2)
            if dist < nearest_dist:
                nearest_dist = dist
                nearest = e

        return {
            "position": (self.drone.x, self.drone.y, self.drone.z),
            "velocity": (self.drone.vx, self.drone.vy, self.drone.vz),
            "attitude": (self.drone.roll, self.drone.pitch, self.drone.yaw),
            "battery": self.drone.battery,
            "armed": self.drone.armed,
            "nearest_enemy": nearest,
            "nearest_dist": nearest_dist,
            "enemies_total": sum(1 for e in self.enemies if not e["destroyed"]),
        }

    def tick(self) -> dict:
        """Один тик симуляции."""
        self.tick_count += 1
        self.flight_time += self.dt
        sensors = self.get_sensors()

        # Каждые 2 секунды — новое решение Serafim
        if self.drone.armed and self.tick_count % 20 == 0:
            self._get_serafim_decision(sensors)
            self.decision_age = 0
        self.decision_age += 1

        # Применить решение через ПИД
        controls = self._decision_to_controls()

        # Физика
        prev_pos = (self.drone.x, self.drone.z)
        self.drone.update(self.dt, controls)
        self.distance_flown += math.sqrt(
            (self.drone.x - prev_pos[0])**2 + (self.drone.z - prev_pos[1])**2)
        self.max_altitude = max(self.max_altitude, self.drone.y)

        # Проверка попаданий
        events = self._check_hits()

        return {
            "tick": self.tick_count,
            "drone": {
                "x": round(self.drone.x, 1), "y": round(self.drone.y, 1), "z": round(self.drone.z, 1),
                "vx": round(self.drone.vx, 1), "vy": round(self.drone.vy, 1), "vz": round(self.drone.vz, 1),
                "roll": round(self.drone.roll, 2), "pitch": round(self.drone.pitch, 2), "yaw": round(self.drone.yaw, 2),
                "battery": round(self.drone.battery, 1), "armed": self.drone.armed,
            },
            "decision": {
                "action": self.last_decision.action.value,
                "reason": self.last_decision.reason[:200],
                "confidence": self.last_decision.confidence,
            } if self.last_decision else None,
            "sensors": {
                "nearest_enemy": sensors["nearest_enemy"]["id"] if sensors["nearest_enemy"] else None,
                "nearest_dist": round(sensors["nearest_dist"], 0),
                "enemies_left": sensors["enemies_total"],
            },
            "events": events,
            "stats": {
                "flight_time": round(self.flight_time, 1),
                "distance_flown": round(self.distance_flown, 1),
                "max_altitude": round(self.max_altitude, 1),
                "decisions": len(self.decisions),
            },
        }

    def _get_serafim_decision(self, sensors: dict):
        """Запросить решение у Serafim."""
        from serafim_agent import TacticalSituation

        enemy = sensors["nearest_enemy"]
        sit = TacticalSituation(
            agent_id=self.drone_id, agent_role="РАЗВ", agent_team="blue",
            x=self.drone.x, y=self.drone.y, z=self.drone.z,
            battery_pct=self.drone.battery,
            heading_deg=math.degrees(self.drone.yaw),
            enemies=[{"id": enemy["id"], "role": enemy["role"],
                       "dist_m": sensors["nearest_dist"]}] if enemy else [],
            nearest_enemy_dist=sensors["nearest_dist"] if enemy else float('inf'),
            friendlies_alive=0,
            enemies_alive=sensors["enemies_total"],
            mission_phase="patrol" if self.decision_age < 40 else "engage",
        )

        try:
            self.last_decision = self.serafim.decide_sync(sit, timeout_s=5)
            self.decisions.append({
                "tick": self.tick_count,
                "action": self.last_decision.action.value,
                "reason": self.last_decision.reason[:200],
                "battery": self.drone.battery,
                "nearest_dist": sensors["nearest_dist"],
            })
            self.log.append(f"🤖 Serafim: {self.last_decision.action.value.upper()} — "
                           f"{self.last_decision.reason[:80]}")
        except Exception as e:
            self.log.append(f"❌ Serafim error: {e}")

    def _decision_to_controls(self) -> dict:
        """Конвертировать решение Serafim в управляющие сигналы."""
        if not self.drone.armed:
            return {"throttle": 0}

        controls = {"throttle": 0.6, "roll": 0, "pitch": 0, "yaw": 0}

        if not self.last_decision:
            # Патруль по умолчанию
            controls["pitch"] = 0.2  # лёгкое движение вперёд
            controls["yaw"] = 0.1 * math.sin(self.tick_count * 0.01)
            return controls

        action = self.last_decision.action.value
        sensors = self.get_sensors()
        enemy = sensors["nearest_enemy"]

        if action == "attack" and enemy and sensors["nearest_dist"] < 2000:
            # Лететь к врагу
            dx = enemy["x"] - self.drone.x
            dz = enemy["z"] - self.drone.z
            target_yaw = math.atan2(dx, dz)
            yaw_err = (target_yaw - self.drone.yaw + math.pi) % (2*math.pi) - math.pi

            controls["pitch"] = 0.5  # вперёд
            controls["yaw"] = max(-1, min(1, yaw_err * 2))
            controls["throttle"] = 0.7

            # Снижение для атаки если близко
            if sensors["nearest_dist"] < 100:
                controls["throttle"] = 0.3  # снижаемся
                controls["pitch"] = 0.8

        elif action == "rtb":
            # Лететь к базе (0, 100, 0)
            dist = math.sqrt(self.drone.x**2 + self.drone.z**2)
            if dist > 5:
                target_yaw = math.atan2(-self.drone.x, -self.drone.z)
                yaw_err = (target_yaw - self.drone.yaw + math.pi) % (2*math.pi) - math.pi
                controls["yaw"] = max(-1, min(1, yaw_err * 2))
                controls["pitch"] = 0.4
                controls["throttle"] = 0.6 if self.drone.y < 100 else 0.4
            else:
                controls["pitch"] = 0
                controls["throttle"] = 0.5  # зависание
                if self.drone.y < 5:
                    self.drone.disarm()
                    self.log.append("🛬 Посадка — миссия завершена")

        elif action == "observe" and enemy and sensors["nearest_dist"] < 1500:
            # Кружить вокруг цели на безопасной дистанции
            orbit_r = 200
            angle = self.drone.yaw + 0.02  # медленный поворот
            orbit_x = enemy["x"] + orbit_r * math.sin(angle)
            orbit_z = enemy["z"] + orbit_r * math.cos(angle)
            dx = orbit_x - self.drone.x
            dz = orbit_z - self.drone.z
            target_yaw = math.atan2(dx, dz)
            yaw_err = (target_yaw - self.drone.yaw + math.pi) % (2*math.pi) - math.pi
            controls["yaw"] = max(-1, min(1, yaw_err))
            controls["pitch"] = 0.2
            controls["throttle"] = 0.55

        else:  # patrol
            controls["pitch"] = 0.2
            controls["yaw"] = 0.1 * math.sin(self.tick_count * 0.01)
            controls["throttle"] = 0.55

        return controls

    def _check_hits(self) -> list:
        """Проверить попадания по врагам."""
        events = []
        if not self.drone.armed:
            return events

        for e in self.enemies:
            if e["destroyed"]:
                continue
            dist = math.sqrt((self.drone.x - e["x"])**2 + (self.drone.z - e["z"])**2)
            if dist < 10 and self.drone.y < 30:
                e["destroyed"] = True
                events.append({"event": "KILL", "target": e["role"], "id": e["id"]})
                self.log.append(f"💥 Поражена цель: {e['role']} ({e['id']})")
        return events

    def state_dict(self) -> dict:
        """Полное состояние для веб-интерфейса."""
        t = self.tick()
        return {
            **t,
            "enemies": [{"id": e["id"], "role": e["role"],
                         "x": e["x"], "z": e["z"],
                         "destroyed": e["destroyed"]}
                        for e in self.enemies],
            "log": list(self.log)[-30:] if self.log else [],
        }


# ═══════════════════════════════════════════════════════════════
# ВЕБ-СЕРВЕР + 3D ВИЗУАЛИЗАЦИЯ
# ═══════════════════════════════════════════════════════════════

FLIGHT_HTML = r"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🛸 Serafim — Боевой ИИ роя</title>
<style>
*{margin:0;box-sizing:border-box;font-family:'Segoe UI',sans-serif}
body{background:#0a0a12;color:#c8ccd4;overflow:hidden;height:100vh;display:flex}
#left{width:260px;background:#111118;padding:10px;overflow-y:auto;border-right:1px solid #222;font-size:11px}
#center{flex:1;position:relative}
#right{width:280px;background:#111118;padding:10px;overflow-y:auto;border-left:1px solid #222;font-size:11px}
canvas{display:block}
h3{color:#f80;font-size:11px;margin:8px 0 4px;text-transform:uppercase;letter-spacing:1px}
.stat{display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #1a1a22}
.stat .val{color:#fff;font-weight:bold}
.btn{display:block;width:100%;padding:8px;margin:3px 0;border:none;border-radius:5px;font-size:12px;cursor:pointer;font-weight:bold;transition:transform 0.1s}
.btn:active{transform:scale(0.95)}
.btn-attack{background:#800;color:#fff}
.btn-observe{background:#048;color:#fff}
.btn-rtb{background:#080;color:#fff}
.btn-patrol{background:#444;color:#ccc}
.btn-arm{background:#f80;color:#000;font-size:14px;padding:10px}
#serafim-box{background:#1a1a1e;border:2px solid #f80;border-radius:8px;padding:10px;margin:8px 0;text-align:center}
#serafim-action{font-size:24px;font-weight:900;color:#f80}
#serafim-reason{font-size:10px;color:#aaa;margin-top:4px;max-height:40px;overflow:hidden}
#log{max-height:150px;overflow-y:auto;font-size:10px}
.log-e{color:#aaa;padding:1px 0;border-bottom:1px solid #1a1a22}
.log-e .a{color:#f80}.log-e .k{color:#f55}.log-e .i{color:#4af}
#minimap{width:100%;height:140px;background:rgba(0,0,0,0.5);border-radius:4px}
</style>
</head>
<body>
<div id="left">
  <h3>🚀 УПРАВЛЕНИЕ</h3>
  <button class="btn btn-arm" onclick="arm()">⬆ ARM / TAKEOFF</button>
  <button class="btn btn-attack" onclick="quick('Вижу танк на 400м','400','танк')">🎯 АТАКА: Танк</button>
  <button class="btn btn-attack" onclick="quick('Вижу РЭБ на 800м','800','РЭБ')">📡 АТАКА: РЭБ</button>
  <button class="btn btn-attack" onclick="quick('Вижу опорник','300','опорник')">🏚 АТАКА: Опорник</button>
  <button class="btn btn-observe" onclick="quick('Вижу человека','300','человек')">👤 НАБЛЮДАТЬ</button>
  <button class="btn btn-rtb" onclick="quick('Батарея 8%, возвращаюсь','','')">🪫 RTB</button>
  <button class="btn btn-patrol" onclick="quick('Патрулирую','','')">🔍 ПАТРУЛЬ</button>

  <h3>🤖 SERAFIM</h3>
  <div id="serafim-box">
    <div id="serafim-action">—</div>
    <div id="serafim-reason">Ожидание...</div>
  </div>
  <div style="display:flex;gap:4px">
    <button class="btn" style="background:#0a0;color:#fff;flex:1" onclick="feedback(true)">✅</button>
    <button class="btn" style="background:#800;color:#fff;flex:1" onclick="feedback(false)">❌</button>
  </div>

  <h3>📡 ТЕЛЕМЕТРИЯ</h3>
  <div class="stat"><span>Высота</span><span class="val" id="alt">0</span></div>
  <div class="stat"><span>Скорость</span><span class="val" id="spd">0</span></div>
  <div class="stat"><span>Батарея</span><span class="val" id="bat">100%</span></div>
  <div class="stat"><span>Режим</span><span class="val" id="mode">—</span></div>
  <div class="stat"><span>Целей</span><span class="val" id="tgt">5</span></div>
  <div class="stat"><span>Убито</span><span class="val" id="kills">0</span></div>
  <div class="stat"><span>Тик</span><span class="val" id="tck">0</span></div>
  <div class="stat"><span>Serafim</span><span class="val" id="sact">—</span></div>
</div>

<div id="center"><canvas id="c"></canvas></div>

<div id="right">
  <h3>🗺 МИНИ-КАРТА</h3>
  <canvas id="minimap" width="280" height="140"></canvas>

  <h3>🎯 ЦЕЛИ</h3>
  <div id="targets-list"></div>

  <h3>📝 ЛОГ</h3>
  <div id="log"></div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
// ═══ 3D WORLD ═══
const W=4000,scene=new THREE.Scene();
scene.background=new THREE.Color(0x87CEEB);
scene.fog=new THREE.FogExp2(0x87CEEB,0.00015);
const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,1,5000);
camera.position.set(200,250,400);camera.lookAt(0,100,0);
const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('c'),antialias:true});
renderer.setSize(1,1);renderer.shadowMap.enabled=true;
const sun=new THREE.DirectionalLight(0xffffcc,1.2);sun.position.set(500,800,300);scene.add(sun);
scene.add(new THREE.AmbientLight(0x446688,0.5));
const grid=new THREE.GridHelper(W,40,0x445544,0x334433);scene.add(grid);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(W,W),new THREE.MeshPhongMaterial({color:0x4a7a3a}));
ground.rotation.x=-Math.PI/2;ground.position.y=-0.5;scene.add(ground);
// Trees
for(let i=0;i<100;i++){let x=(Math.random()-0.5)*W,z=(Math.random()-0.5)*W;let t=new THREE.Mesh(new THREE.ConeGeometry(2+Math.random()*3,4+Math.random()*5,6),new THREE.MeshPhongMaterial({color:0x335522}));t.position.set(x,2,z);scene.add(t);}
// Buildings
for(let i=0;i<8;i++){let x=(Math.random()-0.5)*W*0.6,z=(Math.random()-0.5)*W*0.6;let b=new THREE.Mesh(new THREE.BoxGeometry(5+Math.random()*10,8+Math.random()*20,5+Math.random()*10),new THREE.MeshPhongMaterial({color:0x666666}));b.position.set(x,4,z);scene.add(b);}

const drones={},targets={};
function mkDrone(c){let g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(2,0.6,3.5),new THREE.MeshPhongMaterial({color:c})));for(let s=-1;s<=1;s+=2){g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.2,6),new THREE.MeshPhongMaterial({color:0x444}))).rotation.z=Math.PI/2;g.children[g.children.length-1].position.x=s*3.5}for(let a=0;a<4;a++){let p=new THREE.Mesh(new THREE.BoxGeometry(5,0.1,0.5),new THREE.MeshPhongMaterial({color:0xccc,transparent:true,opacity:0.4}));p.position.set((a<2?-1:1)*3.5,0.8,(a%2==0?-1:1)*2.5);p.name='prop';g.add(p)}scene.add(g);return g}
function mkTarget(r){let cl={танк:0x886633,РЭБ:0x334488,опорник:0x666655,ПВО:0x883333,техника:0x777755}[r]||0xf44;let t=new THREE.Mesh(new THREE.BoxGeometry(6,3,8),new THREE.MeshPhongMaterial({color:cl}));t.position.y=1.5;scene.add(t);return t}
drones['pilot']=mkDrone(0x00ff00);
for(let i=1;i<=4;i++)drones['b'+i]=mkDrone(0x4488ff);
for(let i=1;i<=4;i++)drones['r'+i]=mkDrone(0xff4444);
targets['T1']=mkTarget('танк');targets['T1'].position.set(400,0,200);
targets['T2']=mkTarget('РЭБ');targets['T2'].position.set(-300,0,500);
targets['T3']=mkTarget('опорник');targets['T3'].position.set(600,0,-300);
targets['T4']=mkTarget('ПВО');targets['T4'].position.set(-500,0,-400);
targets['T5']=mkTarget('техника');targets['T5'].position.set(200,0,-600);

// ═══ GAME STATE ═══
let tick=0,kills=0,dronePos={x:0,y:0,z:0},droneYaw=0,lastAction='';

function arm(){fetch('/api/arm').then(r=>r.json()).then(d=>{if(d.armed)log('🚀 Взлёт!','i')})}
function quick(sit,dist,enemy){
  document.getElementById('serafim-action').textContent='...';
  document.getElementById('serafim-reason').textContent='Serafim думает...';
  fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({situation:sit,distance:dist,battery:80,enemies:enemy})})
  .then(r=>r.json()).then(d=>{
    document.getElementById('serafim-action').textContent=d.advice.toUpperCase();
    document.getElementById('serafim-action').style.color={attack:'#f44',observe:'#48f',rtb:'#0f0',patrol:'#888'}[d.advice]||'#f80';
    document.getElementById('serafim-reason').textContent=d.reason.substring(0,200);
    lastAction=d.advice;
    log('🤖 Serafim: '+d.advice.toUpperCase(),'a');
  });
}
function feedback(acc){
  document.getElementById('serafim-action').style.color=acc?'#0f0':'#f44';
  setTimeout(()=>document.getElementById('serafim-action').style.color='#f80',1500);
  log(acc?'✅ ПРИНЯТО: '+lastAction:'❌ ОТКЛОНЕНО: '+lastAction, acc?'i':'k');
}
function log(msg,cls){let d=document.getElementById('log');d.innerHTML='<div class="log-e"><span class="'+cls+'">'+msg+'</span></div>'+d.innerHTML;}

async function update(){
  try{
    let r=await fetch('/api/state');let s=await r.json();
    tick=s.tick||tick+1;let d=s.drone||{},dec=s.decision;
    if(!d)return setTimeout(update,300);

    // HUD
    document.getElementById('alt').textContent=(d.y||0).toFixed(0)+'м';
    document.getElementById('spd').textContent=Math.sqrt((d.vx||0)**2+(d.vz||0)**2).toFixed(1)+'м/с';
    document.getElementById('bat').textContent=(d.battery||0).toFixed(0)+'%';
    document.getElementById('tck').textContent=tick;
    document.getElementById('tgt').textContent=s.sensors?.enemies_left||0;
    document.getElementById('kills').textContent=kills;
    let act=dec?dec.action:'—';
    document.getElementById('sact').textContent=act.toUpperCase();
    document.getElementById('mode').textContent=d.armed?'ARMED':'DISARMED';

    if(dec && !document.getElementById('serafim-action').textContent.match(/[A-Z]/)){
      document.getElementById('serafim-action').textContent=dec.action.toUpperCase();
      document.getElementById('serafim-reason').textContent=(dec.reason||'').substring(0,200);
    }

    // Events
    if(s.events)s.events.forEach(e=>{if(e.event==='KILL'){kills++;log('💥 '+e.target,'k')}});

    // 3D
    dronePos={x:d.x||0,y:d.y||0,z:d.z||0};droneYaw=d.yaw||0;
    let p=drones['pilot'];if(p){p.position.set(dronePos.x,dronePos.y,dronePos.z);p.rotation.y=droneYaw}
    Object.values(drones).forEach(g=>g.children.forEach(c=>{if(c.name==='prop')c.rotation.y+=0.5}));
    if(s.enemies)s.enemies.forEach(t=>{let o=targets[t.id];if(o){o.position.set(t.x,o.position.y,t.z);if(t.destroyed)o.material.color.setHex(0x333)}});
    // Camera
    camera.position.lerp(new THREE.Vector3(dronePos.x-Math.sin(droneYaw)*80,dronePos.y+40,dronePos.z-Math.cos(droneYaw)*80),0.1);
    camera.lookAt(dronePos.x+Math.sin(droneYaw)*100,dronePos.y-10,dronePos.z+Math.cos(droneYaw)*100);

    // Minimap
    let mm=document.getElementById('minimap'),ctx=mm.getContext('2d');
    ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(0,0,280,140);
    let sc=0.03,cx=140,cy=70;
    if(s.enemies)s.enemies.forEach(t=>{let mx=cx+(t.x-dronePos.x)*sc,my=cy+(t.z-dronePos.z)*sc;ctx.fillStyle=t.destroyed?'#333':'#f44';ctx.fillRect(mx-2,my-2,4,4)});
    ctx.fillStyle='#0f0';ctx.beginPath();ctx.arc(cx,cy,3,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#0f0';ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.sin(droneYaw)*8,cy-Math.cos(droneYaw)*8);ctx.stroke();

    // Targets list
    let tl='';if(s.enemies)s.enemies.forEach(t=>{tl+=`<div class="stat"><span>${t.role}</span><span class="val">${t.destroyed?'💀':'🟢'}</span></div>`});
    document.getElementById('targets-list').innerHTML=tl;

  }catch(e){}
  renderer.render(scene,camera);
  setTimeout(update,200);
}
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
update();
log('🟢 Система готова. Жми ARM для взлёта.','i');
</script>
</body></html>
"""

class SerafimFlightServer:
    def __init__(self, controller: SerafimFlightController, port=8101):
        self.ctrl = controller
        self.port = port

    def start(self):
        ctrl = self.ctrl

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/" or self.path == "/index.html":
                    html = FLIGHT_HTML.format(drone_id=ctrl.drone_id)
                    self.send_response(200)
                    self.send_header("Content-type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(html.encode())

                elif self.path == "/api/state":
                    state = ctrl.state_dict()
                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(json.dumps(state, ensure_ascii=False).encode())

                elif self.path == "/api/ask" and self.command == "POST":
                    content_length = int(self.headers.get('Content-Length', 0))
                    body = json.loads(self.rfile.read(content_length))
                    sit = body.get('situation',''); dist = body.get('distance','')
                    bat = body.get('battery',80); enemy = body.get('enemies','')
                    # Build prompt and ask Serafim
                    prompt = f"Ты дрон-разведчик. Враги: {enemy}. Дистанция: {dist}м. Батарея: {bat}%. {sit}. Решение:"
                    from serafim_agent import SerafimAgent, TacticalSituation
                    a = SerafimAgent("ui-1","РАЗВ","blue")
                    sit_obj = a.build_situation(enemies=[{"id":"R1","role":enemy,"dist_m":float(dist) if dist.replace('.','').isdigit() else 500}],
                        nearest_enemy_dist=float(dist) if dist.replace('.','').isdigit() else 500, battery=bat)
                    dec = a.decide_sync(sit_obj, timeout_s=8)
                    self.send_response(200); self.send_header("Content-type","application/json"); self.end_headers()
                    self.wfile.write(json.dumps({"advice":dec.action.value,"reason":dec.reason[:200],"latency_ms":dec.latency_ms}).encode())

                elif self.path == "/api/arm":
                    ctrl.drone.arm()
                    ctrl.drone.y = 100
                    ctrl.log.append("🚀 Взлёт! Serafim управляет.")
                    self.send_response(200); self.end_headers()
                    self.wfile.write(b'{"armed":true}')

                elif self.path == "/api/disarm":
                    ctrl.drone.disarm()
                    self.send_response(200); self.end_headers()
                    self.wfile.write(b'{"armed":false}')

                elif self.path == "/api/mavlink/heartbeat":
                    msg = mavlink_heartbeat()
                    self.send_response(200)
                    self.send_header("Content-type", "application/octet-stream")
                    self.end_headers()
                    self.wfile.write(msg)

                elif self.path == "/api/mavlink/attitude":
                    msg = mavlink_attitude(ctrl.drone.roll, ctrl.drone.pitch, ctrl.drone.yaw)
                    self.send_response(200)
                    self.send_header("Content-type", "application/octet-stream")
                    self.end_headers()
                    self.wfile.write(msg)

                else:
                    self.send_response(404); self.end_headers()

        # Start MAVLink UDP broadcast for QGroundControl
        self._start_mavlink_udp(ctrl)

        server = HTTPServer(("0.0.0.0", self.port), Handler)
        print(f"\n{'='*60}")
        print(f"  Serafim Flight — {ctrl.drone_id}")
        print(f"  MAVLink UDP: :14550 (QGroundControl)")
        print(f"  Веб:    http://localhost:{self.port}")
        print(f"  {'='*60}")
        print(f"  GET /api/arm     — запустить миссию")
        print(f"  GET /api/state   — телеметрия + Serafim")
        print(f"  QGroundControl → UDP 127.0.0.1:14550 → Connect")
        print(f"  {'='*60}\n")
        server.serve_forever()

    def _start_mavlink_udp(self, ctrl):
        """Broadcast MAVLink to UDP :14550 for QGroundControl via pymavlink."""
        import socket, threading
        from pymavlink import mavutil

        class UDPSender:
            def __init__(self, host, port):
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self.addr = (host, port)
            def write(self, data):
                self.sock.sendto(data, self.addr)

        sender = UDPSender('127.0.0.1', 14550)
        mav = mavutil.mavlink.MAVLink(sender, srcSystem=1, srcComponent=1)

        def _broadcast():
            while True:
                ctrl.tick()  # двигаем физику!
                d = ctrl.drone
                base_mode = 81 if d.armed else 0
                mav.heartbeat_send(2, 3, base_mode, 0, 4)
                mav.sys_status_send(0, 0, 0, 0, 11000, -1, int(d.battery), 0, 0, 0, 0, 0, 0)
                lat = int((55.75 + d.x*1e-5)*1e7)
                lon = int((37.62 + d.z*1e-5)*1e7)
                alt_mm = int(d.y*1000)
                mav.global_position_int_send(0, lat, lon, alt_mm, alt_mm,
                    int(d.vx*100), int(d.vy*100), int(d.vz*100), int(d.yaw*100))
                time.sleep(1)

        threading.Thread(target=_broadcast, daemon=True).start()



# ═══════════════════════════════════════════════════════════════
# ВЕБ-СЕРВЕР
# ═══════════════════════════════════════════════════════════════

class SerafimFlightServer:
    def __init__(self, controller, port=8101):
        self.ctrl = controller
        self.port = port

    def start(self):
        ctrl = self.ctrl
        import json as _json

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/" or self.path == "/index.html":
                    html = FLIGHT_HTML
                    self.send_response(200)
                    self.send_header("Content-type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(html.encode())

                elif self.path == "/api/state":
                    state = ctrl.state_dict()
                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(_json.dumps(state, ensure_ascii=False).encode())

                elif self.path == "/api/arm":
                    ctrl.drone.arm()
                    ctrl.drone.y = 100
                    self.send_response(200); self.send_header("Content-type", "application/json"); self.end_headers()
                    self.wfile.write(b'{"armed":true}')

                elif self.path == "/api/mavlink/heartbeat":
                    msg = mavlink_heartbeat()
                    self.send_response(200); self.send_header("Content-type", "application/octet-stream"); self.end_headers()
                    self.wfile.write(msg)

                else:
                    self.send_response(404); self.end_headers()

            def do_POST(self):
                if self.path == "/api/ask":
                    cl = int(self.headers.get('Content-Length', 0))
                    body = _json.loads(self.rfile.read(cl))
                    sit = body.get('situation',''); dist = body.get('distance','')
                    bat = body.get('battery',80); enemy = body.get('enemies','')
                    from serafim_agent import SerafimAgent, TacticalSituation
                    a = SerafimAgent("ui-1","РАЗВ","blue")
                    d = float(dist) if dist and dist.replace('.','').isdigit() else 500
                    so = a.build_situation(enemies=[{"id":"R1","role":enemy,"dist_m":d}],
                        nearest_enemy_dist=d, battery=bat)
                    dec = a.decide_sync(so, timeout_s=8)
                    self.send_response(200); self.send_header("Content-type","application/json"); self.end_headers()
                    self.wfile.write(_json.dumps({"advice":dec.action.value,"reason":dec.reason[:200],"latency_ms":dec.latency_ms}).encode())

        self._start_mavlink_udp(ctrl)
        server = HTTPServer(("0.0.0.0", self.port), Handler)
        print(f"\n{'='*60}\n  Serafim Flight + MAVLink + 3D Game\n  http://localhost:{self.port}\n  MAVLink UDP: :14550 (QGroundControl)\n{'='*60}\n")
        server.serve_forever()

    def _start_mavlink_udp(self, ctrl):
        import socket, struct, threading
        from pymavlink import mavutil

        class UDPSender:
            def __init__(self, host, port):
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self.addr = (host, port)
            def write(self, data):
                self.sock.sendto(data, self.addr)

        sender = UDPSender('127.0.0.1', 14550)
        mav = mavutil.mavlink.MAVLink(sender, srcSystem=1, srcComponent=1)

        def _broadcast():
            while True:
                ctrl.tick()
                d = ctrl.drone
                base_mode = 81 if d.armed else 0
                mav.heartbeat_send(2, 3, base_mode, 0, 4)
                mav.sys_status_send(0, 0, 0, 0, 11000, -1, int(d.battery), 0, 0, 0, 0, 0, 0)
                lat = int((55.75 + d.x*1e-5)*1e7)
                lon = int((37.62 + d.z*1e-5)*1e7)
                alt_mm = int(d.y*1000)
                mav.global_position_int_send(0, lat, lon, alt_mm, alt_mm,
                    int(d.vx*100), int(d.vy*100), int(d.vz*100), int(d.yaw*100))
                time.sleep(1)

        threading.Thread(target=_broadcast, daemon=True).start()

# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8101)
    p.add_argument("--drone-id", default="serafim-1")
    p.add_argument("--auto", action="store_true", help="Авто-взлёт и полёт без веба")
    args = p.parse_args()

    ctrl = SerafimFlightController(drone_id=args.drone_id)

    if args.auto:
        print(f"Автономный полёт: {args.drone_id}")
        ctrl.drone.arm()
        ctrl.drone.y = 100
        ctrl.log.append("🚀 Авто-взлёт")

        for _ in range(300):
            state = ctrl.state_dict()
            d = state["drone"]
            if _ % 30 == 0:
                dec = state.get('decision')
                action_str = dec.action.value if dec and hasattr(dec, 'action') else '—'
                print(f"  t={state['tick']:4d} | alt={d['y']:6.1f}m bat={d['battery']:5.1f}% "
                      f"| action={action_str:8s} "
                      f"| enemies={state['sensors']['enemies_left']}")
            if not d["armed"]:
                print("  Посадка совершена.")
                break
            time.sleep(0.1)

        print(f"\nСтатистика: {json.dumps(ctrl.state_dict()['stats'], indent=2)}")
    else:
        server = SerafimFlightServer(ctrl, port=args.port)
        try:
            server.start()
        except KeyboardInterrupt:
            print("\nStopped")
