#!/usr/bin/env python3
"""
serafim_sitl.py — Serafim + Суворов управляют ArduPilot SITL

Полный цикл:
  Serafim (LLM + Суворов) → MAVLink v2 → ArduCopter SITL → телеметрия → Serafim

Требования: dronekit-sitl (уже установлен)

Запуск:
  python3 src/digital_twin/serafim_sitl.py
  Веб: http://localhost:8102

Архитектура:
  ┌──────────┐    ┌──────────────┐    ┌───────────┐
  │ Serafim  │───▶│ Suvorov      │───▶│ MAVLink   │
  │ (LLM)    │    │ (приоритеты) │    │ (v2 cmds) │
  └──────────┘    └──────────────┘    └─────┬─────┘
       │                                     │
       │                                     ▼
       │                              ┌───────────┐
       └──── телеметрия ◀─────────────│ SITL      │
                                      │ ArduCopter│
                                      └───────────┘
"""

import math, time, json, threading, sys, os, socket, struct
from http.server import HTTPServer, BaseHTTPRequestHandler
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from collections import deque

sys.path.insert(0, os.path.dirname(__file__))
from suvorov_tactics import SUVOROV_SYSTEM_PROMPT, apply_suvorov_rules, build_suvorov_prompt
from serafim_agent import SerafimAgent, TacticalSituation
from serafim_flight import mavlink_heartbeat, mavlink_attitude, mavlink_global_position


# ═══════════════════════════════════════════════════════════════
# SITL BRIDGE
# ═══════════════════════════════════════════════════════════════

