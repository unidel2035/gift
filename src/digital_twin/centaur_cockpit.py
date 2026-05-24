#!/usr/bin/env python3
"""
centaur_cockpit.py — Кентавр: человек + Serafim как один боевой организм

Архитектура Iron Man: инженер (пилот) + Jarvis (Serafim) = Кентавр.

  ПИЛОТ (человек)              SERAFIM (ИИ)
  ─────────────                ─────────────
  Видит обстановку             Анализирует сенсоры
  Принимает решение            Предлагает варианты
  Подтверждает/отклоняет       Объясняет почему
  Учится на ошибках            Учится на решениях пилота

Три режима:
  1. COPILOT  — Serafim предлагает, человек решает (обучение)
  2. AUTONOMY — Serafim действует сам, человек наблюдает (бой)
  3. DEBRIEF  — После миссии: разбор, чему научились (рефлексия)

Опыт пилота → тренировочные данные → Serafim учится → пилот сильнее.

Использование:
  cockpit = CentaurCockpit(pilot_id="Сын", pilot_age=14)
  cockpit.start_mission(arena)
  # Веб-интерфейс на http://localhost:8300
"""

import asyncio, json, time, math, os, sys, threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from collections import deque
from enum import Enum

sys.path.insert(0, os.path.dirname(__file__))
from serafim_agent import SerafimAgent, TacticalSituation, SerafimAction, TacticalDecision
from social_metrics import SocialMetricsTracker, SocialEvent
from training_arena import CombatAgent, CombatPhase

# ═══════════════════════════════════════════════════════════════
# КЕНТАВР: ЧЕЛОВЕК + ИИ
# ═══════════════════════════════════════════════════════════════

class CockpitMode(Enum):
    COPILOT = "copilot"      # Serafim предлагает → человек решает
    AUTONOMY = "autonomy"    # Serafim действует → человек наблюдает
    DEBRIEF = "debrief"      # После миссии: анализ, обучение


@dataclass
class PilotDecision:
    """Решение пилота-человека."""
    tick: int
    action: str              # attack/observe/rtb/patrol/support
    target_id: str
    reasoning: str            # почему пилот так решил
    serafim_suggestion: str  # что предложил Serafim
    accepted_suggestion: bool # принял ли пилот предложение ИИ
    override_reason: str = "" # если отклонил — почему
    timestamp: float = 0.0


@dataclass
class CentaurExperience:
    """Один боевой опыт кентавра — запись для обучения."""
    tick: int
    situation: dict           # тактическая обстановка (сенсоры)
    serafim_suggestion: str   # что предложил Serafim
    pilot_decision: str       # что решил пилот
    outcome: str              # чем закончилось (kill/miss/survive/die)
    lesson: str = ""          # чему научились (post-hoc)


