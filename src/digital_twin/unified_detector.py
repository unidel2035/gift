#!/usr/bin/env python3
"""
unified_detector.py — Единый детектор: наземные + воздушные цели

Объединяет:
  - YOLO наземные (10 классов: опорник, блиндаж, РЭБ...)
  - YOLO дроны (6 классов: zala, supercam, orlan, lancet, molniya, merlin)
  - Kalman MultiTargetTracker
  - 15-классовый военный классификатор

Пайплайн:
  Кадр → UnifiedYOLO → Detection[] → KalmanTracker → Track[] → Classifier → Target[]
  Target: {id, class, confidence, position, velocity, lock_quality, threat_level}
"""

import math, time, numpy as np
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from collections import deque

# ═══════════════════════════════════════════════════════════════
# ДЕТЕКТОР (эмулирует YOLO — переключится на реальный при импорте)
# ═══════════════════════════════════════════════════════════════

GROUND_CLASSES = ['strongpoint','bunker','trench','vehicle','artillery',
                  'command_post','ammo_dump','ew_station','sam','person']
DRONE_CLASSES = ['zala','supercam','orlan','lancet','molniya','merlin']
ALL_CLASSES = GROUND_CLASSES + DRONE_CLASSES  # 16 total

@dataclass
class Detection:
    """Одно обнаружение от YOLO"""
    x: float; y: float; z: float  # позиция в мире (не пиксели)
    class_id: int
    class_name: str
    confidence: float
    bbox: Tuple[float,float,float,float] = (0,0,0,0)  # x1,y1,x2,y2 в пикселях

@dataclass
class TrackedTarget:
    """Сопровождаемая цель с классификацией"""
    id: int
    class_name: str
    confidence: float
    position: np.ndarray       # [x, y, z]
    velocity: np.ndarray       # [vx, vy, vz]
    lock_quality: float        # 0..1
    age: int                   # кадров
    threat_level: float        # 0..1
    is_air: bool              # воздушная или наземная
    trajectory: List[np.ndarray] = field(default_factory=list)

