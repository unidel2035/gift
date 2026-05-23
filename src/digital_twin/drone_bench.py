#!/usr/bin/env python3
"""
drone_bench.py — Стенд цифрового двойника дрона

Показывает ВСЁ что происходит внутри одного дрона:
  - Позиция, скорость, батарея, фаза
  - Сенсоры: что видит (цели, враги, ПВО)
  - LLM-мозг: промпт → ответ → решение
  - Три платы: Cube Orange / Tang Nano / Orange Pi 5
  - Действия: куда летит, кого атакует
  - Лог последних 20 событий

Веб: http://localhost:8090
"""

import math, random, time, json, threading, os, sys, urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from collections import deque

sys.path.insert(0, '/home/unidel/gift/src/digital_twin')

OLLAMA_URL = "http://localhost:11434/api/generate"
SERAFIM_MODEL = "serafim-1.5b"

# ═══════════════════════════════════════════════════════════════
# ДРОН-СТЕНД
# ═══════════════════════════════════════════════════════════════

class DroneBench:
    """Один дрон с полной прозрачностью внутреннего состояния"""

    def __init__(self, drone_id="Scout-1", drone_name="Ворон"):
        self.id = drone_id
        self.name = drone_name
        self.role = "РАЗВ"
        self.team = "blue"

        # Позиция
        self.x = 0.0; self.z = 0.0; self.y = 120.0
        self.vx = 20.0; self.vz = 15.0
        self.heading = 45.0; self.battery = 92.0
        self.phase = "patrol"

        # Сенсоры
        self.sensors = {"camera": 0.85, "thermal": 0.72, "radio": 0.15, "motion": 0.60}
        self.targets_visible = []
        self.enemies_visible = []
        self.threats_nearby = []

        # LLM-мозг (прозрачный)
        self.llm_prompt = ""
        self.llm_response = ""
        self.llm_action = "patrol"
        self.llm_inference_ms = 0
        self.llm_queries = 0
        self.llm_pending = False

        # Платы
        self.boards = {
            "cube_orange": {"imu": "OK", "gps_fix": 8, "baro_pa": 101325, "armed": True, "mode": "GUIDED"},
            "tang_nano": {"l1_target": "—", "luts_used": 4500, "fmax_mhz": 180, "response_us": 0.8},
            "orange_pi5": {"l2_classifier": "—", "l2_confidence": 0.0, "cpu_load": 0.15, "memory_mb": 320},
        }

        # Лог событий
        self.event_log = deque(maxlen=30)
        self._log("Стенд запущен", "system")

        # Враги и цели (эмулируем)
        self._generate_scenario()

    def _log(self, message, category="info"):
        self.event_log.append({
            "time": time.strftime("%H:%M:%S"),
            "message": message,
            "category": category,
        })

    def _generate_scenario(self):
        self.targets_visible = [
            {"name": "ОПОРНИК", "type": "strongpoint", "distance": 450, "bearing": 30, "priority": "high"},
            {"name": "БЛИНДАЖ", "type": "bunker", "distance": 820, "bearing": -15, "priority": "medium"},
        ]
        self.enemies_visible = [
            {"name": "Шахид-1", "type": "КАМИКАДЗЕ", "distance": 1200, "bearing": 90, "threat": "critical"},
            {"name": "Глаз-1", "type": "РАЗВ", "distance": 1500, "bearing": -60, "threat": "low"},
        ]
        self.threats_nearby = [
            {"name": "ПВО-1", "type": "ЗРК", "distance": 1800, "range": 2000, "jammed": False},
        ]

    # ═══ LLM-ЗАПРОС ═══════════════════════════════════════

    def query_llm(self):
        """Отправить запрос к Serafim и записать ВСЁ"""
        self.llm_pending = True
        self._log("Запрос к Serafim...", "llm")

        # Строим промпт
        enemies_str = "\n".join(f"  {e['name']} ({e['type']}): дист={e['distance']}м, угроза={e['threat']}"
                               for e in self.enemies_visible)
        targets_str = "\n".join(f"  {t['name']}: дист={t['distance']}м, приоритет={t['priority']}"
                               for t in self.targets_visible)

        self.llm_prompt = f"""Ты {self.name} ({self.role}), разведчик БПЛА.
Позиция: ({self.x:.0f}, {self.z:.0f}), высота {self.y:.0f}м, курс {self.heading:.0f}°.
Батарея: {self.battery:.0f}%. Фаза: {self.phase}.

Цели:
{targets_str}

Враги:
{enemies_str}

Твоё решение (атаковать/наблюдать/возврат) и краткое обоснование:"""

        self.llm_queries += 1

        try:
            body = json.dumps({
                "model": SERAFIM_MODEL,
                "prompt": self.llm_prompt,
                "stream": False,
                "keep_alive": 300,
                "options": {"temperature": 0.2, "num_predict": 30, "stop": ["\n\n"]}
            }).encode()
            t0 = time.time()
            req = urllib.request.Request(OLLAMA_URL, body, {"Content-Type": "application/json"})
            resp = urllib.request.urlopen(req, timeout=25)
            data = json.loads(resp.read())
            self.llm_response = data.get("response", "").strip()
            self.llm_inference_ms = data.get("eval_duration", 0) // 1_000_000

            # Разбор решения
            resp_upper = self.llm_response.upper()
            if any(w in resp_upper for w in ["АТАК", "ATTACK", "УДАР"]):
                self.llm_action = "attack"
            elif any(w in resp_upper for w in ["ДОМОЙ", "RTB", "ВОЗВРАТ"]):
                self.llm_action = "rtb"
            elif any(w in resp_upper for w in ["НАБЛЮД", "OBSERVE", "ЖД"]):
                self.llm_action = "observe"
            else:
                self.llm_action = "patrol"

            self._log(f"LLM ответ: {self.llm_action} ({self.llm_inference_ms}ms)", "llm")

        except Exception as e:
            self.llm_response = f"ERROR: {str(e)[:100]}"
            self.llm_action = "patrol"
            self.llm_inference_ms = 0
            self._log(f"LLM ошибка: {str(e)[:60]}", "error")

        self.llm_pending = False

    # ═══ ТИК СИМУЛЯЦИИ ═══════════════════════════════════

    def tick(self):
        """Один тик работы дрона"""
        # Движение
        self.x += self.vx * 0.1
        self.z += self.vz * 0.1
        self.battery -= 0.005
        self.heading = (self.heading + random.uniform(-2, 2)) % 360

        # Обновление сенсоров
        self.sensors["camera"] = min(1.0, max(0.0, self.sensors["camera"] + random.uniform(-0.05, 0.05)))
        self.sensors["thermal"] = min(1.0, max(0.0, self.sensors["thermal"] + random.uniform(-0.03, 0.03)))
        self.sensors["radio"] = min(1.0, max(0.0, self.sensors["radio"] + random.uniform(-0.02, 0.05)))

        # Обновление плат
        self.boards["cube_orange"]["baro_pa"] = 101325 * math.exp(-self.y / 8400.0) + random.gauss(0, 1)
        self.boards["tang_nano"]["response_us"] = 0.5 + random.uniform(0, 1.0)
        self.boards["orange_pi5"]["cpu_load"] = 0.1 + random.uniform(0, 0.3)

        # Обновление сценария
        for t in self.targets_visible:
            t["distance"] += random.uniform(-30, 30)
        for e in self.enemies_visible:
            e["distance"] += random.uniform(-50, 50)

        # Периодический LLM-запрос
        if random.random() < 0.05 and not self.llm_pending:
            self.query_llm()

    def get_state(self):
        return {
            "drone": {
                "id": self.id, "name": self.name, "role": self.role, "team": self.team,
                "x": round(self.x, 1), "z": round(self.z, 1), "y": round(self.y, 1),
                "vx": round(self.vx, 1), "vz": round(self.vz, 1),
                "heading": round(self.heading, 1), "battery": round(self.battery, 1),
                "phase": self.phase,
            },
            "sensors": self.sensors,
            "targets": self.targets_visible,
            "enemies": self.enemies_visible,
            "threats": self.threats_nearby,
            "llm": {
                "prompt": self.llm_prompt,
                "response": self.llm_response,
                "action": self.llm_action,
                "inference_ms": self.llm_inference_ms,
                "queries": self.llm_queries,
                "pending": self.llm_pending,
            },
            "boards": self.boards,
            "event_log": list(self.event_log),
        }


