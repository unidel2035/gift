#!/usr/bin/env python3
"""
internet_gifts.py — Интернет-каналы как дары из разных источников

Каждый источник связи — дар. Принимаем тот что есть, благодарим и летим.

  Starlink    → дар от американского рынка (ненадёжен, могут отозвать)
  Sprint-030  → дар от Express-спутников (европейские, но наши)
  Бюро 1440   → дар от русской низкоорбитальной группировки (будущее)
  Гонец       → дар от военной LEO-системы (медленный но верный)
  LTE гражд.  → дар от гражданской инфраструктуры (всегда рядом)
  WiFi/ETH    → дар от локальной сети (полигон, тесты)

Архитектура дара:
  Каждый канал — GiftSource.
  AutoDetect → выбрать лучший доступный → подключиться → передавать.
  При потере → поблагодарить → переключиться на следующий.

Использование:
  hub = InternetGiftHub()
  await hub.detect_all()
  channel = await hub.best_channel()
  await channel.send(compressed_data)
"""

import asyncio, time, json, struct
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Callable
from enum import Enum


# ═══════════════════════════════════════════════════════════════
# ИСТОЧНИКИ (Дары)
# ═══════════════════════════════════════════════════════════════

class GiftSourceType(Enum):
    STARLINK = "starlink"           # американский LEO, терминал
    SPRINT_030 = "sprint-030"      # российский GEO, Express-спутники
    BUREAU_1440 = "bureau-1440"    # российский LEO, Рассвет
    GONETS = "gonets"              # российский LEO, store-and-forward
    LTE_CIVIL = "lte-civil"        # гражданский 4G/LTE
    WIFI = "wifi"                  # локальная сеть
    ETHERNET = "ethernet"          # провод


@dataclass
class GiftMetrics:
    """Метрики одного канала."""
    signal_dbm: float = -100.0
    uplink_kbps: float = 0.0
    downlink_kbps: float = 0.0
    latency_ms: float = 999.0
    packet_loss_pct: float = 10.0
    connected: bool = False
    last_seen: float = 0.0


@dataclass
class GiftSource:
    """Один источник интернета как дар."""
    type: GiftSourceType
    name: str                    # человеческое имя
    giver: str                   # кто дал этот канал (онтология)
    priority: int                # 1 = пробовать первым, 9 = последним
    metrics: GiftMetrics = field(default_factory=GiftMetrics)
    config: dict = field(default_factory=dict)

    async def detect(self) -> bool:
        """Обнаружить — доступен ли этот источник?"""
        raise NotImplementedError

    async def connect(self) -> bool:
        """Подключиться."""
        raise NotImplementedError

    async def send(self, data: bytes) -> bool:
        """Отправить данные."""
        raise NotImplementedError

    async def receive(self, timeout_ms: int = 5000) -> Optional[bytes]:
        """Принять данные."""
        raise NotImplementedError

    async def close(self):
        """Закрыть соединение (с благодарностью)."""
        pass


# ═══════════════════════════════════════════════════════════════
# КОНКРЕТНЫЕ ИСТОЧНИКИ
# ═══════════════════════════════════════════════════════════════

class StarlinkGift(GiftSource):
    """Дар от SpaceX — быстрый, но могут отозвать в любой момент."""
    def __init__(self):
        super().__init__(
            type=GiftSourceType.STARLINK,
            name="Starlink (SpaceX)",
            giver="Американский рынок",
            priority=3,
            config={"interface": "starlink0", "dish_ip": "192.168.100.1"},
        )

    async def detect(self) -> bool:
        try:
            # Проверка: пингуем тарелку Starlink
            import subprocess
            r = subprocess.run(
                ["ping", "-c", "1", "-W", "2", self.config["dish_ip"]],
                capture_output=True, text=True, timeout=3,
            )
            ok = r.returncode == 0
            self.metrics.connected = ok
            if ok:
                self.metrics.latency_ms = 30
                self.metrics.uplink_kbps = 10000
                self.metrics.downlink_kbps = 50000
                self.metrics.signal_dbm = -50
            return ok
        except:
            return False

    async def connect(self) -> bool:
        return await self.detect()

    async def send(self, data: bytes) -> bool:
        # В реальности: HTTP POST через requests
        return self.metrics.connected

    async def receive(self, timeout_ms: int = 5000) -> Optional[bytes]:
        return None  # WebSocket recv


