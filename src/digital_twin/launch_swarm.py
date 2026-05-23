#!/usr/bin/env python3
"""
launch_swarm.py — Рой с Serafim LLM как мозгом каждого дрона

Архитектура:
  Каждый дрон → свой Serafim LLM запрос → тактическое решение
  Пресет = ХАРАКТЕР (промпт), не правила
  LLM решает: куда лететь, атаковать ли, когда отступить

  Запросы асинхронные (ThreadPoolExecutor, 4 worker'а)
  Каждый дрон думает каждые N тиков (стратегически)
  Между запросами — исполняет последнее решение LLM

Флот: 20 синих + 10 красных + 3 ПВО
"""

import math, random, time, json, threading, os, sys, urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import List, Dict, Optional, Tuple
from collections import deque
from concurrent.futures import ThreadPoolExecutor, Future

sys.path.insert(0, '/home/unidel/gift/src/digital_twin')

OLLAMA_URL = "http://localhost:11434/api/generate"
SERAFIM_MODEL = "serafim-1.5b"
llm_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="serafim")

# ═══════════════════════════════════════════════════════════════
# ХАРАКТЕРЫ — промпт-стиль для Serafim
# ═══════════════════════════════════════════════════════════════

CHARACTER_PROMPTS = {
    "stealth": "Ты скрытный разведчик. Избегаешь боя. Наблюдаешь и докладываешь.",
    "hunter": "Ты агрессивный охотник. Ищешь врага и уничтожаешь. Быстр и решителен.",
    "guardian": "Ты страж периметра. Защищаешь базу. Перехватываешь нарушителей.",
    "relay": "Ты ретранслятор. Держишь высоту и mesh-сеть. В бой не вступаешь.",
    "kamikaze": "Ты камикадзе. Одноразовый. Ищешь самую ценную цель и взрываешься.",
    "jammer": "Ты постановщик помех. Глушишь врага. Держишь позицию.",
    "heavy_strike": "Ты тяжёлый ударный. Нетороплив, но мощен. Бьёшь точно.",
}

BEHAVIOR_PRESETS = {
    "stealth": {"altitude": 50, "speed": 20, "sensor_range": 300, "emission": "passive"},
    "hunter": {"altitude": 80, "speed": 55, "sensor_range": 600, "emission": "active"},
    "guardian": {"altitude": 100, "speed": 30, "sensor_range": 500, "emission": "active"},
    "relay": {"altitude": 350, "speed": 10, "sensor_range": 1000, "emission": "active"},
    "kamikaze": {"altitude": 30, "speed": 70, "sensor_range": 400, "emission": "passive"},
    "jammer": {"altitude": 120, "speed": 25, "sensor_range": 800, "emission": "active"},
    "heavy_strike": {"altitude": 200, "speed": 40, "sensor_range": 700, "emission": "active"},
}

# ═══════════════════════════════════════════════════════════════
# ФЛОТ
# ═══════════════════════════════════════════════════════════════

BLUE_FLEET_FULL = [
    ("B-S1","РАЗВ","Ворон","stealth",-200,-200,50,45),
    ("B-S2","РАЗВ","Сова","stealth",200,-300,55,135),
    ("B-S3","РАЗВ","Сокол","stealth",0,200,60,270),
    ("B-F1","ФПВ","Пчела","hunter",400,300,80,0),
    ("B-F2","ФПВ","Волк","hunter",-400,300,80,0),
    ("B-F3","ФПВ","Ласка","hunter",400,-300,80,0),
    ("B-F4","ФПВ","Барс","hunter",-400,-300,80,0),
    ("B-L1","ФПВ","Шершень","hunter",0,400,85,180),
    ("B-P1","ПЕРЕ","Ястреб","guardian",600,0,120,90),
    ("B-P2","ПЕРЕ","Орёл","guardian",-600,0,120,270),
    ("B-R1","РЕТР","Заря","relay",0,-500,350,0),
    ("B-R2","РЕТР","Маяк","relay",0,500,360,180),
    ("B-G1","НАЗМ","База-З","guardian",-500,-500,0,0),
    ("B-G2","НАЗМ","База-Ц","guardian",0,0,0,0),
    ("B-G3","НАЗМ","База-В","guardian",500,500,0,0),
    ("B-E1","РЭБ","Гроза","jammer",300,-500,130,45),
    ("B-E2","РЭБ","Шторм","jammer",-300,500,130,225),
    ("B-K1","КАМИКАДЗЕ","Искра","kamikaze",500,-400,25,0),
    ("B-K2","КАМИКАДЗЕ","Факел","kamikaze",-500,400,25,180),
    ("B-H1","ТЯЖ","Атлант","heavy_strike",700,0,200,90),
]

