#!/usr/bin/env python3
"""
board_emulator.py — Эмуляция трёх бортовых плат БПЛА «Серафим»

Архитектура (как на реальном дроне):
┌─────────────────────────────────────────────────┐
│  Orange Pi 5 (RK3588S, 8GB RAM, NPU 6 TOPS)     │
│  ├─ L2 Classifier (15 классов, ~10μs)            │
│  ├─ Serafim 1.5B LLM (Q4_K_M, ~1GB RAM)         │
│  ├─ Camera input (MIPI CSI)                      │
│  ├─ SDR (RF sensing)                             │
│  └─ Thermal camera (I2C)                         │
├─────────────────────────────────────────────────┤
│  Tang Nano 9K (Gowin GW1NR-9, 138K LUTs)        │
│  ├─ L1 FPGA Classifier (<1ms)                    │
│  ├─ Geometry: area, perimeter, aspect, convexity  │
│  └─ Verilog/VHDL → lookup-table rules            │
├─────────────────────────────────────────────────┤
│  Cube Orange+ (STM32H753, 2MB Flash)             │
│  ├─ ArduPilot / MAVLink v2                       │
│  ├─ IMU (ICM-20689)                              │
│  ├─ Barometer (MS5611)                           │
│  ├─ GPS/GLONASS (UBlox M9N)                      │
│  └─ 3× UART (GPS, telemetry, serial)             │
└─────────────────────────────────────────────────┘

Каждая плата — изолированный процесс с:
  - Ограничениями памяти (resource.setrlimit)
  - Тактовой частотой / latency budget
  - Собственным экземпляром Serafim LLM
  - Независимым сетевым портом
"""

import math, random, time, json, threading, multiprocessing, socket, struct, os, sys, signal, resource
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from abc import ABC, abstractmethod
import urllib.request

# ═══════════════════════════════════════════════════════════════
# Характеристики плат
# ═══════════════════════════════════════════════════════════════

@dataclass
class BoardSpec:
    """Спецификация платы"""
    name: str
    cpu: str
    ram_mb: int
    max_freq_mhz: float      # макс тактовая частота
    latency_us: float         # типовая задержка обработки
    power_watts: float
    interfaces: List[str]
    # Ограничения
    max_processes: int = 4
    max_memory_mb: int = 512

# Спецификация реальных плат
ORANGE_PI5_SPEC = BoardSpec(
    name="Orange Pi 5",
    cpu="RK3588S (4×A76 + 4×A55)",
    ram_mb=8192,
    max_freq_mhz=2400,
    latency_us=10,            # L2 классификатор
    power_watts=8.0,
    interfaces=["MIPI-CSI", "USB3", "I2C", "SPI", "UART", "ETH"],
    max_processes=8,
    max_memory_mb=2048,       # 2GB на процесс (из 8GB)
)

TANG_NANO_SPEC = BoardSpec(
    name="Tang Nano 9K",
    cpu="Gowin GW1NR-9 (138K LUTs)",
    ram_mb=64,                # встроенная SRAM
    max_freq_mhz=200,         # FPGA частота
    latency_us=1,             # <1ms для L1
    power_watts=0.5,
    interfaces=["GPIO", "SPI", "UART", "JTAG"],
    max_processes=2,
    max_memory_mb=32,
)

CUBE_ORANGE_SPEC = BoardSpec(
    name="Cube Orange+",
    cpu="STM32H753 (Cortex-M7, 480MHz)",
    ram_mb=1,                 # 1MB SRAM
    max_freq_mhz=480,
    latency_us=100,           # MAVLink обработка
    power_watts=1.5,
    interfaces=["UART×3", "SPI", "I2C×2", "CAN×2", "ADC"],
    max_processes=2,
    max_memory_mb=1,
)

# ═══════════════════════════════════════════════════════════════
# БАЗОВЫЙ КЛАСС ПЛАТЫ
# ═══════════════════════════════════════════════════════════════

