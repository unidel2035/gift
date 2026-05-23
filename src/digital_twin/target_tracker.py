#!/usr/bin/env python3
"""
target_tracker.py — Удержание и сопровождение целей

Реализует:
  1. Kalman Filter — оценка положения/скорости цели
  2. SORT (Simple Online Realtime Tracking) — привязка детекций к трекам
  3. Track lifecycle: birth → active → lost → dead
  4. Motion prediction — куда двинется цель через N секунд
  5. Multi-target tracking — несколько целей одновременно
  6. Re-acquisition — перезахват потерянной цели
  7. Target lock quality — насколько надёжно держим цель

Принцип работы на дроне:
  YOLO обнаружение → Kalman prediction → Hungarian matching → track update
  Если цель потеряна → prediction продолжается N кадров → re-acquisition
"""

import numpy as np
from scipy.optimize import linear_sum_assignment
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from enum import Enum
import time


class TrackState(Enum):
    BIRTH = "birth"       # новый трек, ещё не подтверждён
    ACTIVE = "active"     # активное сопровождение
    LOST = "lost"         # временно потерян (prediction)
    DEAD = "dead"         # удалён


@dataclass
class KalmanState:
    """Состояние фильтра Калмана для одной цели"""
    # Вектор состояния: [x, y, z, vx, vy, vz, ax, ay, az]
    x: np.ndarray = field(default_factory=lambda: np.zeros(9))

    # Ковариационная матрица
    P: np.ndarray = field(default_factory=lambda: np.eye(9) * 100)

    # Матрица перехода (constant acceleration model)
    @staticmethod
    def F(dt: float) -> np.ndarray:
        F = np.eye(9)
        for i in range(3):
            F[i, i+3] = dt           # pos += vel * dt
            F[i, i+6] = 0.5 * dt**2  # pos += 0.5 * acc * dt^2
            F[i+3, i+6] = dt         # vel += acc * dt
        return F

    # Матрица наблюдения (видим только позицию)
    H: np.ndarray = field(default_factory=lambda: np.array([
        [1,0,0,0,0,0,0,0,0],
        [0,1,0,0,0,0,0,0,0],
        [0,0,1,0,0,0,0,0,0],
    ]))

    # Шум процесса (ускорение)
    Q: np.ndarray = field(default_factory=lambda: np.eye(9) * 0.1)

    # Шум измерения (позиция)
    R: np.ndarray = field(default_factory=lambda: np.eye(3) * 5.0)


class TargetTrack:
    """Один сопровождаемый трек цели"""

    def __init__(self, track_id: int, initial_pos: np.ndarray, target_class: str, confidence: float):
        self.id = track_id
        self.state = TrackState.BIRTH
        self.kf = KalmanState()
        self.kf.x[:3] = initial_pos  # начальная позиция

        # Метаданные
        self.target_class = target_class
        self.classification_history: List[str] = [target_class]
        self.confidence = confidence
        self.confidence_history: List[float] = [confidence]

        # Жизненный цикл
        self.age = 0                         # сколько кадров живёт
        self.hits = 1                        # успешных детекций
        self.misses = 0                      # пропущенных кадров
        self.birth_time = time.time()
        self.last_seen = time.time()

        # Для подтверждения трека
        self.hit_streak = 1                  # подряд успешных
        self.miss_streak = 0                 # подряд пропусков

        # Пороги
        self.min_hits_to_activate = 3        # кадра для активации
        self.max_misses_before_lost = 5      # кадров до потери
        self.max_misses_before_dead = 15     # кадров до удаления

        # Предсказанная позиция
        self.predicted_pos = initial_pos.copy()

        # Качество сопровождения (0..1)
        self.lock_quality = 0.3

        # История позиций для визуализации
        self.trajectory: List[np.ndarray] = [initial_pos.copy()]

    def predict(self, dt: float = 0.1):
        """Предсказать следующее положение (шаг Калмана)"""
        F = KalmanState.F(dt)
        self.kf.x = F @ self.kf.x
        self.kf.P = F @ self.kf.P @ F.T + self.kf.Q
        self.predicted_pos = self.kf.x[:3].copy()
        self.age += 1

    def update(self, measurement: np.ndarray):
        """Обновить трек измерением (коррекция Калмана)"""
        H = self.kf.H
        y = measurement - H @ self.kf.x  # невязка
        S = H @ self.kf.P @ H.T + self.kf.R  # ковариация невязки
        K = self.kf.P @ H.T @ np.linalg.inv(S)  # усиление Калмана

        self.kf.x = self.kf.x + K @ y
        self.kf.P = (np.eye(9) - K @ H) @ self.kf.P

        # Обновить качество
        innovation = np.linalg.norm(y)
        self.lock_quality = max(0.1, min(1.0, 1.0 / (1.0 + innovation / 10.0)))

        self.hits += 1
        self.hit_streak += 1
        self.miss_streak = 0
        self.last_seen = time.time()

        # Активация трека
        if self.state == TrackState.BIRTH and self.hit_streak >= self.min_hits_to_activate:
            self.state = TrackState.ACTIVE

        # Восстановление из LOST
        if self.state == TrackState.LOST:
            self.state = TrackState.ACTIVE

        self.trajectory.append(self.kf.x[:3].copy())
        if len(self.trajectory) > 100:
            self.trajectory.pop(0)

    def mark_missed(self):
        """Отметить пропуск детекции"""
        self.misses += 1
        self.miss_streak += 1
        self.hit_streak = 0

        if self.state == TrackState.ACTIVE and self.miss_streak >= self.max_misses_before_lost:
            self.state = TrackState.LOST
        elif self.state == TrackState.LOST and self.miss_streak >= self.max_misses_before_dead:
            self.state = TrackState.DEAD

        # Качество падает при потере
        self.lock_quality *= 0.7

    def predict_future(self, seconds_ahead: float) -> np.ndarray:
        """Предсказать позицию через N секунд"""
        F = KalmanState.F(seconds_ahead)
        future_state = F @ self.kf.x
        return future_state[:3]

    def get_state(self) -> dict:
        return {
            "id": self.id,
            "state": self.state.value,
            "class": self.target_class,
            "confidence": round(self.confidence, 3),
            "position": [round(x, 1) for x in self.kf.x[:3].tolist()],
            "velocity": [round(x, 1) for x in self.kf.x[3:6].tolist()],
            "lock_quality": round(self.lock_quality, 2),
            "age": self.age,
            "hits": self.hits,
            "misses": self.misses,
        }