RED_FLEET_FULL = [
    ("R-E1","КАМИКАДЗЕ","Шахид-1","kamikaze",1200,800,25,180),
    ("R-E2","КАМИКАДЗЕ","Шахид-2","kamikaze",1000,-700,25,180),
    ("R-E3","РАЗВ","Глаз-1","stealth",800,1000,60,270),
    ("R-E4","РАЗВ","Глаз-2","stealth",-900,900,65,90),
    ("R-E5","ФПВ","Коготь-1","hunter",1100,300,80,0),
    ("R-E6","ФПВ","Коготь-2","hunter",-1000,-400,80,0),
    ("R-E7","РЕТР","Мост-1","relay",500,1200,350,0),
    ("R-E8","ПЕРЕ","Страж-1","guardian",1300,0,100,90),
    ("R-E9","ПЕРЕ","Страж-2","guardian",-1200,0,100,270),
    ("R-E10","РЭБ","Глушилка","jammer",0,-1100,140,0),
]

RED_AIR_DEFENSE_FULL = [
    ("R-AD1","ПВО-ЗРК",1500,800,2000,0.003),
    ("R-AD2","ПВО-ЗРК",-1200,-600,2000,0.003),
    ("R-AD3","ПВО-РЛС",0,1500,2500,0.001),
]

# ═══════════════════════════════════════════════════════════════
# LLM-ЗАПРОС (асинхронный)
# ═══════════════════════════════════════════════════════════════

def query_serafim_async(drone_id: str, drone_name: str, prompt: str) -> Future:
    """Асинхронный запрос к Serafim LLM"""
    def _query():
        try:
            body = json.dumps({
                "model": SERAFIM_MODEL,
                "prompt": prompt,
                "stream": False,
                "keep_alive": 300,  # держать модель в памяти 5 минут
                "options": {"temperature": 0.3, "num_predict": 25, "stop": ["\n\n"]}
            }).encode()
            req = urllib.request.Request(OLLAMA_URL, body, {"Content-Type": "application/json"})
            resp = urllib.request.urlopen(req, timeout=20)
            data = json.loads(resp.read())
            return {
                "drone_id": drone_id,
                "response": data.get("response", "").strip(),
                "inference_ms": data.get("eval_duration", 0) // 1_000_000,
                "error": None,
            }
        except Exception as e:
            return {"drone_id": drone_id, "response": "", "inference_ms": 0, "error": str(e)[:100]}
    return llm_pool.submit(_query)

def parse_llm_decision(response: str, default_action: str = "patrol") -> dict:
    """Извлечь тактическое решение из ответа Serafim"""
    resp_upper = response.upper()

    # Действие
    action = default_action
    if any(w in resp_upper for w in ["АТАК", "ATTACK", "УДАР", "УНИЧТОЖ", "БЕЙ"]):
        action = "attack"
    elif any(w in resp_upper for w in ["ДОМОЙ", "RTB", "ВОЗВРАТ", "БАЗ"]):
        action = "rtb"
    elif any(w in resp_upper for w in ["НАБЛЮД", "OBSERVE", "ЖД", "СТОЙ", "ПАТРУЛ"]):
        action = "patrol"
    elif any(w in resp_upper for w in ["СКРЫТ", "ТИХ", "STEALTH", "ПРЯЧ"]):
        action = "stealth"
    elif any(w in resp_upper for w in ["КАМИКАДЗ", "ЖЕРТВ", "ТАРАН"]):
        action = "kamikaze"

    # Направление (извлекаем из текста)
    heading = None
    for direction, keywords in [
        (0, ["СЕВЕР", "ВВЕРХ", "NORTH"]),
        (90, ["ВОСТОК", "ВПРАВО", "EAST"]),
        (180, ["ЮГ", "ВНИЗ", "SOUTH"]),
        (270, ["ЗАПАД", "ВЛЕВО", "WEST"]),
    ]:
        if any(w in resp_upper for w in keywords):
            heading = direction
            break

    # Приоритет цели
    target_priority = "nearest"
    if any(w in resp_upper for w in ["РЭБ", "EW_STATION", "СТАНЦИ"]):
        target_priority = "ew_station"
    elif any(w in resp_upper for w in ["ПВО", "SAM", "ЗРК"]):
        target_priority = "air_defense"
    elif any(w in resp_upper for w in ["КАМИКАДЗ", "ДРОН"]):
        target_priority = "enemy_drone"

    return {
        "action": action,
        "heading": heading,
        "target_priority": target_priority,
        "raw": response[:200],
    }


