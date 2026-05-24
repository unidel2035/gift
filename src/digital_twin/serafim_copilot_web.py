#!/usr/bin/env python3
"""
serafim_copilot_web.py — Реальный копилот для Uncrashed/GTAV

Одним файлом: сервер + веб-интерфейс.

Сын летит в Uncrashed. Видит врага. Вводит что видит в веб-панель.
Serafim отвечает: ATTACK / OBSERVE / RTB / PATROL.
Все запросы → обучающие данные.

Запуск:
  python3 src/digital_twin/serafim_copilot_web.py
  Открыть http://localhost:8600

Работает СЕЙЧАС. Без эмуляции клавиатуры. Без чтения экрана.
Просто веб-панель + Serafim.
"""

import json, time, os, sys, threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from collections import deque

sys.path.insert(0, os.path.dirname(__file__))
from serafim_agent import SerafimAgent

# ═══════════════════════════════════════════════════════════════
# КОПИЛОТ
# ═══════════════════════════════════════════════════════════════

class CopilotSession:
    def __init__(self, pilot_name="Сын"):
        self.pilot_name = pilot_name
        self.serafim = SerafimAgent("copilot", "РАЗВ", "blue")
        self.history: deque = deque(maxlen=100)
        self.training_data: list = []
        self.session_start = time.time()

    def get_advice(self, situation_text: str, battery: int = 80,
                   enemies: str = "", distance: str = "") -> dict:
        """Получить совет от Serafim."""
        # Построить промпт
        prompt_parts = ["Ты дрон-разведчик."]
        if enemies:
            prompt_parts.append(f"Враги: {enemies}.")
        if distance:
            prompt_parts.append(f"Дистанция: {distance}.")
        if situation_text:
            prompt_parts.append(situation_text)
        prompt_parts.append(f"Батарея: {battery}%.")
        prompt_parts.append("Решение:")
        prompt = " ".join(prompt_parts)

        t0 = time.time()
        decision = self.serafim.decide_sync(
            self.serafim.build_situation(
                battery=battery,
                enemies=[{"id": "R1", "role": enemies, "dist_m": float(distance) if distance.replace('.','').isdigit() else 500}],
                nearest_enemy_dist=float(distance) if distance.replace('.','').isdigit() else 500,
                mission_phase="patrol",
            ),
            timeout_s=5,
        )
        elapsed_ms = (time.time() - t0) * 1000

        # Сохранить в историю
        entry = {
            "time": time.time(),
            "situation": situation_text,
            "enemies": enemies,
            "distance": distance,
            "battery": battery,
            "advice": decision.action.value,
            "reason": decision.reason[:200],
            "latency_ms": elapsed_ms,
        }
        self.history.append(entry)
        self.training_data.append(entry)

        return entry

    def record_feedback(self, entry_idx: int, accepted: bool,
                        outcome: str = "", lesson: str = ""):
        """Записать反馈 пилота."""
        if 0 <= entry_idx < len(self.training_data):
            self.training_data[entry_idx]["accepted"] = accepted
            self.training_data[entry_idx]["outcome"] = outcome
            self.training_data[entry_idx]["lesson"] = lesson


# ═══════════════════════════════════════════════════════════════
# ВЕБ-ИНТЕРФЕЙС
# ═══════════════════════════════════════════════════════════════