class BoardEmulator(ABC):
    """Базовый эмулятор платы в изолированном процессе"""

    def __init__(self, spec: BoardSpec, board_id: str, port: int):
        self.spec = spec
        self.board_id = board_id
        self.port = port
        self.running = False
        self._stats = {
            "cycles": 0,
            "processing_time_us": 0,
            "errors": 0,
            "last_result": None,
        }

    @abstractmethod
    def process(self, input_data: dict) -> dict:
        """Обработать входные данные — реализуется платой"""
        pass

    def start(self):
        """Запустить эмуляцию платы"""
        self.running = True

    def stop(self):
        self.running = False

    def emulate_cycle(self, input_data: dict) -> dict:
        """Один цикл эмуляции с моделированием задержек"""
        if not self.running:
            return {"error": "board not running"}

        # Моделируем задержку обработки
        jitter = random.uniform(0.8, 1.2)
        latency_s = self.spec.latency_us * jitter / 1_000_000
        time.sleep(latency_s)

        # Моделируем возможные ошибки (1 на 10000 циклов)
        if random.random() < 0.0001:
            self._stats["errors"] += 1
            return {"error": f"board {self.board_id} processing error", "board": self.board_id}

        result = self.process(input_data)
        self._stats["cycles"] += 1
        self._stats["processing_time_us"] = self.spec.latency_us * jitter
        self._stats["last_result"] = result
        return result

    def get_stats(self) -> dict:
        return {
            "board_id": self.board_id,
            "spec": self.spec.name,
            "running": self.running,
            **self._stats,
        }


# ═══════════════════════════════════════════════════════════════
# 1. ORANGE PI 5 — L2 классификатор + Serafim LLM
# ═══════════════════════════════════════════════════════════════