# ═══════════════════════════════════════════════════════════════
# ДРОН С LLM-МОЗГОМ
# ═══════════════════════════════════════════════════════════════

class SwarmDrone:
    """Дрон, управляемый Serafim LLM"""

    def __init__(self, drone_id: str, role: str, name: str, preset_name: str,
                 x: float, z: float, y: float, heading: float, team: str):
        self.id = drone_id; self.role = role; self.name = name; self.team = team
        self.preset_name = preset_name
        self.preset = BEHAVIOR_PRESETS.get(preset_name, BEHAVIOR_PRESETS["stealth"])
        self.character = CHARACTER_PROMPTS.get(preset_name, "")

        self.x = x; self.z = z; self.y = y
        self.vx = 0.0; self.vz = 0.0
        self.heading = heading; self.battery = 100.0
        self.phase = "boot"; self.alive = True

        # LLM-мозг
        self.last_llm_decision = {"action": "patrol", "heading": None, "target_priority": "nearest"}
        self.last_llm_response = ""
        self.last_llm_inference_ms = 0
        self.llm_query_interval = random.randint(80, 160)  # каждый дрон думает каждые 4-8s
        self.ticks_since_query = 0
        self.pending_query: Optional[Future] = None
        self.llm_queries_total = 0
        self.llm_errors = 0

        # Статистика
        self.kills = 0; self.deaths = 0
        self.distance_traveled = 0.0; self.gifts_given = 0

        # Платы (lazy)
        self.boards = None

    def needs_llm_query(self) -> bool:
        """Пора ли запросить Serafim?"""
        if self.pending_query is not None:
            return False
        self.ticks_since_query += 1
        return self.ticks_since_query >= self.llm_query_interval

    def request_llm_decision(self, nearby_enemies: list, nearby_friends: list,
                            air_defense_nearby: list, swarm_mgr) -> Optional[Future]:
        """Запросить тактическое решение у Serafim"""
        self.ticks_since_query = 0

        # Строим промпт с полной ситуационной осведомлённостью
        enemy_info = ""
        for i, e in enumerate(nearby_enemies[:3]):
            dist = math.sqrt((self.x-e.x)**2 + (self.z-e.z)**2)
            enemy_info += f"  Враг {e.name} ({e.role}): дист={dist:.0f}м, курс={e.heading:.0f}°, жив={e.alive}\n"

        friend_info = ""
        for f in nearby_friends[:2]:
            dist = math.sqrt((self.x-f.x)**2 + (self.z-f.z)**2)
            friend_info += f"  {f.name} ({f.role}): дист={dist:.0f}м, фаза={f.phase}\n"

        ad_info = ""
        for ad in air_defense_nearby[:2]:
            dist = math.sqrt((self.x-ad["x"])**2 + (self.z-ad["z"])**2)
            ad_info += f"  {ad['id']} ({ad['type']}): дист={dist:.0f}м, опасно={dist<ad['range']}\n"

        prompt = f"""{self.character}
Ситуация: ты {self.name} ({self.role}), команда {self.team}.
Позиция: ({self.x:.0f}, {self.z:.0f}), высота {self.y:.0f}м, курс {self.heading:.0f}°.
Батарея: {self.battery:.0f}%. Фаза: {self.phase}.

Враги рядом ({len(nearby_enemies)}):
{enemy_info or '  нет врагов в зоне видимости'}
Друзья рядом ({len(nearby_friends)}):
{friend_info or '  нет друзей рядом'}
ПВО ({len(air_defense_nearby)}):
{ad_info or '  ПВО не обнаружено'}
Твоё решение (действие, направление, приоритет цели). Кратко:"""

        self.pending_query = query_serafim_async(self.id, self.name, prompt)
        self.llm_queries_total += 1
        return self.pending_query

    def check_llm_response(self) -> bool:
        """Проверить, пришёл ли ответ от Serafim"""
        if self.pending_query is None:
            return False
        if not self.pending_query.done():
            return False
        try:
            result = self.pending_query.result(timeout=0)
            if result["error"]:
                self.llm_errors += 1
            else:
                self.last_llm_response = result["response"]
                self.last_llm_inference_ms = result["inference_ms"]
                self.last_llm_decision = parse_llm_decision(result["response"], self.phase)
        except Exception:
            self.llm_errors += 1
        self.pending_query = None
        return True

    def execute_decision(self, enemy_fleet: Dict, all_enemies: Dict):
        """Исполнить последнее решение LLM (или умолчание)"""
        decision = self.last_llm_decision
        action = decision["action"]
        preset = self.preset
        speed = preset["speed"]

        # Поиск цели согласно приоритету LLM
        target = None
        target_dist = float('inf')
        priority = decision.get("target_priority", "nearest")

        for enemy in enemy_fleet.values():
            if not enemy.alive:
                continue
            dist = math.sqrt((self.x - enemy.x)**2 + (self.z - enemy.z)**2)
            # Приоритет по типу
            if priority == "ew_station" and enemy.role == "РЭБ":
                dist *= 0.3  # приоритет
            elif priority == "air_defense" and enemy.role == "ПВО":
                dist *= 0.3
            elif priority == "enemy_drone" and enemy.role in ("ФПВ", "КАМИКАДЗЕ"):
                dist *= 0.5
            if dist < target_dist and dist < preset["sensor_range"] * 2:
                target_dist = dist
                target = enemy

        # ═══ ИСПОЛНЕНИЕ ДЕЙСТВИЯ ═══════════════════════════

        if action == "attack" and target:
            self.phase = "attack"
            dx, dz = target.x - self.x, target.z - self.z
            dist = target_dist
            spd = speed * 1.3
            self.vx = dx / max(dist, 1) * spd
            self.vz = dz / max(dist, 1) * spd
            self.y += (30 + dist * 0.02 - self.y) * 0.1

            if dist < 15:
                target.alive = False
                target.phase = "dead"
                self.kills += 1
                self.phase = "rtb"
                return ("kill", target)

        elif action == "rtb":
            self.phase = "rtb"
            dx, dz = -self.x, -self.z
            dist = math.sqrt(dx*dx + dz*dz)
            if dist > 30:
                self.vx = dx / dist * 20
                self.vz = dz / dist * 20
            else:
                self.vx *= 0.9; self.vz *= 0.9
                self.battery = min(100, self.battery + 8)
                self.phase = "resupplied"

        elif action == "stealth":
            self.phase = "stealth"
            self.y += (preset["altitude"] - self.y) * 0.1
            if target and target_dist < 400:
                dx, dz = self.x - target.x, self.z - target.z
                self.vx = dx / max(target_dist, 1) * speed * 0.7
                self.vz = dz / max(target_dist, 1) * speed * 0.7
            else:
                self.vx = speed * 0.4 * math.sin(self.id.__hash__() * 0.001 + time.time() * 0.5)
                self.vz = speed * 0.4 * math.cos(self.id.__hash__() * 0.001 + time.time() * 0.5)

        elif action == "kamikaze" and target:
            self.phase = "kamikaze_run"
            dx, dz = target.x - self.x, target.z - self.z
            dist = target_dist
            spd = 70
            self.vx = dx / max(dist, 1) * spd
            self.vz = dz / max(dist, 1) * spd
            self.y -= 4
            if dist < 15:
                target.alive = False
                target.phase = "dead"
                self.alive = False
                self.phase = "dead"
                self.kills += 1
                return ("kamikaze", target)

        else:  # patrol / default
            self.phase = "patrol"
            # Направление от LLM или синусоида
            if decision.get("heading") is not None:
                rad = math.radians(decision["heading"])
                self.vx = speed * 0.5 * math.cos(rad)
                self.vz = speed * 0.5 * math.sin(rad)
            else:
                self.vx = speed * 0.4 * math.sin(time.time() * 0.3 + hash(self.id) * 0.01)
                self.vz = speed * 0.4 * math.cos(time.time() * 0.3 + hash(self.id) * 0.01)
            self.y += (preset["altitude"] - self.y) * 0.05

        return (action, None)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "role": self.role, "team": self.team,
            "x": round(self.x, 1), "z": round(self.z, 1), "y": round(self.y, 1),
            "heading": round(self.heading, 1),
            "battery": round(self.battery, 1),
            "phase": self.phase, "alive": self.alive,
            "preset": self.preset_name, "character": self.character[:60],
            "speed": round(math.sqrt(self.vx**2 + self.vz**2), 1),
            "kills": self.kills, "gifts": self.gifts_given,
            "llm_action": self.last_llm_decision["action"],
            "llm_response": self.last_llm_response[:80],
            "llm_ms": self.last_llm_inference_ms,
            "llm_queries": self.llm_queries_total,
            "llm_pending": self.pending_query is not None,
        }


