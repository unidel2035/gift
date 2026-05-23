#!/usr/bin/env python3
"""
swarm_hal.py — Hardware Abstraction Layer для ИИ-роя

Концепция: «вставил чип — полетело».

Авто-обнаружение железа:
  - Nvidia CUDA (Jetson, RTX — если доступны)
  - Intel SYCL (Arc GPU)
  - Rockchip NPU (Orange Pi, RK3588)
  - Hailo NPU (M.2 ускоритель)
  - AMD ROCm (Radeon RX)
  - Apple MLX (M-series)
  - CPU-only (всегда работает)

Модели распределяются по устройствам автоматически:
  YOLO     → NPU (Rockchip/Hailo) или GPU
  Serafim  → CPU/GPU/NPU (где быстрее)
  Thinker  → GPU/CPU (самое мощное)
  CoderV2  → GPU/CPU (самое мощное)

Использование:
  hal = SwarmHAL()
  hal.detect()                 # авто-обнаружение
  devices = hal.list_devices() # что доступно
  ctx = hal.allocate("yolo")   # выделить устройство под задачу
"""

import os, time, json
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from enum import Enum

# ═══════════════════════════════════════════════════════════════
# ТИПЫ УСТРОЙСТВ
# ═══════════════════════════════════════════════════════════════

class DeviceType(Enum):
    CUDA = "cuda"           # Nvidia (Jetson, RTX)
    SYCL = "sycl"           # Intel Arc / XPU
    ROCM = "rocm"           # AMD Radeon
    NPU_ROCKCHIP = "rknpu"  # Rockchip RK3588
    NPU_HAILO = "hailo"     # Hailo-8/8L
    MLX = "mlx"             # Apple Silicon
    CPU = "cpu"             # Всегда работает


class Precision(Enum):
    FP16 = "fp16"
    Q8 = "q8"
    Q4 = "q4"
    INT8 = "int8"  # Для NPU


@dataclass
class ComputeDevice:
    """Одно вычислительное устройство."""
    name: str
    type: DeviceType
    memory_mb: int           # Доступная память
    compute_units: int       # Ядра/NPU-блоки
    ops_per_sec: float       # Ориентировочная производительность (GFLOPS)
    available: bool = True
    details: dict = field(default_factory=dict)


@dataclass
class ModelAllocation:
    """Выделение модели на устройство."""
    model_name: str
    device: ComputeDevice
    backend: str            # "llama.cpp", "rknn", "hailort", "mlx", "onnx"
    expected_latency_ms: float


# ═══════════════════════════════════════════════════════════════
# ДЕТЕКТОР ЖЕЛЕЗА
# ═══════════════════════════════════════════════════════════════

