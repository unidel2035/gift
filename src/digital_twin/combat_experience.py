#!/usr/bin/env python3
"""
combat_experience.py — Синтез боевого опыта в W-матрицу

Каждое боевое действие → акт дара → запись в W-матрицу.
Боевой опыт = накопленный вес даров между агентами.

Маппинг бой→дар:
  ОБНАРУЖЕНИЕ     → data    (разведчик→рой)     вес 1
  КЛАССИФИКАЦИЯ   → knowledge (OPi5→рой)        вес 2
  АТАКА (приказ)   → protection (командир→рой)   вес 3
  УНИЧТОЖЕНИЕ      → time     (FPV→рой)          вес 10 (время тяжелее)
  ВОЗВРАТ НА БАЗУ  → presence (дрон→база)        вес 5
  ПЕРЕДАЧА ДАННЫХ  → data     (дрон→дрон)        вес 1
  ПРИКРЫТИЕ        → protection (ПЕРЕ→РАЗВ)      вес 3
  РЕТРАНСЛЯЦИЯ     → data     (РЕТР→рой)         вес 2
  ПОТЕРЯ ДРОНА     → time     (дрон→рой)          вес 10 (жертва)
  ПОДАВЛЕНИЕ РЭБ   → knowledge (РЭБ→рой)         вес 4 (контр-РЭБ)

Рост матрицы:
  - Каждый бой добавляет нити между агентами
  - Веса необратимы (irreversible: true)
  - Время тяжелее данных (10 vs 1)
  - Матрица показывает кто кому сколько дал
"""

import time, json, math, os, random, urllib.request
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from collections import defaultdict

# ═══════════════════════════════════════════════════════════════
# КОНФИГУРАЦИЯ АКТОВ ДАРА В БОЮ
# ═══════════════════════════════════════════════════════════════

COMBAT_GIFT_TYPES = {
    "detection":     {"type": "data",       "weight": 1, "description": "Обнаружение цели"},
    "classification":{"type": "knowledge",  "weight": 2, "description": "Классификация цели"},
    "attack_order":  {"type": "protection", "weight": 3, "description": "Приказ на атаку"},
    "target_kill":   {"type": "time",       "weight": 10,"description": "Уничтожение цели"},
    "return_to_base":{"type": "presence",   "weight": 5, "description": "Возвращение на базу"},
    "data_relay":    {"type": "data",       "weight": 1, "description": "Передача данных"},
    "covering_fire": {"type": "protection", "weight": 3, "description": "Прикрытие"},
    "retranslation": {"type": "data",       "weight": 2, "description": "Ретрансляция сигнала"},
    "drone_lost":    {"type": "time",       "weight": 10,"description": "Потеря дрона (жертва)"},
    "ew_suppressed": {"type": "knowledge",  "weight": 4, "description": "Подавление РЭБ"},
    "swarm_consensus":{"type": "presence",  "weight": 2, "description": "Участие в соборе"},
    "battery_shared": {"type": "time",      "weight": 3, "description": "Деление зарядом"},
}

# ═══════════════════════════════════════════════════════════════
# СИНТЕЗАТОР БОЕВОГО ОПЫТА
# ═══════════════════════════════════════════════════════════════

@dataclass
class CombatGiftAct:
    """Акт дара в бою"""
    giver: str           # кто дал
    receiver: str        # кому
    gift_type: str       # тип дара (data/knowledge/protection/time/presence)
    weight: float
    description: str
    mission_id: str      # в какой миссии
    timestamp: float
    target: str = ""     # связанная цель
    drone_role: str = "" # роль дарителя
    metadata: dict = field(default_factory=dict)


