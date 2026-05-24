#!/usr/bin/env python3
"""
serafim_overlay.py — Serafim HUD поверх любой игры (Uncrashed, GTAV, etc.)

Прозрачное окно поверх игры. Сын летит → видит предложения Serafim как HUD.
Горячие клавиши: Ctrl+Space = спросить Serafim, Ctrl+A = принять, Ctrl+X = отклонить.

Запуск НА WINDOWS (не в WSL!):
  pip install pyqt5 requests
  python serafim_overlay.py

Соединяется с WSL-сервером (serafim_copilot_web.py на порту 8600).
"""

import sys, json, time, threading, requests
from collections import deque

# ═══════════════════════════════════════════════════════════════
# ВЕРСИЯ НА PyQt5 (Windows overlay)
# ═══════════════════════════════════════════════════════════════

def run_pyqt5_overlay(wsl_host="localhost", wsl_port=8600):
    """Прозрачный HUD поверх игры через PyQt5."""
    from PyQt5.QtWidgets import QApplication, QLabel, QVBoxLayout, QWidget, QPushButton, QHBoxLayout
    from PyQt5.QtCore import Qt, QTimer, pyqtSignal, QObject
    from PyQt5.QtGui import QFont, QPalette

    SERVER = f"http://{wsl_host}:{wsl_port}"

    class OverlayWindow(QWidget):
        def __init__(self):
            super().__init__()
            # Прозрачное окно всегда поверх
            self.setWindowFlags(
                Qt.WindowStaysOnTopHint |
                Qt.FramelessWindowHint |
                Qt.Tool |
                Qt.WindowTransparentForInput  # клики проходят сквозь!
            )
            self.setAttribute(Qt.WA_TranslucentBackground)
            self.setAttribute(Qt.WA_ShowWithoutActivating)

            # Позиция: правый верхний угол
            screen = QApplication.primaryScreen().geometry()
            self.setGeometry(screen.width() - 380, 50, 350, 300)

            # Виджеты
            layout = QVBoxLayout()
            layout.setContentsMargins(10, 10, 10, 10)

            # Заголовок
            self.title = QLabel("🤖 SERAFIM COPILOT")
            self.title.setFont(QFont("Segoe UI", 12, QFont.Bold))
            self.title.setStyleSheet("color: #ff8800; background: transparent;")
            self.title.setAlignment(Qt.AlignCenter)
            layout.addWidget(self.title)

            # Действие
            self.action_label = QLabel("—")
            self.action_label.setFont(QFont("Segoe UI", 28, QFont.Bold))
            self.action_label.setStyleSheet("color: #ff8800; background: transparent;")
            self.action_label.setAlignment(Qt.AlignCenter)
            layout.addWidget(self.action_label)

            # Причина
            self.reason_label = QLabel("Запустите serafim_copilot_web.py в WSL")
            self.reason_label.setFont(QFont("Segoe UI", 10))
            self.reason_label.setStyleSheet("color: #aaa; background: transparent;")
            self.reason_label.setWordWrap(True)
            self.reason_label.setAlignment(Qt.AlignCenter)
            layout.addWidget(self.reason_label)

            # Статус
            self.status_label = QLabel("⌨ Ctrl+Space: спросить | Ctrl+A: принять | Ctrl+X: отклонить")
            self.status_label.setFont(QFont("Segoe UI", 8))
            self.status_label.setStyleSheet("color: #666; background: transparent;")
            self.status_label.setAlignment(Qt.AlignCenter)
            layout.addWidget(self.status_label)

            self.setLayout(layout)
            self.latency_label = QLabel("")
            self.latency_label.setFont(QFont("Segoe UI", 8))
            self.latency_label.setStyleSheet("color: #444; background: transparent;")
            self.latency_label.setAlignment(Qt.AlignCenter)
            layout.addWidget(self.latency_label)

            # Авто-обновление каждые 5 секунд
            self.timer = QTimer()
            self.timer.timeout.connect(self.refresh_advice)
            self.timer.start(5000)

            # Первый запрос
            self.refresh_advice()

        def refresh_advice(self):
            try:
                r = requests.post(f"{SERVER}/api/ask", json={
                    "situation": "Обстановка",
                    "battery": 80,
                    "enemies": "",
                    "distance": "",
                }, timeout=5)
                if r.status_code == 200:
                    data = r.json()
                    self.action_label.setText(data["advice"].upper())
                    self.reason_label.setText(data["reason"][:200])
                    self.latency_label.setText(f"{data['latency_ms']:.0f}ms")
            except Exception as e:
                self.action_label.setText("НЕТ СВЯЗИ")
                self.reason_label.setText(f"Сервер {SERVER} недоступен.\nЗапустите в WSL: python3 serafim_copilot_web.py")

    app = QApplication(sys.argv)
    window = OverlayWindow()
    window.show()
    print(f"Serafim Overlay запущен. Сервер: {SERVER}")
    print("Горячие клавиши: Ctrl+Space (спросить), Ctrl+A (принять), Ctrl+X (отклонить)")
    app.exec_()


# ═══════════════════════════════════════════════════════════════
# ВЕРСИЯ НА tkinter (лёгкая, без доп. зависимостей)
# ═══════════════════════════════════════════════════════════════

