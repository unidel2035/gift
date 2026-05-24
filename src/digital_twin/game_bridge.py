#!/usr/bin/env python3
"""
game_bridge.py — Мост между Serafim и готовыми игровыми движками

Поддерживает:
  Uncrashed (FPV Drone Simulator, Steam) — через keyboard/mouse эмуляцию
  GTA V (Rockstar) — через ScriptHookV + keyboard эмуляцию
  AirSim (Microsoft) — через airsim Python API (airsim_bridge.py)

Не строим свой 3D-движок. Используем готовые игровые миры.

Архитектура:
  Serafim (LLM) → game_bridge → keyboard/mouse → Игра
  Игра → screen capture / memory read → game_bridge → Serafim

Принцип: игра НЕ знает о нас. Мы притворяемся игроком.

Использование:
  bridge = GameBridge("uncrashed")  # или "gta5" или "airsim"
  bridge.connect()
  state = bridge.get_state()        # позиция дрона, враги, цели
  bridge.execute("attack", target=(x,y,z))
"""

import time, math, json, os, sys, subprocess, ctypes
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from enum import Enum


class GameType(Enum):
    UNCRASHED = "uncrashed"   # Steam FPV симулятор
    GTA5 = "gta5"             # Grand Theft Auto V
    AIRSIM = "airsim"         # Microsoft AirSim


@dataclass
class DroneState:
    """Состояние дрона в игре."""
    x: float = 0; y: float = 0; z: float = 0
    vx: float = 0; vy: float = 0; vz: float = 0
    pitch: float = 0; roll: float = 0; yaw: float = 0
    battery: float = 100
    armed: bool = True