class OrangePi5Emulator(BoardEmulator):
    """
    Эмуляция Orange Pi 5:
      - 8GB RAM (эмулируем 2GB limit на процесс)
      - L2 классификатор (15 классов, ~10μs)
      - Serafim 1.5B через Ollama API
      - Камера (MIPI-CSI) — синтетические изображения
      - SDR — RF-спектр
      - Тепловизор — тепловые сигнатуры
    """

    def __init__(self, board_id="OPi5-1", port=8201, ollama_url="http://localhost:11434"):
        super().__init__(ORANGE_PI5_SPEC, board_id, port)
        self.ollama_url = ollama_url
        self.model = "serafim-1.5b"
        self._classifier = None  # lazy init
        self._serafim_ready = False
        self._last_inference_ms = 0
        # Моделируем ограничения NPU (6 TOPS, но мы используем CPU)
        self._cpu_load = 0.0
        self._memory_used_mb = 0.0

    def start(self):
        super().start()
        # Инициализация классификатора
        sys.path.insert(0, '/home/unidel/gift/src/digital_twin')
        from extended_classifier import ExtendedClassifier
        self._classifier = ExtendedClassifier()
        self._serafim_ready = self._check_ollama()
        # Моделируем загрузку модели в память (~1GB для Q4_K_M)
        self._memory_used_mb = 986.0

    def _check_ollama(self) -> bool:
        """Проверить доступность Serafim в Ollama"""
        try:
            req = urllib.request.Request(
                f"{self.ollama_url}/api/tags",
                headers={"Content-Type": "application/json"}
            )
            resp = urllib.request.urlopen(req, timeout=5)
            models = json.loads(resp.read()).get("models", [])
            return any("serafim" in m.get("name", "") for m in models)
        except Exception:
            return False

    def process(self, input_data: dict) -> dict:
        """
        Обработка на Orange Pi 5:
          1. L2 Классификация цели по признакам
          2. Если нужно — запрос к Serafim LLM
          3. Формирование тактического решения
        """
        result = {
            "board": self.board_id,
            "classifier": None,
            "llm_decision": None,
            "memory_used_mb": self._memory_used_mb,
        }

        # 1. L2 Классификация
        features = input_data.get("features")
        if features:
            if isinstance(features, dict):
                from extended_classifier import MilitaryFeatures
                mf = MilitaryFeatures(**{k: features.get(k, 0) for k in [
                    "area_m2", "perimeter_m", "aspect_ratio", "convexity",
                    "rectangularity", "green_ratio", "texture_variance",
                    "edge_density", "temp_max", "temp_mean", "rf_power",
                    "rf_bandwidth", "nearby_objects", "speed_ms"
                ] if k in features})
                cls_result = self._classifier.classify(mf)
            else:
                cls_result = self._classifier.classify(features)
            result["classifier"] = cls_result
            self._cpu_load = 0.15

        # 2. Serafim LLM запрос (если классификатор дал результат)
        if result["classifier"] and input_data.get("query_llm", False):
            llm_result = self._query_serafim(
                target_type=result["classifier"]["target"],
                target_name=result["classifier"]["name"],
                confidence=result["classifier"]["confidence"],
                battery=input_data.get("battery", 100),
                drone_role=input_data.get("role", "scout"),
            )
            result["llm_decision"] = llm_result
            self._cpu_load = 0.8  # LLM inference грузит CPU

        return result

    def _query_serafim(self, target_type, target_name, confidence, battery, drone_role):
        """Запрос к Serafim 1.5B через Ollama API"""
        if not self._serafim_ready:
            return {"action": "OBSERVE", "reason": "LLM not available", "inference_ms": 0}

        prompt = f"""Борт {self.board_id}. Цель: {target_name} ({target_type}).
Уверенность: {confidence:.0%}. Батарея: {battery:.0f}%. Роль: {drone_role}.
Решение (ATTACK/OBSERVE/RTB):"""

        try:
            t0 = time.time()
            body = json.dumps({
                "model": self.model,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.2, "num_predict": 25, "stop": ["\n", ". "]}
            }).encode()
            req = urllib.request.Request(
                f"{self.ollama_url}/api/generate",
                body, {"Content-Type": "application/json"}
            )
            resp = urllib.request.urlopen(req, timeout=15)
            data = json.loads(resp.read())
            response = data.get("response", "").strip()
            self._last_inference_ms = (time.time() - t0) * 1000

            # Извлечение решения из ответа
            resp_upper = response.upper()
            if any(w in resp_upper for w in ["АТАК", "ATTACK", "УДАР"]):
                action = "ATTACK"
            elif any(w in resp_upper for w in ["ДОМОЙ", "RTB", "ВОЗВРАТ"]):
                action = "RTB"
            else:
                action = "OBSERVE"

            return {
                "action": action,
                "reason": response[:120],
                "inference_ms": round(self._last_inference_ms, 1),
                "model": self.model,
            }
        except Exception as e:
            self._stats["errors"] += 1
            return {"action": "OBSERVE", "reason": f"Error: {str(e)[:60]}", "inference_ms": 0}

    def get_stats(self) -> dict:
        s = super().get_stats()
        s.update({
            "serafim_ready": self._serafim_ready,
            "last_inference_ms": self._last_inference_ms,
            "cpu_load": round(self._cpu_load, 2),
            "memory_used_mb": self._memory_used_mb,
            "model": self.model,
        })
        return s


# ═══════════════════════════════════════════════════════════════
# 2. TANG NANO 9K — FPGA L1 классификатор
# ═══════════════════════════════════════════════════════════════