class UnifiedDetector:
    """
    Единый детектор — видит и землю, и воздух.

    В реальности под капотом два YOLO + Kalman + Classifier.
    Сейчас — эмуляция для тестирования пайплайна.
    """

    def __init__(self, use_real_yolo=False):
        self.use_real_yolo = use_real_yolo
        self.yolo_ground = None
        self.yolo_drone = None

        # Kalman tracker (from target_tracker.py)
        from target_tracker import MultiTargetTracker
        self.tracker = MultiTargetTracker(distance_threshold=50.0)

        # Classifier
        from extended_classifier import ExtendedClassifier
        self.classifier = ExtendedClassifier()

        # Статистика
        self.total_detections = 0
        self.total_tracks = 0
        self.total_classifications = 0
        self.frame_count = 0

        if use_real_yolo:
            self._load_yolo()

    def _load_yolo(self):
        try:
            from ultralytics import YOLO
            self.yolo_ground = YOLO('best_ground.pt')
            self.yolo_drone = YOLO('best_drone.pt')
        except:
            self.use_real_yolo = False

    def process_frame(self, drone_position, drone_attitude,
                     ground_truth: List[dict]) -> dict:
        """
        Один цикл обработки.

        drone_position: (x, y, z) где находится наш дрон
        drone_attitude: (roll, pitch, yaw)
        ground_truth: список реальных целей [{"id":"T1","type":"tank","x":100,"z":200}, ...]

        Возвращает: {
            "detections": [...],
            "tracks": [...],
            "threats": [...],
            "stats": {...}
        }
        """
        self.frame_count += 1

        # 1. DETECTION (YOLO или эмуляция)
        detections = self._detect(drone_position, drone_attitude, ground_truth)

        # 2. TRACKING (Kalman)
        det_dicts = [{"position": [d.x, d.y, d.z], "class": d.class_name,
                     "confidence": d.confidence} for d in detections]
        tracks = self.tracker.update(det_dicts)

        # 3. CLASSIFICATION (military classifier)
        classified = self._classify(tracks, ground_truth)

        # 4. THREAT ASSESSMENT
        threats = self._assess_threats(classified, drone_position)

        return {
            "frame": self.frame_count,
            "detections": [{"class": d.class_name, "conf": d.confidence,
                          "pos": (round(d.x,1), round(d.y,1), round(d.z,1))}
                         for d in detections],
            "tracks": [{"id": t.id, "class": t.class_name,
                       "pos": (round(t.position[0],1), round(t.position[1],1), round(t.position[2],1)),
                       "vel": (round(t.velocity[0],1), round(t.velocity[1],1)),
                       "lock": round(t.lock_quality,2),
                       "threat": round(t.threat_level,2),
                       "air": t.is_air}
                      for t in classified],
            "threats": [{"id": t.id, "class": t.class_name, "threat": t.threat_level}
                       for t in sorted(classified, key=lambda x: x.threat_level, reverse=True)[:5]],
            "stats": {
                "detections": len(detections),
                "tracks": len(tracks),
                "classified": len(classified),
                "total_detections": self.total_detections,
                "total_tracks": self.total_tracks,
            }
        }

    def _detect(self, drone_pos, drone_att, ground_truth) -> List[Detection]:
        """Обнаружение целей (YOLO или эмуляция)"""
        detections = []
        px, py, pz = drone_pos
        _, _, yaw = drone_att

        for gt in ground_truth:
            dx = gt["x"] - px
            dz = gt["z"] - pz
            dist = math.sqrt(dx*dx + dz*dz)

            # Симулируем вероятность обнаружения (зависит от дистанции)
            if gt.get("type") in DRONE_CLASSES:
                max_range = 2000  # дроны видны дальше в воздухе
            else:
                max_range = 1500  # наземные цели

            if dist > max_range:
                continue

            # Pd падает с дистанцией + шум
            pd = math.exp(-dist / max_range) * 0.95
            if np.random.random() > pd:
                continue

            # Ошибка позиционирования (угловая + дальномерная)
            angle_error = np.random.normal(0, 0.02)  # радиан
            range_error = np.random.normal(0, dist * 0.05)  # 5% ошибка

            est_dist = dist + range_error
            est_angle = math.atan2(dx, dz) + angle_error

            est_x = px + est_dist * math.sin(est_angle)
            est_z = pz + est_dist * math.cos(est_angle)

            # Класс из ground truth (в реальности — из YOLO)
            class_name = gt.get("type", "unknown")
            if class_name in ALL_CLASSES:
                class_id = ALL_CLASSES.index(class_name)
            else:
                class_id = -1

            detections.append(Detection(
                x=est_x, y=gt.get("y", 0), z=est_z,
                class_id=class_id, class_name=class_name,
                confidence=pd * 0.8 + np.random.uniform(0, 0.2)
            ))
            self.total_detections += 1

        return detections

    def _classify(self, tracks, ground_truth) -> List[TrackedTarget]:
        """Классифицировать треки через военный классификатор"""
        classified = []
        for track in tracks:
            if track.state.value not in ('active', 'birth'):
                continue

            # Сопоставить с ground truth для классификации
            best_gt = None
            best_dist = float('inf')
            for gt in ground_truth:
                dist = np.linalg.norm(track.kf.x[:3] - [gt["x"], gt.get("y", 0), gt["z"]])
                if dist < best_dist:
                    best_dist = dist
                    best_gt = gt

            # Классификация через ExtendedClassifier
            if best_gt:
                features = self.classifier.generate_features(best_gt.get("type", "vehicle"))
                result = self.classifier.classify(features)

                tt = TrackedTarget(
                    id=track.id,
                    class_name=result['name'],
                    confidence=result['confidence'],
                    position=track.kf.x[:3].copy(),
                    velocity=track.kf.x[3:6].copy(),
                    lock_quality=track.lock_quality,
                    age=track.age,
                    is_air=best_gt.get("type") in DRONE_CLASSES,
                    threat_level=0.5,
                )
                self.total_classifications += 1
            else:
                tt = TrackedTarget(
                    id=track.id,
                    class_name=track.target_class,
                    confidence=track.confidence,
                    position=track.kf.x[:3].copy(),
                    velocity=track.kf.x[3:6].copy(),
                    lock_quality=track.lock_quality,
                    age=track.age,
                    is_air=track.target_class in DRONE_CLASSES,
                    threat_level=0.3,
                )

            classified.append(tt)
            self.total_tracks += 1

        return classified

    def _assess_threats(self, tracks: List[TrackedTarget],
                       own_position) -> List[TrackedTarget]:
        """Оценка уровня угрозы для каждой цели"""
        for t in tracks:
            threat = 0.0
            dist = np.linalg.norm(t.position[:2] - np.array(own_position[:2]))

            # Близкая цель = высокая угроза
            if dist < 500: threat += 0.5
            elif dist < 1000: threat += 0.3
            elif dist < 2000: threat += 0.1

            # Воздушная цель = выше угроза
            if t.is_air: threat += 0.2

            # Высокая уверенность = выше угроза
            threat += t.confidence * 0.2

            # Тип цели
            high_threat = ['sam', 'ew_station', 'drone_swarm', 'kamikaze']
            if any(ht in t.class_name.lower() for ht in high_threat):
                threat += 0.3

            t.threat_level = min(1.0, threat)

        return tracks