def run_tkinter_overlay(wsl_host="localhost", wsl_port=8600):
    """Лёгкий оверлей на tkinter (есть в стандартной поставке Python)."""
    import tkinter as tk

    SERVER = f"http://{wsl_host}:{wsl_port}"

    root = tk.Tk()
    root.title("Serafim Copilot")
    root.attributes("-topmost", True)
    root.attributes("-alpha", 0.85)  # полупрозрачность
    root.overrideredirect(True)  # без рамки

    # Позиция: правый верхний угол
    root.geometry("350x200+{}+50".format(root.winfo_screenwidth() - 370))

    # Тёмный фон
    root.configure(bg="#0a0a12")

    # Виджеты
    title = tk.Label(root, text="🤖 SERAFIM COPILOT", font=("Segoe UI", 12, "bold"),
                     fg="#ff8800", bg="#0a0a12")
    title.pack(pady=(10, 5))

    action_var = tk.StringVar(value="—")
    action_label = tk.Label(root, textvariable=action_var,
                            font=("Segoe UI", 28, "bold"),
                            fg="#ff8800", bg="#0a0a12")
    action_label.pack()

    reason_var = tk.StringVar(value="Запустите сервер в WSL")
    reason_label = tk.Label(root, textvariable=reason_var,
                            font=("Segoe UI", 10), fg="#aaa", bg="#0a0a12",
                            wraplength=330)
    reason_label.pack(pady=(5, 10))

    latency_var = tk.StringVar(value="")
    latency_label = tk.Label(root, textvariable=latency_var,
                             font=("Segoe UI", 8), fg="#444", bg="#0a0a12")
    latency_label.pack()

    # Статус
    status_var = tk.StringVar(value="Ctrl+Space: спросить | Обновление: 5с")
    status = tk.Label(root, textvariable=status_var,
                      font=("Segoe UI", 7), fg="#555", bg="#0a0a12")
    status.pack(side="bottom", pady=5)

    def refresh():
        try:
            r = requests.post(f"{SERVER}/api/ask", json={
                "situation": "Обстановка",
                "battery": 80,
            }, timeout=5)
            if r.status_code == 200:
                d = r.json()
                action_var.set(d["advice"].upper())
                reason_var.set(d["reason"][:200])
                latency_var.set(f"{d['latency_ms']:.0f}ms | {SERVER}")
            else:
                action_var.set("ERR")
        except:
            action_var.set("НЕТ СВЯЗИ")
            reason_var.set(f"Сервер {SERVER} недоступен")
        root.after(5000, refresh)

    root.after(1000, refresh)

    # Горячие клавиши
    def ask(_):
        action_var.set("...")
        reason_var.set("Serafim думает...")
        root.update()
        refresh()

    root.bind("<Control-space>", ask)
    root.bind("<Control-a>", lambda _: action_label.configure(fg="#00ff00") or root.after(2000, lambda: action_label.configure(fg="#ff8800")))
    root.bind("<Control-x>", lambda _: action_label.configure(fg="#ff0000") or root.after(2000, lambda: action_label.configure(fg="#ff8800")))

    print(f"Serafim Overlay (tkinter) запущен. Сервер: {SERVER}")
    root.mainloop()


# ═══════════════════════════════════════════════════════════════
# ТЕКСТОВАЯ ВЕРСИЯ (терминал, WSL — для теста)
# ═══════════════════════════════════════════════════════════════

def run_terminal(wsl_port=8600):
    """Текстовая версия для теста в WSL."""
    import urllib.request

    SERVER = f"http://localhost:{wsl_port}"

    print("╔══════════════════════════════════╗")
    print("║  Serafim Copilot — ТЕРМИНАЛ     ║")
    print("╚══════════════════════════════════╝")
    print()
    print("Вводи что видишь. Serafim отвечает.")
    print("Пусто + Enter = авто-опрос.")
    print("Ctrl+C = выход.")
    print()

    while True:
        try:
            sit = input("🎯 Что видишь? > ").strip()
            if not sit:
                sit = "Патрулирую, врагов не видно"

            print("   ⏳ Serafim думает...", end="\r")

            data = json.dumps({
                "situation": sit,
                "battery": 80,
                "enemies": "",
                "distance": "",
            }).encode()

            req = urllib.request.Request(
                f"{SERVER}/api/ask",
                data=data,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                d = json.loads(resp.read())
                print(f"   🤖 Serafim: {d['advice'].upper():20s} | {d['reason'][:100]}")
                print(f"   ⏱ {d['latency_ms']:.0f}ms")
                print()
        except KeyboardInterrupt:
            print("\nЗавершено.")
            break
        except Exception as e:
            print(f"   ❌ Ошибка: {e}")


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description="Serafim Overlay")
    p.add_argument("--mode", choices=["pyqt5", "tkinter", "terminal"], default="terminal",
                   help="Режим: pyqt5/tkinter (Windows overlay), terminal (WSL тест)")
    p.add_argument("--host", default="localhost", help="WSL хост (для Windows overlay)")
    p.add_argument("--port", type=int, default=8600)
    args = p.parse_args()

    if args.mode == "pyqt5":
        run_pyqt5_overlay(args.host, args.port)
    elif args.mode == "tkinter":
        run_tkinter_overlay(args.host, args.port)
    else:
        run_terminal(args.port)