# ═══════════════════════════════════════════════════════════════
# МЕНЕДЖЕР РОЯ
# ═══════════════════════════════════════════════════════════════

class SwarmManager:
    def __init__(self):
        self.tick = 0; self.dt = 0.1
        self.events: deque = deque(maxlen=500)
        self.kill_feed: deque = deque(maxlen=50)

        self.blue_drones: Dict[str, SwarmDrone] = {}
        self.red_drones: Dict[str, SwarmDrone] = {}
        self._init_fleets()

        self.air_defense = []
        for aid, atype, ax, az, arange, aleth in RED_AIR_DEFENSE_FULL:
            self.air_defense.append({
                "id": aid, "type": atype, "x": ax, "z": az,
                "range": arange, "lethality": aleth, "min_alt": 25,
                "active": True, "targets_engaged": 0,
            })

        self.weather = random.choice(["clear", "cloudy", "rain", "fog", "night"])
        self.wind_speed = random.uniform(0, 8)
        self.wind_dir = random.uniform(0, 360)
        self.winner = None

        self.total_gifts = 0
        self.total_gift_weight = 0.0

        self.llm_stats = {"total_queries": 0, "total_responses": 0, "total_errors": 0,
                         "avg_inference_ms": 0}
        self.swarm_llm_decision = {"tactic": "perimeter", "target_priority": "nearest",
                                  "aggression": "moderate", "reasoning": ""}
        self.swarm_llm_ticks = 50  # каждые 50 тиков — стратегический LLM
        self.swarm_pending_query: Optional[Future] = None
        self._warmup_done = False

    def _init_fleets(self):
        for args in BLUE_FLEET_FULL:
            self.blue_drones[args[0]] = SwarmDrone(*args, team="blue")
        for args in RED_FLEET_FULL:
            self.red_drones[args[0]] = SwarmDrone(*args, team="red")

    def tick_all(self):
        self.tick += 1

        # ═══ СТРАТЕГИЧЕСКИЙ LLM-МОЗГ РОЯ ═══
        self._update_swarm_brain()

        for drone in list(self.blue_drones.values()):
            if drone.alive:
                self._update_drone_with_llm(drone, self.red_drones)
        for drone in list(self.red_drones.values()):
            if drone.alive:
                self._update_drone_with_llm(drone, self.blue_drones)

        self._update_air_defense()
        self._check_winner()
        self._update_llm_stats()
        # Запись в W-матрицу каждые 1000 тиков
        if self.tick % 1000 == 0 and self.total_gifts > 0:
            self._flush_to_wmatrix()

    def _update_swarm_brain(self):
        """Стратегический LLM для всего роя — вызывается каждые 50 тиков"""
        # Проверить ответ от предыдущего запроса
        if self.swarm_pending_query and self.swarm_pending_query.done():
            try:
                result = self.swarm_pending_query.result(timeout=0)
                if not result.get("error"):
                    decision = parse_llm_decision(result["response"], "perimeter")
                    self.swarm_llm_decision = {
                        "tactic": decision["action"],
                        "target_priority": decision["target_priority"],
                        "aggression": "high" if decision["action"] == "attack" else "moderate",
                        "reasoning": result["response"][:150],
                    }
                    self.llm_stats["total_responses"] += 1
            except Exception:
                self.llm_stats["total_errors"] += 1
            self.swarm_pending_query = None

        # Отправить новый запрос каждые 50 тиков
        if self.tick % self.swarm_llm_ticks == 0 and self.swarm_pending_query is None:
            blue_alive = sum(1 for d in self.blue_drones.values() if d.alive)
            red_alive = sum(1 for d in self.red_drones.values() if d.alive)
            blue_kills = sum(d.kills for d in self.blue_drones.values())
            red_kills = sum(d.kills for d in self.red_drones.values())

            prompt = f"""Ты тактический ИИ роя. Прими стратегическое решение.

Синие (наши): {blue_alive}/20 живы, {blue_kills} kills.
Красные (враг): {red_alive}/10 живы, {red_kills} kills.
Погода: {self.weather}, ветер: {self.wind_speed:.0f} м/с.
ПВО врага: {len(self.air_defense)} активно.
Фаза: {'атака' if blue_kills>red_kills else 'оборона' if red_kills>blue_kills else 'разведка'}.

Тактика (perimeter/attack/stealth/retreat) и приоритет цели (nearest/ew_station/air_defense/enemy_drone). Кратко:"""

            self.swarm_pending_query = query_serafim_async("swarm-brain", "Стратег", prompt)
            self.llm_stats["total_queries"] += 1

    def _update_drone_with_llm(self, drone: SwarmDrone, enemy_fleet: Dict):
        """Обновить дрона через LLM-мозг"""

        # 1. Собрать ситуационную осведомлённость
        nearby_enemies = []
        for enemy in enemy_fleet.values():
            if enemy.alive:
                dist = math.sqrt((drone.x-enemy.x)**2 + (drone.z-enemy.z)**2)
                if dist < drone.preset["sensor_range"] * 2:
                    nearby_enemies.append(enemy)

        own_fleet = self.blue_drones if drone.team == "blue" else self.red_drones
        nearby_friends = []
        for friend in own_fleet.values():
            if friend.alive and friend.id != drone.id:
                dist = math.sqrt((drone.x-friend.x)**2 + (drone.z-friend.z)**2)
                if dist < 1000:
                    nearby_friends.append(friend)

        nearby_ad = []
        if drone.team == "blue":
            for ad in self.air_defense:
                if ad["active"]:
                    dist = math.sqrt((drone.x-ad["x"])**2 + (drone.z-ad["z"])**2)
                    if dist < ad["range"] * 1.5:
                        nearby_ad.append(ad)

        # 2. Проверить ответ от LLM
        if drone.check_llm_response():
            self.llm_stats["total_responses"] += 1

        # 3. Запросить LLM если пора
        if drone.needs_llm_query():
            drone.request_llm_decision(nearby_enemies, nearby_friends, nearby_ad, self)
            self.llm_stats["total_queries"] += 1

        # 4. Исполнить последнее решение
        result = drone.execute_decision(enemy_fleet, enemy_fleet)

        # 5. Физика
        drone.x += drone.vx * self.dt
        drone.z += drone.vz * self.dt
        drone.distance_traveled += math.sqrt(drone.vx**2 + drone.vz**2) * self.dt
        drone.heading = math.degrees(math.atan2(drone.vx, drone.vz)) % 360

        # Батарея
        drain = {"stealth": 0.002, "hunter": 0.005, "guardian": 0.004, "relay": 0.001,
                 "kamikaze": 0.015, "jammer": 0.006, "heavy_strike": 0.005}
        drone.battery -= drain.get(drone.preset_name, 0.003)
        if drone.phase in ("attack", "kamikaze_run"):
            drone.battery -= 0.008

        # Ветер
        w_vx = -self.wind_speed * math.sin(math.radians(self.wind_dir))
        w_vz = -self.wind_speed * math.cos(math.radians(self.wind_dir))
        drone.vx += w_vx * 0.02
        drone.vz += w_vz * 0.02

        # Обработка результата
        if result[0] in ("kill", "kamikaze"):
            victim = result[1]
            if victim:
                self.kill_feed.append(f"💥 {drone.name} → {victim.name}")
                self._record_gift(drone, "kill" if result[0] == "kill" else "sacrifice",
                                10 if result[0] == "kill" else 15)
        if drone.battery < 5 and drone.preset_name != "kamikaze":
            drone.last_llm_decision["action"] = "rtb"

    def _update_air_defense(self):
        # ═══ КОНТР-ПВО: синие РЭБ дроны подавляют ПВО ═══
        for ad in self.air_defense:
            if not ad["active"]: continue
            # Проверить, подавлено ли ПВО синими РЭБ
            jammed = False
            for drone in self.blue_drones.values():
                if not drone.alive or drone.preset_name != "jammer": continue
                dist_to_ad = math.sqrt((drone.x - ad["x"])**2 + (drone.z - ad["z"])**2)
                if dist_to_ad < 1200:  # РЭБ радиус подавления
                    jammed = True
                    ad["jammed_by"] = drone.name
                    break

            effective_lethality = ad["lethality"] * (0.2 if jammed else 1.0)

            for drone in self.blue_drones.values():
                if not drone.alive: continue
                dist = math.sqrt((drone.x - ad["x"])**2 + (drone.z - ad["z"])**2)
                if dist < ad["range"] and drone.y > ad["min_alt"]:
                    if random.random() < effective_lethality * (1 - dist/ad["range"]):
                        drone.alive = False; drone.phase = "dead"
                        ad["targets_engaged"] += 1
                        jtag = " [ПОДАВЛЕНО]" if jammed else ""
                        self.kill_feed.append(f"🛡 {ad['id']} сбил {drone.name}{jtag}")
                        self._record_gift(drone, "sacrifice", 10)

    def _flush_to_wmatrix(self):
        """Записать накопленный боевой опыт в реальную W-матрицу"""
        if self.total_gifts == 0: return
        try:
            import urllib.request
            body = json.dumps({
                "giverId": "swarm_blue",
                "receiverId": "_koinon",
                "type": "time",
                "content": f"Боевой опыт: {self.total_gifts} актов, вес {self.total_gift_weight:.0f}",
                "amount": self.total_gift_weight
            }).encode()
            req = urllib.request.Request(
                "http://173.249.2.184:8086/anamnesis_add_gift",
                body, {"Content-Type": "application/json"}
            )
            urllib.request.urlopen(req, timeout=5)
            return True
        except Exception:
            return False  # сервер памяти недоступен — не критично

    def _check_winner(self):
        ba = sum(1 for d in self.blue_drones.values() if d.alive)
        ra = sum(1 for d in self.red_drones.values() if d.alive)
        if ba == 0: self.winner = "red"
        elif ra == 0: self.winner = "blue"

    def _record_gift(self, drone, gtype, weight):
        drone.gifts_given += 1
        self.total_gifts += 1
        self.total_gift_weight += weight

    def _update_llm_stats(self):
        queries = sum(d.llm_queries_total for d in self.blue_drones.values())
        queries += sum(d.llm_queries_total for d in self.red_drones.values())
        if queries > 0:
            self.llm_stats["total_queries"] = queries
            total_ms = sum(d.last_llm_inference_ms for d in self.blue_drones.values() if d.last_llm_inference_ms)
            total_ms += sum(d.last_llm_inference_ms for d in self.red_drones.values() if d.last_llm_inference_ms)
            responded = sum(1 for d in self.blue_drones.values() if d.last_llm_inference_ms)
            responded += sum(1 for d in self.red_drones.values() if d.last_llm_inference_ms)
            if responded > 0:
                self.llm_stats["avg_inference_ms"] = total_ms // responded

    def get_state(self) -> dict:
        ba = sum(1 for d in self.blue_drones.values() if d.alive)
        ra = sum(1 for d in self.red_drones.values() if d.alive)
        return {
            "tick": self.tick,
            "weather": self.weather,
            "wind": {"speed": round(self.wind_speed, 1), "dir": round(self.wind_dir, 0)},
            "blue": {
                "drones": [d.to_dict() for d in self.blue_drones.values()],
                "total": len(self.blue_drones), "alive": ba,
                "kills": sum(d.kills for d in self.blue_drones.values()),
                "llm_queries": sum(d.llm_queries_total for d in self.blue_drones.values()),
            },
            "red": {
                "drones": [d.to_dict() for d in self.red_drones.values()],
                "total": len(self.red_drones), "alive": ra,
                "kills": sum(d.kills for d in self.red_drones.values()),
                "llm_queries": sum(d.llm_queries_total for d in self.red_drones.values()),
            },
            "air_defense": [{"id": ad["id"], "type": ad["type"], "x": ad["x"], "z": ad["z"],
                            "kills": ad["targets_engaged"], "active": ad["active"]}
                           for ad in self.air_defense],
            "kill_feed": list(self.kill_feed)[-20:],
            "gifts": {"total": self.total_gifts, "weight": round(self.total_gift_weight, 1)},
            "winner": self.winner,
            "llm_stats": self.llm_stats,
            "presets": list(CHARACTER_PROMPTS.keys()),
        }


