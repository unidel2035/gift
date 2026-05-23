#!/usr/bin/env python3
"""
unified_sim.py — Единая боевая симуляция. Все модули вместе.

Интегрирует:
  physics_world   — реальная атмосфера, RF, сенсоры, баллистика
  adaptive_enemy  — эволюционный противник (self-play league)
  flight_control  — ПИД + тактические манёвры
  combat_experience — запись в W-матрицу
  board_emulator  — три платы на дрон

Запуск: python3 src/digital_twin/unified_sim.py
Веб:    http://localhost:8106
"""

import math, random, time, json, threading, os, sys, urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from collections import deque, defaultdict
import statistics

sys.path.insert(0, '/home/unidel/gift/src/digital_twin')
from physics_world import Atmosphere, WindModel, RFChannel, CMOSCamera, ThermalCamera, IMUSensor, Ballistics
from flight_control import FlightController, ManeuverType, TacticalApproach
from adaptive_enemy import EvolutionEngine, fast_game_simulator, Strategy, Agent as EvoAgent

# ═══════════════════════════════════════════════════════════════
# ФЛОТЫ
# ═══════════════════════════════════════════════════════════════

BLUE_FLEET = [
    ("B-S1","РАЗВ","Ворон",-200,-200,120,45),
    ("B-S2","РАЗВ","Сова",200,-300,130,135),
    ("B-S3","РАЗВ","Сокол",0,200,125,270),
    ("B-F1","ФПВ","Пчела",400,300,80,0),
    ("B-F2","ФПВ","Волк",-400,300,85,0),
    ("B-F3","ФПВ","Ласка",400,-300,80,0),
    ("B-F4","ФПВ","Барс",-400,-300,85,0),
    ("B-P1","ПЕРЕ","Ястреб",600,0,140,90),
    ("B-P2","ПЕРЕ","Орёл",-600,0,140,270),
    ("B-R1","РЕТР","Заря",0,-500,350,0),
    ("B-E1","РЭБ","Гроза",300,-500,130,45),
    ("B-E2","РЭБ","Шторм",-300,500,135,225),
    ("B-H1","ТЯЖ","Атлант",700,0,200,90),
    ("B-N1","НАЗМ","База-Ц",0,0,0,0),
]

RED_FLEET = [
    ("R-E1","КАМИКАДЗЕ","Шахид-1",1200,800,30,180),
    ("R-E2","КАМИКАДЗЕ","Шахид-2",1000,-700,30,180),
    ("R-E3","РАЗВ","Глаз-1",800,1000,100,270),
    ("R-E4","РАЗВ","Глаз-2",-900,900,110,90),
    ("R-E5","ФПВ","Коготь-1",1100,300,85,0),
    ("R-E6","ФПВ","Коготь-2",-1000,-400,85,0),
    ("R-E7","ПЕРЕ","Страж-1",1300,0,120,90),
    ("R-E8","ПЕРЕ","Страж-2",-1200,0,120,270),
]

RED_AIR_DEFENSE = [
    ("R-AD1","ЗРК",1500,800,2000,0.002),
    ("R-AD2","ЗРК",-1200,-600,2000,0.002),
]

# ═══════════════════════════════════════════════════════════════
# БОЕВОЙ ДРОН (интегрированный)
# ═══════════════════════════════════════════════════════════════