class GameBridge:
    """
    Универсальный мост к игровым движкам.

    Эмулирует клавиатуру/мышь для управления.
    Читает экран для получения обстановки.
    """

    def __init__(self, game_type: str = "uncrashed"):
        self.game_type = GameType(game_type)
        self.connected = False
        self._drone_state = DroneState()

        # Клавиши по умолчанию (Uncrashed)
        self.keymap = {
            "throttle_up": "w",
            "throttle_down": "s",
            "roll_left": "a",
            "roll_right": "d",
            "pitch_forward": "up",
            "pitch_back": "down",
            "yaw_left": "q",
            "yaw_right": "e",
        }

    # ═══════════════════════════════════════════════════════════
    # ПОДКЛЮЧЕНИЕ
    # ═══════════════════════════════════════════════════════════

    def connect(self) -> bool:
        """Подключиться к игре."""
        if self.game_type == GameType.AIRSIM:
            return self._connect_airsim()
        elif self.game_type == GameType.GTA5:
            return self._connect_gta5()
        else:
            # Uncrashed / любая игра — всегда через keyboard
            self.connected = True
            return True

    def _connect_airsim(self) -> bool:
        try:
            import airsim
            self._airsim_client = airsim.MultirotorClient()
            self._airsim_client.confirmConnection()
            self.connected = True
            return True
        except Exception as e:
            print(f"AirSim not available: {e}")
            return False

    def _connect_gta5(self) -> bool:
        """Проверить запущен ли GTA V."""
        try:
            result = subprocess.run(
                ["tasklist", "/fi", "IMAGENAME eq GTA5.exe"],
                capture_output=True, text=True, timeout=5,
            )
            if "GTA5.exe" in result.stdout:
                self.connected = True
                return True
        except:
            pass
        print("GTA V не запущен. Запустите GTA V с ScriptHookV.")
        return False

    # ═══════════════════════════════════════════════════════════
    # УПРАВЛЕНИЕ КЛАВИАТУРОЙ (работает с любой игрой)
    # ═══════════════════════════════════════════════════════════

    def _press_key(self, key: str, duration: float = 0.1):
        """Нажать и отпустить клавишу."""
        if os.name == "nt":
            # Windows: SendInput
            import ctypes
            from ctypes import wintypes

            # Virtual key codes
            vk_map = {
                'w': 0x57, 'a': 0x41, 's': 0x53, 'd': 0x44,
                'q': 0x51, 'e': 0x45, 'r': 0x52, 'f': 0x46,
                'up': 0x26, 'down': 0x28, 'left': 0x25, 'right': 0x27,
                'space': 0x20, 'shift': 0x10, 'ctrl': 0x11,
                '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
            }
            vk = vk_map.get(key.lower(), 0)
            if vk == 0:
                return

            # SendInput для нажатия
            ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
            time.sleep(duration)
            ctypes.windll.user32.keybd_event(vk, 0, 2, 0)  # KEYEVENTF_KEYUP = 2
        else:
            # Linux: xdotool
            subprocess.run(["xdotool", "key", "--delay", str(int(duration*1000)), key],
                          capture_output=True)

    def _move_mouse(self, dx: int, dy: int):
        """Сдвинуть мышь."""
        if os.name == "nt":
            ctypes.windll.user32.mouse_event(0x0001, dx, dy, 0, 0)
        else:
            subprocess.run(["xdotool", "mousemove_relative", "--", str(dx), str(dy)],
                          capture_output=True)

    # ═══════════════════════════════════════════════════════════
    # КОМАНДЫ ДРОНУ
    # ═══════════════════════════════════════════════════════════

    def takeoff(self):
        """Взлёт."""
        self._press_key("shift", 0.3)
        self._drone_state.armed = True

    def land(self):
        """Посадка."""
        self._press_key("shift", 0.3)  # или отдельная клавиша

    def move(self, throttle: float = 0, roll: float = 0,
             pitch: float = 0, yaw: float = 0, duration: float = 0.5):
        """
        Движение дрона.

        throttle: вперёд (+) / назад (-),  -1..1
        roll:     вправо (+) / влево (-),  -1..1
        pitch:    вниз (+) / вверх (-),    -1..1
        yaw:      вправо (+) / влево (-),  -1..1
        """
        # Конвертировать значения в нажатия клавиш
        if throttle > 0.2:
            self._press_key(self.keymap["throttle_up"], duration * throttle)
        elif throttle < -0.2:
            self._press_key(self.keymap["throttle_down"], duration * abs(throttle))

        if roll > 0.2:
            self._press_key(self.keymap["roll_right"], duration * roll)
        elif roll < -0.2:
            self._press_key(self.keymap["roll_left"], duration * abs(roll))

        if pitch > 0.2:
            self._press_key(self.keymap["pitch_forward"], duration * pitch)
        elif pitch < -0.2:
            self._press_key(self.keymap["pitch_back"], duration * abs(pitch))

        if yaw > 0.2:
            self._press_key(self.keymap["yaw_right"], duration * yaw)
        elif yaw < -0.2:
            self._press_key(self.keymap["yaw_left"], duration * abs(yaw))

    def fly_to(self, target_x: float, target_y: float, target_z: float,
               current: DroneState = None) -> dict:
        """
        Автопилот: лететь к точке.

        Использует наивный П-регулятор через клавиатуру.
        Работает в любой игре где дрон управляется с клавиатуры.

        Возвращает команды для следующего шага.
        """
        if current is None:
            current = self._drone_state

        dx = target_x - current.x
        dy = target_y - current.y
        dz = target_z - current.z
        dist = math.sqrt(dx*dx + dy*dy + dz*dz)

        if dist < 2:
            return {"done": True, "dist": dist}

        # Направление
        target_yaw = math.degrees(math.atan2(dx, dz))
        yaw_error = (target_yaw - current.yaw + 180) % 360 - 180

        # Высота
        alt_error = target_y - current.y

        return {
            "done": False,
            "dist": dist,
            "throttle": min(1.0, dist / 50),
            "yaw": max(-1.0, min(1.0, yaw_error / 30)),
            "pitch": max(-1.0, min(1.0, -alt_error / 20)),
            "target_yaw": target_yaw,
            "yaw_error": yaw_error,
        }

    def execute_serafim_action(self, action: str, drone_state: DroneState,
                               target: dict = None) -> dict:
        """
        Выполнить тактическое действие от Serafim через игровое управление.

        action: "attack", "observe", "rtb", "patrol"
        target: {"x":..., "y":..., "z":..., "id":...}
        """
        if action == "attack" and target:
            cmd = self.fly_to(target["x"], target["y"], target["z"], drone_state)
            if cmd.get("dist", 999) < 5:
                # Долетіли — атака (сброс/таран)
                self._press_key("f", 0.2)  # кнопка атаки
                return {"status": "attacking", "target": target.get("id")}
            return {"status": "flying", "cmd": cmd}

        elif action == "rtb":
            cmd = self.fly_to(0, 50, 0, drone_state)  # база в (0,0)
            return {"status": "returning", "cmd": cmd}

        elif action == "observe" and target:
            # Кружить вокруг цели
            orbit_r = 200
            angle = drone_state.yaw + 30
            orbit_x = target["x"] + orbit_r * math.sin(math.radians(angle))
            orbit_z = target.get("z", 0) + orbit_r * math.cos(math.radians(angle))
            cmd = self.fly_to(orbit_x, max(drone_state.y, 100), orbit_z, drone_state)
            return {"status": "orbiting", "cmd": cmd}

        else:
            # Patrol — лететь по кругу
            angle = time.time() * 0.1
            patrol_x = 500 * math.sin(angle)
            patrol_z = 500 * math.cos(angle)
            cmd = self.fly_to(patrol_x, 100, patrol_z, drone_state)
            return {"status": "patrolling", "cmd": cmd}

    # ═══════════════════════════════════════════════════════════
    # ЧТЕНИЕ ИГРОВОГО СОСТОЯНИЯ
    # ═══════════════════════════════════════════════════════════

    def get_state(self) -> DroneState:
        """Прочитать состояние дрона из игры."""
        if self.game_type == GameType.AIRSIM:
            return self._get_state_airsim()
        else:
            # Для Uncrashed/GTA5 — используем оценку по последним командам
            return self._drone_state

    def _get_state_airsim(self) -> DroneState:
        try:
            import airsim
            state = self._airsim_client.getMultirotorState()
            pos = state.kinematics_estimated.position
            vel = state.kinematics_estimated.linear_velocity
            orient = state.kinematics_estimated.orientation

            # Кватернион → углы Эйлера
            q = orient
            pitch = math.asin(2*(q.w_val*q.y_val - q.z_val*q.x_val))
            roll = math.atan2(2*(q.w_val*q.x_val + q.y_val*q.z_val),
                            1 - 2*(q.x_val*q.x_val + q.y_val*q.y_val))
            yaw = math.atan2(2*(q.w_val*q.z_val + q.x_val*q.y_val),
                           1 - 2*(q.y_val*q.y_val + q.z_val*q.z_val))

            self._drone_state = DroneState(
                x=pos.x_val, y=pos.z_val, z=-pos.y_val,
                vx=vel.x_val, vy=vel.z_val, vz=-vel.y_val,
                pitch=math.degrees(pitch),
                roll=math.degrees(roll),
                yaw=math.degrees(yaw),
            )
            return self._drone_state
        except:
            return DroneState()