# ═══════════════════════════════════════════════════════════════
# HTTP API
# ═══════════════════════════════════════════════════════════════

swarm_mgr = SwarmManager()

class SwarmHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global swarm_mgr
        path = self.path.split("?")[0]
        if path == "/api/swarm": self.send_json(swarm_mgr.get_state())
        elif path == "/api/drones":
            s = swarm_mgr.get_state()
            self.send_json({"blue": s["blue"]["drones"], "red": s["red"]["drones"]})
        elif path == "/api/presets": self.send_json({k: v for k, v in CHARACTER_PROMPTS.items()})
        elif path == "/api/stats":
            s = swarm_mgr.get_state()
            self.send_json({"tick": s["tick"], "weather": s["weather"],
                          "blue_alive": s["blue"]["alive"], "red_alive": s["red"]["alive"],
                          "winner": s["winner"], "gifts": s["gifts"], "kill_feed": s["kill_feed"],
                          "llm": s["llm_stats"]})
        elif path == "/api/cmd/restart": swarm_mgr = SwarmManager(); self.send_json({"status": "restarted"})
        elif path == "/":
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers()
            self.wfile.write(("""<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="3">
<title>Swarm LLM Fleet</title><style>body{background:#0a0f1e;color:#aaa;font:11px monospace;padding:15px}
.panel{background:#111;border:1px solid #333;padding:12px;margin:8px 0}
h2{color:#0ff} .blue{color:#48f} .red{color:#f44} .kill{color:#f66} .gift{color:#ff0} .dead{opacity:0.4}
.llm{color:#0ff} .stat{display:inline-block;margin:4px 12px 4px 0}</style></head>
<body><h1>SWARM FLEET — Serafim LLM Brain</h1><div id="s"></div>
<script>setInterval(async()=>{try{const r=await fetch('/api/swarm');const d=await r.json();
let h=`<div class="panel"><span class="stat">Tick: ${d.tick}</span><span class="stat">Weather: ${d.weather}</span><span class="stat">Wind: ${d.wind.speed}m/s</span><span class="stat">Gifts: ${d.gifts.total} (w:${d.gifts.weight})</span><span class="stat llm">LLM: ${d.llm_stats.total_queries}q ${d.llm_stats.total_responses}r ${d.llm_stats.avg_inference_ms}ms</span></div>`;
h+=`<div class="panel"><h2>BLUE (${d.blue.alive}/${d.blue.total}) Kills:${d.blue.kills} LLM:${d.blue.llm_queries}q</h2>`;
d.blue.drones.forEach(dr=>{h+=`<span class="blue ${dr.alive?'':'dead'}">${dr.name}(${dr.role}/${dr.preset})</span> LLM:${dr.llm_action} 🔋${dr.battery}% ${dr.phase} kills:${dr.kills} [${dr.llm_response||'...'}] `});
h+=`</div><div class="panel"><h2>RED (${d.red.alive}/${d.red.total}) Kills:${d.red.kills} LLM:${d.red.llm_queries}q</h2>`;
d.red.drones.forEach(dr=>{h+=`<span class="red ${dr.alive?'':'dead'}">${dr.name}(${dr.role}/${dr.preset})</span> LLM:${dr.llm_action} 🔋${dr.battery}% ${dr.phase} kills:${dr.kills} [${dr.llm_response||'...'}] `});
h+=`</div><div class="panel"><h2>Kill Feed</h2>${(d.kill_feed||[]).slice(-15).map(k=>`<div class="kill">${k}</div>`).join('')}</div>`;
document.getElementById('s').innerHTML=h;}catch(e){}},2000)</script></body></html>""").encode())
        else: self.send_error(404)
    def send_json(self, data):
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*"); self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, default=str).encode())
    def log_message(self, *a): pass

