#!/usr/bin/env python3
"""
mission_recorder.py — Запись и воспроизведение миссий

Сериализация полного состояния симуляции в JSON/msgpack.
Воспроизведение с контролем скорости. Экспорт для AAR.
"""

import json, time, gzip, os
from dataclasses import dataclass, field
from typing import List, Optional
from collections import deque


@dataclass
class MissionFrame:
    """Один кадр миссии"""
    timestamp: float
    time_sim: float
    drones: List[dict]
    targets: List[dict]
    events: List[dict]
    ew_jammers: List[dict]
    lora_stats: dict
    navigation: dict


class MissionRecorder:
    """Запись миссии в кольцевой буфер + сохранение на диск"""

    def __init__(self, max_frames=10000, auto_save_interval=60):
        self.frames: deque = deque(maxlen=max_frames)
        self.recording = False
        self.start_time = 0.0
        self.total_frames = 0
        self.auto_save_interval = auto_save_interval
        self.last_save = 0.0
        self.mission_id = ""
        self.save_dir = "/home/unidel/gift/data/missions"

    def start_recording(self, mission_id=None):
        """Начать запись"""
        self.recording = True
        self.start_time = time.time()
        self.total_frames = 0
        self.mission_id = mission_id or f"mission-{int(time.time())}"
        self.frames.clear()
        os.makedirs(self.save_dir, exist_ok=True)

    def stop_recording(self):
        """Остановить запись"""
        self.recording = False
        self.auto_save()

    def record_frame(self, sim_time, drones, targets, events,
                     ew_jammers=None, lora_stats=None, navigation=None):
        """Записать кадр"""
        if not self.recording:
            return

        # Глубокая копия данных (упрощённая — через json)
        frame = MissionFrame(
            timestamp=time.time(),
            time_sim=sim_time,
            drones=json.loads(json.dumps(drones, default=str)),
            targets=json.loads(json.dumps(targets, default=str)),
            events=events[-50:] if events else [],
            ew_jammers=ew_jammers or [],
            lora_stats=lora_stats or {},
            navigation=navigation or {},
        )
        self.frames.append(frame)
        self.total_frames += 1

        # Автосохранение
        if time.time() - self.last_save > self.auto_save_interval:
            self.auto_save()

    def auto_save(self):
        """Автоматически сохранить миссию на диск"""
        if len(self.frames) == 0:
            return

        # Конвертировать frames в список словарей
        data = {
            "mission_id": self.mission_id,
            "total_frames": self.total_frames,
            "duration_sim": self.frames[-1].time_sim if self.frames else 0,
            "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "frames": [
                {
                    "t": f.timestamp,
                    "ts": f.time_sim,
                    "drones": f.drones,
                    "targets": f.targets,
                    "events": f.events,
                    "ew": f.ew_jammers,
                    "lora": f.lora_stats,
                    "nav": f.navigation,
                }
                for f in self.frames
            ]
        }

        # Сохранить как сжатый JSON
        filepath = os.path.join(self.save_dir, f"{self.mission_id}.json.gz")
        with gzip.open(filepath, "wt", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, default=str)

        self.last_save = time.time()

    def get_recent_frames(self, n=10):
        """Последние n кадров"""
        return list(self.frames)[-n:]

    def get_frame_at(self, sim_time):
        """Найти кадр по симуляционному времени (бинарный поиск)"""
        frames_list = list(self.frames)
        if not frames_list:
            return None

        # Бинарный поиск
        lo, hi = 0, len(frames_list) - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            if frames_list[mid].time_sim < sim_time:
                lo = mid + 1
            elif frames_list[mid].time_sim > sim_time:
                hi = mid - 1
            else:
                return frames_list[mid]
        return frames_list[min(lo, len(frames_list)-1)] if frames_list else None


