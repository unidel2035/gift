#!/usr/bin/env python3
"""
swarm_game_server.py — Игровой сервер: FPV + управление роем

Бэкенд для 3D-игры. Смешивает CentaurArena с game-specific API.

Эндпоинты:
  GET  /api/game/state       — полное состояние игры (все дроны, цели, частицы)
  POST /api/game/pilot/move  — движение пилота (вектор джойстика)
  POST /api/game/pilot/attack— атака выбранной цели
  POST /api/game/swarm/order — приказ рою (attack/defend/regroup)
  GET  /api/game/suggestion  — что предлагает Serafim прямо сейчас
  POST /api/game/feedback    — пилот оценил решение Serafim (👍/👎)
  GET  /api/game/export      — экспорт обучающих данных

Запуск:
  python3 src/digital_twin/swarm_game_server.py --port 8500
"""

import asyncio, json, time, math, os, sys, random, threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from collections import deque
from enum import Enum

sys.path.insert(0, os.path.dirname(__file__))
from serafim_agent import SerafimAgent, TacticalSituation, SerafimAction
from centaur_cockpit import CentaurCockpit
from training_arena import CombatAgent, CombatPhase, BLUE_FLEET, RED_FLEET
from social_metrics import SocialMetricsTracker


# ═══════════════════════════════════════════════════════════════
# ИГРОВОЙ МИР
# ═══════════════════════════════════════════════════════════════

@dataclass
class GameDrone:
    """Дрон в игровом мире."""
    id: str; name: str; team: str; role: str
    x: float = 0; y: float = 100; z: float = 0
    vx: float = 0; vy: float = 0; vz: float = 0
    heading: float = 0; pitch: float = 0; roll: float = 0
    battery: float = 100
    alive: bool = True
    kills: int = 0
    is_pilot: bool = False
    is_serafim: bool = True
    target_id: str = ""
    action: str = "patrol"
    suggestion: str = ""  # что предлагает Serafim


@dataclass
class GameTarget:
    """Наземная цель."""
    id: str; name: str; x: float; z: float
    destroyed: bool = False