class MultiTargetTracker:
    """
    SORT-подобный трекер нескольких целей.

    Каждый кадр:
      1. Predict — все треки предсказывают новое положение
      2. Match — Hungarian algorithm сопоставляет детекции с треками
      3. Update — сопоставленные треки обновляются
      4. Birth/Death — новые треки рождаются, мёртвые удаляются
    """

    def __init__(self, max_tracks=50, iou_threshold=0.3, distance_threshold=50.0):
        self.tracks: Dict[int, TargetTrack] = {}
        self.next_id = 0
        self.max_tracks = max_tracks
        self.iou_threshold = iou_threshold
        self.distance_threshold = distance_threshold  # метров
        self.dt = 0.1  # время между кадрами

        # Статистика
        self.total_detections = 0
        self.total_tracks_created = 0
        self.total_tracks_lost = 0
        self.total_tracks_killed = 0

    def update(self, detections: List[dict], dt: float = 0.1) -> List[TargetTrack]:
        """
        Один цикл трекинга.
        detections: [{"position": [x,y,z], "class": "...", "confidence": 0.9}, ...]
        Возвращает: список активных треков
        """
        self.dt = dt

        # 1. Predict все существующие треки
        for track in self.tracks.values():
            if track.state != TrackState.DEAD:
                track.predict(dt)

        # 2. Match детекции к трекам
        if detections:
            matches, unmatched_dets, unmatched_tracks = self._match(detections)

            # 3. Update сопоставленных
            for track_idx, det_idx in matches:
                track = list(self.tracks.values())[track_idx]
                det = detections[det_idx]
                track.update(np.array(det["position"]))
                track.target_class = det.get("class", track.target_class)
                track.confidence = det.get("confidence", track.confidence)
                track.classification_history.append(track.target_class)
                track.confidence_history.append(track.confidence)

            # 4. Birth — новые треки для несопоставленных детекций
            for det_idx in unmatched_dets:
                det = detections[det_idx]
                if len(self.tracks) < self.max_tracks:
                    track = TargetTrack(
                        self.next_id,
                        np.array(det["position"]),
                        det.get("class", "unknown"),
                        det.get("confidence", 0.5)
                    )
                    self.tracks[self.next_id] = track
                    self.next_id += 1
                    self.total_tracks_created += 1

            # 5. Mark missed
            for track_idx in unmatched_tracks:
                track = list(self.tracks.values())[track_idx]
                track.mark_missed()

        else:
            # Нет детекций — все треки помечаем как пропущенные
            for track in self.tracks.values():
                if track.state != TrackState.DEAD:
                    track.mark_missed()

        # 6. Cleanup dead tracks
        dead_ids = [tid for tid, t in self.tracks.items() if t.state == TrackState.DEAD]
        for tid in dead_ids:
            if self.tracks[tid].state == TrackState.LOST:
                self.total_tracks_lost += 1
            del self.tracks[tid]
            self.total_tracks_killed += 1

        return self.get_active_tracks()

    def _match(self, detections: List[dict]) -> Tuple[List[Tuple[int, int]], List[int], List[int]]:
        """
        Венгерский алгоритм для сопоставления детекций с треками.
        Возвращает: (matches, unmatched_detections, unmatched_tracks)
        """
        active_tracks = [(i, t) for i, t in enumerate(self.tracks.values())
                        if t.state in (TrackState.BIRTH, TrackState.ACTIVE, TrackState.LOST)]

        if not active_tracks:
            return [], list(range(len(detections))), []

        if not detections:
            return [], [], [i for i, _ in active_tracks]

        # Матрица стоимостей (Euclidean distance)
        cost_matrix = np.zeros((len(active_tracks), len(detections)))
        for i, (_, track) in enumerate(active_tracks):
            for j, det in enumerate(detections):
                det_pos = np.array(det["position"])
                dist = np.linalg.norm(track.predicted_pos - det_pos)
                # Штраф за несовпадение класса
                class_penalty = 5.0 if det.get("class") != track.target_class else 0
                cost_matrix[i, j] = dist + class_penalty

        # Венгерский алгоритм
        track_indices, det_indices = linear_sum_assignment(cost_matrix)

        matches = []
        unmatched_dets = set(range(len(detections)))
        unmatched_tracks = set(range(len(active_tracks)))

        for t_idx, d_idx in zip(track_indices, det_indices):
            if cost_matrix[t_idx, d_idx] < self.distance_threshold:
                matches.append((t_idx, d_idx))
                unmatched_dets.discard(d_idx)
                unmatched_tracks.discard(t_idx)

        return matches, list(unmatched_dets), list(unmatched_tracks)

    def get_active_tracks(self) -> List[TargetTrack]:
        return [t for t in self.tracks.values()
                if t.state in (TrackState.ACTIVE, TrackState.BIRTH, TrackState.LOST)]

    def get_best_lock(self) -> Optional[TargetTrack]:
        """Цель с наилучшим удержанием"""
        active = [t for t in self.tracks.values() if t.state == TrackState.ACTIVE]
        if not active:
            return None
        return max(active, key=lambda t: t.lock_quality * t.confidence)

    def get_status(self) -> dict:
        return {
            "active_tracks": sum(1 for t in self.tracks.values() if t.state == TrackState.ACTIVE),
            "lost_tracks": sum(1 for t in self.tracks.values() if t.state == TrackState.LOST),
            "total_tracks": len(self.tracks),
            "total_created": self.total_tracks_created,
            "total_lost": self.total_tracks_lost,
            "total_killed": self.total_tracks_killed,
            "tracks": [t.get_state() for t in self.get_active_tracks()],
        }


