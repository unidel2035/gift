#!/usr/bin/env python3
"""
field_station.py — Лёгкая полевая станция для запускающих

Роль в архитектуре:
  Оператор дома (Thinker + Coder) ← Интернет → Полевая станция ← LoRa → Рой

Полевая станция:
  - НЕ принимает стратегических решений (это оператор)
  - НЕ пишет код (это Coder)
  - РЕТРАНСЛИРУЕТ команды оператору ↔ рою
  - Мониторит батареи дронов
  - Автономно держит связь если интернет упал (через Serafim)
  - Интерфейс для запускающих: статус батарей, готовность, тревоги

Железо: Orange Pi 5 / Raspberry Pi 5 + LoRa + LTE/Starlink
"""

import asyncio, json, time
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class LauncherStatus:
    """Статус одного запускающего."""
    id: str
    ready_drones: int       # сколько дронов готово к запуску
    charging_batteries: int  # сколько АКБ на зарядке
    next_launch_at: float    # когда следующий запуск (timestamp)
    note: str = ""


@dataclass
class FieldRelayState:
    """Состояние полевого ретранслятора."""
    internet_up: bool = True
    lora_rssi: float = -60.0       # dBm до роя
    connected_drones: int = 0
    last_operator_seen: float = 0  # timestamp последней команды
    autonomous_mode: bool = False   # True если интернет упал


class FieldStation:
    """
    Полевая станция — мост между оператором (дома) и роем (воздух).

    Три режима:
      1. RELAY — интернет есть, тупо ретранслирует команды
      2. AUTONOMOUS — интернет упал, включает локальный Serafim
      3. RECOVERY — интернет вернулся, синхронизация с оператором
    """

    def __init__(self, station_id: str = "field-1"):
        self.id = station_id
        self.state = FieldRelayState()
        self.launchers: Dict[str, LauncherStatus] = {}

        # Локальный Serafim (на случай потери интернета)
        self.serafim_local = None  # загружается при входе в AUTONOMOUS

        # Очередь команд
        self.command_queue: List[dict] = []
        self.telemetry_queue: List[dict] = []

    # ═══════════════════════════════════════════════════════════
    # РЕЖИМ 1: RELAY — интернет есть
    # ═══════════════════════════════════════════════════════════

    async def relay_operator_command(self, operator_msg: dict) -> dict:
        """
        Принять команду от оператора (через интернет), отправить в рой (через LoRa).

        operator_msg:
          {"type": "mission", "intent": "...", "targets": [...], "priority": "..."}
          {"type": "code", "payload": "<скрипт от Coder>"}
          {"type": "launch", "drone_id": "...", "payload": "..."}
        """
        self.state.last_operator_seen = time.time()

        if operator_msg.get("type") == "code":
            # Оператор прислал инструмент от Coder → сохранить, отправить дронам
            self._forward_code_to_swarm(operator_msg["payload"])
            return {"status": "code_forwarded"}

        elif operator_msg.get("type") == "mission":
            # Стратегическая команда → сжать и отправить рою
            compressed = self._compress_for_lora(operator_msg)
            await self._send_lora(compressed)
            return {"status": "mission_sent", "bytes": len(compressed)}

        elif operator_msg.get("type") == "launch":
            # Команда на запуск конкретного дрона
            drone_id = operator_msg["drone_id"]
            return await self._handle_launch(drone_id, operator_msg.get("payload", ""))

        return {"status": "unknown_command"}

    async def relay_swarm_telemetry(self) -> dict:
        """Собрать телеметрию от роя → отправить оператору."""
        # Слушаем LoRa-пакеты от роя
        telemetry = await self._receive_lora_batch()

        # Сжимаем для отправки через интернет (JSON, не LoRa-сжатие)
        report = {
            "station_id": self.id,
            "internet_up": self.state.internet_up,
            "drones": telemetry,
            "launchers": {lid: {
                "ready": ls.ready_drones,
                "charging": ls.charging_batteries,
            } for lid, ls in self.launchers.items()},
            "timestamp": time.time(),
        }
        return report

    # ═══════════════════════════════════════════════════════════
    # РЕЖИМ 2: AUTONOMOUS — интернет упал
    # ═══════════════════════════════════════════════════════════

    async def enter_autonomous(self):
        """Интернет потерян — включаем локальное управление."""
        self.state.autonomous_mode = True
        # Загружаем Serafim локально на Orange Pi
        # (работает даже на CPU, 400ms на решение)
        self.serafim_local = True  # Serafim Q8 уже должен быть в памяти

    async def autonomous_decide(self, situation: dict) -> str:
        """
        Локальное решение через Serafim на полевой станции.

        Не стратегия (это Thinker), не инструмент (это Coder) —
        только тактическое решение: атаковать/ждать/возврат.
        """
        if not self.serafim_local:
            return "rtb: связи нет, возврат"

        prompt = (
            f"Ты полевой контроллер роя. Связь с оператором потеряна. "
            f"Дронов: {situation.get('drones', 0)}. "
            f"Целей: {situation.get('targets', 0)}. "
            f"Решение: продолжать миссию или RTB?"
        )

        # Вызов локального Serafim через Ollama на Orange Pi
        import aiohttp
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    "http://localhost:11434/api/generate",
                    json={
                        "model": "serafim-tactical:q8",
                        "prompt": prompt,
                        "stream": False,
                        "options": {"temperature": 0.1, "num_predict": 20},
                    },
                    timeout=aiohttp.ClientTimeout(total=2),
                ) as resp:
                    data = await resp.json()
                    return data.get("response", "patrol").strip()
        except:
            return "rtb: Serafim недоступен"

    # ═══════════════════════════════════════════════════════════
    # РЕЖИМ 3: RECOVERY — интернет вернулся
    # ═══════════════════════════════════════════════════════════

    async def exit_autonomous(self):
        """Интернет вернулся — синхронизация с оператором."""
        self.state.autonomous_mode = False
        # Отправить оператору всё что произошло за время разрыва
        backlog = {
            "autonomous_period_s": time.time() - self.state.last_operator_seen,
            "decisions_made": len(self.command_queue),
            "current_state": self.state,
        }
        self.command_queue.clear()
        return backlog

    # ═══════════════════════════════════════════════════════════
    # ПОМОЩНИКИ
    # ═══════════════════════════════════════════════════════════

    def _compress_for_lora(self, msg: dict) -> bytes:
        """Сжать команду оператора для LoRa (51 байт макс)."""
        import struct
        intent = msg.get("intent", "")[:30]
        priority = msg.get("priority", "0")[0]
        packed = struct.pack('<B30s', ord(priority), intent.encode())
        return packed[:51]

    async def _send_lora(self, data: bytes):
        """Отправить данные через LoRa модуль."""
        # В реальности: serial write в LoRa-модуль
        pass

    async def _receive_lora_batch(self) -> List[dict]:
        """Принять пакет от роя через LoRa."""
        # В реальности: serial read из LoRa-модуля
        return []

    async def _handle_launch(self, drone_id: str, payload: str) -> dict:
        """Обработать запуск дрона."""
        return {"status": "launched", "drone_id": drone_id}

    def _forward_code_to_swarm(self, code: str):
        """Переслать инструмент от Coder в рой."""
        # Разбить на LoRa-пакеты по 51 байт, отправить последовательно
        chunks = [code[i:i+45].encode() for i in range(0, len(code), 45)]
        for i, chunk in enumerate(chunks):
            header = f"CD:{i}/{len(chunks)}:".encode()
            pkt = (header + chunk)[:51]
            self.command_queue.append({"type": "code_chunk", "data": pkt})