class SwarmGameWorld:
    """
    Игровой мир: 3D-пространство с дронами, целями, ландшафтом.
    """

    def __init__(self, pilot_name: str = "Сын", pilot_age: int = 14):
        self.pilot_name = pilot_name
        self.pilot_age = pilot_age
        self.map_size = 4000
        self.tick_count = 0
        self.winner = None

        # Дроны
        self.drones: Dict[str, GameDrone] = {}
        self._init_drones()

        # Цели
        self.targets: List[GameTarget] = []
        self._init_targets()

        # Частицы (взрывы, трассеры)
        self.particles: deque = deque(maxlen=100)

        # Serafim
        self.serafim_agents: Dict[str, SerafimAgent] = {}
        for fid, drone in self.drones.items():
            if drone.team == "blue" and not drone.is_pilot:
                self.serafim_agents[fid] = SerafimAgent(fid, drone.role, "blue")

        # Кентавр
        self.cockpit = CentaurCockpit("pilot-1", pilot_name, pilot_age)

        # Метрики
        self.metrics = SocialMetricsTracker()
        self.metrics.set_initial_conditions(
            agents_count=len([d for d in self.drones.values() if d.team == "blue"]),
            targets_count=len(self.targets),
        )

        # Счёт
        self.score = 0
        self.kills = 0
        self.deaths = 0

    def _init_drones(self):
        """Создать дроны для игры."""
        # Синие (наши) — 5 дронов: 1 пилот + 4 Serafim
        blue_specs = [
            ("blue-1", "Пилот", "РАЗВ", True),   # пилот-человек
            ("blue-2", "Сокол", "РАЗВ", False),
            ("blue-3", "Пчела", "ФПВ", False),
            ("blue-4", "Волк", "ФПВ", False),
            ("blue-5", "Заря", "РЕТР", False),
        ]
        for fid, name, role, is_pilot in blue_specs:
            d = GameDrone(
                id=fid, name=name, team="blue", role=role,
                x=random.uniform(-300, 300),
                y=120 if role != "РЕТР" else 350,
                z=random.uniform(-300, 300),
                heading=random.uniform(0, 360),
                is_pilot=is_pilot,
                is_serafim=not is_pilot,
            )
            self.drones[fid] = d

        # Красные (враги) — 8 дронов
        red_specs = [
            ("red-1", "Шахид-1", "КАМИКАДЗЕ"),
            ("red-2", "Шахид-2", "КАМИКАДЗЕ"),
            ("red-3", "Глаз-1", "РАЗВ"),
            ("red-4", "Глаз-2", "РАЗВ"),
            ("red-5", "Коготь-1", "ФПВ"),
            ("red-6", "Коготь-2", "ФПВ"),
            ("red-7", "Мост-1", "РЕТР"),
            ("red-8", "Страж-1", "ПЕРЕ"),
        ]
        for fid, name, role in red_specs:
            d = GameDrone(
                id=fid, name=name, team="red", role=role,
                x=random.uniform(800, 1800),
                y=random.uniform(80, 200),
                z=random.uniform(800, 1800),
                heading=random.uniform(0, 360),
                is_serafim=True,
            )
            self.drones[fid] = d

    def _init_targets(self):
        """Создать наземные цели."""
        target_specs = [
            ("tgt-1", "Опорник", 1200, 900),
            ("tgt-2", "РЭБ", -1000, 1100),
            ("tgt-3", "Склад БК", 1500, -800),
            ("tgt-4", "КП", -1300, -700),
            ("tgt-5", "Техника", 600, -1100),
        ]
        for tid, name, x, z in target_specs:
            self.targets.append(GameTarget(id=tid, name=name, x=x, z=z))

    # ═══════════════════════════════════════════════════════════
    # ИГРОВОЙ ТИК
    # ═══════════════════════════════════════════════════════════

    def tick(self, pilot_input: dict = None) -> dict:
        """Один тик игры."""
        self.tick_count += 1
        dt = 0.1
        events = []

        pilot_drone = self._get_pilot_drone()

        # 1. Обработать ввод пилота
        if pilot_input and pilot_drone and pilot_drone.alive:
            self._apply_pilot_input(pilot_drone, pilot_input, dt, events)

        # 2. Обновить Serafim-агентов
        for fid, drone in self.drones.items():
            if not drone.alive or drone.is_pilot:
                continue
            self._update_serafim_drone(drone, dt, events)

        # 3. Обновить вражеские дроны (простые правила)
        for fid, drone in self.drones.items():
            if not drone.alive or drone.team != "red":
                continue
            self._update_enemy_drone(drone, dt, events)

        # 4. Физика: движение
        for drone in self.drones.values():
            if not drone.alive:
                continue
            drone.x += drone.vx * dt
            drone.y += drone.vy * dt
            drone.z += drone.vz * dt
            drone.y = max(5, min(500, drone.y))
            drone.x = max(-self.map_size/2, min(self.map_size/2, drone.x))
            drone.z = max(-self.map_size/2, min(self.map_size/2, drone.z))

        # 5. Проверка победы
        blue_alive = sum(1 for d in self.drones.values() if d.team == "blue" and d.alive)
        red_alive = sum(1 for d in self.drones.values() if d.team == "red" and d.alive)
        targets_alive = sum(1 for t in self.targets if not t.destroyed)

        if red_alive == 0 and targets_alive == 0:
            self.winner = "blue"
        elif blue_alive == 0:
            self.winner = "red"

        return {
            "tick": self.tick_count,
            "winner": self.winner,
            "blue_alive": blue_alive,
            "red_alive": red_alive,
            "targets_alive": targets_alive,
            "events": events,
        }

    def _get_pilot_drone(self) -> Optional[GameDrone]:
        for d in self.drones.values():
            if d.is_pilot and d.alive:
                return d
        return None

    def _apply_pilot_input(self, drone: GameDrone, inp: dict, dt: float, events: list):
        """Применить ввод пилота к дрону."""
        speed = 60  # м/с крейсерская

        # Джойстик: forward/back, left/right, up/down
        fwd = inp.get("forward", 0)      # -1..1
        right = inp.get("right", 0)      # -1..1
        up = inp.get("up", 0)            # -1..1

        # Конвертировать heading в вектор
        hdg_rad = math.radians(drone.heading)
        drone.vx = math.sin(hdg_rad) * fwd * speed + math.cos(hdg_rad) * right * speed * 0.5
        drone.vz = math.cos(hdg_rad) * fwd * speed - math.sin(hdg_rad) * right * speed * 0.5
        drone.vy = up * speed * 0.5

        # Поворот (мышь/стик)
        turn = inp.get("turn", 0)        # -1..1
        drone.heading += turn * 90 * dt
        drone.heading %= 360

        # Pitch
        pitch_input = inp.get("pitch", 0)  # -1..1
        drone.pitch += pitch_input * 45 * dt
        drone.pitch = max(-60, min(60, drone.pitch))

        # Атака
        if inp.get("attack") and inp.get("target_id"):
            target_id = inp["target_id"]
            # Найти цель
            target = None
            target_dist = float('inf')
            for t in self.targets:
                if t.id == target_id and not t.destroyed:
                    dist = math.sqrt((drone.x - t.x)**2 + (drone.z - t.z)**2)
                    if dist < 100:  # в радиусе атаки
                        t.destroyed = True
                        drone.kills += 1
                        self.kills += 1
                        self.score += 100
                        events.append({"event": "TARGET_DESTROYED", "target": t.name, "by": drone.name})
                        self.particles.append({"type": "explosion", "x": t.x, "y": 0, "z": t.z, "life": 1.0})
                        break

            # Атака вражеского дрона
            for eid, enemy in self.drones.items():
                if enemy.team != "red" or not enemy.alive:
                    continue
                dist = math.sqrt((drone.x - enemy.x)**2 + (drone.y - enemy.y)**2 + (drone.z - enemy.z)**2)
                if dist < 30:
                    enemy.alive = False
                    drone.kills += 1
                    self.kills += 1
                    self.score += 50
                    self.deaths += 1  # вражеского
                    events.append({"event": "DRONE_KILL", "victim": enemy.name, "by": drone.name})
                    self.particles.append({"type": "explosion", "x": enemy.x, "y": enemy.y, "z": enemy.z, "life": 1.0})

        # Батарея
        drone.battery -= 0.02 * (1 + abs(fwd) + abs(up))

    def _update_serafim_drone(self, drone: GameDrone, dt: float, events: list):
        """Обновить Serafim-управляемый дрон."""
        serafim = self.serafim_agents.get(drone.id)
        if not serafim:
            return

        # Упрощённо: каждые 5 тиков запрашиваем решение
        if self.tick_count % 5 == 0:
            # Найти ближайшего врага
            nearest_enemy = None
            nearest_dist = float('inf')
            for eid, enemy in self.drones.items():
                if enemy.team == drone.team or not enemy.alive:
                    continue
                dist = math.sqrt((drone.x - enemy.x)**2 + (drone.z - enemy.z)**2)
                if dist < nearest_dist:
                    nearest_dist = dist
                    nearest_enemy = enemy

            sit = TacticalSituation(
                agent_id=drone.id, agent_role=drone.role, agent_team=drone.team,
                x=drone.x, y=drone.y, z=drone.z,
                battery_pct=drone.battery,
                heading_deg=drone.heading,
                enemies=[{"id": nearest_enemy.id, "role": nearest_enemy.role, "dist_m": nearest_dist}]
                if nearest_enemy else [],
                nearest_enemy_dist=nearest_dist,
                friendlies_alive=sum(1 for d in self.drones.values() if d.team == drone.team and d.alive),
                enemies_alive=sum(1 for d in self.drones.values() if d.team != drone.team and d.alive),
                mission_phase=drone.action,
            )

            try:
                decision = serafim.decide_sync(sit, timeout_s=2)
                drone.action = decision.action.value
                drone.suggestion = decision.reason[:100]
            except:
                drone.action = "patrol"

        # Применить действие
        if drone.action == "attack":
            # Найти ближайшего врага и лететь к нему
            nearest_enemy = None
            nearest_dist = float('inf')
            for eid, enemy in self.drones.items():
                if enemy.team == drone.team or not enemy.alive:
                    continue
                dist = math.sqrt((drone.x - enemy.x)**2 + (drone.z - enemy.z)**2)
                if dist < nearest_dist:
                    nearest_dist = dist
                    nearest_enemy = enemy

            if nearest_enemy and nearest_dist < 2000:
                speed = 50 if drone.role == "ФПВ" else 30
                drone.vx = (nearest_enemy.x - drone.x) / max(nearest_dist, 1) * speed
                drone.vz = (nearest_enemy.z - drone.z) / max(nearest_dist, 1) * speed
                drone.heading = math.degrees(math.atan2(drone.vx, drone.vz))

                if nearest_dist < 20:
                    nearest_enemy.alive = False
                    drone.kills += 1
                    events.append({"event": "SERAFIM_KILL", "victim": nearest_enemy.name, "by": drone.name})
                    self.particles.append({"type": "explosion", "x": nearest_enemy.x, "y": nearest_enemy.y, "z": nearest_enemy.z, "life": 1.0})
            else:
                drone.vx = drone.vz = 0
        elif drone.action == "rtb":
            dist = math.sqrt(drone.x**2 + drone.z**2)
            if dist > 1:
                drone.vx = -drone.x / dist * 30
                drone.vz = -drone.z / dist * 30
        else:
            drone.vx = 10 * math.sin(self.tick_count * 0.01 + hash(drone.id) % 50)
            drone.vz = 10 * math.cos(self.tick_count * 0.01 + hash(drone.id) % 50)

        drone.battery -= 0.01
        if drone.battery <= 0:
            drone.alive = False

    def _update_enemy_drone(self, drone: GameDrone, dt: float, events: list):
        """Простые правила для вражеских дронов."""
        # Найти ближайшего синего
        nearest_blue = None
        nearest_dist = float('inf')
        for fid, friendly in self.drones.items():
            if friendly.team != "blue" or not friendly.alive:
                continue
            dist = math.sqrt((drone.x - friendly.x)**2 + (drone.z - friendly.z)**2)
            if dist < nearest_dist:
                nearest_dist = dist
                nearest_blue = friendly

        if nearest_blue and nearest_dist < 2000:
            speed = 35 if drone.role == "ФПВ" else 25 if drone.role == "КАМИКАДЗЕ" else 20
            drone.vx = (nearest_blue.x - drone.x) / max(nearest_dist, 1) * speed
            drone.vz = (nearest_blue.z - drone.z) / max(nearest_dist, 1) * speed
            drone.heading = math.degrees(math.atan2(drone.vx, drone.vz))

            if nearest_dist < 15:
                nearest_blue.alive = False
                if nearest_blue.is_pilot:
                    self.deaths += 1
                drone.kills += 1
                events.append({"event": "ENEMY_KILL", "victim": nearest_blue.name, "by": drone.name})
                self.particles.append({"type": "explosion", "x": nearest_blue.x, "y": nearest_blue.y, "z": nearest_blue.z, "life": 1.0})
        else:
            drone.vx = 8 * math.sin(self.tick_count * 0.008 + hash(drone.id) % 40)
            drone.vz = 8 * math.cos(self.tick_count * 0.008 + hash(drone.id) % 40)

        drone.battery -= 0.01
        if drone.battery <= 0:
            drone.alive = False

    # ═══════════════════════════════════════════════════════════
    # СОСТОЯНИЕ ДЛЯ КЛИЕНТА
    # ═══════════════════════════════════════════════════════════

    def get_state(self) -> dict:
        """Полное состояние для 3D-клиента."""
        pilot = self._get_pilot_drone()

        # Дроны
        drones_state = []
        for d in self.drones.values():
            drones_state.append({
                "id": d.id, "name": d.name, "team": d.team, "role": d.role,
                "x": round(d.x, 1), "y": round(d.y, 1), "z": round(d.z, 1),
                "vx": round(d.vx, 1), "vy": round(d.vy, 1), "vz": round(d.vz, 1),
                "heading": round(d.heading, 1), "pitch": round(d.pitch, 1),
                "battery": round(d.battery, 1),
                "alive": d.alive, "isPilot": d.is_pilot,
                "kills": d.kills,
                "action": d.action,
                "suggestion": d.suggestion[:100],
            })

        # Цели
        targets_state = []
        for t in self.targets:
            targets_state.append({
                "id": t.id, "name": t.name,
                "x": t.x, "z": t.z,
                "destroyed": t.destroyed,
            })

        # Частицы
        particles_state = []
        for p in list(self.particles):
            if p["life"] > 0:
                particles_state.append(p.copy())
                p["life"] -= 0.02

        # Serafim-предложение для пилота
        suggestion = None
        if pilot and pilot.alive:
            sit = self._build_pilot_situation(pilot)
            try:
                serafim = self.serafim_agents.get("blue-2")  # любой Serafim
                if serafim:
                    dec = serafim.decide_sync(sit, timeout_s=3)
                    suggestion = {"action": dec.action.value, "reason": dec.reason[:200]}
            except:
                pass

        return {
            "tick": self.tick_count,
            "winner": self.winner,
            "score": self.score,
            "kills": self.kills,
            "deaths": self.deaths,
            "blueAlive": sum(1 for d in self.drones.values() if d.team == "blue" and d.alive),
            "redAlive": sum(1 for d in self.drones.values() if d.team == "red" and d.alive),
            "targetsAlive": sum(1 for t in self.targets if not t.destroyed),
            "pilot": {
                "x": round(pilot.x, 1), "y": round(pilot.y, 1), "z": round(pilot.z, 1),
                "heading": round(pilot.heading, 1), "pitch": round(pilot.pitch, 1),
                "battery": round(pilot.battery, 1),
            } if pilot and pilot.alive else None,
            "drones": drones_state,
            "targets": targets_state,
            "particles": particles_state,
            "suggestion": suggestion,
            "mapSize": self.map_size,
        }

    def _build_pilot_situation(self, pilot: GameDrone) -> TacticalSituation:
        enemies = []
        nearest_dist = float('inf')
        for d in self.drones.values():
            if d.team == "red" and d.alive:
                dist = math.sqrt((pilot.x - d.x)**2 + (pilot.z - d.z)**2)
                if dist < nearest_dist:
                    nearest_dist = dist
                enemies.append({"id": d.id, "role": d.role, "dist_m": dist})

        return TacticalSituation(
            agent_id="pilot-1", agent_role="РАЗВ", agent_team="blue",
            x=pilot.x, y=pilot.y, z=pilot.z,
            battery_pct=pilot.battery,
            heading_deg=pilot.heading,
            enemies=enemies,
            nearest_enemy_dist=nearest_dist,
            friendlies_alive=sum(1 for d in self.drones.values() if d.team == "blue" and d.alive and not d.is_pilot),
            enemies_alive=sum(1 for d in self.drones.values() if d.team == "red" and d.alive),
            mission_phase=pilot.action,
        )