class SITLBridge:
    """Мост к ArduPilot SITL через raw socket + MAVLink."""

    def __init__(self):
        self.sitl = None
        self.sock = None
        self.connected = False
        self.conn_str = ""

        # Телеметрия
        self.lat = 55.75; self.lon = 37.62
        self.alt_msl = 100.0; self.alt_rel = 100.0
        self.vx = 0.0; self.vy = 0.0; self.vz = 0.0
        self.roll = 0.0; self.pitch = 0.0; self.yaw = 0.0
        self.armed = False
        self.mode = "STABILIZE"
        self.battery = 100.0
        self.heartbeat_count = 0
        self.last_msg_time = 0

    def start(self):
        """Запустить SITL и подключиться."""
        import dronekit_sitl
        self.sitl = dronekit_sitl.start_default()
        self.conn_str = self.sitl.connection_string()
        time.sleep(5)

        host, port = self.conn_str[4:].split(':')
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.connect((host, int(port)))
        self.sock.settimeout(0.5)
        self.connected = True
        print(f"SITL connected: {self.conn_str}")

        # Поток чтения телеметрии
        def reader():
            while self.connected:
                try:
                    data = self.sock.recv(1024)
                    self._parse_mavlink(data)
                except socket.timeout:
                    pass
                except:
                    break

        t = threading.Thread(target=reader, daemon=True)
        t.start()
        return True

    def _parse_mavlink(self, data: bytes):
        """Разобрать MAVLink-пакет."""
        if len(data) < 10 or data[0] != 0xFD:
            return
        self.last_msg_time = time.time()

        # Упрощённый парсер (полноценный — через pymavlink)
        msg_id = data[7]
        payload = data[10:10+data[1]]

        if msg_id == 0:  # HEARTBEAT
            self.heartbeat_count += 1
            if len(payload) >= 5:
                self.mode = ["STABILIZE","ACRO","ALT_HOLD","AUTO","GUIDED","LOITER",
                            "RTL","CIRCLE","LAND","DRIFT","SPORT","FLIP","AUTOTUNE",
                            "POSHOLD","BRAKE","THROW","AVOID","FOLLOW","ZIGZAG","SYSTEMID",
                            "AUTOROTATE","AUTO"][min(payload[0], 21)] if payload[0] < 22 else f"MODE{payload[0]}"
                self.armed = (payload[1] & 0x80) != 0

        elif msg_id == 33:  # GLOBAL_POSITION_INT
            if len(payload) >= 28:
                self.lat = struct.unpack_from('<i', payload, 4)[0] / 1e7
                self.lon = struct.unpack_from('<i', payload, 8)[0] / 1e7
                self.alt_msl = struct.unpack_from('<i', payload, 12)[0] / 1000.0
                self.alt_rel = struct.unpack_from('<i', payload, 16)[0] / 1000.0
                self.vx = struct.unpack_from('<h', payload, 20)[0] / 100.0
                self.vy = struct.unpack_from('<h', payload, 22)[0] / 100.0
                self.vz = struct.unpack_from('<h', payload, 24)[0] / 100.0

        elif msg_id == 30:  # ATTITUDE
            if len(payload) >= 28:
                self.roll = struct.unpack_from('<f', payload, 4)[0]
                self.pitch = struct.unpack_from('<f', payload, 8)[0]
                self.yaw = struct.unpack_from('<f', payload, 12)[0]

    def send_command(self, cmd_type: str, params: dict = None):
        """Отправить MAVLink-команду."""
        if not self.sock:
            return

        # MAVLink COMMAND_LONG format: 7x float params + uint16 cmd + uint8 x3
        if cmd_type == "arm":
            payload = struct.pack('<fffffffHHBB', 1.0, 0, 0, 0, 0, 0, 0,
                                  400, 1, 1, 0)  # MAV_CMD_COMPONENT_ARM_DISARM
            self._send_msg(76, payload)

        elif cmd_type == "takeoff":
            alt = (params or {}).get("altitude", 50)
            payload = struct.pack('<fffffffHHBB', 0, 0, 0, 0, 0, 0, float(alt),
                                  22, 1, 1, 0)  # MAV_CMD_NAV_TAKEOFF
            self._send_msg(76, payload)

        elif cmd_type == "land":
            payload = struct.pack('<fffffffHHBB', 0, 0, 0, 0, 0, 0, 0,
                                  21, 1, 1, 0)  # MAV_CMD_NAV_LAND
            self._send_msg(76, payload)

        elif cmd_type == "guided":
            # SET_MODE: custom_mode=4 (GUIDED)
            payload = struct.pack('<fffffffHHBB', 1.0, 4.0, 0, 0, 0, 0, 0,
                                  176, 1, 1, 0)  # MAV_CMD_DO_SET_MODE
            self._send_msg(76, payload)

        elif cmd_type == "move_to":
            lat = (params or {}).get("lat", self.lat + 0.001)
            lon = (params or {}).get("lon", self.lon + 0.001)
            alt = (params or {}).get("alt", 100)
            payload = struct.pack('<fffffffHHBB', 0, 0, 0, 0,
                                  float(lat), float(lon), float(alt),
                                  16, 1, 1, 0)  # MAV_CMD_NAV_WAYPOINT
            self._send_msg(76, payload)

    def _send_msg(self, msg_id: int, payload: bytes):
        """Отправить MAVLink-сообщение."""
        header = struct.pack('<BBBBBB', 0xFD, len(payload), 0, 0, 0, 0)
        header += struct.pack('<BB', 1, msg_id)
        crc = 0xFFFF
        for b in header[1:] + payload:
            crc ^= (b << 8)
            for _ in range(8):
                crc = (crc << 1) ^ 0x1021 if crc & 0x8000 else crc << 1
        msg = header + payload + struct.pack('<H', crc & 0xFFFF)
        try:
            self.sock.send(msg)
        except:
            pass

    def state_dict(self) -> dict:
        return {
            "connected": self.connected,
            "conn_str": self.conn_str,
            "armed": self.armed,
            "mode": self.mode,
            "position": {"lat": self.lat, "lon": self.lon,
                        "alt_msl": self.alt_msl, "alt_rel": self.alt_rel},
            "velocity": {"vx": self.vx, "vy": self.vy, "vz": self.vz},
            "attitude": {"roll": self.roll, "pitch": self.pitch, "yaw": self.yaw},
            "heartbeat_count": self.heartbeat_count,
        }

    def stop(self):
        self.connected = False
        if self.sock:
            self.sock.close()
        if self.sitl:
            self.sitl.stop()


# ═══════════════════════════════════════════════════════════════
# SERAFIM + СУВОРОВ → SITL КОНТРОЛЛЕР
# ═══════════════════════════════════════════════════════════════