class CombatExperienceSynthesizer:
    """
    Синтезатор боевого опыта.

    Собирает боевые действия → преобразует в акты дара → растит W-матрицу.
    """

    def __init__(self, anamnesis_url=None):
        self.acts: List[CombatGiftAct] = []
        self.mission_id = f"mission-{int(time.time())}"
        self.stats = defaultdict(lambda: {"given": 0, "received": 0, "acts": 0})
        self.matrix_snapshot = {}  # текущий срез матрицы

        # Анамнезис MCP URL
        self.anamnesis_url = anamnesis_url or os.environ.get(
            "ANAMNESIS_URL", "http://173.249.2.184:8086")

    def record_detection(self, scout_id, scout_role, target_type, target_pos):
        """Разведчик обнаружил цель → дар данных рою"""
        act = CombatGiftAct(
            giver=scout_id,
            receiver="_koinon",  # общий получатель = рой
            gift_type="data",
            weight=1,
            description=f"Обнаружение {target_type} на ({target_pos[0]:.0f},{target_pos[1]:.0f})",
            mission_id=self.mission_id,
            timestamp=time.time(),
            target=target_type,
            drone_role=scout_role,
            metadata={"target_pos": target_pos},
        )
        self.acts.append(act)
        self._update_stats(act)
        return act

    def record_classification(self, classifier_board, target_type, target_name, confidence):
        """OPi5 классифицировал цель → дар знания"""
        act = CombatGiftAct(
            giver=classifier_board,
            receiver="_koinon",
            gift_type="knowledge",
            weight=2,
            description=f"Классификация: {target_name} (conf={confidence:.0%})",
            mission_id=self.mission_id,
            timestamp=time.time(),
            target=target_type,
            metadata={"confidence": confidence, "classifier_name": target_name},
        )
        self.acts.append(act)
        self._update_stats(act)
        return act

    def record_attack_order(self, commander_id, target_type, consensus_votes):
        """Отдан приказ на атаку → дар защиты"""
        act = CombatGiftAct(
            giver=commander_id,
            receiver="_koinon",
            gift_type="protection",
            weight=3,
            description=f"Приказ на атаку {target_type} (собор: {consensus_votes})",
            mission_id=self.mission_id,
            timestamp=time.time(),
            target=target_type,
            metadata={"consensus": consensus_votes},
        )
        self.acts.append(act)
        self._update_stats(act)
        return act

    def record_kill(self, fpv_id, fpv_name, target_type, target_pos):
        """FPV уничтожил цель → дар времени (жертва батареи/времени полёта)"""
        act = CombatGiftAct(
            giver=fpv_id,
            receiver="_koinon",
            gift_type="time",
            weight=10,  # время тяжелее денег
            description=f"УНИЧТОЖЕНИЕ {target_type} — {fpv_name} отдал время полёта",
            mission_id=self.mission_id,
            timestamp=time.time(),
            target=target_type,
            drone_role="ФПВ",
            metadata={"fpv_name": fpv_name, "target_pos": target_pos},
        )
        self.acts.append(act)
        self._update_stats(act)
        return act

    def record_drone_lost(self, drone_id, drone_name, cause):
        """Дрон потерян → дар времени (высший дар — жизнь батареи)"""
        act = CombatGiftAct(
            giver=drone_id,
            receiver="_koinon",
            gift_type="time",
            weight=10,
            description=f"ПОТЕРЯ ДРОНА {drone_name}: {cause} — жертва принята",
            mission_id=self.mission_id,
            timestamp=time.time(),
            metadata={"drone_name": drone_name, "cause": cause},
        )
        self.acts.append(act)
        self._update_stats(act)
        return act

    def record_return_to_base(self, drone_id, drone_role, battery_pct):
        """Дрон вернулся на базу → дар присутствия"""
        act = CombatGiftAct(
            giver=drone_id,
            receiver="База",
            gift_type="presence",
            weight=5,
            description=f"Возвращение на базу (батарея: {battery_pct:.0f}%)",
            mission_id=self.mission_id,
            timestamp=time.time(),
            drone_role=drone_role,
            metadata={"battery": battery_pct},
        )
        self.acts.append(act)
        self._update_stats(act)
        return act

    def record_swarm_consensus(self, drone_id, vote, decision):
        """Участие в соборном голосовании → дар присутствия"""
        act = CombatGiftAct(
            giver=drone_id,
            receiver="_koinon",
            gift_type="presence",
            weight=2,
            description=f"Голос в соборе: {vote} (решение: {decision})",
            mission_id=self.mission_id,
            timestamp=time.time(),
            metadata={"vote": vote, "decision": decision},
        )
        self.acts.append(act)
        self._update_stats(act)
        return act

    def _update_stats(self, act: CombatGiftAct):
        """Обновить статистику агента"""
        self.stats[act.giver]["given"] += act.weight
        self.stats[act.giver]["acts"] += 1
        self.stats[act.receiver]["received"] += act.weight

    # ═══ ЗАПИСЬ В W-МАТРИЦУ ═══════════════════════════════════

    def flush_to_matrix(self):
        """
        Записать все накопленные акты в W-матрицу через анамнезис MCP.

        Каждый акт → anamnesis_add_gift(giverId, receiverId, type, content, amount)
        """
        results = []
        for act in self.acts:
            try:
                body = json.dumps({
                    "giverId": act.giver,
                    "receiverId": act.receiver,
                    "type": act.gift_type,
                    "content": act.description[:200],
                    "amount": act.weight,
                }).encode()
                req = urllib.request.Request(
                    f"{self.anamnesis_url}/anamnesis_add_gift",
                    body, {"Content-Type": "application/json"}
                )
                resp = urllib.request.urlopen(req, timeout=5)
                result = json.loads(resp.read())
                results.append({"act": act.description, "status": "recorded", "result": result})
            except Exception as e:
                results.append({"act": act.description, "status": "error", "error": str(e)[:100]})

        return results

    # ═══ АНАЛИТИКА ОПЫТА ═════════════════════════════════════

    def get_experience_summary(self) -> dict:
        """Сводка боевого опыта"""
        total_weight = sum(a.weight for a in self.acts)

        # По типам даров
        by_type = defaultdict(lambda: {"count": 0, "weight": 0})
        for a in self.acts:
            by_type[a.gift_type]["count"] += 1
            by_type[a.gift_type]["weight"] += a.weight

        # По дарителям
        top_givers = sorted(self.stats.items(),
                          key=lambda x: x[1]["given"], reverse=True)[:10]

        # По получателям
        receivers = defaultdict(float)
        for a in self.acts:
            receivers[a.receiver] += a.weight
        top_receivers = sorted(receivers.items(), key=lambda x: x[1], reverse=True)[:5]

        # Самые тяжёлые акты (время=10)
        heaviest = sorted(
            [a for a in self.acts if a.weight >= 10],
            key=lambda a: a.weight, reverse=True
        )[:10]

        return {
            "mission_id": self.mission_id,
            "total_acts": len(self.acts),
            "total_weight": round(total_weight, 1),
            "by_type": {k: dict(v) for k, v in by_type.items()},
            "top_givers": [{"agent": k, **v} for k, v in top_givers],
            "top_receivers": [{"agent": k, "weight": round(v, 1)} for k, v in top_receivers],
            "heaviest_acts": [{"giver": a.giver, "description": a.description, "weight": a.weight}
                            for a in heaviest],
            "matrix_energy": self._calculate_energy(),
        }

    def _calculate_energy(self):
        """Энергия сети = сумма всех весов минус потери"""
        total = sum(a.weight for a in self.acts)
        losses = sum(a.weight for a in self.acts if a.gift_type == "time" and "ПОТЕРЯ" in a.description)
        return round(total - losses * 0.5, 1)

    def predict_experience_growth(self, num_waves=10, targets_per_wave=15):
        """
        Предсказать рост матрицы за N волн.

        Каждая волна: 15 целей → ~15 обнаружений + ~15 классификаций
          + ~10 атак + ~3-5 возвратов на базу
        """
        acts_per_wave = targets_per_wave * 2  # обнаружение + классификация
        attack_acts = targets_per_wave * 0.7  # ~70% целей атакуются
        kill_acts = targets_per_wave * 0.5
        return_acts = 3  # ~3 возврата на базу за волну

        weight_per_wave = (
            acts_per_wave * 1 +      # detection: weight 1
            acts_per_wave * 2 +      # classification: weight 2
            attack_acts * 3 +         # attack_order: weight 3
            kill_acts * 10 +          # kill: weight 10
            return_acts * 5           # return: weight 5
        )

        return {
            "waves": num_waves,
            "predicted_acts": int((acts_per_wave * 2 + attack_acts + kill_acts + return_acts) * num_waves),
            "predicted_weight": round(weight_per_wave * num_waves, 1),
            "matrix_growth_pct": round(num_waves * 15, 1),  # ~15% роста за волну
        }


