#!/usr/bin/env python3
"""
centaur_arena.py — Кентавр в бою: человек-пилот + Serafim-рой

Соединяет CentaurCockpit с SerafimArena:
  - Пилот (Сын, 14) управляет ОДНИМ дроном через кокпит
  - ВСЕ остальные агенты (синие и красные) управляются Serafim
  - Каждое решение пилота → обучающие данные
  - Каждый бой → метрики социального поведения
  - Опыт → meta-KB через AgentBus dronedoc2026

Запуск:
  python3 centaur_arena.py          # веб на :8400
  python3 centaur_arena.py --battle # быстрый бой без веба

Архитектура:
  ┌─────────────────────────────────────────────────┐
  │                CENTAUR ARENA                     │
  │                                                 │
  │  👤 Пилот (1 дрон)    🤖 Serafim (все остальные)│
  │  ┌──────────┐         ┌──────────────────┐      │
  │  │ Centaur  │         │ SerafimArena     │      │
  │  │ Cockpit  │◄────────┤ (13 синих +      │      │
  │  │ (web UI) │────────►│   11 красных)    │      │
  │  └──────────┘         └──────────────────┘      │
  │       │                        │                │
  │       └────────┬───────────────┘                │
  │                ▼                                │
  │     ┌──────────────────┐                        │
  │     │ SocialMetrics    │                        │
  │     │ (cooperation,    │                        │
  │     │  conflict,       │                        │
  │     │  consensus,      │                        │
  │     │  emergence)      │                        │
  │     └────────┬─────────┘                        │
  │              ▼                                  │
  │     ┌──────────────────┐                        │
  │     │ MetaKB Bridge    │                        │
  │     │ → dronedoc2026   │                        │
  │     │   AgentBus       │                        │
  │     └──────────────────┘                        │
  └─────────────────────────────────────────────────┘
"""

import asyncio, json, time, math, os, sys, threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from collections import deque
from enum import Enum

sys.path.insert(0, os.path.dirname(__file__))
from serafim_agent import SerafimAgent, TacticalSituation, SerafimAction
from serafim_arena import SerafimArena, ArenaWebServer
from centaur_cockpit import CentaurCockpit, PilotDecision, CentaurExperience, CockpitMode
from social_metrics import SocialMetricsTracker
from training_arena import CombatAgent, CombatPhase, BLUE_FLEET, RED_FLEET

# ═══════════════════════════════════════════════════════════════
# Meta-KB BRIDGE
# ═══════════════════════════════════════════════════════════════

class MetaKBBridge:
    """
    Мост к meta-KB dronedoc2026.

    Отправляет боевой опыт кентавра в AgentBus для накопления знаний.
    """

    def __init__(self, agentbus_url: str = "http://127.0.0.1:8081/api/agent-bus",
                 enabled: bool = True):
        self.agentbus_url = agentbus_url
        self.enabled = enabled
        self.experiences_sent = 0
        self.battles_reported = 0

    def send_experience(self, exp: CentaurExperience, pilot_name: str):
        """Отправить один боевой опыт в meta-KB."""
        if not self.enabled:
            return

        msg = {
            "source": "centaur-arena",
            "type": "combat_experience",
            "pilot": pilot_name,
            "tick": exp.tick,
            "situation": exp.situation,
            "serafim_suggestion": exp.serafim_suggestion,
            "pilot_decision": exp.pilot_decision,
            "outcome": exp.outcome,
            "lesson": exp.lesson,
            "timestamp": time.time(),
        }

        try:
            import urllib.request
            data = json.dumps({
                "agent": "centaur-arena",
                "event": "combat_experience",
                "data": msg,
            }).encode()
            req = urllib.request.Request(
                f"{self.agentbus_url}/publish",
                data=data,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=2) as resp:
                self.experiences_sent += 1
        except Exception:
            # Fallback: сохранить локально
            self._save_local(msg)

    def send_battle_report(self, report: dict):
        """Отправить отчёт о бое в meta-KB."""
        if not self.enabled:
            return

        msg = {
            "source": "centaur-arena",
            "type": "battle_report",
            "report": report,
            "timestamp": time.time(),
        }

        try:
            import urllib.request
            data = json.dumps({
                "agent": "centaur-arena",
                "event": "battle_report",
                "data": msg,
            }).encode()
            req = urllib.request.Request(
                f"{self.agentbus_url}/publish",
                data=data,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=2) as resp:
                self.battles_reported += 1
        except Exception:
            self._save_local(msg)

    def _save_local(self, msg: dict):
        """Сохранить локально если AgentBus недоступен."""
        import os
        kb_dir = os.path.expanduser("~/gift/data/meta-kb")
        os.makedirs(kb_dir, exist_ok=True)
        fname = f"{kb_dir}/centaur-{int(time.time())}.json"
        with open(fname, "w") as f:
            json.dump(msg, f, ensure_ascii=False)

    def stats(self) -> dict:
        return {
            "enabled": self.enabled,
            "experiences_sent": self.experiences_sent,
            "battles_reported": self.battles_reported,
        }