class SerafimSITLController:
    """
    Serafim + Суворов управляют реальным ArduCopter SITL.

    Цикл:
      1. Читаем телеметрию из SITL
      2. Serafim (с суворовским промптом) принимает решение
      3. Суворовские правила приоритезируют цели
      4. MAVLink-команды отправляются в SITL
    """

    def __init__(self):
        self.sitl = SITLBridge()
        self.serafim = SerafimAgent("serafim-1", "РАЗВ", "blue")
        self.tick_count = 0
        self.last_decision = None
        self.decision_age = 0

        # Виртуальные цели (GPS координаты)
        self.targets = [
            {"id": "T1", "role": "танк", "lat": 55.751, "lon": 37.625, "destroyed": False},
            {"id": "T2", "role": "РЭБ", "lat": 55.749, "lon": 37.622, "destroyed": False},
            {"id": "T3", "role": "опорник", "lat": 55.752, "lon": 37.619, "destroyed": False},
        ]

        self.log: deque = deque(maxlen=200)
        self.mission_started = False

    def start(self):
        if self.sitl.start():
            self.log.append("🚀 SITL запущен, Serafim+Суворов готовы")
            return True
        return False

    def start_mission(self):
        """Запустить миссию: arm + takeoff."""
        self.sitl.send_command("guided")
        time.sleep(1)
        self.sitl.send_command("arm")
        time.sleep(2)
        self.sitl.send_command("takeoff", {"altitude": 100})
        self.mission_started = True
        self.log.append("🚁 Взлёт! Serafim+Суворов управляют.")

    def land(self):
        self.sitl.send_command("land")
        self.mission_started = False
        self.log.append("🛬 Посадка.")

    def tick(self) -> dict:
        """Один цикл управления."""
        self.tick_count += 1
        state = self.sitl.state_dict()

        if not state["armed"] or not self.mission_started:
            return {"tick": self.tick_count, "sITL": state, "decision": None}

        # Каждые 3 секунды — новое решение Serafim+Суворов
        if self.tick_count % 30 == 0:
            self._make_decision(state)
            self.decision_age = 0
        self.decision_age += 1

        # Применить решение → MAVLink
        self._execute_decision(state)

        return {
            "tick": self.tick_count,
            "sitl": state,
            "decision": self.last_decision,
            "targets": self.targets,
        }

    def _make_decision(self, state: dict):
        """Serafim + Суворов принимают решение."""
        # Суворовская приоритезация
        active_targets = [t for t in self.targets if not t["destroyed"]]
        for t in active_targets:
            t["_priority"] = \
                apply_suvorov_rules.__wrapped__ if hasattr(apply_suvorov_rules, '__wrapped__') \
                else SUVOROV_RULES_FUNC(t)

        # Приоритеты от Суворова
        suvorov_advice = apply_suvorov_rules(
            [{"role": t["role"], "dist_m": 500,
              "_priority": {"танк":7,"РЭБ":10,"опорник":5}.get(t["role"],0)}
             for t in active_targets],
            battery=90,
            enemies_alive=len(active_targets),
        )

        # Serafim запрос с суворовским контекстом
        enemy_str = ", ".join(
            f"{t['role']} ({t.get('dist_m', '?')}м)" for t in active_targets[:3]
        ) if active_targets else "врагов не видно"

        sit = TacticalSituation(
            agent_id="serafim-1", agent_role="РАЗВ", agent_team="blue",
            x=state["position"]["lat"], y=state["position"]["alt_rel"],
            z=state["position"]["lon"],
            battery_pct=90,
            heading_deg=math.degrees(state["attitude"]["yaw"]),
            enemies=[{"id": t["id"], "role": t["role"], "dist_m": 500}
                      for t in active_targets[:3]],
            nearest_enemy_dist=500 if active_targets else float('inf'),
            enemies_alive=len(active_targets),
            mission_phase="attack" if active_targets else "patrol",
        )

        try:
            self.last_decision = self.serafim.decide_sync(sit, timeout_s=5)
            self.log.append(
                f"🤖 Serafim: {self.last_decision.action.value.upper()} | "
                f"Суворов: {suvorov_advice['reason'][:60]}")
        except:
            self.last_decision = None

    def _execute_decision(self, state: dict):
        """Выполнить решение через MAVLink."""
        if not self.last_decision:
            return

        action = self.last_decision.action.value

        if action == "attack":
            # Найти ближайшую активную цель
            active = [t for t in self.targets if not t["destroyed"]]
            if active:
                target = active[0]  # брать по приоритету
                self.sitl.send_command("move_to", {
                    "lat": target["lat"], "lon": target["lon"], "alt": 80,
                })
                # Проверить попадание (упрощённо: если близко к цели)
                dist = math.sqrt(
                    (state["position"]["lat"] - target["lat"])**2 +
                    (state["position"]["lon"] - target["lon"])**2
                ) * 111000  # грубо: 1° ≈ 111 км
                if dist < 20:  # 20 метров
                    target["destroyed"] = True
                    self.log.append(f"💥 {target['role']} уничтожен! (Суворов: натиск)")

        elif action == "rtb":
            self.sitl.send_command("move_to", {
                "lat": 55.75, "lon": 37.62, "alt": 100,  # home position
            })

        elif action == "observe":
            # Кружить над позицией
            pass

        # patrol — бездействие (SITL сам держит позицию)

    def stop(self):
        self.sitl.stop()


# ═══════════════════════════════════════════════════════════════
# ВЕБ
# ═══════════════════════════════════════════════════════════════

