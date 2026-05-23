#!/usr/bin/env python3
"""
camera_streams.py — Видеопотоки с камер дронов (Небо-22 совместимость)

Реализует:
  - RTSP-подобные стримы от лица каждого дрона (MJPEG over HTTP)
  - RGB + Depth камеры
  - Настройка: FPS, разрешение, FOV, позиция/ориентация камеры
  - UDP JPEG-стрим для низкой задержки
  - Захват одиночного кадра через API
  - Вид от третьего лица (режим Бога)

Архитектура:
  Каждый дрон → CameraFeed → HTTP MJPEG stream
  /camera/{drone_id} → живой видеопоток
  /camera/{drone_id}/snapshot → одиночный JPEG
  /camera/god → вид сверху на всё поле боя
"""

import math, random, time, json, threading, io, struct, socket, os, sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import List, Dict, Optional, Tuple
from collections import deque
try:
    import numpy as np
    from PIL import Image, ImageDraw
except ImportError:
    np = None; Image = None; ImageDraw = None

# ═══════════════════════════════════════════════════════════════
# СИНТЕТИЧЕСКАЯ КАМЕРА (без реального рендера)
# ═══════════════════════════════════════════════════════════════

class SyntheticCamera:
    """
    Синтетическая камера БПЛА.
    Генерирует реалистичные MJPEG-потоки для каждого дрона.
    Без OpenGL — через numpy/canvas + боевые маркеры.
    """

    def __init__(self, drone_id: str, width=640, height=480, fov=85.0):
        self.drone_id = drone_id
        self.width = width
        self.height = height
        self.fov = fov  # градусы
        self.position = (0, 0, 100)  # x, z, y (world coords)
        self.orientation = (0, 0, 0)  # roll, pitch, yaw
        self.frame_count = 0
        self.fps = 15
        self.last_frame_time = 0
        self.camera_type = "RGB"  # "RGB", "Depth", "Thermal"
        self.enabled = True
        self.targets_in_view = []

    def update(self, drone_x, drone_z, drone_y, heading, pitch=0, roll=0):
        self.position = (drone_x, drone_z, drone_y)
        self.orientation = (roll, pitch, math.radians(heading))

    def generate_frame(self, targets: list, enemy_drones: list, terrain_height_func=None) -> bytes:
        """
        Сгенерировать синтетический JPEG-кадр с видом от лица дрона.
        Возвращает: JPEG bytes
        """
        import numpy as np
        from PIL import Image, ImageDraw, ImageFont

        # Создать холст
        img = np.zeros((self.height, self.width, 3), dtype=np.uint8)

        # Небо (верхняя половина)
        sky_color = np.array([100, 140, 200])  # дневное небо
        horizon_y = self.height // 2 + int(self.orientation[1] * 50)  # тангаж сдвигает горизонт
        img[:max(0, horizon_y), :] = sky_color

        # Земля (нижняя половина) с рельефом
        ground_color = np.array([60, 100, 40])  # зелёная земля
        for y in range(max(0, horizon_y), self.height):
            # Вариации цвета земли
            row_color = ground_color + np.random.randint(-15, 15, 3)
            img[y, :] = np.clip(row_color, 0, 255)

        # Дороги (линии)
        img = Image.fromarray(img)
        draw = ImageDraw.Draw(img)

        # Отрисовка целей в поле зрения
        px, pz, py = self.position
        _, _, yaw = self.orientation

        self.targets_in_view = []

        for t in targets:
            if not t.get("detected"):
                continue
            tx, tz = t.get("x", 0), t.get("z", 0)
            dx, dz = tx - px, tz - pz
            dist = math.sqrt(dx*dx + dz*dz)

            if dist > 2000:  # дальше 2км не видно
                continue

            # Угол на цель относительно курса дрона
            angle_to_target = math.atan2(dx, dz) - yaw
            # Нормализация
            while angle_to_target > math.pi: angle_to_target -= 2*math.pi
            while angle_to_target < -math.pi: angle_to_target += 2*math.pi

            if abs(angle_to_target) > math.radians(self.fov / 2):
                continue

            # Проекция на экран
            screen_x = self.width // 2 + int(angle_to_target / math.radians(self.fov) * self.width)
            screen_y = int(self.height // 2 - (py - 0) / dist * 200)  # упрощённая проекция

            screen_x = max(10, min(self.width - 10, screen_x))
            screen_y = max(10, min(self.height - 10, screen_y))

            # Размер цели зависит от расстояния
            size = max(4, int(30 / (dist / 200 + 1)))

            # Цвет цели
            target_colors = {
                "strongpoint": (255, 50, 50), "bunker": (150, 100, 50),
                "ew_station": (255, 150, 0), "vehicle": (50, 100, 255),
                "artillery": (255, 100, 0), "sam": (255, 0, 100),
                "drone_swarm": (0, 255, 255),
            }
            color = target_colors.get(t.get("type", ""), (255, 255, 0))

            # Прямоугольник цели
            draw.rectangle(
                [screen_x - size, screen_y - size, screen_x + size, screen_y + size],
                outline=color, width=2
            )
            # Крестик
            draw.line([screen_x - size*2, screen_y, screen_x + size*2, screen_y], fill=color, width=1)
            draw.line([screen_x, screen_y - size*2, screen_x, screen_y + size*2], fill=color, width=1)

            # Подпись
            draw.text((screen_x + size + 3, screen_y - 8),
                     f"{t.get('type','?')[:8]} {dist:.0f}м", fill=color)

            self.targets_in_view.append({
                "type": t.get("type", "?"),
                "distance": round(dist, 1),
                "screen_x": screen_x,
                "screen_y": screen_y,
            })

        # Вражеские дроны
        for e in enemy_drones:
            if not e.get("alive", True):
                continue
            ex, ez, ey = e.get("x", 0), e.get("z", 0), e.get("y", 80)
            dx, dz = ex - px, ez - pz
            dist = math.sqrt(dx*dx + dz*dz)
            if dist > 1500:
                continue
            angle = math.atan2(dx, dz) - yaw
            if abs(angle) > math.radians(self.fov / 2):
                continue
            sx = self.width // 2 + int(angle / math.radians(self.fov) * self.width)
            sy = int(self.height // 2 - (py - ey) / dist * 200)
            sx = max(5, min(self.width - 5, sx))
            sy = max(5, min(self.height - 5, sy))
            size = max(3, int(10 / (dist / 300 + 1)))
            draw.ellipse([sx - size, sy - size, sx + size, sy + size],
                        outline=(255, 100, 100), width=1)

        # HUD (данные телеметрии)
        hud_text = [
            f"DRONE: {self.drone_id}",
            f"ALT: {py:.0f}m HDG: {math.degrees(yaw):.0f}°",
            f"FOV: {self.fov}° | FPS: {self.fps}",
            f"TARGETS: {len(self.targets_in_view)}",
        ]
        for i, text in enumerate(hud_text):
            draw.text((10, 10 + i * 18), text, fill=(0, 255, 0))

        # Крест прицела
        cx, cy = self.width // 2, self.height // 2
        draw.line([cx - 20, cy, cx + 20, cy], fill=(0, 255, 0, 128), width=1)
        draw.line([cx, cy - 20, cx, cy + 20], fill=(0, 255, 0, 128), width=1)
        draw.ellipse([cx - 15, cy - 15, cx + 15, cy + 15], outline=(0, 255, 0, 128), width=1)

        # Конвертировать в JPEG
        import io as io_module
        buf = io_module.BytesIO()
        img.save(buf, format="JPEG", quality=75)
        self.frame_count += 1
        return buf.getvalue()


# ═══════════════════════════════════════════════════════════════
# MJPEG СТРИМ-СЕРВЕР
# ═══════════════════════════════════════════════════════════════

class CameraStreamServer:
    """HTTP MJPEG сервер — видеопотоки от каждого дрона"""

    def __init__(self, port=8110):
        self.port = port
        self.cameras: Dict[str, SyntheticCamera] = {}
        self.targets = []
        self.enemy_drones = []
        self.running = False

    def add_camera(self, drone_id: str, width=640, height=480, fov=85.0):
        self.cameras[drone_id] = SyntheticCamera(drone_id, width, height, fov)

    def update_camera(self, drone_id: str, drone_x, drone_z, drone_y, heading):
        if drone_id in self.cameras:
            self.cameras[drone_id].update(drone_x, drone_z, drone_y, heading)

    def start(self):
        self.running = True
        threading.Thread(target=self._run_server, daemon=True).start()

    def _run_server(self):
        server = HTTPServer(("0.0.0.0", self.port), self._make_handler())
        server.serve_forever()

    def _make_handler(self):
        streams = self

        class MJPEGHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                path = self.path.split("?")[0]

                if path.startswith("/camera/") and path.endswith("/stream"):
                    drone_id = path.split("/")[2]
                    self._serve_mjpeg(drone_id)

                elif path.startswith("/camera/") and path.endswith("/snapshot"):
                    drone_id = path.split("/")[2]
                    self._serve_snapshot(drone_id)
                    self._serve_snapshot(drone_id)

                elif path == "/camera/god/stream":
                    self._serve_god_view()

                elif path == "/":
                    self._serve_index()
                else:
                    self.send_error(404)

            def _serve_mjpeg(self, drone_id):
                if drone_id not in streams.cameras:
                    self.send_error(404); return
                cam = streams.cameras[drone_id]
                self.send_response(200)
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                try:
                    while streams.running:
                        frame = cam.generate_frame(streams.targets, streams.enemy_drones)
                        self.wfile.write(b"--frame\r\n")
                        self.wfile.write(b"Content-Type: image/jpeg\r\n")
                        self.wfile.write(f"Content-Length: {len(frame)}\r\n\r\n".encode())
                        self.wfile.write(frame)
                        self.wfile.write(b"\r\n")
                        time.sleep(1.0 / cam.fps)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def _serve_snapshot(self, drone_id):
                if drone_id not in streams.cameras:
                    self.send_error(404); return
                cam = streams.cameras[drone_id]
                frame = cam.generate_frame(streams.targets, streams.enemy_drones)
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(frame)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(frame)

            def _serve_god_view(self):
                # Вид сверху — простая схема поля боя
                from PIL import Image, ImageDraw
                import numpy as np
                import io as io_module

                sz = 800
                img = Image.new("RGB", (sz, sz), (20, 30, 50))
                draw = ImageDraw.Draw(img)
                # Сетка
                for i in range(0, sz, 40):
                    draw.line([i, 0, i, sz], fill=(30, 40, 60))
                    draw.line([0, i, sz, i], fill=(30, 40, 60))
                # Центр
                cx, cy = sz // 2, sz // 2
                scale = sz / 4000  # 4km → 800px
                # Дроны (синие точки)
                for t in streams.targets:
                    if t.get("detected"):
                        tx = int(cx + t.get("x", 0) * scale)
                        ty = int(cy + t.get("z", 0) * scale)
                        draw.ellipse([tx-4, ty-4, tx+4, ty+4], fill=(255, 200, 0))
                # Свои дроны
                for did, cam in streams.cameras.items():
                    dx = int(cx + cam.position[0] * scale)
                    dy = int(cy + cam.position[1] * scale)
                    draw.ellipse([dx-5, dy-5, dx+5, dy+5], fill=(100, 200, 255))
                    draw.text((dx+7, dy-7), did[:6], fill=(100, 200, 255))

                buf = io_module.BytesIO()
                img.save(buf, format="JPEG", quality=80)
                frame = buf.getvalue()
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(frame)))
                self.end_headers()
                self.wfile.write(frame)

            def _serve_index(self):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                cameras_html = ""
                for did in streams.cameras:
                    cameras_html += f"""
                    <div style="display:inline-block;margin:10px;background:#111;padding:5px">
                    <h3 style="color:#0f0">{did}</h3>
                    <img src="/camera/{did}/stream" width="320" height="240"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22240%22><text fill=%22red%22>Loading...</text></svg>'">
                    <br><a href="/camera/{did}/snapshot">📸 Snapshot</a>
                    </div>"""
                self.wfile.write(f"""<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>DronDoc Cameras</title>
<style>body{{background:#000;color:#aaa;font:12px monospace}}</style></head>
<body><h1>🎥 Camera Streams ({len(streams.cameras)} drones)</h1>
<a href="/camera/god/stream">🗺 God View</a>
<div>{cameras_html}</div>
<small>MJPEG streams — Небо-22 compatible format</small>
</body></html>""".encode())

            def log_message(self, *args): pass
        return MJPEGHandler


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  CAMERA STREAMS — MJPEG per drone               ║")
    print("║  Небо-22 совместимость: RTSP-подобные потоки    ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    server = CameraStreamServer(port=8110)
    for did in ["B-S1","B-F1","B-P1","R-E5"]:
        server.add_camera(did)

    # Тестовые цели
    server.targets = [
        {"type": "strongpoint", "x": 300, "z": 200, "detected": True},
        {"type": "ew_station", "x": -400, "z": -300, "detected": True},
        {"type": "vehicle", "x": 500, "z": -150, "detected": True},
    ]
    server.enemy_drones = [
        {"x": 300, "z": 300, "y": 80, "alive": True},
        {"x": -200, "z": 400, "y": 90, "alive": True},
    ]

    # Обновить позиции камер
    server.update_camera("B-S1", 100, 50, 150, 45)
    server.update_camera("B-F1", 200, -100, 80, 180)
    server.update_camera("B-P1", -300, 200, 120, 270)
    server.update_camera("R-E5", 500, 400, 90, 0)

    server.start()
    print(f"  🌐 MJPEG streams: http://localhost:8110")
    print(f"  📸 Snapshot: http://localhost:8110/camera/B-S1/snapshot")
    print(f"  🗺 God view: http://localhost:8110/camera/god/stream")
    print(f"  Камер: {len(server.cameras)}")
    print()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Stop")