# ═══════════════════════════════════════════════════════════════
# ИНТЕРФЕЙС ОПЕРАТОРА (дома)
# ═══════════════════════════════════════════════════════════════

class OperatorConsole:
    """
    Интерфейс оператора — командный центр роя.

    Запускается на ПК/сервере дома.
    Соединяется с полевой станцией через интернет (VPN/шифрованный канал).

    Оператор:
      - Видит карту с дронами и целями
      - Задаёт намерение (intent) — НЕ пилотирует
      - Получает готовые планы от Thinker
      - Получает инструменты от Coder
      - Отправляет команды через полевую станцию в рой
    """

    def __init__(self, field_station_url: str = ""):
        self.field_url = field_station_url  # URL полевой станции (через VPN)

    async def send_intent(self, intent: str, priority: str = "attack"):
        """Отправить намерение рою (через полевую станцию)."""
        # Thinker обрабатывает намерение → план
        # План → сжатие → полевая станция → LoRa → рой
        msg = {"type": "mission", "intent": intent, "priority": priority}
        # await http_post(self.field_url + "/command", msg)

    async def get_battlefield_view(self) -> dict:
        """Получить текущую картину поля боя."""
        # Запрос к полевой станции → телеметрия роя → отрисовка на карте
        # await http_get(self.field_url + "/telemetry")
        return {
            "drones": [],
            "targets": [],
            "field_station": {"internet_up": True, "autonomous": False},
        }

    async def deploy_tool(self, tool_code: str):
        """Отправить инструмент от Coder в рой."""
        msg = {"type": "code", "payload": tool_code}
        # await http_post(self.field_url + "/command", msg)


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  ПОЛЕВАЯ СТАНЦИЯ — мост оператор ↔ рой          ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    # Демонстрация трёх режимов
    station = FieldStation("home-front-1")

    print("1. Интернет есть → RELAY mode")
    print("   Оператор: «Разведать квадрат 37»")
    print("   Станция: сжала → LoRa → рой")
    print("   Задержка: ~50ms (интернет) + 200ms (LoRa)")
    print()

    print("2. Интернет упал → AUTONOMOUS mode")
    print("   Станция: Serafim локально на Orange Pi")
    print("   Решение: «Продолжать миссию, приоритет ПВО»")
    print("   Задержка: ~400ms (Serafim на CPU)")
    print()

    print("3. Интернет вернулся → RECOVERY mode")
    print("   Станция → оператору: отчёт за время разрыва")
    print("   Оператор → станции: новый план")
    print()

    print("Архитектура: оператор дома — безопасен.")
    print("Рой в поле — автономен. Связь через интернет + LoRa.")
    print("При обрыве интернета — рой НЕ слепнет.")