def sim_thread():
    while True:
        swarm_mgr.tick_all()
        time.sleep(0.05)

def warmup_llm():
    """Прогреть Serafim модель — загрузить и держать в памяти"""
    print("  🧠 Прогрев Serafim 1.5B...")
    try:
        body = json.dumps({
            "model": SERAFIM_MODEL, "prompt": "OK", "stream": False,
            "keep_alive": 600, "options": {"num_predict": 3}
        }).encode()
        req = urllib.request.Request(OLLAMA_URL, body, {"Content-Type": "application/json"})
        resp = urllib.request.urlopen(req, timeout=45)
        data = json.loads(resp.read())
        ms = data.get("eval_duration", 0) // 1_000_000
        print(f"  ✅ Модель загружена ({ms}ms), keep_alive=600s")
        return True
    except Exception as e:
        print(f"  ⚠️ Прогрев не удался: {e}")
        return False

def main():
    print("╔══════════════════════════════════════════════════════════╗")
    print("║  SWARM FLEET — Serafim LLM как мозг каждого дрона       ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print(f"  🔵 Синий флот: {len(BLUE_FLEET_FULL)} дронов")
    print(f"  🔴 Красный флот: {len(RED_FLEET_FULL)} дронов + {len(RED_AIR_DEFENSE_FULL)} ПВО")
    print(f"  🧠 LLM: {SERAFIM_MODEL} ({len(CHARACTER_PROMPTS)} характеров)")
    print(f"  🌐 http://localhost:8105")
    print()

    warmup_llm()

    threading.Thread(target=sim_thread, daemon=True).start()
    HTTPServer(("0.0.0.0", 8105), SwarmHandler).serve_forever()

if __name__ == "__main__":
    main()