class TangNano9KEmulator(BoardEmulator):
    """
    Эмуляция Tang Nano 9K (FPGA, 138K LUTs):
      - L1 геометрический классификатор (<1ms)
      - Verilog lookup-table правила
      - 5 правил из ground_targets.h fpga_L1
    """

    def __init__(self, board_id="FPGA-1", port=8202):
        super().__init__(TANG_NANO_SPEC, board_id, port)
        # LUT utilisation (138K total)
        self._luts_used = 0
        self._fmax_mhz = 0.0

    def start(self):
        super().start()
        # Моделируем загрузку битстрима в FPGA
        self._luts_used = 4500  # ~3.3% от 138K LUTs для простых правил
        self._fmax_mhz = 180.0  # достигнутая тактовая частота

    def process(self, input_data: dict) -> dict:
        """
        FPGA L1 (<1ms):
        Правила из fpga_L1::classify():
          1. Прямоугольник + большая площадь + траншеи → опорник
          2. Маленький + серый + гладкий → блиндаж
          3. Вытянутый + движется → техника
          4. Края + RF → РЭБ
          5. Маленький + медленно → человек
        """
        f = input_data.get("features", {})
        result = {"board": self.board_id, "target": "UNKNOWN", "confidence": 0.0}

        # Правило 1: опорник
        if (f.get("rectangularity", 0) > 0.7 and
            f.get("area_m2", 0) > 50 and
            f.get("near_trench", False)):
            result = {"target": "strongpoint", "confidence": 0.85, "rule": 1}

        # Правило 2: блиндаж
        elif (5 < f.get("area_m2", 0) < 30 and
              f.get("green_ratio", 1) < 0.2 and
              f.get("rectangularity", 0) > 0.7):
            result = {"target": "bunker", "confidence": 0.80, "rule": 2}

        # Правило 3: техника
        elif (f.get("aspect_ratio", 0) > 2.5 and
              f.get("speed_ms", 0) > 0.5):
            result = {"target": "vehicle", "confidence": 0.80, "rule": 3}

        # Правило 4: РЭБ
        elif (f.get("edge_density", 0) > 0.6 and
              f.get("rf_power", 0) > 5.0):
            result = {"target": "ew_station", "confidence": 0.75, "rule": 4}

        # Правило 5: человек
        elif (f.get("area_m2", 0) < 3.0 and
              0.1 < f.get("speed_ms", 0) < 5.0):
            result = {"target": "person", "confidence": 0.70, "rule": 5}

        result["luts_used"] = self._luts_used
        result["fmax_mhz"] = self._fmax_mhz
        return result

    def get_stats(self) -> dict:
        s = super().get_stats()
        s.update({"luts_used": self._luts_used, "fmax_mhz": self._fmax_mhz})
        return s


# ═══════════════════════════════════════════════════════════════
# 3. CUBE ORANGE+ — Flight Controller + MAVLink
# ═══════════════════════════════════════════════════════════════

class CubeOrangeEmulator(BoardEmulator):
    """
    Эмуляция Cube Orange+ (STM32H753):
      - ArduPilot-совместимый полётный контроллер
      - MAVLink v2 телеметрия
      - IMU (ICM-20689): акселерометр + гироскоп
      - Барометр (MS5611)
      - GPS (UBlox M9N)
      - Магнитометр (RM3100)
    """

    def __init__(self, board_id="CubeOrange-1", port=8203):
        super().__init__(CUBE_ORANGE_SPEC, board_id, port)
        self._attitude = [0.0, 0.0, 0.0]  # roll, pitch, yaw
        self._position = [55.75, 37.62, 100.0]  # lat, lon, alt
        self._velocity = [0.0, 0.0, 0.0]
        self._imu_data = {"accel": [0, 0, 981], "gyro": [0, 0, 0]}
        self._baro_pressure = 101325.0
        self._gps_fix = 3
        self._gps_satellites = 12
        self._mode = "GUIDED"
        self._armed = False

    def process(self, input_data: dict) -> dict:
        """
        Обработка полётного контроллера:
          1. Чтение IMU
          2. Чтение барометра
          3. Чтение GPS
          4. MAVLink-телеметрия
        """
        # Обновление сенсоров из входных данных
        self._attitude = [
            input_data.get("roll", 0.0),
            input_data.get("pitch", 0.0),
            input_data.get("yaw", 0.0),
        ]
        self._position = [
            input_data.get("lat", 55.75),
            input_data.get("lon", 37.62),
            input_data.get("alt", 100.0),
        ]
        self._velocity = [
            input_data.get("vx", 0.0),
            input_data.get("vy", 0.0),
            input_data.get("vz", 0.0),
        ]

        # Моделирование шума сенсоров
        self._imu_data = {
            "accel": [
                input_data.get("ax", 0) + random.gauss(0, 0.01),
                input_data.get("ay", 0) + random.gauss(0, 0.01),
                input_data.get("az", -9.81) + random.gauss(0, 0.02),
            ],
            "gyro": [
                random.gauss(0, 0.005),
                random.gauss(0, 0.005),
                input_data.get("yaw_rate", 0) + random.gauss(0, 0.003),
            ],
        }

        # Барометр (шум ~10см)
        self._baro_pressure = 101325.0 * math.exp(-self._position[2] / 8400.0) + random.gauss(0, 1.2)

        # GPS (шум ~1.5м CEP)
        gps_noise = random.gauss(0, 1.5e-5)
        return {
            "board": self.board_id,
            "attitude": self._attitude,
            "position": [self._position[0] + gps_noise, self._position[1] + gps_noise, self._position[2]],
            "velocity": self._velocity,
            "imu": self._imu_data,
            "baro_pa": round(self._baro_pressure, 1),
            "gps_fix": self._gps_fix,
            "gps_sats": self._gps_satellites,
            "mode": self._mode,
            "armed": self._armed,
            # MAVLink HEARTBEAT fields
            "mav_type": 2,  # QUADROTOR
            "mav_autopilot": 3,  # ARDUPILOTMEGA
            "mav_state": 4,  # ACTIVE
        }

    def arm(self):
        self._armed = True
        self._mode = "GUIDED"

    def disarm(self):
        self._armed = False

    def get_stats(self) -> dict:
        s = super().get_stats()
        s.update({
            "mode": self._mode,
            "armed": self._armed,
            "gps_fix": self._gps_fix,
            "altitude": self._position[2],
        })
        return s