class CentaurCockpit:
    """
    Кокпит кентавра — интерфейс человек+ИИ.

    Человек-пилот и Serafim-копилот работают как один организм.
    Все решения записываются → становятся обучающими данными.
    """

    def __init__(self, pilot_id: str = "Pilot-1",
                 pilot_name: str = "Пилот",
                 pilot_age: int = 14,
                 ollama_url: str = "http://localhost:11434",
                 model: str = "serafim-tactical:q8"):
        self.pilot_id = pilot_id
        self.pilot_name = pilot_name
        self.pilot_age = pilot_age
        self.mode = CockpitMode.COPILOT

        # Serafim-копилот
        self.copilot = SerafimAgent(f"copilot-{pilot_id}", "РАЗВ", "blue", ollama_url, model)

        # История решений
        self.decisions: List[PilotDecision] = []
        self.experiences: List[CentaurExperience] = []

        # Текущая миссия
        self.mission_active = False
        self.mission_tick = 0
        self.current_situation: Optional[TacticalSituation] = None
        self.current_suggestion: Optional[TacticalDecision] = None

        # Статистика
        self.suggestions_accepted = 0
        self.suggestions_rejected = 0
        self.kills = 0
        self.deaths = 0
        self.missions_flown = 0

        # Коммуникация
        self.log: deque = deque(maxlen=200)
        self.pending_decision: bool = False  # ждём решения пилота

    # ═══════════════════════════════════════════════════════════
    # МИССИЯ
    # ═══════════════════════════════════════════════════════════

    def start_mission(self):
        """Начать новую миссию."""
        self.mission_active = True
        self.mission_tick = 0
        self.decisions = []
        self.experiences = []
        self.kills = 0
        self.deaths = 0
        self.log.append({
            "tick": 0, "type": "mission_start",
            "msg": f"Миссия начата. Пилот: {self.pilot_name} ({self.pilot_age} лет). "
                   f"Режим: {self.mode.value}. Копилот: Serafim V2 Q8."
        })

    def end_mission(self, outcome: str = "completed"):
        """Завершить миссию."""
        self.mission_active = False
        self.missions_flown += 1
        self.log.append({
            "tick": self.mission_tick, "type": "mission_end",
            "msg": f"Миссия завершена: {outcome}. "
                   f"Принято/отклонено: {self.suggestions_accepted}/{self.suggestions_rejected}. "
                   f"Уничтожено: {self.kills}. Потерь: {self.deaths}."
        })

    # ═══════════════════════════════════════════════════════════
    # ЦИКЛ РЕШЕНИЯ: SITUATION → SUGGESTION → PILOT → ACTION
    # ═══════════════════════════════════════════════════════════

    def present_situation(self, sit: TacticalSituation) -> dict:
        """
        Предъявить обстановку пилоту. Serafim предлагает решение.
        Пилот видит и обстановку, и предложение.
        Возвращает: {situation, suggestion, pending: True}
        """
        self.mission_tick += 1
        self.current_situation = sit

        # Serafim предлагает решение
        suggestion = self.copilot.decide_sync(sit, timeout_s=5)
        self.current_suggestion = suggestion
        self.pending_decision = True

        self.log.append({
            "tick": self.mission_tick,
            "type": "situation",
            "enemies": len(sit.enemies),
            "nearest_dist": sit.nearest_enemy_dist,
            "battery": sit.battery_pct,
            "suggestion": suggestion.action.value,
            "suggestion_reason": suggestion.reason[:150],
        })

        return {
            "tick": self.mission_tick,
            "situation": {
                "enemies": sit.enemies[:5],
                "nearest_enemy_dist": sit.nearest_enemy_dist,
                "friendlies_alive": sit.friendlies_alive,
                "battery_pct": sit.battery_pct,
                "comms_quality": sit.comms_quality,
                "ew_jamming": sit.ew_jamming,
                "sam_threat": sit.sam_threat,
                "weather": sit.weather,
                "mission_phase": sit.mission_phase,
            },
            "suggestion": {
                "action": suggestion.action.value,
                "reason": suggestion.reason[:200],
                "confidence": suggestion.confidence,
                "target_id": suggestion.target_id,
                "priority": suggestion.priority,
            },
            "pending": True,
            "pilot": {
                "id": self.pilot_id,
                "name": self.pilot_name,
            },
        }

    def pilot_decide(self, action: str, target_id: str = "",
                     reasoning: str = "", accept_suggestion: bool = True,
                     override_reason: str = "") -> dict:
        """
        Пилот принимает решение.

        Если accept_suggestion=True: действие = предложение Serafim.
        Если accept_suggestion=False: пилот отклоняет и задаёт своё действие.
        """
        if not self.pending_decision:
            return {"error": "no pending decision"}

        suggestion_action = self.current_suggestion.action.value if self.current_suggestion else "patrol"

        if accept_suggestion:
            final_action = suggestion_action
            self.suggestions_accepted += 1
        else:
            final_action = action
            self.suggestions_rejected += 1

        # Записать решение
        decision = PilotDecision(
            tick=self.mission_tick,
            action=final_action,
            target_id=target_id,
            reasoning=reasoning,
            serafim_suggestion=suggestion_action,
            accepted_suggestion=accept_suggestion,
            override_reason=override_reason,
            timestamp=time.time(),
        )
        self.decisions.append(decision)
        self.pending_decision = False

        # Записать опыт для обучения
        experience = CentaurExperience(
            tick=self.mission_tick,
            situation={
                "enemies": self.current_situation.enemies[:5] if self.current_situation else [],
                "battery": self.current_situation.battery_pct if self.current_situation else 100,
                "comms": self.current_situation.comms_quality if self.current_situation else 1.0,
            },
            serafim_suggestion=suggestion_action,
            pilot_decision=final_action,
            outcome="pending",  # будет заполнено по результату
        )
        self.experiences.append(experience)

        self.log.append({
            "tick": self.mission_tick,
            "type": "decision",
            "suggestion": suggestion_action,
            "accepted": accept_suggestion,
            "final_action": final_action,
            "pilot_reasoning": reasoning[:150],
        })

        return {
            "action": final_action,
            "accepted_suggestion": accept_suggestion,
            "suggestion_was": suggestion_action,
            "target_id": target_id,
        }

    def record_outcome(self, outcome: str, lesson: str = ""):
        """Записать исход последнего решения (kill/miss/survive/die)."""
        if self.experiences:
            exp = self.experiences[-1]
            exp.outcome = outcome
            if lesson:
                exp.lesson = lesson
            if outcome == "kill":
                self.kills += 1
            elif outcome == "die":
                self.deaths += 1

    # ═══════════════════════════════════════════════════════════
    # ОБУЧАЮЩИЕ ДАННЫЕ
    # ═══════════════════════════════════════════════════════════

    def export_training_data(self) -> List[dict]:
        """
        Экспортировать опыт кентавра как тренировочные данные для Serafim.

        Формат — ChatML, совместимый с LoRA-дообучением:
          prompt: тактическая обстановка
          response: что решил человек-пилот (gold standard)
        """
        dataset = []
        for exp in self.experiences:
            if exp.outcome in ("pending", ""):
                continue  # пропускаем незавершённые

            # Формируем prompt как текст обстановки
            enemies = exp.situation.get("enemies", [])
            enemy_str = ", ".join(
                f"{e.get('role','цель')} на {e.get('dist_m',0):.0f}м"
                for e in enemies[:3]
            ) if enemies else "врагов не видно"

            prompt = (
                f"Ты дрон-пилот (кентавр). "
                f"Враги: {enemy_str}. "
                f"Батарея: {exp.situation.get('battery', 100):.0f}%. "
                f"Связь: {exp.situation.get('comms', 1.0):.0%}. "
                f"Решение:"
            )

            # Ответ пилота — золотой стандарт
            serafim_note = f"[Serafim предлагал: {exp.serafim_suggestion}]"
            response = f"{exp.pilot_decision}: {serafim_note} — исход: {exp.outcome}"
            if exp.lesson:
                response += f" | урок: {exp.lesson}"

            dataset.append({
                "prompt": prompt,
                "response": response,
                "metadata": {
                    "serafim_suggestion": exp.serafim_suggestion,
                    "pilot_accepted": exp.pilot_decision == exp.serafim_suggestion,
                    "outcome": exp.outcome,
                    "lesson": exp.lesson,
                    "pilot": self.pilot_name,
                    "pilot_age": self.pilot_age,
                },
            })

        return dataset

    # ═══════════════════════════════════════════════════════════
    # СТАТИСТИКА
    # ═══════════════════════════════════════════════════════════

    def stats(self) -> dict:
        return {
            "pilot": {
                "id": self.pilot_id,
                "name": self.pilot_name,
                "age": self.pilot_age,
            },
            "missions": {
                "flown": self.missions_flown,
                "active": self.mission_active,
                "current_tick": self.mission_tick,
            },
            "decisions": {
                "total": len(self.decisions),
                "suggestions_accepted": self.suggestions_accepted,
                "suggestions_rejected": self.suggestions_rejected,
                "acceptance_rate": round(
                    self.suggestions_accepted / max(1, self.suggestions_accepted + self.suggestions_rejected), 2
                ),
            },
            "combat": {
                "kills": self.kills,
                "deaths": self.deaths,
                "kd_ratio": round(self.kills / max(1, self.deaths), 1),
            },
            "training": {
                "experiences_recorded": len(self.experiences),
                "trainable_examples": len([e for e in self.experiences if e.outcome not in ("pending", "")]),
            },
            "mode": self.mode.value,
        }


