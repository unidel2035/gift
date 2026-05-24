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
<meta charset="utf-8">
<title>Serafim Flight — {drone_id}</title>
<style>
*{{margin:0;box-sizing:border-box}}
body{{background:#0a0a12;color:#c8ccd4;font-family:monospace;display:flex;height:100vh}}
#panel{{width:300px;background:#111118;padding:14px;overflow-y:auto;border-right:1px solid #222}}
#view{{flex:1;position:relative}}
canvas{{display:block}}
h2{{color:#4af;font-size:14px;margin-bottom:8px}}
.stat{{display:flex;justify-content:space-between;padding:2px 0;font-size:11px;border-bottom:1px solid #1a1a22}}
.stat .val{{color:#fff}}
.action{{font-size:20px;font-weight:bold;padding:8px;text-align:center;border-radius:6px;margin:8px 0}}
.action.attack{{background:#400;color:#f44}}
.action.observe{{background:#004;color:#48f}}
.action.rtb{{background:#040;color:#0f0}}
.action.patrol{{background:#222;color:#888}}
#log{{font-size:10px;max-height:150px;overflow-y:auto}}
.log-entry{{padding:1px 0;border-bottom:1px solid #1a1a22}}
</style>
</head>
<body>
<div id="panel">
  <h2>🛸 Serafim Flight</h2>
  <div style="font-size:10px;color:#aaa;margin-bottom:10px">{drone_id} | Serafim V2 Q8 | MAVLink v2</div>

  <div id="action-display" class="action patrol">—</div>

  <h3>📊 ТЕЛЕМЕТРИЯ</h3>
  <div class="stat"><span>Высота</span><span class="val" id="alt">—</span></div>
  <div class="stat"><span>Скорость</span><span class="val" id="speed">—</span></div>
  <div class="stat"><span>Батарея</span><span class="val" id="bat">—</span></div>
  <div class="stat"><span>Крен/Тангаж</span><span class="val" id="att">—</span></div>
  <div class="stat"><span>Курс</span><span class="val" id="hdg">—</span></div>
  <div class="stat"><span>Врагов</span><span class="val" id="enemies">—</span></div>
  <div class="stat"><span>Ближайший</span><span class="val" id="nearest">—</span></div>
  <div class="stat"><span>Время полёта</span><span class="val" id="ftime">—</span></div>
  <div class="stat"><span>Дальность</span><span class="val" id="dist">—</span></div>
  <div class="stat"><span>Решений Serafim</span><span class="val" id="decisions">—</span></div>

  <h3>📝 ЛОГ</h3>
  <div id="log"></div>
</div>
<div id="view"><canvas id="c"></canvas></div>
<script>
var api='/api/state';
async function update(){{
  try{{
    let r=await fetch(api);let s=await r.json();
    let d=s.drone;
    document.getElementById('alt').textContent=d.y.toFixed(0)+'м';
    document.getElementById('speed').textContent=Math.sqrt(d.vx*d.vx+d.vy*d.vy+d.vz*d.vz).toFixed(1)+'м/с';
    document.getElementById('bat').textContent=d.battery.toFixed(0)+'%';
    document.getElementById('att').textContent=(d.roll*57).toFixed(1)+'°/'+(d.pitch*57).toFixed(1)+'°';
    document.getElementById('hdg').textContent=(d.yaw*57).toFixed(0)+'°';
    document.getElementById('enemies').textContent=(s.sensors?.enemies_left||0);
    document.getElementById('nearest').textContent=(s.sensors?.nearest_dist||'—')+'м';
    document.getElementById('ftime').textContent=(s.stats?.flight_time||0).toFixed(1)+'с';
    document.getElementById('dist').textContent=(s.stats?.distance_flown||0).toFixed(0)+'м';
    document.getElementById('decisions').textContent=(s.stats?.decisions||0);

    let act=s.decision?.action||'patrol';
    let el=document.getElementById('action-display');
    el.textContent=act.toUpperCase();
    el.className='action '+act;

    // Лог
    if(s.log){{
      document.getElementById('log').innerHTML=s.log.slice(-12)
        .map(l=>'<div class="log-entry">'+l+'</div>').join('');
    }}

    // 3D
    let canvas=document.getElementById('c'),ctx=canvas.getContext('2d');
    canvas.width=canvas.parentElement.clientWidth;canvas.height=window.innerHeight;
    let w=canvas.width,h=canvas.height,cx=w/2,cy=h/2,scale=0.8;
    ctx.fillStyle='#0a0a12';ctx.fillRect(0,0,w,h);
    // Сетка
    ctx.strokeStyle='#1a1a2a';ctx.lineWidth=1;
    for(let i=-1000;i<=1000;i+=100){{
      ctx.beginPath();ctx.moveTo(cx+i*scale,0);ctx.lineTo(cx+i*scale,h);ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,cy+i*scale);ctx.lineTo(w,cy+i*scale);ctx.stroke();
    }}
    // Враги
    if(s.enemies) s.enemies.forEach(e=>{{
      let x=cx+(e.x-d.x)*scale,z=cy-(e.z-d.z)*scale;
      ctx.fillStyle=e.destroyed?'#333':'#f44';
      ctx.beginPath();ctx.arc(x,z,6,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.font='9px mono';ctx.fillText(e.role,x+8,z+3);
    }});
    // Дрон (центр)
    ctx.fillStyle=d.armed?'#0f0':'#888';
    ctx.beginPath();ctx.arc(cx,cy,8,0,Math.PI*2);ctx.fill();
    // Направление
    ctx.strokeStyle='#0f0';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.sin(d.yaw)*15,cy-Math.cos(d.yaw)*15);ctx.stroke();
    // База
    ctx.fillStyle='#48f';ctx.beginPath();ctx.arc(cx-d.x*scale,cy+d.z*scale,10,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='9px mono';ctx.fillText('БАЗА',cx-d.x*scale+12,cy+d.z*scale+3);
  }}catch(e){{}}setTimeout(update,300);}}
update();
</script></body></html>"""


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