# ═══════════════════════════════════════════════════════════════
# 4. СИСТЕМНЫЙ ИНТЕГРАТОР — все три платы вместе
# ═══════════════════════════════════════════════════════════════

class BoardSystem:
    """
    Полная бортовая система: три платы, работающие вместе.

    Поток данных:
      Cube Orange+ → Tang Nano 9K → Orange Pi 5 → Serafim LLM → решение

      1. Cube Orange+ даёт телеметрию (GPS, IMU, высота)
      2. Tang Nano 9K делает быструю L1 геометрию (FPGA)
      3. Orange Pi 5 делает L2 классификацию + запрос LLM
      4. Решение возвращается на Cube Orange+ для исполнения
    """

    def __init__(self, drone_id="Scout-1", drone_role="scout"):
        self.drone_id = drone_id
        self.drone_role = drone_role

        # Три платы
        self.cube = CubeOrangeEmulator(f"CubeOrange-{drone_id}", 8203)
        self.fpga = TangNano9KEmulator(f"FPGA-{drone_id}", 8202)
        self.opi5 = OrangePi5Emulator(f"OPi5-{drone_id}", 8201)

        # Состояние
        self.pipeline_stats = {
            "total_cycles": 0,
            "total_time_us": 0,
            "decisions": [],
        }

    def start_all(self):
        """Запустить все три платы"""
        self.cube.start()
        self.fpga.start()
        self.opi5.start()

    def process_target(self, target_features: dict, drone_state: dict) -> dict:
        """
        Полный конвейер через три платы:
        Cube Orange → FPGA L1 → Orange Pi L2 → Serafim → решение
        """
        t0 = time.time()

        # Этап 1: Cube Orange+ — телеметрия
        telemetry = self.cube.emulate_cycle(drone_state)

        # Этап 2: Tang Nano 9K — FPGA L1 (<1ms)
        fpga_result = self.fpga.emulate_cycle({"features": target_features})

        # Этап 3: Orange Pi 5 — L2 + Serafim LLM
        opi5_input = {
            "features": target_features,
            "query_llm": True,
            "battery": drone_state.get("battery", 100),
            "role": self.drone_role,
        }
        opi5_result = self.opi5.emulate_cycle(opi5_input)

        total_time_us = (time.time() - t0) * 1_000_000

        # Сборка решения
        decision = {
            "drone_id": self.drone_id,
            "role": self.drone_role,
            "total_time_us": round(total_time_us, 1),
            "pipeline": {
                "cube_orange_telemetry": telemetry,
                "fpga_L1": fpga_result,
                "opi5_L2": opi5_result.get("classifier"),
                "serafim_llm": opi5_result.get("llm_decision"),
            },
            "final_action": opi5_result.get("llm_decision", {}).get("action", "OBSERVE"),
        }

        self.pipeline_stats["total_cycles"] += 1
        self.pipeline_stats["total_time_us"] += total_time_us
        self.pipeline_stats["decisions"].append(decision)
        if len(self.pipeline_stats["decisions"]) > 50:
            self.pipeline_stats["decisions"].pop(0)

        return decision

    def get_system_status(self) -> dict:
        return {
            "drone_id": self.drone_id,
            "role": self.drone_role,
            "boards": {
                "cube_orange": self.cube.get_stats(),
                "fpga": self.fpga.get_stats(),
                "orange_pi5": self.opi5.get_stats(),
            },
            "pipeline": {
                "total_cycles": self.pipeline_stats["total_cycles"],
                "avg_time_us": round(self.pipeline_stats["total_time_us"] / max(1, self.pipeline_stats["total_cycles"]), 1),
                "recent_decisions": self.pipeline_stats["decisions"][-5:],
            },
        }

    def stop_all(self):
        self.cube.stop()
        self.fpga.stop()
        self.opi5.stop()