SITL_HTML = r"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Serafim+Suvorov → SITL</title>
<meta http-equiv="refresh" content="2">
<style>body{{background:#0a0a12;color:#c8ccd4;font-family:monospace;padding:20px}}
h1{{color:#f80}} .stat{{display:flex;justify-content:space-between;max-width:400px;padding:2px 0}}
.val{{color:#fff}} .attack{{color:#f44}} .observe{{color:#48f}} .rtb{{color:#0f0}}
.log{{max-height:300px;overflow-y:auto;font-size:11px;margin-top:10px}}</style></head>
<body>
<h1>🛸 Serafim + Суворов → ArduCopter SITL</h1>
<div id="data">Загрузка...</div>
<script>
fetch('/api/state').then(r=>r.json()).then(s=>{{
  let st=s.sitl||{},d=s.decision||{};
  let act=d.action||'—';
  document.getElementById('data').innerHTML=''+
    '<div class="stat"><span>SITL</span><span class="val">'+(st.connected?'✅ '+st.conn_str:'❌')+'</span></div>'+
    '<div class="stat"><span>Режим</span><span class="val">'+st.mode+' '+(st.armed?'ARMED':'DISARMED')+'</span></div>'+
    '<div class="stat"><span>Высота</span><span class="val">'+st.position?.alt_rel?.toFixed(1)+'м</span></div>'+
    '<div class="stat"><span>Позиция</span><span class="val">'+st.position?.lat?.toFixed(4)+' '+st.position?.lon?.toFixed(4)+'</span></div>'+
    '<div class="stat"><span>Serafim</span><span class="val '+act+'">'+act.toUpperCase()+'</span></div>'+
    '<div class="stat"><span>Тик</span><span class="val">'+s.tick+'</span></div>'+
    '<div class="stat"><span>Целей</span><span class="val">'+(s.targets||[]).filter(t=>!t.destroyed).length+'/'+s.targets?.length+'</span></div>';
}}).catch(e=>document.getElementById('data').textContent='Ошибка: '+e);
setTimeout(()=>location.reload(),2000);
</script></body></html>"""


class SerafimSITLServer:
    def __init__(self, controller: SerafimSITLController, port=8102):
        self.ctrl = controller
        self.port = port

    def start(self):
        ctrl = self.ctrl

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/":
                    self.send_response(200)
                    self.send_header("Content-type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(SITL_HTML.encode())

                elif self.path == "/api/state":
                    state = ctrl.tick()
                    state["log"] = list(ctrl.log)[-20]
                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(state, ensure_ascii=False).encode())

                elif self.path == "/api/start":
                    ctrl.start_mission()
                    self.send_response(200); self.end_headers()
                    self.wfile.write(b'{"mission":"started"}')

                elif self.path == "/api/land":
                    ctrl.land()
                    self.send_response(200); self.end_headers()
                    self.wfile.write(b'{"mission":"landed"}')

        server = HTTPServer(("0.0.0.0", self.port), Handler)
        print(f"\n{'='*60}")
        print(f"  Serafim + Суворов → SITL")
        print(f"  MAVLink: {ctrl.sitl.conn_str}")
        print(f"  Веб:    http://localhost:{self.port}")
        print(f"  GET /api/start — взлёт и миссия")
        print(f"  GET /api/land  — посадка")
        print(f"  {'='*60}\n")
        server.serve_forever()


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8102)
    p.add_argument("--auto", action="store_true", help="Авто-миссия без веба")
    args = p.parse_args()

    ctrl = SerafimSITLController()
    if not ctrl.start():
        print("ERROR: SITL не запустился")
        sys.exit(1)

    if args.auto:
        print("Авто-миссия: Serafim + Суворов → SITL")
        ctrl.start_mission()
        time.sleep(5)

        for i in range(200):
            state = ctrl.tick()
            if i % 30 == 0:
                s = state.get("sitl", {})
                d = state.get("decision")
                act = d.action.value if d and hasattr(d, 'action') else '—'
                alt = s.get("position", {}).get("alt_rel", 0)
                armed = s.get("armed", False)
                targets_alive = sum(1 for t in ctrl.targets if not t["destroyed"])
                print(f"  t={state['tick']:4d} | alt={alt:6.1f}m armed={armed} "
                      f"| action={act:8s} | targets={targets_alive}")
            time.sleep(0.1)

        ctrl.land()
        time.sleep(3)
        print(f"\nМиссия завершена. Уничтожено целей: "
              f"{sum(1 for t in ctrl.targets if t['destroyed'])}/{len(ctrl.targets)}")

    else:
        server = SerafimSITLServer(ctrl, port=args.port)
        try:
            server.start()
        except KeyboardInterrupt:
            print("\nStopped")

    ctrl.stop()