# ═══════════════════════════════════════════════════════════════
# ТЕСТ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import random
    print("═══ TARGET TRACKER TEST ═══")
    print()

    tracker = MultiTargetTracker(distance_threshold=30.0)

    # Симулируем 50 кадров с 2 целями
    true_targets = [
        {"pos": np.array([100.0, 50.0, 200.0]), "vel": np.array([2.0, 0.0, -1.0]), "class": "tank"},
        {"pos": np.array([300.0, 80.0, -100.0]), "vel": np.array([-1.5, 0.0, 1.5]), "class": "drone"},
    ]

    for frame in range(50):
        detections = []
        for t in true_targets:
            # Движение цели
            t["pos"] = t["pos"] + t["vel"] * 0.1
            # Добавляем шум измерения
            noisy_pos = t["pos"] + np.random.randn(3) * 3.0
            # Иногда теряем детекцию (10% шанс)
            if random.random() > 0.1:
                detections.append({
                    "position": noisy_pos.tolist(),
                    "class": t["class"],
                    "confidence": 0.7 + random.uniform(0, 0.3),
                })

        tracks = tracker.update(detections, dt=0.1)

        if frame % 5 == 0:
            print(f"Frame {frame}: {len(detections)} detections, {len(tracks)} active tracks")
            for t in tracker.get_active_tracks():
                s = t.get_state()
                pos = s["position"]
                vel = s["velocity"]
                print(f"  Track {s['id']}: {s['class']} ({s['state']}) "
                      f"pos=({pos[0]:.0f},{pos[1]:.0f},{pos[2]:.0f}) "
                      f"vel=({vel[0]:.1f},{vel[1]:.1f},{vel[2]:.1f}) "
                      f"lock={s['lock_quality']:.2f}")

    print()
    status = tracker.get_status()
    print(f"Final: {status['active_tracks']} active, {status['total_created']} created, "
          f"{status['total_lost']} lost, {status['total_killed']} killed")

    # Тест предсказания
    best = tracker.get_best_lock()
    if best:
        future = best.predict_future(2.0)
        print(f"\nBest lock ({best.lock_quality:.2f}): predicted position in 2s = "
              f"({future[0]:.0f}, {future[1]:.0f}, {future[2]:.0f})")