class MissionPlayer:
    """Воспроизведение записанной миссии"""

    def __init__(self, recorder: MissionRecorder):
        self.recorder = recorder
        self.playing = False
        self.play_speed = 1.0
        self.play_time = 0.0
        self._playback_frames = []
        self._frame_idx = 0

    def load_mission(self, mission_id):
        """Загрузить миссию с диска"""
        filepath = os.path.join(self.recorder.save_dir, f"{mission_id}.json.gz")
        if not os.path.exists(filepath):
            return False

        with gzip.open(filepath, "rt", encoding="utf-8") as f:
            data = json.load(f)

        self._playback_frames = data["frames"]
        self._frame_idx = 0
        self.play_time = 0.0
        return True

    def start_playback(self, speed=1.0):
        self.playing = True
        self.play_speed = speed
        self._frame_idx = 0

    def stop_playback(self):
        self.playing = False

    def get_frame(self, dt):
        """Получить следующий кадр при воспроизведении"""
        if not self.playing or not self._playback_frames:
            return None

        self.play_time += dt * self.play_speed

        # Найти кадр, ближайший к play_time
        while self._frame_idx < len(self._playback_frames) - 1:
            next_frame = self._playback_frames[self._frame_idx + 1]
            if next_frame["ts"] <= self.play_time:
                self._frame_idx += 1
            else:
                break

        frame = self._playback_frames[self._frame_idx]
        return frame

    def seek(self, sim_time):
        """Перемотка на заданное время"""
        self.play_time = sim_time
        # Найти ближайший кадр
        closest_idx = 0
        min_diff = float('inf')
        for i, f in enumerate(self._playback_frames):
            diff = abs(f["ts"] - sim_time)
            if diff < min_diff:
                min_diff = diff
                closest_idx = i
        self._frame_idx = closest_idx

    def get_timeline(self):
        """Получить временную шкалу миссии для UI"""
        if not self._playback_frames:
            return None
        return {
            "duration": self._playback_frames[-1]["ts"],
            "total_frames": len(self._playback_frames),
            "key_events": self._extract_key_events(),
        }

    def _extract_key_events(self):
        """Извлечь ключевые события из кадров"""
        key_events = []
        for f in self._playback_frames:
            for e in f.get("events", []):
                if e.get("event") in ("DETECT", "ATTACK_ORDER", "TARGET_KILLED", "NEW_WAVE"):
                    key_events.append({
                        "time": f["ts"],
                        "event": e["event"],
                        "target": e.get("target", ""),
                        "llm_action": e.get("llm_action", ""),
                    })
        return key_events


# ═══════════════════════════════════════════════════════════════
# Глобальный записыватель (синглтон)
# ═══════════════════════════════════════════════════════════════

_mission_recorder = MissionRecorder()
_mission_player = MissionPlayer(_mission_recorder)


def start_mission(mission_id=None):
    _mission_recorder.start_recording(mission_id)


def stop_mission():
    _mission_recorder.stop_recording()


def record_frame(*args, **kwargs):
    _mission_recorder.record_frame(*args, **kwargs)


def get_player():
    return _mission_player


def get_recorder():
    return _mission_recorder


# ═══════════════════════════════════════════════════════════════
# Тест
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("═══ Mission Recorder Test ═══")

    rec = MissionRecorder(max_frames=100)
    rec.start_recording("test-mission")

    # Симулируем запись
    for i in range(50):
        rec.record_frame(
            sim_time=i * 0.1,
            drones=[{"id": "Scout-1", "x": i, "z": i*2, "y": 100, "battery": 100-i*0.5}],
            targets=[{"id": 0, "type": "bunker", "x": 500, "z": 300, "detected": i > 20}],
            events=[{"ts": i*0.1, "event": "TEST"}] if i % 10 == 0 else [],
        )

    rec.stop_recording()
    print(f"Recorded: {rec.total_frames} frames")
    print(f"Mission ID: {rec.mission_id}")

    # Воспроизведение
    player = MissionPlayer(rec)
    if player.load_mission(rec.mission_id):
        player.start_playback(speed=2.0)
        for _ in range(5):
            frame = player.get_frame(0.5)
            if frame:
                print(f"  Playback t={frame['ts']:.1f}s drone_x={frame['drones'][0]['x']}")
        player.stop_playback()

    print("Mission recorder OK")