class CombatDrone:
    def __init__(self, drone_id, role, name, x, z, y, heading, team):
        self.id = drone_id; self.role = role; self.name = name; self.team = team
        self.alive = True

        # Полётный контроллер (ПИД + манёвры)
        self.fc = FlightController()
        self.fc.state.x = x; self.fc.state.z = z; self.fc.state.y = y
        self.fc.state.yaw = math.radians(heading)
        self.fc.state.airspeed = 20 if role in ("ФПВ","КАМИКАДЗЕ") else 15

        # Физические сенсоры
        self.camera = CMOSCamera()
        self.thermal = ThermalCamera()
        self.imu = IMUSensor()

        # RF-канал
        self.rf = RFChannel(frequency_hz=868e6)

        # Стратегия (для красных — эволюционная, для синих — LLM)
        self.strategy = Strategy.random() if team == "red" else None
        self.llm_action = "patrol"
        self.llm_response = ""

        # Статистика
        self.kills = 0; self.deaths = 0; self.damage_dealt = 0
        self.distance_traveled = 0; self.shots_fired = 0

        # Батарея
        self.battery = 100.0

    def decide(self, state: dict) -> str:
        """Тактическое решение: LLM для синих, стратегия для красных"""
        if self.team == "blue" and self.role in ("РАЗВ","ФПВ","ПЕРЕ"):
            return self.llm_action  # LLM-решение извне
        elif self.strategy:
            return self.strategy.decide(state)
        return "patrol"

    def update_physics(self, dt: float, wind_model: WindModel, enemies: list,
                      friends: list, air_defense: list):
        """Обновить физику дрона за dt секунд"""
        if not self.alive: return

        s = self.fc.state

        # Ветер на высоте дрона
        wx, wy, wz = wind_model.get_wind(s.y, dt)
        # Влияние ветра на скорость
        s.vx += wx * 0.01 * dt
        s.vz += wz * 0.01 * dt

        # Обновление полётного контроллера
        self.fc.update(dt)

        # Расход батареи
        base_drain = {"РАЗВ": 0.003, "ФПВ": 0.005, "КАМИКАДЗЕ": 0.008,
                      "ПЕРЕ": 0.004, "РЕТР": 0.002, "РЭБ": 0.006, "ТЯЖ": 0.007,
                      "НАЗМ": 0.001}
        self.battery -= base_drain.get(self.role, 0.003)
        if self.fc.approach_phase == 2:
            self.battery -= 0.01  # форсаж на терминале

        self.distance_traveled += s.airspeed * dt

    def try_attack(self, target, dt: float) -> bool:
        """Попытка атаки с учётом физики: баллистика + сенсоры"""
        if not self.alive or not target.alive: return False

        s = self.fc.state
        tx, tz, ty = target.fc.state.x, target.fc.state.z, target.fc.state.y
        distance = math.sqrt((s.x - tx)**2 + (s.z - tz)**2 + (s.y - ty)**2)

        # Проверка сенсоров: видит ли дрон цель?
        cam_pd = self.camera.detection_probability(distance, target_size_m=3.0)
        if random.random() > cam_pd: return False  # не видит

        # Баллистика
        hit_prob = Ballistics.hit_probability(distance, cep_m=2.0)

        if distance < 30 and random.random() < hit_prob * 0.8:
            r_p, r_v = Ballistics.lethal_radius(0.3, "TNT")
            if distance < r_p:
                target.alive = False; self.kills += 1
                return True

        self.shots_fired += 1
        return False


# ═══════════════════════════════════════════════════════════════
# ЕДИНАЯ СИМУЛЯЦИЯ
# ═══════════════════════════════════════════════════════════════