# ═══════════════════════════════════════════════════════════════
# CENTAUR ARENA — интеграция пилота в симуляцию
# ═══════════════════════════════════════════════════════════════

class CentaurArena:
    """
    Арена где человек-пилот + Serafim-рой сражаются вместе.

    Пилот управляет ОДНИМ дроном (через CentaurCockpit).
    Остальные агенты — Serafim (через SerafimArena).

    Социальность: пилот — такой же агент в метриках, как и Serafim.
    """

    def __init__(self,
                 pilot_id: str = "son-1",
                 pilot_name: str = "Сын",
                 pilot_age: int = 14,
                 pilot_role: str = "РАЗВ",
                 ollama_url: str = "http://localhost:11434",
                 model: str = "serafim-tactical:q8"):
        # Кентавр-пилот
        self.cockpit = CentaurCockpit(pilot_id, pilot_name, pilot_age, ollama_url, model)
        self.pilot_role = pilot_role

        # Serafim-арена (все остальные агенты)
        self.arena = SerafimArena(
            game_id=f"centaur-{int(time.time())}",
            ollama_url=ollama_url, model=model,
            use_serafim=True,
        )

        # Заменяем одного синего агента на пилота-человека
        self.pilot_agent = self._replace_with_pilot(pilot_id, pilot_role)

        # Meta-KB мост
        self.meta_kb = MetaKBBridge()

        # Социальные метрики (добавляем пилота как агента)
        self.arena.metrics.set_initial_conditions(
            agents_count=len([a for a in self.arena.blue_agents.values()
                             if a.role != "НАЗМ"]) + 1,  # +1 за пилота
            targets_count=len([a for a in self.arena.red_agents.values()
                              if a.role != "НАЗМ"]),
        )

        # Игра
        self.tick = 0
        self.max_ticks = 500
        self.winner = None
        self.running = False

        self.log: deque = deque(maxlen=200)

    def _replace_with_pilot(self, pilot_id: str, pilot_role: str) -> CombatAgent:
        """Заменить одного синего агента на пилота-человека."""
        # Найти первого синего агента с подходящей ролью
        for fid, agent in list(self.arena.blue_agents.items()):
            if agent.role == pilot_role and agent.role != "НАЗМ":
                # Удалить Serafim-агента
                if fid in self.arena.serafim_agents:
                    del self.arena.serafim_agents[fid]

                # Переименовать в пилота
                agent.name = self.cockpit.pilot_name
                # Сохранить старого агента под новым ID пилота
                old_id = fid
                self.arena.blue_agents[pilot_id] = agent
                del self.arena.blue_agents[old_id]
                return agent

        raise RuntimeError("Нет подходящего агента для замены на пилота")

    # ═══════════════════════════════════════════════════════════
    # ИГРОВОЙ ЦИКЛ
    # ═══════════════════════════════════════════════════════════

    def tick_game(self, pilot_decision: Optional[dict] = None) -> dict:
        """
        Один тик игры.

        Если pilot_decision передан — применяем решение пилота к его дрону.
        Остальные агенты обновляются через SerafimArena.
        """
        self.tick += 1
        events = []

        # 1. Применить решение пилота к его агенту
        if pilot_decision and self.pilot_agent.phase != CombatPhase.DEAD:
            action = pilot_decision.get("action", "patrol")

            # Найти ближайшего врага для пилота
            nearest_enemy = None
            nearest_dist = float('inf')
            for eid, enemy in self.arena.red_agents.items():
                if enemy.phase == CombatPhase.DEAD:
                    continue
                dist = math.sqrt(
                    (self.pilot_agent.x - enemy.x)**2 +
                    (self.pilot_agent.z - enemy.z)**2
                )
                if dist < nearest_dist:
                    nearest_dist = dist
                    nearest_enemy = enemy

            # Применить решение (используем логику из training_arena)
            if action == "attack" and nearest_enemy and nearest_dist < 2000:
                speed = 40 if self.pilot_role == "ФПВ" else 25
                dx = nearest_enemy.x - self.pilot_agent.x
                dz = nearest_enemy.z - self.pilot_agent.z
                self.pilot_agent.vx = dx / max(nearest_dist, 1) * speed
                self.pilot_agent.vz = dz / max(nearest_dist, 1) * speed
                self.pilot_agent.phase = CombatPhase.ATTACK

                if nearest_dist < 15:
                    nearest_enemy.phase = CombatPhase.DEAD
                    self.pilot_agent.kills += 1
                    self.cockpit.kills += 1
                    events.append({
                        "event": "PILOT_KILL",
                        "killer": f"{self.cockpit.pilot_name}(пилот)",
                        "victim": f"{nearest_enemy.name}({nearest_enemy.id})",
                    })
                    self.log.append(f"👤💥 {self.cockpit.pilot_name} → {nearest_enemy.name}")

            elif action == "rtb":
                dist_to_base = math.sqrt(self.pilot_agent.x**2 + self.pilot_agent.z**2)
                if dist_to_base > 1:
                    self.pilot_agent.vx = -self.pilot_agent.x / dist_to_base * 30
                    self.pilot_agent.vz = -self.pilot_agent.z / dist_to_base * 30
                self.pilot_agent.phase = CombatPhase.RETREAT

            elif action == "observe" and nearest_enemy and nearest_dist < 1500:
                self.pilot_agent.phase = CombatPhase.ENGAGE
                tick_phase = self.tick * 0.02
                self.pilot_agent.vx = -nearest_dist * 0.01 * math.sin(tick_phase)
                self.pilot_agent.vz = nearest_dist * 0.01 * math.cos(tick_phase)

            else:  # patrol
                self.pilot_agent.phase = CombatPhase.PATROL
                tick_phase = self.tick * 0.005
                self.pilot_agent.vx = 20 * math.sin(tick_phase)
                self.pilot_agent.vz = 20 * math.cos(tick_phase)

            # Движение пилота
            self.pilot_agent.x += self.pilot_agent.vx * self.arena.dt
            self.pilot_agent.z += self.pilot_agent.vz * self.arena.dt

            # Запись в метрики (пилот — такой же агент)
            self.arena.metrics.record_decision(
                tick=self.tick,
                agent_id=self.cockpit.pilot_id,
                role=f"human_{self.pilot_role}",
                action=action,
                target_id=nearest_enemy.id if nearest_enemy else "",
                priority=9,  # человек всегда приоритет
                reasoning="Пилот-человек",
                latency_ms=0,  # человек не измеряется в миллисекундах
            )

        # 2. Обновить Serafim-агентов (все кроме пилота)
        for agents_dict in [self.arena.blue_agents, self.arena.red_agents]:
            for agent_id, agent in list(agents_dict.items()):
                if agent_id == self.cockpit.pilot_id:
                    continue  # пилот управляется человеком
                if agent.phase == CombatPhase.DEAD:
                    continue
                self.arena._update_agent(agent, events)

        # 3. ПВО
        self.arena._update_air_defense(events)

        # 4. Проверка победы
        blue_alive = sum(1 for a in self.arena.blue_agents.values()
                        if a.phase != CombatPhase.DEAD)
        red_alive = sum(1 for a in self.arena.red_agents.values()
                       if a.phase != CombatPhase.DEAD)

        if red_alive == 0 and blue_alive > 0:
            self.winner = "blue"
        elif blue_alive == 0 and red_alive > 0:
            self.winner = "red"
        elif self.tick >= self.max_ticks:
            self.winner = "blue" if blue_alive > red_alive else "red" if red_alive > blue_alive else "draw"

        if self.winner:
            events.append({"event": "GAME_OVER", "winner": self.winner, "tick": self.tick})

        return {"tick": self.tick, "events": events, "winner": self.winner}

    # ═══════════════════════════════════════════════════════════
    # СИТУАЦИЯ ДЛЯ ПИЛОТА
    # ═══════════════════════════════════════════════════════════

    def get_pilot_situation(self) -> TacticalSituation:
        """Построить тактическую обстановку для пилота."""
        agent = self.pilot_agent
        if agent.phase == CombatPhase.DEAD:
            return TacticalSituation(
                agent_id=self.cockpit.pilot_id,
                agent_role=self.pilot_role,
                agent_team="blue",
                x=0, y=0, z=0,
                battery_pct=0,
                heading_deg=0,
                mission_phase="dead",
            )

        # Враги
        enemies = []
        nearest_dist = float('inf')
        for eid, enemy in self.arena.red_agents.items():
            if enemy.phase == CombatPhase.DEAD:
                continue
            dist = math.sqrt((agent.x - enemy.x)**2 + (agent.z - enemy.z)**2)
            if dist < nearest_dist:
                nearest_dist = dist
            enemies.append({
                "id": eid, "role": enemy.role, "dist_m": dist,
                "heading_rel_deg": 0, "y_rel": enemy.y - agent.y,
            })

        # Свои
        friendlies = []
        friendlies_alive = 0
        for fid, f_agent in self.arena.blue_agents.items():
            if f_agent.phase == CombatPhase.DEAD or fid == self.cockpit.pilot_id:
                continue
            friendlies_alive += 1
            dist = math.sqrt((agent.x - f_agent.x)**2 + (agent.z - f_agent.z)**2)
            friendlies.append({
                "id": fid, "role": f_agent.role, "dist_m": dist,
            })

        enemies_alive = sum(1 for e in self.arena.red_agents.values()
                           if e.phase != CombatPhase.DEAD)

        return TacticalSituation(
            agent_id=self.cockpit.pilot_id,
            agent_role=self.pilot_role,
            agent_team="blue",
            x=agent.x, y=agent.y, z=agent.z,
            battery_pct=agent.battery,
            heading_deg=agent.heading,
            enemies=enemies,
            nearest_enemy_dist=nearest_dist,
            friendlies=friendlies,
            friendlies_alive=friendlies_alive,
            enemies_alive=enemies_alive,
            comms_quality=1.0,
            ew_jamming=False,
            sam_threat=len(self.arena.air_defense) > 0,
            weather=self.arena.weather,
            time_of_day=self.arena.time_of_day,
            mission_phase=agent.phase.value,
            kills=agent.kills,
        )

    # ═══════════════════════════════════════════════════════════
    # ЗАПУСК
    # ═══════════════════════════════════════════════════════════

    def run_battle(self) -> dict:
        """Запустить полностью автономный бой (пилот управляется правилами)."""
        self.cockpit.start_mission()
        t0 = time.time()

        while self.winner is None and self.tick < self.max_ticks:
            # Авто-пилот: используем правила из training_arena
            sit = self.get_pilot_situation()
            self.tick_game(pilot_decision=None)  # None → арена сама обновит пилота

        elapsed = time.time() - t0
        self.cockpit.end_mission("victory" if self.winner == "blue" else "defeat")

        # Финальные метрики
        blue_alive = sum(1 for a in self.arena.blue_agents.values()
                        if a.phase != CombatPhase.DEAD)
        red_alive = sum(1 for a in self.arena.red_agents.values()
                       if a.phase != CombatPhase.DEAD)

        report = {
            "game_id": self.arena.game_id,
            "pilot": self.cockpit.pilot_name,
            "ticks": self.tick,
            "duration_s": round(elapsed, 1),
            "winner": self.winner,
            "blue_alive": blue_alive,
            "red_alive": red_alive,
            "pilot_kills": self.cockpit.kills,
            "pilot_deaths": self.cockpit.deaths,
            "social_metrics": self.arena.metrics.report(),
            "training_examples": len(self.cockpit.export_training_data()),
        }

        # Отправить в meta-KB
        self.meta_kb.send_battle_report(report)

        # Отправить каждый опыт
        for exp in self.cockpit.experiences:
            self.meta_kb.send_experience(exp, self.cockpit.pilot_name)

        return report