# ═══════════════════════════════════════════════════════════════
# СЕРВЕР СТЕНДА
# ═══════════════════════════════════════════════════════════════

bench = DroneBench()

class BenchHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/state":
            self.send_json(bench.get_state())
        elif self.path == "/api/llm/query":
            bench.query_llm()
            self.send_json({"status": "queried", "response": bench.llm_response})
        elif self.path == "/":
            self.send_html()
        else:
            self.send_error(404)

    def send_json(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, default=str).encode())

    def send_html(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(HTML_TEMPLATE.encode())

    def log_message(self, *args): pass

HTML_TEMPLATE = """<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
<title>Drone Bench — Стенд цифрового двойника</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0f1e;color:#aaa;font:11px/1.4 monospace;padding:15px}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.panel{background:#111;border:1px solid #333;padding:12px;border-radius:4px}
.panel2{grid-column:span 2}
.panel3{grid-column:span 3}
h2{color:#0ff;font-size:13px;margin-bottom:8px;border-bottom:1px solid #333;padding-bottom:4px}
h3{color:#0f0;font-size:11px;margin:4px 0}
.val{color:#ff0} .err{color:#f44} .info{color:#aaa} .llm{color:#0ff} .act{color:#f80}
.stat{display:inline-block;width:120px;margin:2px 0}
.bar{background:#222;height:10px;border-radius:2px;margin:2px 0;overflow:hidden}
.bar-fill{height:100%;border-radius:2px;transition:width 0.3s}
.bar-green{background:#0f0} .bar-yellow{background:#ff0} .bar-red{background:#f44}
.log-entry{padding:2px 0;border-bottom:1px solid #1a1a1a;font-size:10px}
.prompt-box{background:#000;color:#0f0;padding:8px;font-size:10px;max-height:120px;overflow-y:auto;white-space:pre-wrap;border:1px solid #333;margin:4px 0}
.response-box{background:#000;color:#0ff;padding:8px;font-size:10px;max-height:80px;overflow-y:auto;white-space:pre-wrap;border:1px solid #333;margin:4px 0}
.btn{background:#222;color:#0f0;border:1px solid #0f0;padding:4px 12px;cursor:pointer;font:11px monospace;margin:2px}
.btn:hover{background:#333}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
.pending{animation:pulse 1s infinite;color:#ff0}
</style></head><body>
<h1>Стенд цифрового двойника — <span style="color:#48f">Ворон (Scout-1)</span></h1>
<div style="margin:4px 0;font-size:10px">
  <button class="btn" onclick="fetch('/api/llm/query')">🧠 Запросить Serafim</button>
  <span id="auto-refresh">Авто-обновление: 1s</span>
</div>

<div class="grid">
  <!-- ПОЗИЦИЯ И СОСТОЯНИЕ -->
  <div class="panel">
    <h2>📍 Позиция и состояние</h2>
    <div id="position"></div>
  </div>

  <!-- СЕНСОРЫ -->
  <div class="panel">
    <h2>📡 Сенсоры</h2>
    <div id="sensors"></div>
  </div>

  <!-- ПЛАТЫ -->
  <div class="panel">
    <h2>🔧 Бортовые платы</h2>
    <div id="boards"></div>
  </div>

  <!-- LLM-МОЗГ -->
  <div class="panel panel2">
    <h2>🧠 LLM-мозг (Serafim 1.5B)</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div>
        <h3>📤 Промпт (что дрон отправил)</h3>
        <div class="prompt-box" id="llm-prompt">—</div>
      </div>
      <div>
        <h3>📥 Ответ (что Serafim ответил)</h3>
        <div class="response-box" id="llm-response">—</div>
        <div style="margin-top:4px">
          <span class="stat">Решение: <span class="llm" id="llm-action">—</span></span>
          <span class="stat">Инференс: <span class="val" id="llm-ms">—</span></span>
          <span class="stat">Запросов: <span class="val" id="llm-queries">0</span></span>
          <span id="llm-status"></span>
        </div>
      </div>
    </div>
  </div>

  <!-- ЦЕЛИ И ВРАГИ -->
  <div class="panel">
    <h2>🎯 Видимые цели</h2>
    <div id="targets"></div>
  </div>
  <div class="panel">
    <h2>⚠️ Враги и угрозы</h2>
    <div id="enemies"></div>
  </div>

  <!-- ЛОГ -->
  <div class="panel panel3">
    <h2>📋 Лог событий</h2>
    <div id="log" style="max-height:200px;overflow-y:auto"></div>
  </div>
</div>

<script>
async function update() {
  try {
    const r = await fetch('/api/state');
    const d = await r.json();
    const dr = d.drone;

    // Позиция
    document.getElementById('position').innerHTML = `
      <span class="stat">X: <span class="val">${dr.x}</span></span>
      <span class="stat">Z: <span class="val">${dr.z}</span></span>
      <span class="stat">Y: <span class="val">${dr.y}</span>м</span><br>
      <span class="stat">Vx: <span class="val">${dr.vx}</span></span>
      <span class="stat">Vz: <span class="val">${dr.vz}</span></span>
      <span class="stat">Курс: <span class="val">${dr.heading}°</span></span><br>
      <span class="stat">Батарея: <span class="val">${dr.battery}%</span></span>
      <div class="bar"><div class="bar-fill ${dr.battery>60?'bar-green':dr.battery>20?'bar-yellow':'bar-red'}" style="width:${dr.battery}%"></div></div>
      <span class="stat">Фаза: <span class="act">${dr.phase}</span></span>
      <span class="stat">Роль: <span class="val">${dr.role}</span></span>
    `;

    // Сенсоры
    let shtml = '';
    for (const [k,v] of Object.entries(d.sensors)) {
      const pct = Math.round(v*100);
      shtml += `<span class="stat">${k}: <span class="val">${pct}%</span></span>
        <div class="bar"><div class="bar-fill ${pct>70?'bar-green':pct>30?'bar-yellow':'bar-red'}" style="width:${pct}%"></div></div>`;
    }
    document.getElementById('sensors').innerHTML = shtml;

    // Платы
    document.getElementById('boards').innerHTML = `
      <h3>Cube Orange+</h3>
      IMU: ${d.boards.cube_orange.imu} | GPS: ${d.boards.cube_orange.gps_fix} спутников | Baro: ${Math.round(d.boards.cube_orange.baro_pa/100)}hPa | Armed: ${d.boards.cube_orange.armed}<br>
      <h3>Tang Nano 9K</h3>
      L1: ${d.boards.tang_nano.l1_target} | LUTs: ${d.boards.tang_nano.luts_used}/138K | Fmax: ${d.boards.tang_nano.fmax_mhz}MHz | Отклик: ${d.boards.tang_nano.response_us}μs<br>
      <h3>Orange Pi 5</h3>
      L2: ${d.boards.orange_pi5.l2_classifier} | Conf: ${d.boards.orange_pi5.l2_confidence} | CPU: ${Math.round(d.boards.orange_pi5.cpu_load*100)}% | RAM: ${d.boards.orange_pi5.memory_mb}MB
    `;

    // LLM
    const prompt = d.llm.prompt || 'Ожидание первого запроса...';
    const response = d.llm.response || 'Ожидание ответа...';
    document.getElementById('llm-prompt').textContent = prompt;
    document.getElementById('llm-response').textContent = response;
    document.getElementById('llm-action').textContent = d.llm.action;
    document.getElementById('llm-ms').textContent = d.llm.inference_ms + 'ms';
    document.getElementById('llm-queries').textContent = d.llm.queries;
    document.getElementById('llm-status').innerHTML = d.llm.pending ? '<span class="pending">⏳ Думает...</span>' : '<span style="color:#0f0">✅ Готов</span>';

    // Цели
    let thtml = '';
    for (const t of d.targets) {
      thtml += `<div>🎯 <b>${t.name}</b> (${t.type}) — ${Math.round(t.distance)}м, ${t.bearing}° <span style="color:${t.priority=='high'?'#f44':'#ff0'}">${t.priority}</span></div>`;
    }
    document.getElementById('targets').innerHTML = thtml || '<span class="info">Нет видимых целей</span>';

    // Враги
    let ehtml = '';
    for (const e of d.enemies) {
      ehtml += `<div>⚠️ <b>${e.name}</b> (${e.type}) — ${Math.round(e.distance)}м, ${e.bearing}° <span style="color:${e.threat=='critical'?'#f44':'#ff0'}">${e.threat}</span></div>`;
    }
    for (const t of d.threats) {
      ehtml += `<div>🛡 <b>${t.name}</b> (${t.type}) — ${Math.round(t.distance)}м, радиус ${t.range}м ${t.jammed?'<span style=\\"color:#0f0\\">[ПОДАВЛЕНО]</span>':''}</div>`;
    }
    document.getElementById('enemies').innerHTML = ehtml || '<span class="info">Нет угроз</span>';

    // Лог
    let lhtml = '';
    for (const e of d.event_log.slice().reverse()) {
      const color = e.category=='llm'?'#0ff':e.category=='error'?'#f44':'#aaa';
      lhtml += `<div class="log-entry"><span style="color:#666">${e.time}</span> <span style="color:${color}">${e.message}</span></div>`;
    }
    document.getElementById('log').innerHTML = lhtml;

  } catch(e) { console.error(e); }
}

update();
setInterval(update, 1000);
</script></body></html>"""

def sim_thread():
    while True:
        bench.tick()
        time.sleep(0.2)

def main():
    print("╔══════════════════════════════════════════════╗")
    print("║  СТЕНД ЦИФРОВОГО ДВОЙНИКА ДРОНА             ║")
    print("║  Ворон (Scout-1) — полная прозрачность       ║")
    print("╚══════════════════════════════════════════════╝")
    print(f"  🌐 http://localhost:8090")
    print(f"  🧠 Serafim: {SERAFIM_MODEL}")
    print()

    threading.Thread(target=sim_thread, daemon=True).start()
    HTTPServer(("0.0.0.0", 8090), BenchHandler).serve_forever()

if __name__ == "__main__":
    main()