# ═══════════════════════════════════════════════════════════════
# ВЕБ-КОКПИТ
# ═══════════════════════════════════════════════════════════════

CENTAUR_HTML = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Centaur Cockpit — {pilot_name} + Serafim</title>
<style>
*{{margin:0;box-sizing:border-box}}
body{{background:#0a0a12;color:#c8ccd4;font-family:'Segoe UI',monospace;display:flex;height:100vh}}
#left{{width:320px;background:#111118;padding:16px;overflow-y:auto;border-right:1px solid #222}}
#center{{flex:1;position:relative}}
#right{{width:340px;background:#111118;padding:16px;overflow-y:auto;border-left:1px solid #222}}
canvas{{display:block}}
h2{{color:#4af;font-size:16px;margin-bottom:12px}}
h3{{color:#8af;font-size:13px;margin:12px 0 6px}}
.pilot{{color:#0f0;font-size:18px;font-weight:bold}}
.serafim{{color:#f80}}
.stat{{display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid #1a1a22}}
.stat .val{{color:#fff}}
#suggestion{{background:#1a1a2e;border:2px solid #f80;border-radius:8px;padding:12px;margin:12px 0}}
#suggestion .action{{font-size:20px;font-weight:bold;color:#f80;text-transform:uppercase}}
#suggestion .reason{{font-size:12px;color:#aaa;margin-top:6px}}
.btn{{display:block;width:100%;padding:12px;margin:6px 0;border:none;border-radius:6px;font-size:16px;cursor:pointer;font-weight:bold}}
.btn-accept{{background:#0a0;color:#fff}}
.btn-override{{background:#800;color:#fff}}
.btn-observe{{background:#448;color:#fff;font-size:12px;padding:8px}}
#override-panel{{display:none;background:#1a1a2e;border:2px solid #f44;border-radius:8px;padding:12px;margin:6px 0}}
#override-panel select,#override-panel input{{width:100%;padding:8px;margin:4px 0;background:#0a0a12;color:#fff;border:1px solid #333;border-radius:4px}}
#log{{font-size:11px;max-height:200px;overflow-y:auto}}
.log-entry{{padding:2px 0;border-bottom:1px solid #1a1a22}}
.log-entry .suggest{{color:#f80}}
.log-entry .accept{{color:#0f0}}
.log-entry .reject{{color:#f44}}
.kill{{color:#f55}} .info{{color:#4af}}
#experience-counter{{color:#ff0;font-size:14px}}
</style>
</head>
<body>
<div id="left">
  <div class="pilot">👤 {pilot_name}</div>
  <div style="font-size:12px;color:#aaa;margin-bottom:16px">{pilot_age} лет | Кентавр</div>

  <h3>📊 СТАТИСТИКА МИССИИ</h3>
  <div class="stat"><span>Режим</span><span class="val" id="mode">COPILOT</span></div>
  <div class="stat"><span>Тик</span><span class="val" id="tick">0</span></div>
  <div class="stat"><span>Принято предложений</span><span class="val" id="accepted">0</span></div>
  <div class="stat"><span>Отклонено</span><span class="val" id="rejected">0</span></div>
  <div class="stat"><span>Уничтожено</span><span class="val" id="kills">0</span></div>
  <div class="stat"><span>Потерь</span><span class="val" id="deaths">0</span></div>
  <div class="stat"><span>Опыта записано</span><span class="val" id="experience-counter">0</span></div>

  <h3>🤖 SERAFIM КОПИЛОТ</h3>
  <div id="suggestion">
    <div style="font-size:11px;color:#aaa">SERAFIM ПРЕДЛАГАЕТ:</div>
    <div class="action" id="sugg-action">—</div>
    <div class="reason" id="sugg-reason">Ожидание обстановки...</div>
    <div style="font-size:11px;color:#888;margin-top:4px">
      Уверенность: <span id="sugg-confidence">—</span>
    </div>
  </div>

  <button class="btn btn-accept" onclick="accept()">✅ ПРИНЯТЬ</button>
  <button class="btn btn-override" onclick="showOverride()">❌ ОТКЛОНИТЬ</button>

  <div id="override-panel">
    <h3 style="color:#f44">СВОЁ РЕШЕНИЕ</h3>
    <select id="override-action">
      <option value="attack">ATTACK — Атаковать</option>
      <option value="observe">OBSERVE — Наблюдать</option>
      <option value="rtb">RTB — Возврат на базу</option>
      <option value="patrol">PATROL — Патрулировать</option>
      <option value="support">SUPPORT — Поддержка</option>
    </select>
    <input id="override-reason" placeholder="Почему? (кратко)">
    <button class="btn btn-override" onclick="override()" style="margin-top:8px">ПОДТВЕРДИТЬ</button>
    <button class="btn btn-observe" onclick="hideOverride()">ОТМЕНА</button>
  </div>
</div>

<div id="center">
  <canvas id="c"></canvas>
</div>

<div id="right">
  <h3>📋 ОБСТАНОВКА</h3>
  <div id="situation"></div>

  <h3>📝 ЛОГ</h3>
  <div id="log"></div>
</div>

<script>
const API='/api';
var tick=0;

async function update(){{
  try{{
    let r=await fetch(API+'/state');
    let s=await r.json();
    if(!s.pending){{ tick=s.tick; drawArena(s); }}
    document.getElementById('tick').textContent=tick;
    document.getElementById('accepted').textContent=s.stats?.suggestions_accepted||0;
    document.getElementById('rejected').textContent=s.stats?.suggestions_rejected||0;
    document.getElementById('kills').textContent=s.stats?.kills||0;
    document.getElementById('deaths').textContent=s.stats?.deaths||0;
    document.getElementById('experience-counter').textContent=s.stats?.training?.trainable_examples||0;
    document.getElementById('mode').textContent=s.stats?.mode||'COPILOT';

    if(s.pending && s.suggestion){{
      document.getElementById('sugg-action').textContent=s.suggestion.action.toUpperCase();
      document.getElementById('sugg-reason').textContent=s.suggestion.reason;
      document.getElementById('sugg-confidence').textContent=Math.round((s.suggestion.confidence||0.8)*100)+'%';
    }}

    // Situation panel
    let sit=s.situation;
    if(sit){{
      let html='';
      if(sit.enemies&&sit.enemies.length) sit.enemies.forEach(e=>html+=`<div class="stat"><span>🎯 ${{e.role}}</span><span class="val">${{Math.round(e.dist_m)}}м</span></div>`);
      html+=`<div class="stat"><span>Батарея</span><span class="val">${{Math.round(sit.battery_pct)}}%</span></div>`;
      html+=`<div class="stat"><span>Связь</span><span class="val">${{Math.round(sit.comms_quality*100)}}%</span></div>`;
      html+=`<div class="stat"><span>РЭБ</span><span class="val">${{sit.ew_jamming?'ДА':'нет'}}</span></div>`;
      html+=`<div class="stat"><span>ПВО</span><span class="val">${{sit.sam_threat?'ДА':'нет'}}</span></div>`;
      document.getElementById('situation').innerHTML=html;
    }}

    // Log
    if(s.log){{
      let logHtml='';
      s.log.slice(-15).forEach(l=>{{
        if(l.type==='decision') logHtml+=`<div class="log-entry"><span class="${{l.accepted?'accept':'reject'}}">${{l.accepted?'✅ ПРИНЯЛ':'❌ ОТКЛОНИЛ'}}</span> → <span class="info">${{l.final_action}}</span></div>`;
        else if(l.type==='outcome') logHtml+=`<div class="log-entry"><span class="kill">💥 ${{l.msg}}</span></div>`;
        else if(l.type==='lesson') logHtml+=`<div class="log-entry"><span style="color:#ff0">📖 ${{l.msg}}</span></div>`;
      }});
      document.getElementById('log').innerHTML=logHtml;
    }}
  }}catch(e){{console.error(e)}}
  setTimeout(update,1000);
}}

function accept(){{fetch(API+'/decide',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{accept:true}})}});}}
function showOverride(){{document.getElementById('override-panel').style.display='block';}}
function hideOverride(){{document.getElementById('override-panel').style.display='none';}}
function override(){{
  let action=document.getElementById('override-action').value;
  let reason=document.getElementById('override-reason').value;
  fetch(API+'/decide',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{accept:false,action:action,reason:reason}})}});
  hideOverride();
}}

// Arena render
var canvas=document.getElementById('c');
var ctx=canvas.getContext('2d');
function drawArena(s){{
  let w=canvas.width=canvas.parentElement.clientWidth-20;
  let h=canvas.height=window.innerHeight-20;
  ctx.fillStyle='#0a0a12';ctx.fillRect(0,0,w,h);
  let cx=w/2,cy=h/2,scale=0.15;
  ctx.strokeStyle='#1a1a2a';ctx.lineWidth=1;
  for(let i=0;i<w;i+=scale*100){{ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(w,i);ctx.stroke();}}
  if(s.agents){{
    s.agents.forEach(a=>{{
      let x=cx+a.x*scale,y=cy+a.z*scale;
      ctx.fillStyle=a.phase==='dead'?'#333':a.is_pilot?'#0f0':a.team==='blue'?'#44f':'#f44';
      ctx.beginPath();ctx.arc(x,y,a.is_pilot?10:5,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.font='9px mono';ctx.fillText(a.name||a.id,x+7,y+3);
    }});
  }}
}}
update();
</script>
</body></html>"""


class CentaurWebServer:
    """Веб-сервер кокпита кентавра."""

    def __init__(self, cockpit: CentaurCockpit, arena=None, port: int = 8300):
        self.cockpit = cockpit
        self.arena = arena
        self.port = port
        self._latest_state = {}

    def start(self):
        cockpit = self.cockpit
        arena = self.arena

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/" or self.path == "/index.html":
                    html = CENTAUR_HTML.format(
                        pilot_name=cockpit.pilot_name,
                        pilot_age=cockpit.pilot_age,
                    )
                    self.send_response(200)
                    self.send_header("Content-type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(html.encode())

                elif self.path == "/api/state":
                    state = {
                        "tick": cockpit.mission_tick,
                        "pending": cockpit.pending_decision,
                        "stats": cockpit.stats(),
                        "log": list(cockpit.log)[-30:],
                    }
                    if cockpit.pending_decision and cockpit.current_suggestion:
                        state["suggestion"] = {
                            "action": cockpit.current_suggestion.action.value,
                            "reason": cockpit.current_suggestion.reason[:200],
                            "confidence": cockpit.current_suggestion.confidence,
                        }
                    if cockpit.current_situation:
                        state["situation"] = {
                            "enemies": cockpit.current_situation.enemies[:5],
                            "battery_pct": cockpit.current_situation.battery_pct,
                            "comms_quality": cockpit.current_situation.comms_quality,
                            "ew_jamming": cockpit.current_situation.ew_jamming,
                            "sam_threat": cockpit.current_situation.sam_threat,
                        }
                    # Arena agents if available
                    if arena:
                        state["agents"] = []
                        for a in list(arena.blue_agents.values()) + list(arena.red_agents.values()):
                            state["agents"].append({
                                "id": a.id, "name": a.name, "role": a.role,
                                "team": a.team, "x": a.x, "z": a.z, "y": a.y,
                                "phase": a.phase.value,
                                "is_pilot": a.id == cockpit.pilot_id,
                            })

                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(state).encode())

                else:
                    self.send_response(404); self.end_headers()

            def do_POST(self):
                if self.path == "/api/decide":
                    content_length = int(self.headers.get('Content-Length', 0))
                    body = json.loads(self.rfile.read(content_length))

                    if body.get("accept"):
                        result = cockpit.pilot_decide(
                            action="", accept_suggestion=True)
                    else:
                        result = cockpit.pilot_decide(
                            action=body.get("action", "patrol"),
                            target_id=body.get("target_id", ""),
                            reasoning=body.get("reason", "Пилот решил иначе"),
                            accept_suggestion=False,
                            override_reason=body.get("reason", ""),
                        )

                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())

                elif self.path == "/api/outcome":
                    content_length = int(self.headers.get('Content-Length', 0))
                    body = json.loads(self.rfile.read(content_length))
                    cockpit.record_outcome(
                        outcome=body.get("outcome", "unknown"),
                        lesson=body.get("lesson", ""),
                    )
                    self.send_response(200); self.send_header("Content-type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"ok":true}')

                elif self.path == "/api/export":
                    dataset = cockpit.export_training_data()
                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(dataset, ensure_ascii=False).encode())

        server = HTTPServer(("0.0.0.0", self.port), Handler)
        print(f"Centaur Cockpit: http://localhost:{self.port}")
        print(f"  Пилот: {cockpit.pilot_name} ({cockpit.pilot_age} лет)")
        print(f"  Копилот: Serafim V2 Q8")
        server.serve_forever()


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  CENTAUR COCKPIT — Человек + Serafim            ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    # Создать кентавра
    son = CentaurCockpit(
        pilot_id="son-1",
        pilot_name="Сын",
        pilot_age=14,
    )

    # Демо: симулировать несколько решений
    from serafim_agent import SerafimAgent, TacticalSituation
    copilot = SerafimAgent("copilot-1", "РАЗВ", "blue")

    print(f"Пилот: {son.pilot_name}, {son.pilot_age} лет")
    print(f"Копилот: Serafim V2 Q8")
    print()

    son.start_mission()

    # Симулируем 3 такта
    scenarios = [
        {"enemies": [{"id":"R1","role":"танк","dist_m":400}], "dist": 400, "bat": 80},
        {"enemies": [{"id":"R2","role":"РЭБ","dist_m":800}], "dist": 800, "bat": 60},
        {"enemies": [{"id":"R3","role":"человек","dist_m":200}], "dist": 200, "bat": 45},
    ]

    for i, sc in enumerate(scenarios):
        sit = TacticalSituation(
            agent_id="son-1", agent_role="РАЗВ", agent_team="blue",
            x=0, y=100, z=0,
            battery_pct=sc["bat"],
            heading_deg=45,
            enemies=sc["enemies"],
            nearest_enemy_dist=sc["dist"],
            friendlies_alive=3,
            mission_phase="patrol",
        )

        # Предъявить обстановку
        pres = son.present_situation(sit)
        print(f"Такт {i+1}: враг — {sc['enemies'][0]['role']} на {sc['dist']}м")
        print(f"  Serafim: {pres['suggestion']['action'].upper()}")
        print(f"  Обоснование: {pres['suggestion']['reason'][:120]}")

        # Пилот принимает/отклоняет
        if "человек" in sc["enemies"][0]["role"]:
            son.pilot_decide("observe", accept_suggestion=False,
                            reasoning="Это гражданский, не атакую",
                            override_reason="Не боевая цель")
            son.record_outcome("correct_rejection", "Гражданских не атаковать")
            print(f"  👤 Пилот: ОТКЛОНИЛ → OBSERVE (гражданский)")
        else:
            son.pilot_decide("", accept_suggestion=True)
            son.record_outcome("kill", "Атака эффективна")
            print(f"  👤 Пилот: ПРИНЯЛ → {pres['suggestion']['action'].upper()}")
        print()

    son.end_mission("completed")

    # Экспорт данных
    dataset = son.export_training_data()
    print(f"Опыта записано: {len(dataset)} примеров")
    print(f"Статистика: {json.dumps(son.stats(), indent=2, ensure_ascii=False)}")
