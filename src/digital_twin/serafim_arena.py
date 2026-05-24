#!/usr/bin/env python3
"""
serafim_arena.py — Тренировочная арена с Serafim-агентами

training_arena.py + SerafimAgent = SerafimArena

Хардкодные правила заменены на реальный LLM-инференс.
Каждый агент в симуляции управляется своей копией Serafim.

Два режима:
  HEADLESS — быстрая симуляция, только метрики (для генерации датасета)
  VISUAL   — веб-интерфейс на http://localhost:8200 (для отладки)

Использование:
  arena = SerafimArena(game_id="test-1")
  result = arena.run_game(max_ticks=500)
  print(arena.report())
"""

import math, random, time, json, os, sys, asyncio
from http.server import HTTPServer, BaseHTTPRequestHandler
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from collections import deque
from enum import Enum
import threading

sys.path.insert(0, os.path.dirname(__file__))
from training_arena import (
    CombatAgent, CombatPhase, TrainingArena,
    BLUE_FLEET, RED_FLEET, RED_AIR_DEFENSE,
    ARENA_SIZE, CELL_SIZE,
)
from serafim_agent import SerafimAgent, TacticalSituation
from social_metrics import SocialMetricsTracker


class SerafimArena(TrainingArena):
    """
    Арена где агенты управляются Serafim вместо хардкода.

    От TrainingArena отличается только методом _update_agent —
    здесь решение принимает LLM, а не правила.
    """

    def __init__(self, game_id: str = None,
                 ollama_url: str = "http://localhost:11434",
                 model: str = "serafim-tactical:q8",
                 use_serafim: bool = True,
                 tick_rate: float = 0.5):  # запрос к Serafim раз в 500ms
        super().__init__(game_id)
        self.ollama_url = ollama_url
        self.model = model
        self.use_serafim = use_serafim
        self.tick_rate = tick_rate  # seconds between Serafim decisions

        # Serafim-агенты (по одному на каждого боевого агента)
        self.serafim_agents: Dict[str, SerafimAgent] = {}
        self._init_serafim_agents()

        # Метрики социального поведения
        self.metrics = SocialMetricsTracker()
        blue_count = len([a for a in self.blue_agents.values() if a.role != "НАЗМ"])
        red_count = len([a for a in self.red_agents.values() if a.role != "НАЗМ"])
        self.metrics.set_initial_conditions(
            agents_count=blue_count,
            targets_count=red_count,
        )

        # Статистика Serafim
        self.serafim_calls = 0
        self.serafim_cache_hits = 0
        self.total_latency_ms = 0.0

    def _init_serafim_agents(self):
        """Создать Serafim-агента для каждого боевого агента."""
        for fid, role, name in BLUE_FLEET:
            if role != "НАЗМ":  # база не управляется Serafim
                self.serafim_agents[fid] = SerafimAgent(
                    fid, role, "blue", self.ollama_url, self.model)
        for fid, role, name in RED_FLEET:
            if role != "НАЗМ":
                self.serafim_agents[fid] = SerafimAgent(
                    fid, role, "red", self.ollama_url, self.model)

    # ═══════════════════════════════════════════════════════════
    # ГЛАВНОЕ: ЗАМЕНА ХАРДКОДА НА Serafim
    # ═══════════════════════════════════════════════════════════

    def _update_agent(self, agent: CombatAgent, events: list):
        """Обновить агента — с Serafim вместо хардкода."""
        if not self.use_serafim or agent.role == "НАЗМ":
            return super()._update_agent(agent, events)

        serafim = self.serafim_agents.get(agent.id)
        if not serafim:
            return super()._update_agent(agent, events)

        # Построить тактическую обстановку
        sit = self._build_tactical_situation(agent)

        # Запросить решение у Serafim
        decision = serafim.decide_sync(sit, timeout_s=3)

        self.serafim_calls += 1
        self.total_latency_ms += decision.latency_ms
        if serafim.cache_hits > 0:
            self.serafim_cache_hits += 1

        # Найти ближайшего врага для apply_decision
        enemy_team = self.red_agents if agent.team == "blue" else self.blue_agents
        nearest_enemy = None
        nearest_dist = float('inf')
        for enemy in enemy_team.values():
            if enemy.phase == CombatPhase.DEAD:
                continue
            dist = math.sqrt((agent.x - enemy.x)**2 + (agent.z - enemy.z)**2)
            if dist < nearest_dist:
                nearest_dist = dist
                nearest_enemy = enemy

        # Применить решение
        serafim.apply_decision(agent, decision, nearest_enemy, nearest_dist)

        # Попадание при атаке (общая логика, не зависит от Serafim)
        if decision.action.value == "attack" and nearest_enemy and nearest_dist < 15:
            nearest_enemy.phase = CombatPhase.DEAD
            agent.kills += 1
            agent.total_kills += 1
            agent.damage_dealt += 100
            events.append({
                "event": "SERAFIM_KILL",
                "killer": f"{agent.name}({agent.id})",
                "victim": f"{nearest_enemy.name}({nearest_enemy.id})",
                "team": agent.team, "tick": self.tick,
                "decision": decision.reason[:100],
            })
            self.kill_feed.append(f"🤖 {agent.name} [Serafim] → {nearest_enemy.name}")

            # Социальная метрика: cooperation если рядом союзники
            nearby_friendlies = []
            friendly_team = self.blue_agents if agent.team == "blue" else self.red_agents
            for fid, fagent in friendly_team.items():
                if fid != agent.id and fagent.phase != CombatPhase.DEAD:
                    fdist = math.sqrt((agent.x - fagent.x)**2 + (agent.z - fagent.z)**2)
                    if fdist < 500:
                        nearby_friendlies.append(fid)
            if nearby_friendlies:
                self.metrics.record_cooperation(
                    self.tick, [agent.id] + nearby_friendlies,
                    f"Совместная атака на {nearest_enemy.name}",
                )

        # Запись в метрики
        self.metrics.record_decision(
            tick=self.tick,
            agent_id=agent.id,
            role=agent.role,
            action=decision.action.value,
            target_id=nearest_enemy.id if nearest_enemy else "",
            priority=decision.priority,
            reasoning=decision.reason[:100],
            latency_ms=decision.latency_ms,
        )

    def _build_tactical_situation(self, agent: CombatAgent) -> TacticalSituation:
        """Построить TacticalSituation из текущего состояния игры."""
        enemy_team = self.red_agents if agent.team == "blue" else self.blue_agents
        friendly_team = self.blue_agents if agent.team == "blue" else self.red_agents

        # Враги
        enemies = []
        nearest_dist = float('inf')
        for eid, enemy in enemy_team.items():
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
        for fid, f_agent in friendly_team.items():
            if f_agent.phase == CombatPhase.DEAD or fid == agent.id:
                continue
            friendlies_alive += 1
            dist = math.sqrt((agent.x - f_agent.x)**2 + (agent.z - f_agent.z)**2)
            friendlies.append({
                "id": fid, "role": f_agent.role, "dist_m": dist,
                "heading_rel_deg": 0,
            })

        # Врагов живыми
        enemies_alive = sum(1 for e in enemy_team.values() if e.phase != CombatPhase.DEAD)

        return TacticalSituation(
            agent_id=agent.id,
            agent_role=agent.role,
            agent_team=agent.team,
            x=agent.x, y=agent.y, z=agent.z,
            battery_pct=agent.battery,
            heading_deg=agent.heading,
            enemies=enemies,
            nearest_enemy_dist=nearest_dist,
            friendlies=friendlies,
            friendlies_alive=friendlies_alive,
            enemies_alive=enemies_alive,
            comms_quality=1.0 if self.tick % 100 < 90 else 0.1,  # периодический обрыв для теста
            ew_jamming=hasattr(self, 'ew_active') and self.ew_active,
            sam_threat=len(self.air_defense) > 0,
            weather=self.weather,
            time_of_day=self.time_of_day,
            mission_phase=agent.phase.value,
            kills=agent.kills,
        )

    # ═══════════════════════════════════════════════════════════
    # ЗАПУСК ИГРЫ
    # ═══════════════════════════════════════════════════════════

    def run_game(self, max_ticks: int = 500) -> dict:
        """Запустить одну игру."""
        t0 = time.time()

        for _ in range(max_ticks):
            result = self.tick_game()
            if result.get("event") == "GAME_OVER" or self.winner:
                break

        elapsed = time.time() - t0

        # Финальные метрики
        blue_alive = sum(1 for a in self.blue_agents.values() if a.phase != CombatPhase.DEAD)
        red_alive = sum(1 for a in self.red_agents.values() if a.phase != CombatPhase.DEAD)
        red_destroyed = len([a for a in self.red_agents.values() if a.phase == CombatPhase.DEAD])
        self.metrics.set_final_conditions(
            survivors=blue_alive,
            targets_destroyed=red_destroyed,
        )

        social_report = self.metrics.report()

        return {
            "game_id": self.game_id,
            "ticks": self.tick,
            "duration_s": round(elapsed, 1),
            "winner": self.winner,
            "blue_alive": blue_alive,
            "red_alive": red_alive,
            "serafim_calls": self.serafim_calls,
            "serafim_cache_hits": self.serafim_cache_hits,
            "avg_latency_ms": round(self.total_latency_ms / max(1, self.serafim_calls), 1),
            "social_metrics": social_report,
        }

    def report(self) -> str:
        """Краткий отчёт."""
        blue_alive = sum(1 for a in self.blue_agents.values() if a.phase != CombatPhase.DEAD)
        red_alive = sum(1 for a in self.red_agents.values() if a.phase != CombatPhase.DEAD)
        return (
            f"Game: {self.game_id} | Winner: {self.winner} | "
            f"Blue alive: {blue_alive} | Red alive: {red_alive} | "
            f"Ticks: {self.tick} | Serafim calls: {self.serafim_calls} | "
            f"Avg latency: {self.total_latency_ms / max(1, self.serafim_calls):.0f}ms\n"
            f"Social: {self.metrics.summary()}"
        )