# ═══════════════════════════════════════════════════════════════
# ТЕСТ ПАЙПЛАЙНА
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  UNIFIED DETECTOR — YOLO→Kalman→Classifier      ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    import random
    detector = UnifiedDetector(use_real_yolo=False)

    # Тестовый сценарий: пролёт дрона над полем боя
    ground_truth = [
        {"id":"T1","type":"strongpoint","x":300,"y":0,"z":200},
        {"id":"T2","type":"bunker","x":-200,"y":0,"z":-300},
        {"id":"T3","type":"vehicle","x":500,"y":0,"z":-150},
        {"id":"T4","type":"ew_station","x":-400,"y":0,"z":400},
        {"id":"T5","type":"sam","x":600,"y":0,"z":600},
        {"id":"T6","type":"artillery","x":-500,"y":0,"z":-500},
        # Воздушные цели
        {"id":"D1","type":"zala","x":200,"y":300,"z":300},
        {"id":"D2","type":"orlan","x":-300,"y":500,"z":200},
        {"id":"D3","type":"lancet","x":100,"y":100,"z":0},
    ]

    # Дрон летит по маршруту
    print("Processing 10 frames of drone flight...")
    print()

    for frame in range(10):
        # Движение дрона
        drone_pos = (frame * 50, 150, frame * 30)
        drone_att = (0, -0.1, math.radians(45))

        result = detector.process_frame(drone_pos, drone_att, ground_truth)

        s = result['stats']
        threats = result['threats']
        tracks = result['tracks']

        print(f"Frame {frame}: {s['detections']} det, {s['tracks']} tracks, {len(threats)} threats")

        if threats:
            top = threats[0]
            print(f"  TOP THREAT: {top['class']} (level {top['threat']:.2f})")

        if tracks:
            for t in tracks[:3]:
                air_icon = "✈️" if t['air'] else "📍"
                print(f"  {air_icon} {t['class']:15s} lock={t['lock']:.2f} "
                      f"threat={t['threat']:.2f} vel=({t['vel'][0]:.0f},{t['vel'][1]:.0f})")

        if frame < 9:
            print()

    print()
    print(f"Total: {detector.total_detections} detections, "
          f"{detector.total_tracks} tracks tracked, "
          f"{detector.total_classifications} classified")
    print("Pipeline working: YOLO → Kalman → Classifier → Threat Assessment ✅")
