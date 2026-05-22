#!/usr/bin/env python3
"""
swarm_consensus.py — Соборное принятие решений роем

Три дрона независимо запрашивают Serafim LLM → голосуют ATTACK/OBSERVE/RTB.
Реализует принцип собора (σύνοδος): множество лиц → единое решение.

Правила:
  - Каждый дрон получает цель со своего ракурса (позиция, дистанция, роль)
  - 3 голоса: ATTACK / OBSERVE / RTB
  - ATTACK >= 2 → атака
  - RTB >= 2 → возврат (даже если один хочет атаковать)
  - При равенстве OBSERVE/RTB → старший (scout) решает
  - Меньшинство записывается как особое мнение (dissenting opinion)
"""

import json, time, urllib.request

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "serafim-1.5b"

class SwarmConsensus:
    """Соборный Decision Maker для роя дронов"""

    @staticmethod
    def query_drone(drone_id, drone_role, target_name, target_type, confidence,
                    drone_x, drone_z, battery, distance_to_target):
        """Один дрон запрашивает Serafim о решении"""
        # Ракурс дрона влияет на промпт
        if drone_role == "scout":
            perspective = f"Ты разведчик на дистанции {distance_to_target:.0f}м. Видишь цель сверху."
        elif drone_role == "interceptor":
            perspective = f"Ты перехватчик на дистанции {distance_to_target:.0f}м. Готов к манёвру."
        elif drone_role == "fpv":
            perspective = f"Ты ударный FPV на дистанции {distance_to_target:.0f}м. Готов атаковать."

        prompt = f"""{perspective}
Цель: {target_name} (тип: {target_type}). Уверенность: {confidence:.0%}.
Батарея: {battery:.0f}%. Твоё решение (ATTACK/OBSERVE/RTB):"""

        try:
            body = json.dumps({
                "model": MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.3, "num_predict": 20, "stop": ["\n", ". ", ".\n"]}
            }).encode()
            req = urllib.request.Request(OLLAMA_URL, body, {"Content-Type": "application/json"})
            resp = urllib.request.urlopen(req, timeout=15)
            data = json.loads(resp.read())
            response = data.get("response", "").strip()

            # Extract decision
            resp_upper = response.upper()
            if any(w in resp_upper for w in ["АТАК", "ATTACK", "УДАР", "УНИЧТОЖ"]):
                vote = "ATTACK"
            elif any(w in resp_upper for w in ["ДОМОЙ", "RTB", "ВОЗВРАТ", "СУББОТ"]):
                vote = "RTB"
            else:
                vote = "OBSERVE"

            return {
                "drone_id": drone_id,
                "role": drone_role,
                "vote": vote,
                "reasoning": response[:150],
                "inference_ms": data.get("eval_duration", 0) // 1_000_000,
            }
        except Exception as e:
            return {
                "drone_id": drone_id,
                "role": drone_role,
                "vote": "OBSERVE",
                "reasoning": f"LLM error: {str(e)[:80]}",
                "inference_ms": 0,
            }

    @classmethod
    def decide(cls, target, drones):
        """
        Провести соборное голосование.
        target: dict с type, classified, confidence, x, z
        drones: list of dict с id, role, x, z, battery
        Возвращает: решение + протокол голосования
        """
        votes = []
        for d in drones:
            if d.get("killed"):
                continue
            dist = ((d["x"] - target["x"])**2 + (d["z"] - target["z"])**2) ** 0.5
            vote = cls.query_drone(
                d["id"], d.get("role", "scout"),
                target.get("classifier_name", target["type"]),
                target["type"],
                target.get("confidence", 0.5),
                d["x"], d["z"],
                d.get("battery", 100),
                dist
            )
            votes.append(vote)

        # Подсчёт голосов
        attack_votes = sum(1 for v in votes if v["vote"] == "ATTACK")
        rtb_votes = sum(1 for v in votes if v["vote"] == "RTB")
        observe_votes = len(votes) - attack_votes - rtb_votes

        # Правило решения
        if attack_votes >= 2:
            decision = "ATTACK"
        elif rtb_votes >= 2:
            decision = "RTB"
        elif attack_votes == 1 and rtb_votes == 1 and observe_votes == 1:
            # Равенство: scout решает
            scout_vote = next((v for v in votes if v["role"] == "scout"), None)
            decision = scout_vote["vote"] if scout_vote else "OBSERVE"
        else:
            decision = "OBSERVE"

        # Особые мнения
        dissenters = [v for v in votes if v["vote"] != decision]

        return {
            "decision": decision,
            "votes": {v["drone_id"]: v["vote"] for v in votes},
            "reasoning": {v["drone_id"]: v["reasoning"] for v in votes},
            "attack_count": attack_votes,
            "rtb_count": rtb_votes,
            "observe_count": observe_votes,
            "dissenters": [{"drone": d["drone_id"], "voted": d["vote"], "why": d["reasoning"][:80]} for d in dissenters],
            "total_inference_ms": sum(v["inference_ms"] for v in votes),
            "protocol": f"СОБОР: {attack_votes}/{len(votes)} голосов за атаку → {decision}",
        }