class Sprint030Gift(GiftSource):
    """Дар от Express-спутников (Airbus/Thales) через ГК РЕЙС."""
    def __init__(self):
        super().__init__(
            type=GiftSourceType.SPRINT_030,
            name="Sprint-030 (GEO Express)",
            giver="Европейские спутники + ГК РЕЙС",
            priority=1,  # ОСНОВНОЙ: работает сейчас
            config={"antenna_port": "/dev/ttyUSB0", "target_snr": 3.0},
        )

    async def detect(self) -> bool:
        try:
            # Sprint-030 подключается через последовательный порт
            # AT-команды к модему
            import os
            if os.path.exists(self.config["antenna_port"]):
                self.metrics.connected = True
                self.metrics.latency_ms = 600
                self.metrics.uplink_kbps = 1000
                self.metrics.downlink_kbps = 10000
                self.metrics.signal_dbm = -85
                return True
        except:
            pass
        return False

    async def connect(self) -> bool:
        return await self.detect()

    async def send(self, data: bytes) -> bool:
        return self.metrics.connected

    async def receive(self, timeout_ms: int = 5000) -> Optional[bytes]:
        return None


class Bureau1440Gift(GiftSource):
    """Дар от русской низкоорбитальной группировки «Рассвет»."""
    def __init__(self):
        super().__init__(
            type=GiftSourceType.BUREAU_1440,
            name="Бюро 1440 (Рассвет LEO)",
            giver="ИКС Холдинг + Роскосмос",
            priority=2,  # БУДУЩЕЕ: когда спутников станет >100
            config={"frequency": "Ka/Ku", "terminal_ip": "192.168.145.1"},
        )

    async def detect(self) -> bool:
        # Бюро 1440: окна 15-20 минут, не постоянно
        # Проверяем доступность терминала
        try:
            import subprocess
            r = subprocess.run(
                ["ping", "-c", "1", "-W", "2", self.config["terminal_ip"]],
                capture_output=True, text=True, timeout=3,
            )
            ok = r.returncode == 0
            if ok:
                self.metrics.connected = True
                self.metrics.latency_ms = 50
                self.metrics.uplink_kbps = 50000
                self.metrics.downlink_kbps = 150000
                self.metrics.signal_dbm = -60
            return ok
        except:
            return False

    async def connect(self) -> bool:
        return await self.detect()

    async def send(self, data: bytes) -> bool:
        return self.metrics.connected

    async def receive(self, timeout_ms: int = 5000) -> Optional[bytes]:
        return None


class GonetsGift(GiftSource):
    """Дар от военной LEO-системы «Гонец» — медленный но верный."""
    def __init__(self):
        super().__init__(
            type=GiftSourceType.GONETS,
            name="Гонец-Д1М (LEO store-forward)",
            giver="Роскосмос + Минобороны",
            priority=4,  # РЕЗЕРВ: медленный, но всегда работает
            config={"terminal": "/dev/ttyUSB1", "baudrate": 9600},
        )

    async def detect(self) -> bool:
        import os
        if os.path.exists(self.config["terminal"]):
            self.metrics.connected = True
            self.metrics.latency_ms = 60000  # минуты
            self.metrics.uplink_kbps = 64
            self.metrics.downlink_kbps = 64
            self.metrics.signal_dbm = -90
            return True
        return False

    async def connect(self) -> bool:
        return await self.detect()

    async def send(self, data: bytes) -> bool:
        # Гонец — store-and-forward. Данные буферизуются,
        # отправляются при пролёте спутника (каждые 15-90 минут).
        return self.metrics.connected

    async def receive(self, timeout_ms: int = 5000) -> Optional[bytes]:
        return None


