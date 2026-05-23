#!/usr/bin/env python3
"""
gift_navigation.py — Навигация как экономика дара

Богословское основание:
  Дар можно не принять. Свобода получателя — онтологическое свойство дара.

  GPS-сигнал       — дар спутника (gratia gratis data). Можно принять или отвергнуть.
  UWB-дальность    — дар друга-дрона. Друг может быть скомпрометирован → отвергнуть.
  Звёздный свет    — дар неба. Нельзя подделать врагом. Всегда принимается.
  Инерция (IMU)    — не дар. Собственное движение. Базис, не требующий доверия.

Технически:
  Каждый источник навигации = предложение дара.
  Получатель оценивает: подлинный ли дар? Согласуется ли с другими?
  Если дар отвергнут — источник считается скомпрометированным.

  Это защита от спуфинга, построенная не на криптографии,
  а на онтологии дара: свобода не принять = безопасность.
"""

import math, random, time
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional
from enum import Enum


class GiftDecision(Enum):
    ACCEPTED = "accepted"       # дар принят — навигационная поправка применена
    REJECTED = "rejected"       # дар отвергнут — источник под подозрением
    UNCERTAIN = "uncertain"     # неопределённость — ждём ещё данных
    CORRUPTED = "corrupted"     # дар испорчен (спуфинг/помеха) — источник враждебен


@dataclass
class NavigationGift:
    """Предложение навигационного дара от источника"""
    source_id: str              # кто даёт (GPS-15, Scout-1, Сириус)
    source_type: str            # тип источника (satellite, drone, star, ground)
    gift_vector: Tuple[float, float, float]  # (x, y, z) — предлагаемая позиция
    confidence: float           # уверенность источника в своём даре (0..1)
    timestamp: float
    # Метаданные для верификации
    signal_strength_db: float = 0    # мощность сигнала
    frequency_hz: float = 0         # частота
    expected_delay_ms: float = 0    # ожидаемая задержка
    actual_delay_ms: float = 0      # реальная задержка
    checksum_valid: bool = True     # контрольная сумма
    crypto_signed: bool = False     # криптоподпись
    # История
    previous_gifts_from_source: int = 0  # сколько даров принято от этого источника ранее