# ═══════════════════════════════════════════════════════════════
# ИНТЕГРАЦИЯ С ЦИФРОВЫМ ДВОЙНИКОМ
# ═══════════════════════════════════════════════════════════════

class CombatExperienceBridge:
    """
    Мост между боевой симуляцией и W-матрицей.

    Автоматически преобразует события боя в акты дара.
    Вызывается из главного цикла цифрового двойника.
    """

    def __init__(self, synthesizer: CombatExperienceSynthesizer):
        self.synth = synthesizer
        self.processed_event_ids = set()
        self.auto_flush_interval = 100  # запись в матрицу каждые 100 актов
        self.last_flush = 0

    def process_swarm_events(self, events: list, drones: list, targets: list):
        """Обработать события роя → акты дара"""
        new_acts = 0

        for i, event in enumerate(events):
            event_id = f"{event.get('ts', 0)}_{event.get('event', '')}_{i}"
            if event_id in self.processed_event_ids:
                continue
            self.processed_event_ids.add(event_id)

            evt = event.get("event", "")

            if evt == "DETECT":
                self.synth.record_detection(
                    scout_id=event.get("drone", "Scout-1"),
                    scout_role="РАЗВ",
                    target_type=event.get("target", "unknown"),
                    target_pos=(event.get("x", 0), event.get("z", 0)),
                )
                new_acts += 1

            elif evt == "ATTACK_ORDER":
                self.synth.record_attack_order(
                    commander_id="Scout-1",
                    target_type=event.get("target", "unknown"),
                    consensus_votes=event.get("votes", {}),
                )
                new_acts += 1

            elif evt == "TARGET_KILLED":
                self.synth.record_kill(
                    fpv_id=event.get("by", "FPV-1"),
                    fpv_name=event.get("by", "FPV-1"),
                    target_type=event.get("target", "unknown"),
                    target_pos=(0, 0),
                )
                new_acts += 1

            elif evt == "DRONE_KILLED":
                self.synth.record_drone_lost(
                    drone_id=event.get("drone", "unknown"),
                    drone_name=event.get("drone", "unknown"),
                    cause=event.get("by", "unknown"),
                )
                new_acts += 1

            elif evt == "CONSENSUS":
                for drone_id, vote in event.get("votes", {}).items():
                    self.synth.record_swarm_consensus(
                        drone_id=drone_id,
                        vote=vote,
                        decision=event.get("decision", "OBSERVE"),
                    )
                    new_acts += 1

        # Автозапись в матрицу
        if len(self.synth.acts) - self.last_flush >= self.auto_flush_interval:
            self.synth.flush_to_matrix()
            self.last_flush = len(self.synth.acts)

        return new_acts

    def get_mission_report(self) -> dict:
        """Отчёт о миссии для записи в матрицу"""
        summary = self.synth.get_experience_summary()
        growth = self.synth.predict_experience_growth()

        return {
            "mission_summary": summary,
            "growth_forecast": growth,
            "matrix_ready": True,
            "anamnesis_url": self.synth.anamnesis_url,
        }