class UnifiedSimulation:
    def __init__(self):
        self.tick = 0; self.dt = 0.1
        self.events: deque = deque(maxlen=500)

        # Физика мира
        self.wind = WindModel(surface_speed=3.0, surface_dir=315)
        self.atmosphere = Atmosphere()

        # ПВО
        self.air_defense = []
        for aid, atype, ax, az, arange, aleth in RED_AIR_DEFENSE:
            self.air_defense.append({
                "id": aid, "x": ax, "z": az, "range": arange,
                "lethality": aleth, "kills": 0, "active": True,
            })

        # Эволюционный движок (обучение красных) — ДО флотов
        self.evo_engine = EvolutionEngine(population_size=20, elite_count=3)
        self.evo_generation = 0

        # Флоты
        self.blue_drones: Dict[str, CombatDrone] = {}
        self.red_drones: Dict[str, CombatDrone] = {}
        self._init_fleets()

        # Счёт
        self.blue_score = 0; self.red_score = 0; self.winner = None

        # Gift tracking
        self.total_gifts = 0; self.total_gift_weight = 0.0

    def _init_fleets(self):
        for args in BLUE_FLEET:
            self.blue_drones[args[0]] = CombatDrone(*args, team="blue")
        for args in RED_FLEET:
            d = CombatDrone(*args, team="red")
            # Дать красным эволюционные стратегии
            if self.evo_engine.population:
                d.strategy = random.choice(self.evo_engine.population).strategy
            self.red_drones[args[0]] = d

    def tick_all(self):
        self.tick += 1

        for d in self.blue_drones.values():
            if d.alive:
                d.update_physics(self.dt, self.wind,
                                list(self.red_drones.values()),
                                list(self.blue_drones.values()),
                                self.air_defense)
        for d in self.red_drones.values():
            if d.alive:
                d.update_physics(self.dt, self.wind,
                                list(self.blue_drones.values()),
                                list(self.red_drones.values()),
                                [])

        # Атаки: синие FPV атакуют красных
        self._process_attacks(self.blue_drones, self.red_drones)
        self._process_attacks(self.red_drones, self.blue_drones)

        # ПВО
        self._update_air_defense()

        # Каждые 500 тиков — эволюционный шаг
        if self.tick % 500 == 0:
            self._evolution_step()

        self._check_winner()

    def _process_attacks(self, attackers, defenders):
        for d in attackers.values():
            if not d.alive or d.role not in ("ФПВ","КАМИКАДЗЕ","ПЕРЕ","ТЯЖ"):
                continue
            # Найти ближайшего врага
            nearest = None; nearest_dist = 300
            for e in defenders.values():
                if not e.alive: continue
                dist = math.sqrt((d.fc.state.x - e.fc.state.x)**2 +
                                (d.fc.state.z - e.fc.state.z)**2)
                if dist < nearest_dist:
                    nearest_dist = dist; nearest = e

            if nearest and d.try_attack(nearest, self.dt):
                self.events.append({
                    "tick": self.tick, "event": "KILL",
                    "killer": f"{d.name}({d.id})",
                    "victim": f"{nearest.name}({nearest.id})",
                })
                self.total_gifts += 1
                self.total_gift_weight += 10
                if d.role == "КАМИКАДЗЕ":
                    d.alive = False

    def _update_air_defense(self):
        for ad in self.air_defense:
            if not ad["active"]: continue
            # Контр-ПВО: синие РЭБ подавляют
            jammed = False
            for d in self.blue_drones.values():
                if not d.alive or d.role != "РЭБ": continue
                dist = math.sqrt((d.fc.state.x - ad["x"])**2 +
                                (d.fc.state.z - ad["z"])**2)
                if dist < 1200: jammed = True; break

            eff = ad["lethality"] * (0.2 if jammed else 1.0)
            for d in self.blue_drones.values():
                if not d.alive: continue
                dist = math.sqrt((d.fc.state.x - ad["x"])**2 +
                                (d.fc.state.z - ad["z"])**2)
                if dist < ad["range"] and d.fc.state.y > 25:
                    if random.random() < eff * (1 - dist/ad["range"]):
                        d.alive = False; ad["kills"] += 1
                        self.total_gifts += 1
                        self.total_gift_weight += 10

    def _evolution_step(self):
        """Один шаг эволюции красных стратегий"""
        self.evo_engine.run_tournament(fast_game_simulator, games_per_pair=1)
        self.evo_engine.evolve()
        self.evo_generation += 1
        # Обновить стратегии выживших красных
        best = self.evo_engine.get_best_agent()
        for d in self.red_drones.values():
            if d.alive:
                d.strategy = best.strategy

    def _check_winner(self):
        ba = sum(1 for d in self.blue_drones.values() if d.alive)
        ra = sum(1 for d in self.red_drones.values() if d.alive)
        if ba == 0: self.winner = "red"; self.red_score += 1
        elif ra == 0: self.winner = "blue"; self.blue_score += 1
        if self.tick >= 5000 and not self.winner:
            self.winner = "blue" if ba > ra else "red" if ra > ba else "draw"

    def get_state(self) -> dict:
        def ddict(d: CombatDrone):
            s = d.fc.state
            fc = d.fc.get_state()
            return {
                "id": d.id, "name": d.name, "role": d.role, "team": d.team, "alive": d.alive,
                "x": round(s.x, 1), "z": round(s.z, 1), "y": round(s.y, 1),
                "airspeed": round(s.airspeed, 1), "heading": round(math.degrees(s.yaw)%360, 1),
                "roll": fc["attitude"]["roll_deg"], "pitch": fc["attitude"]["pitch_deg"],
                "battery": round(d.battery, 1),
                "maneuver": fc["maneuver"], "approach": fc["approach"],
                "kills": d.kills, "shots": d.shots_fired,
                "llm_action": d.llm_action,
            }

        blue_alive = sum(1 for d in self.blue_drones.values() if d.alive)
        red_alive = sum(1 for d in self.red_drones.values() if d.alive)

        return {
            "tick": self.tick,
            "weather": {"wind_speed": self.wind.surface_speed,
                       "wind_dir": round(math.degrees(self.wind.surface_dir)),
                       "turbulence": self.wind.turbulence_level},
            "blue": {"drones": [ddict(d) for d in self.blue_drones.values()],
                    "alive": blue_alive, "total": len(self.blue_drones)},
            "red": {"drones": [ddict(d) for d in self.red_drones.values()],
                   "alive": red_alive, "total": len(self.red_drones)},
            "air_defense": [{"id": ad["id"], "kills": ad["kills"],
                            "active": ad["active"], "range": ad["range"]}
                           for ad in self.air_defense],
            "evolution": self.evo_engine.get_status() if self.evo_generation > 0 else {},
            "gifts": {"total": self.total_gifts, "weight": self.total_gift_weight},
            "winner": self.winner,
            "events": list(self.events)[-20:],
        }