class GiftNavigationEngine:
    """
    Навигационный движок на основе экономики дара.

    Принцип работы:
      1. Собрать предложения даров от всех источников
      2. Каждый дар проверить на подлинность (консистентность, история, сигнатура)
      3. Принять или отвергнуть каждый дар
      4. Слить принятые дары в навигационное решение
      5. Отвергнутые источники пометить как подозрительные
    """

    def __init__(self, drone_id: str):
        self.drone_id = drone_id
        # Текущая позиция (наилучшая оценка)
        self.position = [0.0, 0.0, 0.0]
        self.velocity = [0.0, 0.0, 0.0]
        self.attitude = [0.0, 0.0, 0.0]

        # История даров
        self.gift_history: List[NavigationGift] = []
        self.accepted_count: Dict[str, int] = {}      # по источникам
        self.rejected_count: Dict[str, int] = {}
        self.source_trust: Dict[str, float] = {}        # уровень доверия к источнику (0..1)

        # Подозрительные источники
        self.suspicious_sources: Dict[str, str] = {}   # source_id → причина

        # Статистика
        self.total_gifts_offered = 0
        self.total_gifts_accepted = 0
        self.total_gifts_rejected = 0
        self.spoofing_attempts_detected = 0

        # Навигационная неопределённость
        self.position_uncertainty = 10.0  # метров (растёт без даров)

    # ═══ ПРЕДЛОЖЕНИЕ ДАРА ══════════════════════════════════════

    def offer_gift(self, source_id: str, source_type: str,
                   position: Tuple[float, float, float],
                   confidence: float = 0.9,
                   signal_strength_db: float = -50,
                   frequency_hz: float = 1575.42e6,
                   expected_delay_ms: float = 67,
                   actual_delay_ms: float = 0,
                   checksum_valid: bool = True,
                   crypto_signed: bool = False) -> NavigationGift:
        """
        Источник предлагает навигационный дар.
        Дрон-получатель решает: принять или нет.
        """
        if actual_delay_ms == 0:
            actual_delay_ms = expected_delay_ms + random.gauss(0, 2)

        gift = NavigationGift(
            source_id=source_id,
            source_type=source_type,
            gift_vector=position,
            confidence=confidence,
            timestamp=time.time(),
            signal_strength_db=signal_strength_db,
            frequency_hz=frequency_hz,
            expected_delay_ms=expected_delay_ms,
            actual_delay_ms=actual_delay_ms,
            checksum_valid=checksum_valid,
            crypto_signed=crypto_signed,
            previous_gifts_from_source=self.accepted_count.get(source_id, 0),
        )

        self.total_gifts_offered += 1
        self.gift_history.append(gift)
        if len(self.gift_history) > 200:
            self.gift_history.pop(0)

        return gift

    # ═══ ПРОВЕРКА ДАРА (РАЗЛИЧЕНИЕ ДУХОВ) ════════════════════

    def evaluate_gift(self, gift: NavigationGift) -> GiftDecision:
        """
        Различить: принять дар или отвергнуть?

        Критерии:
          1. Контрольная сумма / криптоподпись (формальная проверка)
          2. Консистентность с другими принятыми дарами
          3. История отношений с источником
          4. Задержка сигнала (аномалия = спуфинг)
          5. Мощность сигнала (аномалия = подмена)
          6. Согласованность с IMU (базисом)
        """
        reasons = []

        # 1. Формальная проверка
        if not gift.checksum_valid:
            self.spoofing_attempts_detected += 1
            self.suspicious_sources[gift.source_id] = "checksum_fail"
            return GiftDecision.CORRUPTED

        # 2. Аномалия задержки (>5σ от ожидаемой)
        delay_error = abs(gift.actual_delay_ms - gift.expected_delay_ms)
        if delay_error > 10:  # >10ms аномалия
            reasons.append(f"delay_anomaly:{delay_error:.0f}ms")
            self.suspicious_sources[gift.source_id] = "delay_anomaly"

        # 3. Аномалия мощности (спуфер обычно мощнее)
        expected_strength = -130 + 20 * math.log10(max(20000, self.position_uncertainty * 1000))
        if gift.signal_strength_db > expected_strength + 20:  # на 20dB сильнее ожидаемого
            reasons.append(f"power_anomaly:{gift.signal_strength_db:.0f}dB")

        # Звёздный дар не может быть отвергнут (небесный источник)
        if gift.source_type == "star":
            self.total_gifts_accepted += 1
            self.accepted_count[gift.source_id] = self.accepted_count.get(gift.source_id, 0) + 1
            self.source_trust[gift.source_id] = 1.0  # звёзды всегда 1.0
            return GiftDecision.ACCEPTED

        # 4. Консистентность с принятыми дарами
        if len(self.gift_history) > 3:
            recent_positions = [
                g.gift_vector for g in self.gift_history[-10:]
                if g.source_id != gift.source_id and
                self.source_trust.get(g.source_id, 1.0) > 0.3
            ]
            if recent_positions:
                avg_x = sum(p[0] for p in recent_positions) / len(recent_positions)
                avg_y = sum(p[1] for p in recent_positions) / len(recent_positions)
                avg_z = sum(p[2] for p in recent_positions) / len(recent_positions)
                dist = math.sqrt(
                    (gift.gift_vector[0] - avg_x)**2 +
                    (gift.gift_vector[1] - avg_y)**2 +
                    (gift.gift_vector[2] - avg_z)**2
                )
                if dist > self.position_uncertainty * 3:
                    reasons.append(f"inconsistent:dist={dist:.0f}m")

        # 5. Консистентность с текущей позицией (IMU-базис)
        imu_dist = math.sqrt(
            (gift.gift_vector[0] - self.position[0])**2 +
            (gift.gift_vector[1] - self.position[1])**2 +
            (gift.gift_vector[2] - self.position[2])**2
        )
        if imu_dist > 1000:  # >1km от текущей позиции — явный спуфинг
            reasons.append(f"imu_mismatch:{imu_dist:.0f}m")

        # 6. История источника
        trust = self.source_trust.get(gift.source_id, 0.5)
        if trust < 0.2:
            reasons.append(f"low_trust:{trust:.2f}")

        # 7. Источник был ранее отвергнут много раз
        rejected = self.rejected_count.get(gift.source_id, 0)
        if rejected > 5:
            reasons.append(f"chronic_rejection:{rejected}")

        # ═══ РЕШЕНИЕ ═══════════════════════════════════════════
        if len(reasons) >= 3:
            # Множественные аномалии → дар испорчен
            self.total_gifts_rejected += 1
            self.rejected_count[gift.source_id] = self.rejected_count.get(gift.source_id, 0) + 1
            self.source_trust[gift.source_id] = max(0.0, trust - 0.3)
            self.spoofing_attempts_detected += 1
            return GiftDecision.CORRUPTED

        elif len(reasons) >= 1:
            # Есть сомнения → отвергнуть, но без отметки corruption
            self.total_gifts_rejected += 1
            self.rejected_count[gift.source_id] = self.rejected_count.get(gift.source_id, 0) + 1
            self.source_trust[gift.source_id] = max(0.0, trust - 0.1)
            return GiftDecision.REJECTED

        elif gift.confidence < 0.5 or trust < 0.3:
            # Неуверенность
            return GiftDecision.UNCERTAIN

        else:
            # Дар принят
            self.total_gifts_accepted += 1
            self.accepted_count[gift.source_id] = self.accepted_count.get(gift.source_id, 0) + 1
            self.source_trust[gift.source_id] = min(1.0, trust + 0.05)
            return GiftDecision.ACCEPTED

    # ═══ СЛИЯНИЕ ПРИНЯТЫХ ДАРОВ ═══════════════════════════════

    def fuse_accepted_gifts(self, accepted_gifts: List[NavigationGift],
                            imu_position: Tuple[float, float, float]) -> Tuple[float, float, float]:
        """
        Слить принятые дары в навигационное решение.

        Веса:
          - Звёздный дар (star): вес ×3 (нельзя подделать)
          - Дар друга (drone/ground): вес ×2 (доверие + история)
          - Дар спутника (satellite): вес ×1 (легко подделать, но много источников)
          - IMU (базис): вес зависит от времени с последней коррекции
        """
        if not accepted_gifts:
            return imu_position

        weighted_x, weighted_y, weighted_z = 0.0, 0.0, 0.0
        total_weight = 0.0

        for gift in accepted_gifts:
            # Базовый вес: уверенность источника × доверие к нему
            trust = self.source_trust.get(gift.source_id, 0.5)
            weight = gift.confidence * trust

            # Тип источника модифицирует вес
            if gift.source_type == "star":
                weight *= 3.0      # звёзды не лгут
            elif gift.source_type in ("drone", "ground"):
                weight *= 2.0      # друг заслужил доверие
            elif gift.source_type == "satellite":
                weight *= 1.0      # спутник — gratia gratis data, но может быть подменён

            weighted_x += gift.gift_vector[0] * weight
            weighted_y += gift.gift_vector[1] * weight
            weighted_z += gift.gift_vector[2] * weight
            total_weight += weight

        if total_weight > 0:
            fused = (
                weighted_x / total_weight,
                weighted_y / total_weight,
                weighted_z / total_weight,
            )
            # Обновить неопределённость
            self.position_uncertainty = max(0.5, 10.0 / (total_weight + 1))
            return fused
        return imu_position

    # ═══ ГЛАВНЫЙ ЦИКЛ НАВИГАЦИИ ══════════════════════════════

    def navigation_cycle(self, gps_signals: List[dict], uwb_rangings: List[dict],
                         star_position: Optional[dict], imu_position: Tuple[float, float, float],
                         dt: float) -> dict:
        """
        Один цикл навигации через экономику дара.

        gps_signals: [{"sat_id": "GPS-15", "position": (x,y,z), "snr_db": -45, ...}, ...]
        uwb_rangings: [{"drone_id": "Scout-2", "position": (x,y,z), ...}, ...]
        star_position: {"position": (x,y,z), "stars_visible": 8, ...} or None
        imu_position: (x, y, z) — базис, не дар
        """
        # 1. Предложить дары от всех источников
        gifts = []

        # GPS-сигналы — дары спутников
        for sig in gps_signals:
            gift = self.offer_gift(
                source_id=sig.get("sat_id", "GPS-?"),
                source_type="satellite",
                position=sig.get("position", (0, 0, 0)),
                confidence=sig.get("confidence", 0.9),
                signal_strength_db=sig.get("snr_db", -45),
                frequency_hz=sig.get("freq_hz", 1575.42e6),
                checksum_valid=sig.get("valid", True),
            )
            gifts.append(gift)

        # UWB-дальности — дары друзей
        for rng in uwb_rangings:
            gift = self.offer_gift(
                source_id=rng.get("drone_id", "UWB-?"),
                source_type="drone",
                position=rng.get("position", (0, 0, 0)),
                confidence=rng.get("confidence", 0.8),
                signal_strength_db=rng.get("snr_db", -60),
                frequency_hz=rng.get("freq_hz", 4.0e9),
                crypto_signed=rng.get("trusted", False),
            )
            gifts.append(gift)

        # Звёздный дар
        if star_position:
            gift = self.offer_gift(
                source_id="Caelum",  # Небо
                source_type="star",
                position=star_position.get("position", imu_position),
                confidence=star_position.get("confidence", 0.999),
                signal_strength_db=0,  # звёзды не имеют dB
                frequency_hz=5e14,     # видимый свет ~500 THz
                expected_delay_ms=0,
                actual_delay_ms=0,
                checksum_valid=True,
                crypto_signed=True,    # звёзды — подпись Творца
            )
            gifts.append(gift)

        # 2. Оценить каждый дар
        accepted = []
        decisions = []
        for gift in gifts:
            decision = self.evaluate_gift(gift)
            decisions.append({
                "source": gift.source_id,
                "type": gift.source_type,
                "decision": decision.value,
                "trust": round(self.source_trust.get(gift.source_id, 0.5), 2),
            })
            if decision == GiftDecision.ACCEPTED:
                accepted.append(gift)

        # 3. Слить принятые дары
        new_position = self.fuse_accepted_gifts(accepted, imu_position)

        # 4. Обновить позицию
        self.position = list(new_position)
        # Интеграция скорости из IMU (базис)
        self.position[0] += self.velocity[0] * dt
        self.position[1] += self.velocity[1] * dt
        self.position[2] += self.velocity[2] * dt

        # 5. Если даров нет — IMU дрейфует
        if not accepted:
            self.position_uncertainty += 0.1 * dt  # дрейф растёт

        return {
            "position": self.position,
            "uncertainty_m": round(self.position_uncertainty, 2),
            "gifts_offered": len(gifts),
            "gifts_accepted": len(accepted),
            "gifts_rejected": len(gifts) - len(accepted),
            "decisions": decisions,
            "suspicious_sources": dict(self.suspicious_sources),
            "source_trust": {k: round(v, 2) for k, v in self.source_trust.items()},
            "stats": {
                "total_offered": self.total_gifts_offered,
                "total_accepted": self.total_gifts_accepted,
                "total_rejected": self.total_gifts_rejected,
                "spoofing_detected": self.spoofing_attempts_detected,
            },
        }