# ═══════════════════════════════════════════════════════════════
# ТЕСТ + ДЕМОНСТРАЦИЯ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════════╗")
    print("║  СИНТЕЗ БОЕВОГО ОПЫТА → W-МАТРИЦА                  ║")
    print("╚══════════════════════════════════════════════════════╝")
    print()

    synth = CombatExperienceSynthesizer()

    # Симулируем одну волну боя (6 целей)
    print("─── БОЕВАЯ ВОЛНА ───")
    print()

    # Scout обнаруживает цели
    for target in ["strongpoint", "bunker", "ew_station", "vehicle", "artillery", "mlrs"]:
        act = synth.record_detection("S1-Ворон", "РАЗВ", target, (random.uniform(-500,500), random.uniform(-500,500)))
        print(f"  👁 {act.description} [вес {act.weight}] → {act.giver}→{act.receiver}")

    print()

    # OPi5 классифицирует
    for target, name, conf in [("strongpoint","ОПОРНИК",0.95), ("bunker","БЛИНДАЖ",0.80),
                               ("ew_station","РЭБ",0.99), ("vehicle","ТЕХНИКА",0.85),
                               ("artillery","АРТИЛЛЕРИЯ",0.92), ("mlrs","РСЗО",0.88)]:
        act = synth.record_classification("OPi5-1", target, name, conf)
        print(f"  🔬 {act.description} [вес {act.weight}]")

    print()

    # Соборное голосование
    for drone, vote in [("S1-Ворон","ATTACK"), ("S2-Сова","ATTACK"), ("S3-Сокол","OBSERVE")]:
        act = synth.record_swarm_consensus(drone, vote, "ATTACK")
        print(f"  🗳 {act.description} [вес {act.weight}]")

    print()

    # Атака
    act = synth.record_attack_order("S1-Ворон", "ew_station", {"S1":"ATTACK","S2":"ATTACK","S3":"OBSERVE"})
    print(f"  ⚔ {act.description} [вес {act.weight}]")

    print()

    # Уничтожение целей
    for fpv_name, target in [("F1-Пчела","ew_station"), ("F2-Волк","vehicle"),
                              ("F3-Ласка","artillery"), ("F4-Барс","mlrs")]:
        act = synth.record_kill(fpv_name.split("-")[0], fpv_name, target, (0,0))
        print(f"  💥 {act.description} [вес {act.weight}]")

    print()

    # Потеря дрона от ПВО
    act = synth.record_drone_lost("P1-Ястреб", "Ястреб", "ПВО-1 (ЗРК)")
    print(f"  💀 {act.description} [вес {act.weight}]")

    print()

    # Возврат на базу
    for drone_id, battery in [("F1-Пчела", 12), ("F3-Ласка", 8)]:
        act = synth.record_return_to_base(drone_id, "ФПВ", battery)
        print(f"  🏠 {act.description} [вес {act.weight}]")

    # ═══ ИТОГИ ═══════════════════════════════════════════════
    print()
    print("═══ ИТОГИ БОЕВОГО ОПЫТА ═══")
    summary = synth.get_experience_summary()
    print(f"  Актов: {summary['total_acts']}")
    print(f"  Общий вес: {summary['total_weight']}")
    print(f"  Энергия сети: {summary['matrix_energy']}")
    print()
    print("  По типам даров:")
    for gift_type, stats in summary['by_type'].items():
        print(f"    {gift_type:12s}: {stats['count']:3d} актов, вес {stats['weight']:.0f}")
    print()
    print("  Топ-дарители:")
    for g in summary['top_givers'][:5]:
        print(f"    {g['agent']:15s}: дал {g['given']:.0f} ({g['acts']} актов)")
    print()
    print("  Самые тяжёлые акты:")
    for h in summary['heaviest_acts'][:5]:
        print(f"    {h['giver']:10s}: {h['description'][:60]} [вес {h['weight']}]")

    # Прогноз
    print()
    print("═══ ПРОГНОЗ РОСТА МАТРИЦЫ ═══")
    growth = synth.predict_experience_growth(num_waves=10)
    print(f"  Волн: {growth['waves']}")
    print(f"  Ожидаемый вес: {growth['predicted_weight']:.0f}")
    print(f"  Рост матрицы: +{growth['matrix_growth_pct']:.0f}%")
    print(f"  Предсказано актов: {growth['predicted_acts']}")

    print()
    print("Боевой опыт синтезирован. Матрица W растёт с каждым боем.")