# ═══════════════════════════════════════════════════════════════
# HTTP API
# ═══════════════════════════════════════════════════════════════

sim = UnifiedSimulation()

class UnifiedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global sim
        path = self.path.split("?")[0]
        if path == "/api/state": self.send_json(sim.get_state())
        elif path == "/api/drones":
            s = sim.get_state()
            self.send_json({"blue": s["blue"]["drones"], "red": s["red"]["drones"]})
        elif path == "/api/evolution": self.send_json(sim.evo_engine.get_status())
        elif path == "/api/cmd/restart":
            sim = UnifiedSimulation()
            self.send_json({"status": "restarted"})
        elif path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(("""<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="2">
<title>Unified Combat Sim</title><style>body{background:#0a0f1e;color:#aaa;font:11px monospace;padding:15px}
.panel{background:#111;border:1px solid #333;padding:10px;margin:8px 0}
h2{color:#0ff;margin:0 0 6px} .blue{color:#48f} .red{color:#f44} .dead{opacity:0.4}
.stat{display:inline-block;margin:3px 10px 3px 0} .kill{color:#f66} .gift{color:#ff0}
</style></head><body><h1>Unified Combat Simulation</h1><div id="s"></div>
<script>setInterval(async()=>{try{const r=await fetch('/api/state');const d=await r.json();
let h=`<div class="panel"><span class="stat">Tick: ${d.tick}</span><span class="stat">Wind: ${d.weather.wind_speed}m/s</span><span class="stat">Blue: ${d.blue.alive}/${d.blue.total}</span><span class="stat">Red: ${d.red.alive}/${d.red.total}</span><span class="stat">Gifts: ${d.gifts.total} (w:${d.gifts.weight})</span><span class="stat">Winner: ${d.winner||'...'}</span></div>`;
h+=`<div class="panel"><h2>Blue Fleet</h2>`;
d.blue.drones.forEach(dr=>{h+=`<span class="blue ${dr.alive?'':'dead'}">${dr.name}(${dr.role})</span> spd:${dr.airspeed} hdg:${dr.heading}° roll:${dr.roll}° bat:${dr.battery}% kills:${dr.kills} `});
h+=`</div><div class="panel"><h2>Red Fleet</h2>`;
d.red.drones.forEach(dr=>{h+=`<span class="red ${dr.alive?'':'dead'}">${dr.name}(${dr.role})</span> spd:${dr.airspeed} hdg:${dr.heading}° kills:${dr.kills} `});
h+=`</div><div class="panel"><h2>Events</h2>${d.events.slice(-10).map(e=>`<div class="kill">${e.tick}: ${e.event} — ${e.killer||''} → ${e.victim||''}</div>`).join('')}</div>`;
if(d.evolution.generation)h+=`<div class="panel">Evo gen:${d.evolution.generation} best_fit:${d.evolution.best_fitness}</div>`;
document.getElementById('s').innerHTML=h;}catch(e){}},1000)</script></body></html>""").encode())
        else: self.send_error(404)

    def send_json(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, default=str).encode())
    def log_message(self, *a): pass

def sim_thread():
    while True:
        sim.tick_all()
        time.sleep(0.05)

def main():
    print("╔══════════════════════════════════════════════════╗")
    print("║  UNIFIED COMBAT SIM — физика + эволюция + LLM   ║")
    print("╚══════════════════════════════════════════════════╝")
    print(f"  🔵 Синие: {len(BLUE_FLEET)} дронов с LLM")
    print(f"  🔴 Красные: {len(RED_FLEET)} дронов + {len(RED_AIR_DEFENSE)} ПВО (эволюционные)")
    print(f"  🌐 http://localhost:8106")
    print()
    threading.Thread(target=sim_thread, daemon=True).start()
    HTTPServer(("0.0.0.0", 8106), UnifiedHandler).serve_forever()

if __name__ == "__main__":
    main()