# ═══════════════════════════════════════════════════════════════
# ДЕМОНСТРАЦИЯ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════════════╗")
    print("║  НАВИГАЦИЯ КАК ЭКОНОМИКА ДАРА                          ║")
    print("║  Свобода не принять дар = безопасность от спуфинга     ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print()

    nav = GiftNavigationEngine("Scout-1")
    nav.position = [100.0, 200.0, 150.0]
    nav.position_uncertainty = 2.0

    # ═══ СЦЕНАРИЙ 1: НОРМАЛЬНАЯ НАВИГАЦИЯ ═══════════════════
    print("─── СЦЕНАРИЙ 1: Нормальная навигация ───")
    print("  Все источники честны. Дроны доверяют друг другу.")
    print()

    for t in range(5):
        gps_signals = [
            {"sat_id": f"GPS-{i}", "position": (100 + random.gauss(0, 3), 200 + random.gauss(0, 3), 150),
             "snr_db": random.uniform(-48, -42), "confidence": 0.95, "valid": True}
            for i in range(4)
        ]
        uwb_rangings = [
            {"drone_id": "Scout-2", "position": (102 + random.gauss(0, 1), 198 + random.gauss(0, 1), 151),
             "confidence": 0.9, "snr_db": -58, "trusted": True}
        ]
        star_pos = {"position": (100.5, 200.5, 150.2), "confidence": 0.999}

        result = nav.navigation_cycle(gps_signals, uwb_rangings, star_pos, (100, 200, 150), 0.1)
        print(f"  Такт {t}: pos=({result['position'][0]:.1f},{result['position'][1]:.1f}) "
              f"±{result['uncertainty_m']}m "
              f"принято={result['gifts_accepted']}/{result['gifts_offered']} даров "
              f"отвергнуто={result['gifts_rejected']}")

    print()

    # ═══ СЦЕНАРИЙ 2: СПУФИНГ-АТАКА ═════════════════════════
    print("─── СЦЕНАРИЙ 2: Спуфинг-атака на GPS ───")
    print("  Враг подменяет сигнал GPS-3. Даёт ложную позицию.")
    print("  Дрон различает: дар испорчен → отвергает.")
    print()

    for t in range(7):
        gps_signals = [
            {"sat_id": f"GPS-{i}", "position": (100 + random.gauss(0, 3), 200 + random.gauss(0, 3), 150),
             "snr_db": random.uniform(-48, -42), "confidence": 0.95, "valid": True}
            for i in range(4)
        ]

        # GPS-3 — спуфинговая атака!
        if t >= 2:
            gps_signals[2] = {
                "sat_id": "GPS-3",
                "position": (-5000, -3000, 50),  # ЛОЖНАЯ позиция!
                "snr_db": -25,  # аномально мощный сигнал!
                "confidence": 0.99,
                "valid": True,
            }

        uwb_rangings = [
            {"drone_id": "Scout-2", "position": (102 + random.gauss(0, 1), 198 + random.gauss(0, 1), 151),
             "confidence": 0.9, "snr_db": -58, "trusted": True}
        ]
        star_pos = {"position": (101, 201, 150), "confidence": 0.999}

        result = nav.navigation_cycle(gps_signals, uwb_rangings, star_pos, (100, 200, 150), 0.1)

        # Показать решения по каждому источнику
        spoof_decision = next((d for d in result["decisions"] if d["source"] == "GPS-3"), None)
        spoof_status = f"GPS-3: {spoof_decision['decision']}" if spoof_decision else ""

        print(f"  Такт {t}: pos=({result['position'][0]:.1f},{result['position'][1]:.1f}) "
              f"±{result['uncertainty_m']}m | {spoof_status} "
              f"принято={result['gifts_accepted']} отверг={result['gifts_rejected']}")

        if t >= 2 and spoof_decision:
            icon = "🛡" if spoof_decision["decision"] in ("rejected", "corrupted") else "⚠"
            print(f"    {icon} GPS-3 → {spoof_decision['decision']} "
                  f"(trust={spoof_decision['trust']})")

    print()

    # ═══ СЦЕНАРИЙ 3: КОМПРОМЕТАЦИЯ ДРУГА ═══════════════════
    print("─── СЦЕНАРИЙ 3: Друг скомпрометирован ───")
    print("  Scout-2 захвачен врагом. Его UWB-дары ложны.")
    print("  Свобода не принять дар друга = защита роя.")
    print()

    for t in range(5):
        gps_signals = [
            {"sat_id": f"GPS-{i}", "position": (100 + random.gauss(0, 2), 200 + random.gauss(0, 2), 150),
             "snr_db": -45, "confidence": 0.95, "valid": True}
            for i in range(4)
        ]

        # Scout-2 скомпрометирован! Посылает ложные UWB-дальности
        uwb_rangings = [{
            "drone_id": "Scout-2",
            "position": (3000 + t * 200, -2000 + t * 100, 800),  # уводит в сторону!
            "confidence": 0.85,
            "snr_db": -55,
            "trusted": False,  # криптоподпись не совпадает
        }]

        star_pos = {"position": (100.5, 200.3, 150.1), "confidence": 0.999}

        result = nav.navigation_cycle(gps_signals, uwb_rangings, star_pos, (100, 200, 150), 0.1)

        friend_decision = next((d for d in result["decisions"] if d["source"] == "Scout-2"), None)
        print(f"  Такт {t}: принято={result['gifts_accepted']} отверг={result['gifts_rejected']} "
              f"| Scout-2: {friend_decision['decision'] if friend_decision else '?'} "
              f"подозр.={len(result['suspicious_sources'])}")

    # ═══ ФИНАЛЬНАЯ СТАТИСТИКА ═══════════════════════════════
    print()
    print("═══ ФИНАЛЬНАЯ СТАТИСТИКА ═══")
    print(f"  Предложено даров: {nav.total_gifts_offered}")
    print(f"  Принято: {nav.total_gifts_accepted} ({100*nav.total_gifts_accepted/max(1,nav.total_gifts_offered):.0f}%)")
    print(f"  Отвергнуто: {nav.total_gifts_rejected}")
    print(f"  Обнаружено спуфинг-атак: {nav.spoofing_attempts_detected}")
    print(f"  Подозрительных источников: {len(nav.suspicious_sources)}")
    print(f"  Позиция: ({nav.position[0]:.1f}, {nav.position[1]:.1f}, {nav.position[2]:.1f})")
    print(f"  Неопределённость: ±{nav.position_uncertainty:.2f}м")
    print()
    print("  Доверие к источникам:")
    for source, trust in sorted(nav.source_trust.items()):
        bar = "█" * int(trust * 20) + "░" * (20 - int(trust * 20))
        status = "✅" if trust > 0.7 else "⚠️" if trust > 0.3 else "❌"
        print(f"    {status} {source:15s}: {bar} {trust:.2f}")
    print()
    print("Вывод: свобода не принять дар = навигационная безопасность.")
    print("GPS можно отвергнуть. Друга можно заподозрить. Звёзды не лгут.")