# ═══════════════════════════════════════════════════════════════
# HTTP СЕРВЕР
# ═══════════════════════════════════════════════════════════════

class SwarmGameServer:
    def __init__(self, world: SwarmGameWorld, port: int = 8500):
        self.world = world
        self.port = port

    def start(self):
        world = self.world

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/api/game/state":
                    state = world.get_state()
                    self._json(state)

                elif self.path == "/api/game/suggestion":
                    pilot = world._get_pilot_drone()
                    if pilot and pilot.alive:
                        sit = world._build_pilot_situation(pilot)
                        serafim = world.serafim_agents.get("blue-2")
                        if serafim:
                            dec = serafim.decide_sync(sit, timeout_s=3)
                            self._json({"action": dec.action.value, "reason": dec.reason[:200]})
                        else:
                            self._json({"action": "patrol", "reason": "нет связи с Serafim"})
                    else:
                        self._json({"action": "dead", "reason": "пилот уничтожен"})

                elif self.path.startswith("/api/game/export"):
                    dataset = world.cockpit.export_training_data()
                    self._json({"count": len(dataset), "examples": dataset})

                else:
                    self.send_response(404); self.end_headers()

            def do_POST(self):
                content_length = int(self.headers.get('Content-Length', 0))
                body = json.loads(self.rfile.read(content_length)) if content_length > 0 else {}

                if self.path == "/api/game/pilot/move":
                    result = world.tick(pilot_input=body)
                    self._json(result)

                elif self.path == "/api/game/pilot/attack":
                    result = world.tick(pilot_input={"attack": True, "target_id": body.get("target_id", "")})
                    self._json(result)

                elif self.path == "/api/game/swarm/order":
                    # Приказ всему рою: attack/defend/regroup
                    order = body.get("order", "attack")
                    for fid, drone in world.drones.items():
                        if drone.team == "blue" and not drone.is_pilot and drone.alive:
                            drone.action = order
                    self._json({"order": order, "status": "sent"})

                elif self.path == "/api/game/feedback":
                    # Пилот оценил предложение Serafim
                    accepted = body.get("accepted", True)
                    if accepted:
                        world.cockpit.pilot_decide("", accept_suggestion=True)
                    else:
                        world.cockpit.pilot_decide(
                            body.get("action", "observe"),
                            accept_suggestion=False,
                            reasoning=body.get("reason", ""),
                        )
                    world.cockpit.record_outcome(
                        "correct_rejection" if not accepted else "kill",
                        body.get("lesson", ""),
                    )
                    self._json({"ok": True, "experiences": len(world.cockpit.export_training_data())})

                else:
                    self.send_response(404); self.end_headers()

            def _json(self, data):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

        server = HTTPServer(("0.0.0.0", self.port), Handler)
        print(f"\n╔══════════════════════════════════════════════════╗")
        print(f"║  SWARM GAME SERVER                               ║")
        print(f"║  Пилот: {world.pilot_name} ({world.pilot_age} лет)                       ║")
        print(f"║  API: http://localhost:{self.port}/api/game/state    ║")
        print(f"╚══════════════════════════════════════════════════╝")

        # Запустить игровой цикл
        def game_loop():
            while True:
                world.tick()
                time.sleep(0.1)  # 10Hz

        threading.Thread(target=game_loop, daemon=True).start()
        server.serve_forever()


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8500)
    p.add_argument("--pilot-name", default="Сын")
    p.add_argument("--pilot-age", type=int, default=14)
    args = p.parse_args()

    world = SwarmGameWorld(pilot_name=args.pilot_name, pilot_age=args.pilot_age)
    server = SwarmGameServer(world, port=args.port)
    server.start()