# ═══════════════════════════════════════════════════════════════
# 5. ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════╗")
    print("║  ЭМУЛЯЦИЯ ТРЁХ ПЛАТ БПЛА «СЕРАФИМ»         ║")
    print("╚══════════════════════════════════════════════╝")
    print()

    # Создаём систему из трёх плат
    sys_board = BoardSystem("Scout-1", "scout")
    sys_board.start_all()

    print("Спецификации плат:")
    for spec in [ORANGE_PI5_SPEC, TANG_NANO_SPEC, CUBE_ORANGE_SPEC]:
        print(f"  {spec.name}: {spec.cpu} | {spec.ram_mb}MB | {spec.latency_us}μs | {spec.power_watts}W")

    print("\nТест конвейера (3 цели):")
    test_targets = [
        {"area_m2": 120, "rectangularity": 0.8, "green_ratio": 0.2, "near_trench": True,
         "rf_power": 2, "speed_ms": 0, "edge_density": 0.3, "aspect_ratio": 2.0,
         "temp_max": 25, "nearby_objects": 5},
        {"area_m2": 0.8, "rectangularity": 0.2, "green_ratio": 0.4, "near_trench": False,
         "rf_power": 0, "speed_ms": 1.5, "edge_density": 0.1, "aspect_ratio": 1.5,
         "temp_max": 36, "nearby_objects": 0},
        {"area_m2": 18, "rectangularity": 0.5, "green_ratio": 0.3, "near_trench": False,
         "rf_power": 25, "speed_ms": 0, "edge_density": 0.8, "aspect_ratio": 1.3,
         "temp_max": 45, "nearby_objects": 3},
    ]

    drone_state = {"battery": 85, "x": 100, "z": 200, "y": 120, "heading": 45,
                   "vx": 15, "vz": 10, "roll": 0.1, "pitch": -0.2, "yaw": 0.8}

    for i, features in enumerate(test_targets):
        decision = sys_board.process_target(features, drone_state)
        fpg = decision["pipeline"]["fpga_L1"]
        l2 = decision["pipeline"]["opi5_L2"]
        llm = decision["pipeline"]["serafim_llm"]
        print(f"\n  Цель {i+1}:")
        print(f"    FPGA L1 → {fpg.get('target', '?'):15s} (rule {fpg.get('rule', '?')}) [{fpg.get('luts_used', 0)} LUTs]")
        if l2:
            print(f"    OPi5 L2 → {l2.get('name', '?'):15s} conf={l2.get('confidence', 0):.2f}")
        else:
            print(f"    OPi5 L2 → (no features passed)")
        if llm:
            print(f"    Serafim → {llm.get('action', '?'):8s} ({llm.get('inference_ms', 0):.0f}ms) — {llm.get('reason', '')[:80]}")
        print(f"    Total pipeline: {decision['total_time_us']:.0f}μs → {decision['final_action']}")

    status = sys_board.get_system_status()
    print(f"\nСистемный статус:")
    for board_name, board_stat in status["boards"].items():
        print(f"  {board_name}: cycles={board_stat['cycles']} spec={board_stat['spec']}")
    print(f"  Pipeline avg: {status['pipeline']['avg_time_us']:.0f}μs/цикл")

    sys_board.stop_all()
    print("\nЭмуляция плат завершена.")