# ═══════════════════════════════════════════════════════════════
# WEB-СЕРВЕР ДЛЯ ВИЗУАЛИЗАЦИИ
# ═══════════════════════════════════════════════════════════════

class ArenaWebServer:
    """Веб-интерфейс для наблюдения за ареной."""

    def __init__(self, arena: SerafimArena, port: int = 8200):
        self.arena = arena
        self.port = port

    def start(self):
        arena = self.arena

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/":
                    self.send_response(200)
                    self.send_header("Content-type", "text/html; charset=utf-8")
                    self.end_headers()
                    html = self._build_html()
                    self.wfile.write(html.encode())
                elif self.path == "/state":
                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.end_headers()
                    state = {
                        "tick": arena.tick,
                        "winner": arena.winner,
                        "blue": [
                            {"id": a.id, "name": a.name, "role": a.role,
                             "x": a.x, "z": a.z, "y": a.y,
                             "phase": a.phase.value, "battery": a.battery,
                             "kills": a.kills,
                             "serafim": arena.serafim_agents.get(a.id, None) is not None}
                            for a in arena.blue_agents.values()
                        ],
                        "red": [
                            {"id": a.id, "name": a.name, "role": a.role,
                             "x": a.x, "z": a.z, "y": a.y,
                             "phase": a.phase.value, "kills": a.kills,
                             "serafim": arena.serafim_agents.get(a.id, None) is not None}
                            for a in arena.red_agents.values()
                        ],
                        "kill_feed": list(arena.kill_feed)[-10:],
                        "serafim_calls": arena.serafim_calls,
                        "avg_latency_ms": arena.total_latency_ms / max(1, arena.serafim_calls),
                    }
                    self.wfile.write(json.dumps(state).encode())
                else:
                    self.send_response(404); self.end_headers()

            def _build_html(self):
                return """<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Serafim Arena</title>
<style>body{margin:0;background:#0a0a0f;color:#ccc;font-family:monospace}
canvas{display:block;margin:10px auto}
#info{text-align:center;padding:10px}
.kill{color:#f55}.blue{color:#55f}.red{color:#f55}.serafim{color:#0f0}</style></head>
<body><canvas id="c" width="800" height="800"></canvas>
<div id="info"><span id="status">...</span></div>
<div id="feed" style="max-width:800px;margin:0 auto;padding:10px;height:200px;overflow-y:auto;font-size:12px"></div>
<script>
const canvas=document.getElementById('c'),ctx=canvas.getContext('2d');
const CX=400,CZ=400,SCALE=0.18;
function draw(){
  fetch('/state').then(r=>r.json()).then(s=>{
    ctx.fillStyle='#0a0a0f';ctx.fillRect(0,0,800,800);
    ctx.strokeStyle='#1a1a2a';ctx.lineWidth=1;
    for(let i=0;i<800;i+=SCALE*100) {ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,800);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(800,i);ctx.stroke();}
    s.blue.forEach(a=>{let x=CX+a.x*SCALE,z=CZ+a.z*SCALE;
      ctx.fillStyle=a.phase==='dead'?'#333':a.serafim?'#0f0':'#44f';
      ctx.beginPath();ctx.arc(x,z,6,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.font='9px mono';ctx.fillText(a.name,x+8,z+3)});
    s.red.forEach(a=>{let x=CX+a.x*SCALE,z=CZ+a.z*SCALE;
      ctx.fillStyle=a.phase==='dead'?'#333':a.serafim?'#0f0':'#f44';
      ctx.beginPath();ctx.arc(x,z,6,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.font='9px mono';ctx.fillText(a.name,x+8,z+3)});
    document.getElementById('status').innerHTML=`Tick: ${s.tick} | Winner: ${s.winner||'...'} | Serafim calls: ${s.serafim_calls} | Avg latency: ${s.avg_latency_ms.toFixed(0)}ms`;
    let feed=document.getElementById('feed');
    if(s.kill_feed&&s.kill_feed.length) feed.innerHTML=s.kill_feed.slice(-20).map(k=>`<div>${k}</div>`).join('<br>');
  });setTimeout(draw,500);}
draw();</script></body></html>"""

        server = HTTPServer(("0.0.0.0", self.port), Handler)
        print(f"Serafim Arena: http://localhost:{self.port}")
        server.serve_forever()


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--headless", action="store_true", help="Без веб-сервера, только метрики")
    p.add_argument("--max-ticks", type=int, default=500, help="Максимум тиков")
    p.add_argument("--port", type=int, default=8200)
    args = p.parse_args()

    print("╔══════════════════════════════════════════════╗")
    print("║  SERAFIM ARENA — LLM vs LLM                 ║")
    print("╚══════════════════════════════════════════════╝")
    print(f"  Агенты: Serafim ({len(BLUE_FLEET)} blue vs {len(RED_FLEET)} red)")
    print(f"  Арена: {ARENA_SIZE}×{ARENA_SIZE}м | Тиков: {args.max_ticks}")
    print()

    arena = SerafimArena(game_id=f"serafim-{int(time.time())}")

    if args.headless:
        result = arena.run_game(max_ticks=args.max_ticks)
        print(arena.report())
        if result.get("social_metrics"):
            sm = result["social_metrics"]
            print(f"\n  Cooperation: {sm['cooperation']['index']:.2f}")
            print(f"  Conflict: {sm['conflict']['rate']:.2f}")
            print(f"  Survival: {sm['survival']['rate']:.0%}")
            print(f"  Mission: {sm['mission']['success_rate']:.0%}")
            print(f"  Emergent: {sm['emergent']['patterns_count']} patterns")
    else:
        # Запустить игру в фоне + веб-сервер
        def game_loop():
            while arena.winner is None:
                arena.tick_game()
                time.sleep(0.3)

        game_thread = threading.Thread(target=game_loop, daemon=True)
        game_thread.start()
        time.sleep(1)

        web = ArenaWebServer(arena, args.port)
        try:
            web.start()
        except KeyboardInterrupt:
            print("\nStopped")
            print(arena.report())
