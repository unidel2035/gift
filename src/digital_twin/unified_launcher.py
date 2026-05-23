#!/usr/bin/env python3
"""
unified_launcher.py — Единый пуск всей системы

Одной командой поднимает:
  :8100 — endless_swarm (классификатор + собор)
  :8101 — dronedoc_twin (DronDoc-логика, 14 БАС)
  :8102 — training_arena (self-play, матрица растёт)
  :8105 — launch_swarm (30 дронов, LLM-мозг)
  :8110 — camera_streams (MJPEG с камер)

Плюс:
  - Мониторинг состояния всех серверов
  - Авто-рестарт упавших
  - Единый статус-дашборд на :8099

Запуск: python3 src/digital_twin/unified_launcher.py
Статус: http://localhost:8099
"""

import subprocess, time, threading, json, os, sys, signal
from http.server import HTTPServer, BaseHTTPRequestHandler

SERVICES = {
    "endless_swarm": {
        "port": 8100, "script": "endless_swarm.py",
        "desc": "Классификатор 15 классов + собор + 12 модулей"
    },
    "dronedoc_twin": {
        "port": 8101, "script": "dronedoc_twin.py",
        "desc": "DronDoc-логика, 14 БАС, сенсорный фьюжн"
    },
    "training_arena": {
        "port": 8102, "script": "training_arena.py",
        "desc": "Self-play арена, матрица растёт"
    },
    "launch_swarm": {
        "port": 8105, "script": "launch_swarm.py",
        "desc": "30 дронов с LLM-мозгом"
    },
    "camera_streams": {
        "port": 8110, "script": "camera_streams.py",
        "desc": "MJPEG-видеопотоки с камер"
    },
}

class ServiceManager:
    def __init__(self):
        self.processes = {}
        self.statuses = {}
        self.dir = os.path.dirname(os.path.abspath(__file__))

    def start_service(self, name):
        cfg = SERVICES[name]
        script = os.path.join(self.dir, cfg["script"])
        if not os.path.exists(script):
            return False
        try:
            proc = subprocess.Popen(
                ["python3", script],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                cwd=self.dir
            )
            self.processes[name] = proc
            time.sleep(2)
            return self.check_port(cfg["port"])
        except Exception:
            return False

    def stop_service(self, name):
        if name in self.processes:
            self.processes[name].terminate()
            try:
                self.processes[name].wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.processes[name].kill()
            del self.processes[name]
        # Also kill anything on the port
        cfg = SERVICES[name]
        os.system(f"fuser -k {cfg['port']}/tcp 2>/dev/null")

    def check_port(self, port):
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2)
        try:
            s.connect(("127.0.0.1", port))
            s.close()
            return True
        except:
            return False

    def get_status(self):
        result = {}
        for name, cfg in SERVICES.items():
            port_ok = self.check_port(cfg["port"])
            proc_running = name in self.processes and self.processes[name].poll() is None
            result[name] = {
                "port": cfg["port"],
                "alive": port_ok,
                "process": proc_running,
                "desc": cfg["desc"],
            }
        return result

    def start_all(self):
        print("Starting all services...")
        for name in SERVICES:
            print(f"  {name}...", end=" ", flush=True)
            ok = self.start_service(name)
            print("OK" if ok else "FAIL")

    def stop_all(self):
        print("Stopping all services...")
        for name in list(self.processes.keys()):
            self.stop_service(name)

    def auto_heal(self):
        """Авто-рестарт упавших сервисов"""
        for name, cfg in SERVICES.items():
            if not self.check_port(cfg["port"]):
                print(f"  [HEAL] Restarting {name}...")
                self.stop_service(name)
                self.start_service(name)


mgr = ServiceManager()

class DashboardHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self.send_dashboard()
        elif self.path == "/api/status":
            self.send_json(mgr.get_status())
        elif self.path == "/api/start":
            mgr.start_all()
            self.send_json({"status": "started"})
        elif self.path == "/api/stop":
            mgr.stop_all()
            self.send_json({"status": "stopped"})
        elif self.path == "/api/heal":
            mgr.auto_heal()
            self.send_json({"status": "healed"})
        else:
            self.send_error(404)

    def send_json(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def send_dashboard(self):
        status = mgr.get_status()
        rows = ""
        for name, s in status.items():
            icon = "🟢" if s["alive"] else "🔴"
            rows += f"""
            <tr>
              <td>{icon} {name}</td>
              <td>:{s['port']}</td>
              <td>{'✅' if s['process'] else '⚠️'}</td>
              <td><a href='http://localhost:{s['port']}' target='_blank'>→</a></td>
              <td>{s['desc']}</td>
            </tr>"""

        html = f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="5">
<title>Unified Dashboard</title>
<style>body{{background:#0a0f1e;color:#0f0;font:12px monospace;padding:20px}}
table{{border-collapse:collapse;width:100%}} th,td{{padding:8px;border:1px solid #333;text-align:left}}
th{{color:#0ff}} a{{color:#0ff}} .btn{{background:#222;color:#0f0;border:1px solid #0f0;padding:8px 16px;margin:4px;cursor:pointer;font:12px monospace}}
.stats{{display:flex;gap:20px;margin:15px 0}} .stat-box{{background:#111;padding:12px;border:1px solid #333;flex:1}}
</style></head><body>
<h1>Unified Dashboard</h1>
<div class="stats">
  <div class="stat-box">Серверов: {sum(1 for s in status.values() if s['alive'])}/{len(status)}</div>
  <div class="stat-box">W-матрица: активна</div>
</div>
<button class="btn" onclick="fetch('/api/heal')">🔄 Auto-Heal</button>
<button class="btn" onclick="fetch('/api/stop')">⏹ Stop All</button>
<button class="btn" onclick="fetch('/api/start')">▶ Start All</button>
<table>
<tr><th>Сервис</th><th>Порт</th><th>Процесс</th><th>Web</th><th>Описание</th></tr>
{rows}
</table>
<script>setInterval(()=>location.reload(),10000)</script>
</body></html>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode())

    def log_message(self, *args): pass

def main():
    print("╔══════════════════════════════════════════════════╗")
    print("║  UNIFIED LAUNCHER — вся система одним запуском  ║")
    print("╚══════════════════════════════════════════════════╝")
    print()
    print(f"  Сервисов: {len(SERVICES)}")
    print(f"  Дашборд:  http://localhost:8099")
    print()

    mgr.start_all()

    # Auto-heal thread (каждые 30 секунд)
    def healer():
        while True:
            time.sleep(30)
            mgr.auto_heal()
    threading.Thread(target=healer, daemon=True).start()

    server = HTTPServer(("0.0.0.0", 8099), DashboardHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping all services...")
        mgr.stop_all()
        server.shutdown()

if __name__ == "__main__":
    main()