COPILOT_HTML = r"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Serafim Copilot — {pilot_name}</title>
<style>
*{{margin:0;box-sizing:border-box;font-family:'Segoe UI',monospace}}
body{{background:#0a0a12;color:#c8ccd4;display:flex;justify-content:center;padding:20px}}
#app{{max-width:700px;width:100%}}
.header{{text-align:center;margin-bottom:20px}}
.header h1{{color:#4af;font-size:22px}}
.header .sub{{color:#888;font-size:13px}}

.panel{{background:#111118;border-radius:10px;padding:16px;margin-bottom:12px}}
.panel h2{{color:#8af;font-size:14px;margin-bottom:10px}}

input,select{{width:100%;padding:10px;margin:4px 0;background:#0a0a12;color:#fff;border:1px solid #333;border-radius:6px;font-size:14px}}
.row{{display:flex;gap:8px}}
.row>*{{flex:1}}

.btn{{padding:12px 24px;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;margin:4px}}
.btn-ask{{background:#08f;color:#fff;width:100%;padding:14px;font-size:18px}}
.btn-accept{{background:#0a0;color:#fff}}
.btn-reject{{background:#800;color:#fff}}

#advice{{background:#1a1a2e;border:3px solid #f80;border-radius:10px;padding:16px;margin:12px 0;text-align:center}}
#advice .action{{font-size:32px;font-weight:bold;color:#f80;text-transform:uppercase}}
#advice .reason{{font-size:13px;color:#aaa;margin-top:6px}}
#advice .meta{{font-size:11px;color:#666;margin-top:4px}}
#advice .waiting{{color:#666;font-size:16px}}

#quick{{
  display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px}}
.quick-btn{{
  padding:10px;background:#1a1a2e;border:1px solid #333;border-radius:6px;
  color:#ccc;cursor:pointer;font-size:12px;text-align:center}}
.quick-btn:hover{{border-color:#f80;color:#f80}}

#history{{max-height:300px;overflow-y:auto;font-size:12px}}
.h-entry{{padding:6px;border-bottom:1px solid #1a1a22;display:flex;justify-content:space-between}}
.h-entry .adv{{color:#f80;font-weight:bold}}
.h-entry .acc{{color:#0f0}} .h-entry .rej{{color:#f44}}
.h-entry .sit{{color:#aaa;font-size:11px}}

#stats{{display:flex;justify-content:space-around;text-align:center;padding:10px;font-size:12px;color:#888}}
#stats .num{{color:#fff;font-size:20px;font-weight:bold}}

#presets{{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}}
.preset-btn{{
  padding:6px 10px;background:#0a1a2e;border:1px solid #224;border-radius:4px;
  color:#8af;cursor:pointer;font-size:11px}}
.preset-btn:hover{{background:#0a2a4e;border-color:#f80}}
</style>
</head>
<body>
<div id="app">
  <div class="header">
    <h1>🤖 Serafim Copilot</h1>
    <div class="sub">Копилот для Uncrashed · Пилот: {pilot_name}</div>
  </div>

  <div id="stats">
    <div><div class="num" id="st-advice">0</div>советов</div>
    <div><div class="num" id="st-accepted">0</div>принято</div>
    <div><div class="num" id="st-rejected">0</div>отклонено</div>
    <div><div class="num" id="st-latency">—</div>задержка ms</div>
  </div>

  <div class="panel">
    <h2>🎯 Что видишь?</h2>
    <div id="quick">
      <div class="quick-btn" onclick="quick('Вижу вражеский дрон')">🛸 Вражеский дрон</div>
      <div class="quick-btn" onclick="quick('Вижу танк')">🎯 Танк</div>
      <div class="quick-btn" onclick="quick('Вижу опорник')">🏚 Опорник</div>
      <div class="quick-btn" onclick="quick('Вижу РЭБ')">📡 РЭБ</div>
      <div class="quick-btn" onclick="quick('Вижу ПВО')">🚀 ПВО</div>
      <div class="quick-btn" onclick="quick('Вижу человека')">👤 Человек</div>
    </div>

    <input id="situation" placeholder="Опиши что видишь... (например: танк на холме справа, 300м)">
    <input id="distance" placeholder="Дистанция (м)" type="number" value="400">
    <div class="row">
      <input id="battery" placeholder="Батарея %" type="number" value="80" min="0" max="100">
      <select id="enemy-type">
        <option value="">Тип врага</option>
        <option>танк</option><option>БМП</option><option>опорник</option>
        <option>РЭБ</option><option>ПВО</option><option>дрон</option>
        <option>человек</option><option>техника</option><option>блиндаж</option>
      </select>
    </div>

    <div id="presets">
      <span style="color:#888;font-size:10px;padding:6px">Быстрые:</span>
      <div class="preset-btn" onclick="preset('patrol')">Патруль</div>
      <div class="preset-btn" onclick="preset('attack_tank')">Танк 400м</div>
      <div class="preset-btn" onclick="preset('attack_ew')">РЭБ 800м</div>
      <div class="preset-btn" onclick="preset('low_battery')">Батарея 8%</div>
      <div class="preset-btn" onclick="preset('civilian')">Гражданский</div>
      <div class="preset-btn" onclick="preset('multiple')">Много целей</div>
    </div>

    <button class="btn btn-ask" onclick="askSerafim()">🔮 Спросить Serafim</button>
  </div>

  <div id="advice" style="display:none">
    <div class="waiting">Serafim думает...</div>
  </div>

  <div class="panel">
    <h2>📝 История</h2>
    <div id="history"></div>
  </div>

  <div style="text-align:center;padding:10px">
    <button class="btn btn-accept" onclick="exportData()" style="font-size:12px">📥 Скачать обучающие данные</button>
  </div>
</div>

<script>
var adviceCount=0,acceptedCount=0,rejectedCount=0,history=[];
var currentAdvice=null;

function preset(type){{
  var sit=document.getElementById('situation');
  var dist=document.getElementById('distance');
  var bat=document.getElementById('battery');
  var enemy=document.getElementById('enemy-type');
  if(type==='patrol'){{sit.value='Патрулирую, врагов не видно';dist.value='';bat.value=80;enemy.value='';}}
  else if(type==='attack_tank'){{sit.value='Вижу танк на дороге';dist.value='400';bat.value=80;enemy.value='танк';}}
  else if(type==='attack_ew'){{sit.value='Станция РЭБ на возвышенности';dist.value='800';bat.value=60;enemy.value='РЭБ';}}
  else if(type==='low_battery'){{sit.value='Батарея почти ноль, надо возвращаться';dist.value='';bat.value=8;enemy.value='';}}
  else if(type==='civilian'){{sit.value='Вижу человека, не похож на военного';dist.value='300';bat.value=55;enemy.value='человек';}}
  else if(type==='multiple'){{sit.value='3 цели: опорник 400м, РЭБ 800м, ПВО 2км';dist.value='400';bat.value=70;enemy.value='опорник+РЭБ+ПВО';}}
}}

function quick(text){{document.getElementById('situation').value=text;askSerafim();}}

function askSerafim(){{
  var sit=document.getElementById('situation').value||'Патрулирую';
  var dist=document.getElementById('distance').value||'';
  var bat=parseInt(document.getElementById('battery').value)||80;
  var enemy=document.getElementById('enemy-type').value||'';
  if(!enemy && sit.includes('танк')) enemy='танк';
  if(!enemy && sit.includes('РЭБ')) enemy='РЭБ';
  if(!enemy && sit.includes('ПВО')) enemy='ПВО';

  var adv=document.getElementById('advice');
  adv.style.display='block';
  adv.innerHTML='<div class="waiting">⏳ Serafim думает...</div>';

  fetch('/api/ask',{{
    method:'POST',
    headers:{{'Content-Type':'application/json'}},
    body:JSON.stringify({{situation:sit,distance:dist,battery:bat,enemies:enemy}})
  }}).then(r=>r.json()).then(data=>{{
    adviceCount++;
    currentAdvice=adviceCount-1;
    document.getElementById('st-advice').textContent=adviceCount;
    document.getElementById('st-latency').textContent=Math.round(data.latency_ms);

    adv.innerHTML=''+
      '<div class="action">'+data.advice.toUpperCase()+'</div>'+
      '<div class="reason">'+data.reason.substring(0,200)+'</div>'+
      '<div class="meta">Задержка: '+Math.round(data.latency_ms)+'ms</div>'+
      '<div style="margin-top:10px">'+
        '<button class="btn btn-accept" onclick="feedback(true)">✅ ПРИНЯТЬ</button>'+
        '<button class="btn btn-reject" onclick="feedback(false)">❌ ОТКЛОНИТЬ</button>'+
      '</div>';

    history.unshift(data);
    renderHistory();
    document.getElementById('history').scrollTop=0;
  }});
}}

function feedback(accepted){{
  if(accepted) acceptedCount++; else rejectedCount++;
  document.getElementById('st-accepted').textContent=acceptedCount;
  document.getElementById('st-rejected').textContent=rejectedCount;

  fetch('/api/feedback',{{
    method:'POST',
    headers:{{'Content-Type':'application/json'}},
    body:JSON.stringify({{index:currentAdvice,accepted:accepted,outcome:accepted?'kill':'rejected',lesson:accepted?'':'Отклонено пилотом'}})
  }});
}}

function renderHistory(){{
  var h=document.getElementById('history');
  var html='';
  history.forEach(function(e,i){{
    var cls=e.accepted===true?'acc':(e.accepted===false?'rej':'');
    html+='<div class="h-entry">'+
      '<div><span class="adv">'+e.advice.toUpperCase()+'</span> '+
      '<span class="sit">'+e.situation.substring(0,60)+'</span></div>'+
      '<div class="'+cls+'">'+Math.round(e.latency_ms)+'ms</div>'+
    '</div>';
  }});
  h.innerHTML=html;
}}

function exportData(){{
  fetch('/api/export').then(r=>r.json()).then(d=>{{
    var blob=new Blob([JSON.stringify(d,null,2)],{{type:'application/json'}});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download='serafim-training-'+Date.now()+'.json';
    a.click();
  }});
}}

document.getElementById('situation').addEventListener('keydown',function(e){{
  if(e.key==='Enter') askSerafim();
}});
document.getElementById('situation').focus();
</script>
</body></html>"""


# ═══════════════════════════════════════════════════════════════
# HTTP СЕРВЕР
# ═══════════════════════════════════════════════════════════════

class CopilotServer:
    def __init__(self, pilot_name="Сын", port=8600):
        self.session = CopilotSession(pilot_name)
        self.port = port

    def start(self):
        session = self.session

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/" or self.path == "/index.html":
                    html = COPILOT_HTML.format(pilot_name=session.pilot_name)
                    self.send_response(200)
                    self.send_header("Content-type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(html.encode())

                elif self.path == "/api/export":
                    data = session.training_data
                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

                else:
                    self.send_response(404); self.end_headers()

            def do_POST(self):
                content_length = int(self.headers.get('Content-Length', 0))
                body = json.loads(self.rfile.read(content_length)) if content_length else {}

                if self.path == "/api/ask":
                    result = session.get_advice(
                        situation_text=body.get("situation", ""),
                        battery=body.get("battery", 80),
                        enemies=body.get("enemies", ""),
                        distance=body.get("distance", ""),
                    )
                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(result, ensure_ascii=False).encode())

                elif self.path == "/api/feedback":
                    session.record_feedback(
                        entry_idx=body.get("index", 0),
                        accepted=body.get("accepted", True),
                        outcome=body.get("outcome", ""),
                        lesson=body.get("lesson", ""),
                    )
                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"ok":true}')

        server = HTTPServer(("0.0.0.0", self.port), Handler)
        print(f"\n{'='*60}")
        print(f"  Serafim Copilot — http://localhost:{self.port}")
        print(f"  Пилот: {session.pilot_name}")
        print(f"  {'='*60}")
        print(f"  Сын летит в Uncrashed → видит врага → вводит в панель")
        print(f"  Serafim отвечает → Сын принимает/отклоняет")
        print(f"  Всё → обучающие данные")
        print(f"  {'='*60}\n")
        server.serve_forever()


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8600)
    p.add_argument("--pilot", default="Сын")
    args = p.parse_args()

    CopilotServer(pilot_name=args.pilot, port=args.port).start()