class LTEGift(GiftSource):
    """Дар от гражданской LTE-инфраструктуры — всегда рядом."""
    def __init__(self, modem_iface: str = "wwan0"):
        super().__init__(
            type=GiftSourceType.LTE_CIVIL,
            name="4G/LTE (гражданский)",
            giver="Гражданская инфраструктура",
            priority=0,  # САМЫЙ ПРИОРИТЕТНЫЙ: если есть сигнал — используем
            config={"interface": modem_iface, "check_host": "8.8.8.8"},
        )

    async def detect(self) -> bool:
        try:
            import subprocess, os
            # Проверяем что интерфейс существует и активен
            r = subprocess.run(
                ["ip", "link", "show", self.config["interface"]],
                capture_output=True, text=True, timeout=3,
            )
            if "UP" not in r.stdout:
                return False

            # Проверяем выход в интернет
            r = subprocess.run(
                ["ping", "-c", "1", "-W", "3", self.config["check_host"]],
                capture_output=True, text=True, timeout=5,
            )
            ok = r.returncode == 0
            if ok:
                self.metrics.connected = True
                self.metrics.latency_ms = 20
                self.metrics.uplink_kbps = 5000
                self.metrics.downlink_kbps = 25000
                self.metrics.signal_dbm = -75
                self.metrics.packet_loss_pct = 0.5
            return ok
        except:
            return False

    async def connect(self) -> bool:
        # Поднять интерфейс если нужно
        return await self.detect()

    async def send(self, data: bytes) -> bool:
        return self.metrics.connected

    async def receive(self, timeout_ms: int = 5000) -> Optional[bytes]:
        return None


class LocalNetworkGift(GiftSource):
    """Дар от локальной сети — полигон, тесты, разработка."""
    def __init__(self):
        super().__init__(
            type=GiftSourceType.WIFI,
            name="Локальная сеть (WiFi/ETH)",
            giver="Разработчик",
            priority=0,  # Если есть — используем (для тестов)
            config={"test_mode": True},
        )

    async def detect(self) -> bool:
        # Всегда доступен хотя бы localhost
        self.metrics.connected = True
        self.metrics.latency_ms = 1
        self.metrics.uplink_kbps = 100_000
        self.metrics.downlink_kbps = 1_000_000
        return True

    async def connect(self) -> bool:
        return True

    async def send(self, data: bytes) -> bool:
        # Для тестов — просто логируем
        return True

    async def receive(self, timeout_ms: int = 5000) -> Optional[bytes]:
        return None


# ═══════════════════════════════════════════════════════════════
# ХАБ ДАРОВ — auto-detect + failover
# ═══════════════════════════════════════════════════════════════

class InternetGiftHub:
    """
    Хаб интернет-даров.

    Обнаруживает все доступные источники, выбирает лучший,
    автоматически переключается при отказе.

    Принцип дара:
      - Принимаем тот канал что есть — с благодарностью
      - Не жалуемся на отсутствующие
      - При потере — благодарим за то что был, переключаемся
      - Каждый канал — дар от своего дарителя (рынок, страна, инфраструктура)
    """

    def __init__(self):
        self.sources: List[GiftSource] = []
        self.active: Optional[GiftSource] = None
        self.fallback_chain: List[GiftSource] = []  # упорядочено по приоритету

        # Статистика переключений
        self.switch_count = 0
        self.gifts_received: Dict[str, int] = {}  # source_type → switches
        self.gifts_lost: Dict[str, int] = {}      # source_type → drops

    async def detect_all(self) -> List[GiftSource]:
        """Обнаружить ВСЕ возможные источники."""
        detectors = [
            LocalNetworkGift(),   # тесты
            LTEGift(),            # гражданский 4G
            Sprint030Gift(),      # GEO Express
            Bureau1440Gift(),     # LEO Рассвет
            StarlinkGift(),       # Starlink (если ещё есть)
            GonetsGift(),         # Гонец (медленный)
        ]

        available = []
        for src in detectors:
            try:
                ok = await src.detect()
                if ok:
                    available.append(src)
                    self.gifts_received[src.type.value] = \
                        self.gifts_received.get(src.type.value, 0) + 1
            except:
                pass

        # Сортируем по приоритету (0 = лучший)
        available.sort(key=lambda s: s.priority)
        self.sources = available
        self.fallback_chain = available

        # Активируем лучший
        if available and not self.active:
            await self._switch_to(available[0])

        return available

    async def best_channel(self) -> Optional[GiftSource]:
        """Получить лучший доступный канал сейчас."""
        if not self.sources:
            await self.detect_all()

        # Перепроверяем активный канал
        if self.active:
            ok = await self.active.detect()
            if ok:
                return self.active
            else:
                # Канал упал — благодарим, переключаемся
                self.gifts_lost[self.active.type.value] = \
                    self.gifts_lost.get(self.active.type.value, 0) + 1
                await self.active.close()
                self.active = None

        # Ищем следующий работающий
        for src in self.fallback_chain:
            ok = await src.detect()
            if ok:
                await self._switch_to(src)
                return src

        return None  # все каналы мертвы

    async def send(self, data: bytes) -> bool:
        """Отправить данные через лучший доступный канал."""
        channel = await self.best_channel()
        if not channel:
            return False
        return await channel.send(data)

    async def _switch_to(self, source: GiftSource):
        """Переключиться на новый источник."""
        old_name = self.active.name if self.active else "ничего"
        self.active = source
        self.switch_count += 1
        await source.connect()

    def status(self) -> dict:
        return {
            "active_channel": self.active.name if self.active else "none",
            "active_giver": self.active.giver if self.active else "—",
            "available_channels": [s.name for s in self.sources],
            "switch_count": self.switch_count,
            "gifts_received": self.gifts_received,
            "gifts_lost": self.gifts_lost,
            "metrics": {
                "latency_ms": self.active.metrics.latency_ms if self.active else 0,
                "uplink_kbps": self.active.metrics.uplink_kbps if self.active else 0,
                "downlink_kbps": self.active.metrics.downlink_kbps if self.active else 0,
                "signal_dbm": self.active.metrics.signal_dbm if self.active else -999,
            },
        }