# ═══════════════════════════════════════════════════════════════
# ВЕБ-СЕРВЕР КЕНТАВР-АРЕНЫ
# ═══════════════════════════════════════════════════════════════

CENTAUR_ARENA_HTML = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Centaur Arena — {pilot_name} + Serafim Swarm</title>
<style>
*{{margin:0;box-sizing:border-box}}
body{{background:#0a0a12;color:#c8ccd4;font-family:'Segoe UI',monospace;display:flex;height:100vh}}
#left{{width:300px;background:#111118;padding:14px;overflow-y:auto;border-right:1px solid #222}}
#center{{flex:1;position:relative}}
#right{{width:320px;background:#111118;padding:14px;overflow-y:auto;border-left:1px solid #222}}
canvas{{display:block}}
h2{{color:#4af;font-size:15px;margin-bottom:10px}}
h3{{color:#8af;font-size:12px;margin:10px 0 5px}}
.pilot{{color:#0f0;font-size:18px;font-weight:bold}}
.stat{{display:flex;justify-content:space-between;padding:2px 0;font-size:11px;border-bottom:1px solid #1a1a22}}
.stat .val{{color:#fff}}
#suggestion{{background:#1a1a2e;border:2px solid #f80;border-radius:8px;padding:10px;margin:10px 0}}
#suggestion .action{{font-size:18px;font-weight:bold;color:#f80;text-transform:uppercase}}
.btn{{display:block;width:100%;padding:10px;margin:4px 0;border:none;border-radius:6px;font-size:15px;cursor:pointer;font-weight:bold}}
.btn-accept{{background:#0a0;color:#fff}}
.btn-override{{background:#800;color:#fff}}
#log{{font-size:10px;max-height:150px;overflow-y:auto}}
.log-entry{{padding:1px 0;border-bottom:1px solid #1a1a22}}
</style>
</head>
<body>
<div id="left">
  <div class="pilot">👤 {pilot_name}</div>
  <div style="font-size:11px;color:#aaa;margin-bottom:10px">{pilot_age} лет | Кентавр | Рой {swarm_size}</div>

  <h3>📊 БОЙ</h3>
  <div class="stat"><span>Тик</span><span class="val" id="tick">0</span></div>
  <div class="stat"><span>Синих живо</span><span class="val" id="blue-alive">—</span></div>
  <div class="stat"><span>Красных живо</span><span class="val" id="red-alive">—</span></div>
  <div class="stat"><span>Убийств пилота</span><span class="val" id="kills">0</span></div>
  <div class="stat"><span>Опыта</span><span class="val" id="exp">0</span></div>

  <h3>🤖 SERAFIM</h3>
  <div id="suggestion">
    <div style="font-size:10px;color:#aaa">КОПИЛОТ:</div>
    <div class="action" id="sugg-action">—</div>
    <div style="font-size:11px;color:#aaa;margin-top:4px" id="sugg-reason"></div>
  </div>

  <button class="btn btn-accept" onclick="decide(true)">✅ ПРИНЯТЬ</button>
  <button class="btn btn-override" onclick="decide(false)">❌ ОТКЛОНИТЬ (OBSERVE)</button>
</div>

<div id="center"><canvas id="c"></canvas></div>

<div id="right">
  <h3>🎯 ОБСТАНОВКА</h3>
  <div id="situation"></div>
  <h3>📝 ЛОГ</h3>
  <div id="log"></div>
</div>

<script>
var API='/api/centaur';
function decide(accept){{
  fetch(API+'/decide',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{accept:accept,action:accept?'':'observe',reason:accept?'':'Отклоняю'}})}});
}}

async function update(){{
  try{{
    let r=await fetch(API+'/state');
    let s=await r.json();
    document.getElementById('tick').textContent=s.tick||0;
    document.getElementById('blue-alive').textContent=s.blue_alive||0;
    document.getElementById('red-alive').textContent=s.red_alive||0;
    document.getElementById('kills').textContent=s.pilot_kills||0;
    document.getElementById('exp').textContent=s.training_examples||0;

    if(s.suggestion){{
      document.getElementById('sugg-action').textContent=s.suggestion.action.toUpperCase();
      document.getElementById('sugg-reason').textContent=s.suggestion.reason;
    }}
    if(s.situation){{
      let sit=s.situation,html='';
      if(sit.enemies) sit.enemies.slice(0,5).forEach(e=>html+=`<div class="stat"><span>${{e.role}}</span><span class="val">${{Math.round(e.dist_m)}}м</span></div>`);
      html+=`<div class="stat"><span>Батарея</span><span class="val">${{Math.round(sit.battery_pct)}}%</span></div>`;
      document.getElementById('situation').innerHTML=html;
    }}
    if(s.log) document.getElementById('log').innerHTML=s.log.slice(-10).map(l=>`<div class="log-entry">${{l}}</div>`).join('');

    // Canvas
    let canvas=document.getElementById('c'),ctx=canvas.getContext('2d');
    canvas.width=canvas.parentElement.clientWidth-10;canvas.height=window.innerHeight-10;
    let w=canvas.width,h=canvas.height,cx=w/2,cy=h/2,scale=0.15;
    ctx.fillStyle='#0a0a12';ctx.fillRect(0,0,w,h);
    if(s.agents){{
      s.agents.forEach(a=>{{
        let x=cx+a.x*scale,y=cy+a.z*scale;
        ctx.fillStyle=a.phase==='dead'?'#333':a.is_pilot?'#0f0':a.team==='blue'?'#48f':'#f44';
        ctx.beginPath();ctx.arc(x,y,a.is_pilot?8:4,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#fff';ctx.font='8px mono';ctx.fillText(a.is_pilot?'★ '+a.name:a.name,x+6,y+3);
      }});
    }}
  }}catch(e){{console.error(e)}}
  setTimeout(update,800);
}}
update();
</script></body></html>"""


class CentaurArenaServer:
    """Веб-сервер для CentaurArena."""

    def __init__(self, centaur_arena: CentaurArena, port: int = 8400):
        self.ca = centaur_arena
        self.port = port
        self._game_thread = None

    def start(self):
        ca = self.ca

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/" or self.path == "/index.html":
                    blue_count = len([a for a in ca.arena.blue_agents.values() if a.role != "НАЗМ"])
                    red_count = len([a for a in ca.arena.red_agents.values() if a.role != "НАЗМ"])
                    html = CENTAUR_ARENA_HTML.format(
                        pilot_name=ca.cockpit.pilot_name,
                        pilot_age=ca.cockpit.pilot_age,
                        swarm_size=f"{blue_count} синих + {red_count} красных",
                    )
                    self.send_response(200)
                    self.send_header("Content-type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(html.encode())

                elif self.path == "/api/centaur/state":
                    sit = ca.get_pilot_situation()
                    suggestion = ca.cockpit.copilot.decide_sync(sit, timeout_s=5) if ca.pilot_agent.phase != CombatPhase.DEAD else None

                    blue_alive = sum(1 for a in ca.arena.blue_agents.values() if a.phase != CombatPhase.DEAD)
                    red_alive = sum(1 for a in ca.arena.red_agents.values() if a.phase != CombatPhase.DEAD)

                    state = {
                        "tick": ca.tick,
                        "blue_alive": blue_alive,
                        "red_alive": red_alive,
                        "winner": ca.winner,
                        "pilot_kills": ca.cockpit.kills,
                        "training_examples": len(ca.cockpit.export_training_data()),
                        "suggestion": {
                            "action": suggestion.action.value,
                            "reason": suggestion.reason[:200],
                        } if suggestion else None,
                        "situation": {
                            "enemies": sit.enemies[:5],
                            "battery_pct": sit.battery_pct,
                        } if sit else None,
                        "agents": self._get_agents_state(ca),
                        "log": list(ca.log)[-15],
                    }
                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(state).encode())

                else:
                    self.send_response(404); self.end_headers()

            def do_POST(self):
                if self.path == "/api/centaur/decide":
                    content_length = int(self.headers.get('Content-Length', 0))
                    body = json.loads(self.rfile.read(content_length))

                    if body.get("accept"):
                        action = body.get("action", "")
                        if not action:
                            # Использовать предложение Serafim
                            sit = ca.get_pilot_situation()
                            suggestion = ca.cockpit.copilot.decide_sync(sit, timeout_s=5)
                            action = suggestion.action.value
                        ca.cockpit.pilot_decide(action, accept_suggestion=True)
                    else:
                        ca.cockpit.pilot_decide(
                            body.get("action", "observe"),
                            accept_suggestion=False,
                            reasoning=body.get("reason", "Пилот решил иначе"),
                        )

                    # Тик игры с решением пилота
                    last_decision = ca.cockpit.decisions[-1] if ca.cockpit.decisions else None
                    ca.tick_game(pilot_decision={
                        "action": last_decision.action if last_decision else "patrol",
                    })

                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"ok":true}')

            def _get_agents_state(self, ca):
                agents = []
                for a in list(ca.arena.blue_agents.values()) + list(ca.arena.red_agents.values()):
                    agents.append({
                        "id": a.id, "name": a.name, "role": a.role,
                        "team": a.team, "x": a.x, "z": a.z, "y": a.y,
                        "phase": a.phase.value,
                        "is_pilot": a.id == ca.cockpit.pilot_id,
                        "kills": a.kills,
                    })
                return agents

        server = HTTPServer(("0.0.0.0", self.port), Handler)
        print(f"\n╔══════════════════════════════════════════════════╗")
        print(f"║  CENTAUR ARENA — {ca.cockpit.pilot_name} + Serafim Swarm     ║")
        print(f"╚══════════════════════════════════════════════════╝")
        print(f"  Пилот: {ca.cockpit.pilot_name} ({ca.cockpit.pilot_age} лет)")
        print(f"  Роль: {ca.pilot_role} | Рой: Serafim V2 Q8")
        print(f"  Meta-KB: {'✅' if ca.meta_kb.enabled else '❌ (локально)'}")
        print(f"  Веб: http://localhost:{self.port}")
        print()

        # Запустить игру в фоне
        def game_loop():
            ca.cockpit.start_mission()
            while ca.winner is None and ca.tick < ca.max_ticks:
                ca.tick_game(pilot_decision=None)
                time.sleep(0.5)  # 2Hz

        self._game_thread = threading.Thread(target=game_loop, daemon=True)
        self._game_thread.start()

        server.serve_forever()


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--battle", action="store_true", help="Быстрый авто-бой без веба")
    p.add_argument("--port", type=int, default=8400)
    p.add_argument("--pilot-name", default="Сын")
    p.add_argument("--pilot-age", type=int, default=14)
    p.add_argument("--pilot-role", default="РАЗВ")
    args = p.parse_args()

    ca = CentaurArena(
        pilot_name=args.pilot_name,
        pilot_age=args.pilot_age,
        pilot_role=args.pilot_role,
    )

    if args.battle:
        print(f"Авто-бой: {args.pilot_name} vs Serafim-рой")
        report = ca.run_battle()
        print(f"\nПобедитель: {report['winner']}")
        print(f"Тиков: {report['ticks']} | Длительность: {report['duration_s']}с")
        print(f"Убийств пилота: {report['pilot_kills']}")
        print(f"Обучающих примеров: {report['training_examples']}")
        print(f"Meta-KB: отправлено {ca.meta_kb.experiences_sent} опытов")
    else:
        server = CentaurArenaServer(ca, args.port)
        try:
            server.start()
        except KeyboardInterrupt:
            print("\nStopped")
            if ca.winner:
                print(f"Победитель: {ca.winner}")