class HardwareDetector:
    """Обнаружение доступных вычислителей."""

    @staticmethod
    def detect_cuda() -> Optional[ComputeDevice]:
        try:
            import subprocess
            r = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total",
                               "--format=csv,noheader"],
                              capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                name, mem_str = r.stdout.strip().split(", ")
                mem_mb = int(mem_str.replace(" MiB", ""))
                return ComputeDevice(
                    name=f"Nvidia {name.strip()}",
                    type=DeviceType.CUDA,
                    memory_mb=mem_mb,
                    compute_units=0,  # определяется позже
                    ops_per_sec=float(mem_mb) * 50,  # ~50 GFLOPS/GB
                    details={"cuda_available": True},
                )
        except:
            pass
        return None

    @staticmethod
    def detect_intel_sycl() -> Optional[ComputeDevice]:
        try:
            import subprocess
            r = subprocess.run(["xpu-smi", "discovery", "-j"],
                              capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                info = json.loads(r.stdout)
                device_list = info.get("device_list", [])
                if device_list:
                    d = device_list[0]
                    mem_mb = d.get("memory_physical_size_byte", 0) // (1024*1024)
                    return ComputeDevice(
                        name=f"Intel {d.get('device_name', 'Arc')}",
                        type=DeviceType.SYCL,
                        memory_mb=mem_mb,
                        compute_units=d.get("number_of_eus", 0),
                        ops_per_sec=float(mem_mb) * 40,
                        details={"sycl_available": True},
                    )
        except:
            pass

        # Fallback: проверка через OpenCL
        try:
            import subprocess
            r = subprocess.run(["clinfo"], capture_output=True, text=True, timeout=5)
            if "Intel" in r.stdout and "Global memory size" in r.stdout:
                for line in r.stdout.split("\n"):
                    if "Global memory size" in line:
                        mem_bytes = int(line.split()[-1])
                        mem_mb = mem_bytes // (1024*1024)
                        return ComputeDevice(
                            name="Intel GPU (OpenCL)",
                            type=DeviceType.SYCL,
                            memory_mb=mem_mb,
                            compute_units=0,
                            ops_per_sec=float(mem_mb) * 30,
                        )
        except:
            pass
        return None

    @staticmethod
    def detect_rockchip_npu() -> Optional[ComputeDevice]:
        """Обнаружение Rockchip NPU (RK3588/RK3588S)."""
        try:
            # Проверка устройства
            if os.path.exists("/dev/rknpu") or os.path.exists("/sys/class/rknpu"):
                return ComputeDevice(
                    name="Rockchip NPU (RK3588)",
                    type=DeviceType.NPU_ROCKCHIP,
                    memory_mb=4096,  # Разделяемая с CPU, оценка
                    compute_units=3,  # 3 NPU-ядра
                    ops_per_sec=6_000,  # 6 TOPS
                    details={"soc": "RK3588", "tops": 6},
                )
        except:
            pass

        # Проверка через /proc
        try:
            with open("/proc/cpuinfo") as f:
                if "RK3588" in f.read():
                    return ComputeDevice(
                        name="Rockchip NPU (RK3588)",
                        type=DeviceType.NPU_ROCKCHIP,
                        memory_mb=4096,
                        compute_units=3,
                        ops_per_sec=6_000,
                    )
        except:
            pass
        return None

    @staticmethod
    def detect_hailo_npu() -> Optional[ComputeDevice]:
        """Обнаружение Hailo-8/8L NPU."""
        try:
            import subprocess
            r = subprocess.run(["hailortcli", "fw-control", "identify"],
                              capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                # Определяем Hailo-8 (26 TOPS) или Hailo-8L (13 TOPS)
                tops = 26 if "HAILO8" in r.stdout.upper() else 13
                return ComputeDevice(
                    name=f"Hailo-{'8' if tops > 20 else '8L'} NPU",
                    type=DeviceType.NPU_HAILO,
                    memory_mb=1024 if tops < 20 else 2048,
                    compute_units=1,
                    ops_per_sec=tops * 1_000,
                    details={"tops": tops},
                )
        except:
            pass
        return None

    @staticmethod
    def detect_amd_rocm() -> Optional[ComputeDevice]:
        try:
            import subprocess
            r = subprocess.run(["rocm-smi", "--showmeminfo", "vram"],
                              capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                for line in r.stdout.split("\n"):
                    if "VRAM" in line and "Total" in line:
                        mem_mb = int(line.split()[-2])
                        return ComputeDevice(
                            name="AMD Radeon (ROCm)",
                            type=DeviceType.ROCM,
                            memory_mb=mem_mb,
                            compute_units=0,
                            ops_per_sec=float(mem_mb) * 45,
                            details={"rocm_available": True},
                        )
        except:
            pass
        return None

    @staticmethod
    def detect_apple_mlx() -> Optional[ComputeDevice]:
        try:
            import platform
            if platform.processor() == "arm" or "Apple" in platform.version():
                import subprocess
                r = subprocess.run(["sysctl", "-n", "hw.memsize"],
                                  capture_output=True, text=True, timeout=3)
                if r.returncode == 0:
                    total_mem = int(r.stdout.strip()) // (1024*1024)
                    return ComputeDevice(
                        name="Apple Silicon (M-series)",
                        type=DeviceType.MLX,
                        memory_mb=total_mem,  # Unified memory
                        compute_units=0,
                        ops_per_sec=10_000,
                        details={"unified_memory": True},
                    )
        except:
            pass
        return None

    @staticmethod
    def detect_cpu() -> ComputeDevice:
        """CPU есть всегда."""
        import os
        cores = os.cpu_count() or 4
        # Оценка RAM
        try:
            with open("/proc/meminfo") as f:
                for line in f:
                    if "MemTotal" in line:
                        mem_mb = int(line.split()[1]) // 1024
                        break
                else:
                    mem_mb = 8192
        except:
            mem_mb = 8192

        return ComputeDevice(
            name=f"CPU ({cores} cores, {mem_mb}MB)",
            type=DeviceType.CPU,
            memory_mb=mem_mb,
            compute_units=cores,
            ops_per_sec=float(cores) * 10,
            details={"cores": cores, "avx2": True},
        )


# ═══════════════════════════════════════════════════════════════
# HAL — распределитель моделей по железу
# ═══════════════════════════════════════════════════════════════

class SwarmHAL:
    """
    Hardware Abstraction Layer.

    Автоматически находит всё доступное железо и распределяет
    модели по оптимальным устройствам.
    """

    def __init__(self):
        self.devices: List[ComputeDevice] = []
        self.allocations: Dict[str, ModelAllocation] = {}
        self.detector = HardwareDetector()

    def detect(self) -> List[ComputeDevice]:
        """Обнаружить всё доступное железо."""
        detectors = [
            ("Nvidia CUDA", self.detector.detect_cuda),
            ("Intel Arc/SYCL", self.detector.detect_intel_sycl),
            ("AMD ROCm", self.detector.detect_amd_rocm),
            ("Apple MLX", self.detector.detect_apple_mlx),
            ("Rockchip NPU", self.detector.detect_rockchip_npu),
            ("Hailo NPU", self.detector.detect_hailo_npu),
        ]

        self.devices = []
        for name, fn in detectors:
            try:
                dev = fn()
                if dev:
                    self.devices.append(dev)
            except:
                pass

        # CPU всегда в конце
        self.devices.append(self.detector.detect_cpu())

        return self.devices

    def list_devices(self) -> List[dict]:
        """Список устройств для отображения."""
        return [{
            "name": d.name,
            "type": d.type.value,
            "memory_mb": d.memory_mb,
            "ops_per_sec_gflops": d.ops_per_sec,
            "available": d.available,
        } for d in self.devices]

    def allocate(self, model_name: str) -> ModelAllocation:
        """
        Выделить устройство под модель.

        Правила приоритета:
          YOLO (обнаружение)  → NPU > GPU > CPU (маленькая, быстрая)
          Serafim (тактика)   → NPU > CPU > GPU (1.6GB, низкая задержка)
          Thinker (стратегия) → GPU > CPU (тяжёлая, допускает задержку)
          CoderV2 (инструм.)  → GPU > CPU (тяжёлая, допускает задержку)
        """
        # Оценка требований модели
        requirements = {
            "yolo":      {"memory_mb": 500,  "priority": "latency"},
            "serafim":   {"memory_mb": 1600, "priority": "latency"},
            "thinker":   {"memory_mb": 5000, "priority": "throughput"},
            "coderv2":   {"memory_mb": 5000, "priority": "throughput"},
            "serafim-q4": {"memory_mb": 500, "priority": "latency"},
            "thinker-q4": {"memory_mb": 2500, "priority": "throughput"},
        }
        req = requirements.get(model_name, {"memory_mb": 2000, "priority": "throughput"})

        # Фильтр: достаточно памяти
        candidates = [d for d in self.devices
                      if d.memory_mb >= req["memory_mb"] * 0.8]

        if not candidates:
            # CPU всегда候选人
            cpu = [d for d in self.devices if d.type == DeviceType.CPU][0]
            candidates = [cpu]

        # Сортировка по приоритету
        if req["priority"] == "latency":
            # Для быстрых моделей: NPU > GPU > CPU
            order = {DeviceType.NPU_ROCKCHIP: 0, DeviceType.NPU_HAILO: 0,
                     DeviceType.MLX: 1, DeviceType.CUDA: 1,
                     DeviceType.SYCL: 2, DeviceType.ROCM: 2,
                     DeviceType.CPU: 3}
        else:
            # Для тяжёлых моделей: GPU > CPU
            order = {DeviceType.CUDA: 0, DeviceType.SYCL: 0,
                     DeviceType.ROCM: 0, DeviceType.MLX: 0,
                     DeviceType.NPU_ROCKCHIP: 2, DeviceType.NPU_HAILO: 2,
                     DeviceType.CPU: 1}

        best = sorted(candidates, key=lambda d: order.get(d.type, 9))[0]

        # Определить бэкенд
        backend_map = {
            DeviceType.CUDA: "llama.cpp-cuda",
            DeviceType.SYCL: "llama.cpp-sycl",
            DeviceType.ROCM: "llama.cpp-rocm",
            DeviceType.MLX: "mlx",
            DeviceType.NPU_ROCKCHIP: "rknn",
            DeviceType.NPU_HAILO: "hailort",
            DeviceType.CPU: "llama.cpp-cpu",
        }

        # Оценка задержки
        latency_estimates = {  # ms, на типичном устройстве
            "yolo":    {"NPU": 15, "GPU": 8, "CPU": 80},
            "serafim": {"NPU": 50, "GPU": 30, "CPU": 400},
            "thinker": {"NPU": 0, "GPU": 6000, "CPU": 45000},
            "coderv2": {"NPU": 0, "GPU": 2000, "CPU": 40000},
        }
        dev_type = "GPU" if best.type in (DeviceType.CUDA, DeviceType.SYCL, DeviceType.ROCM, DeviceType.MLX) else \
                   "NPU" if best.type in (DeviceType.NPU_ROCKCHIP, DeviceType.NPU_HAILO) else "CPU"
        lat = latency_estimates.get(model_name, {}).get(dev_type, 1000)

        allocation = ModelAllocation(
            model_name=model_name,
            device=best,
            backend=backend_map.get(best.type, "cpu"),
            expected_latency_ms=float(lat),
        )
        self.allocations[model_name] = allocation
        return allocation

    def allocate_all(self) -> Dict[str, ModelAllocation]:
        """Распределить все модели роя по доступному железу."""
        models = ["yolo", "serafim", "thinker", "coderv2"]
        for m in models:
            self.allocate(m)
        return self.allocations

    def status(self) -> dict:
        """Полный статус железа и распределения."""
        return {
            "devices": self.list_devices(),
            "allocations": {
                name: {
                    "device": a.device.name,
                    "backend": a.backend,
                    "latency_ms": a.expected_latency_ms,
                }
                for name, a in self.allocations.items()
            },
            "total_devices": len(self.devices),
            "can_fly": len(self.devices) > 1,  # больше чем просто CPU
        }


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  SWARM HAL — что видно на этом железе           ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    hal = SwarmHAL()
    devices = hal.detect()

    print(f"Найдено устройств: {len(devices)}")
    print()
    for i, dev in enumerate(devices):
        print(f"  [{i+1}] {dev.name}")
        print(f"      Тип: {dev.type.value} | Память: {dev.memory_mb}MB | ~{dev.ops_per_sec:.0f} GFLOPS")
        print()

    print("═══ РАСПРЕДЕЛЕНИЕ МОДЕЛЕЙ ═══")
    allocations = hal.allocate_all()
    for name, alloc in allocations.items():
        print(f"  {name:12s} → {alloc.device.name:25s} ({alloc.backend}) ~{alloc.expected_latency_ms:.0f}ms")

    print()
    print(f"Может лететь: {'✅' if hal.status()['can_fly'] else '⚠️ только CPU'}")