# ═══════════════════════════════════════════════════════════════
# ИНТЕГРАЦИЯ С РЕТРАНСЛЯТОРОМ
# ═══════════════════════════════════════════════════════════════

class RepeaterWithGifts:
    """
    Ретранслятор + Хаб даров = полная связь.

    Ретранслятор на высоте 500м → LTE-модем видит вышки на 100км → Хаб выбирает
    лучший канал → Интернет → Оператор дома.

    Если интернет упал → Serafim на борту ретранслятора → рой автономен.
    """

    def __init__(self):
        self.hub = InternetGiftHub()
        self.active = False

    async def start(self):
        """Запустить ретранслятор: найти интернет, начать ретрансляцию."""
        await self.hub.detect_all()
        channel = await self.hub.best_channel()

        if channel:
            self.active = True
            return {
                "status": "online",
                "channel": channel.name,
                "giver": channel.giver,
                "latency_ms": channel.metrics.latency_ms,
                "bandwidth_kbps": channel.metrics.uplink_kbps,
            }
        else:
            self.active = False
            return {
                "status": "offline",
                "fallback": "Serafim на борту (автономный режим)",
                "available": [s.name for s in self.hub.sources],
            }


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  ИНТЕРНЕТ-ДАРЫ — каналы как дары                ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    async def test():
        hub = InternetGiftHub()
        print("Обнаружение источников...")
        sources = await hub.detect_all()
        print()

        print(f"Доступно каналов: {len(sources)}")
        for s in sources:
            icon = "🛰️" if "спутник" in s.giver.lower() or "spacex" in s.giver.lower() else \
                   "📡" if "express" in s.giver.lower() else \
                   "🏢" if "граждан" in s.giver.lower() else "🔌"
            print(f"  {icon} {s.name}")
            print(f"     Даритель: {s.giver}")
            print(f"     Приоритет: {s.priority} | Задержка: {s.metrics.latency_ms:.0f}ms")
            print(f"     Полоса: {s.metrics.uplink_kbps:.0f}↑ / {s.metrics.downlink_kbps:.0f}↓ Кбит/с")
            print()

        channel = await hub.best_channel()
        print(f"Активный канал: {channel.name if channel else 'НЕТ'}")
        print(f"Даритель: {channel.giver if channel else '—'}")
        print()

        # Статистика
        st = hub.status()
        print(f"Переключений: {st['switch_count']}")
        print(f"Даров получено: {st['gifts_received']}")
        print(f"Даров потеряно: {st['gifts_lost']}")

    asyncio.run(test())