# ═══════════════════════════════════════════════════════════════
# КОНФИГУРАЦИЯ ДЛЯ ПОПУЛЯРНЫХ ИГР
# ═══════════════════════════════════════════════════════════════

GAME_CONFIGS = {
    "uncrashed": {
        "name": "Uncrashed (FPV Drone Simulator)",
        "type": "keyboard",
        "keymap": {
            "throttle_up": "w", "throttle_down": "s",
            "roll_left": "a", "roll_right": "d",
            "pitch_forward": "up", "pitch_back": "down",
            "yaw_left": "q", "yaw_right": "e",
        },
        "launch": "steam://rungameid/1682970",
        "note": "Запустите Free Flight карту. Дрон должен быть в режиме Acro.",
    },
    "gta5": {
        "name": "Grand Theft Auto V",
        "type": "keyboard+mod",
        "keymap": {
            "throttle_up": "w", "throttle_down": "s",
            "roll_left": "a", "roll_right": "d",
            "pitch_forward": "numpad8", "pitch_back": "numpad5",
            "yaw_left": "numpad4", "yaw_right": "numpad6",
        },
        "mods": [
            "ScriptHookV (http://dev-c.com/GTAV/scripthookv)",
            "DroneMod или Simple Trainer (для спавна дронов)",
        ],
        "note": "Установите ScriptHookV. Используйте Simple Trainer для спавна военной техники.",
    },
    "airsim": {
        "name": "Microsoft AirSim",
        "type": "python_api",
        "launch": "AirSimNH (Neighborhood) или AirSimCity",
        "note": "pip install airsim. Запустите AirSim окружение.",
    },
    "liftoff": {
        "name": "Liftoff (FPV Drone Racing)",
        "type": "keyboard",
        "keymap": {
            "throttle_up": "w", "throttle_down": "s",
            "roll_left": "a", "roll_right": "d",
            "pitch_forward": "up", "pitch_back": "down",
            "yaw_left": "q", "yaw_right": "e",
        },
        "launch": "steam://rungameid/410340",
    },
    "dcl": {
        "name": "DRL Simulator / DCL The Game",
        "type": "keyboard",
        "keymap": {
            "throttle_up": "w", "throttle_down": "s",
            "roll_left": "a", "roll_right": "d",
            "pitch_forward": "up", "pitch_back": "down",
            "yaw_left": "q", "yaw_right": "e",
        },
    },
}


def print_games():
    """Показать все поддерживаемые игры."""
    print("Поддерживаемые игры:")
    for game_id, cfg in GAME_CONFIGS.items():
        print(f"  {game_id:15s} — {cfg['name']} ({cfg['type']})")


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  GAME BRIDGE — Serafim → Игровые движки         ║")
    print("╚══════════════════════════════════════════════════╝")
    print()
    print_games()
    print()

    # Демо: симуляция полёта через fly_to()
    print("Демо: автопилот к цели")
    bridge = GameBridge("uncrashed")
    state = DroneState(x=0, y=100, z=0, yaw=0)
    target = (100, 50, 200)

    for step in range(5):
        cmd = bridge.fly_to(*target, current=state)
        if cmd["done"]:
            print(f"  Шаг {step+1}: ПРИБЫЛИ (dist={cmd['dist']:.1f}м)")
            break
        # Симулируем движение
        state.x += (target[0] - state.x) * 0.3
        state.y += (target[1] - state.y) * 0.3
        state.z += (target[2] - state.z) * 0.3
        print(f"  Шаг {step+1}: throttle={cmd['throttle']:.2f} yaw={cmd['yaw']:.2f} dist={cmd['dist']:.0f}м")
