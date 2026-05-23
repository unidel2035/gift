#!/usr/bin/env python3
"""
adaptive_enemy.py — Адаптивный противник через эволюционный self-play

Архитектура (вдохновлена AlphaStar League):
  - Популяция агентов (N=50), каждый со своей стратегией
  - Турнирная селекция: агенты играют друг против друга
  - Победители скрещиваются (crossover стратегий)
  - Мутации стратегий
  - Элитизм: топ-5 переходят в следующее поколение
  - Фитнес = win_rate × avg_damage / losses

Стратегия агента — вектор из 8 параметров:
  [aggression, caution, flanking_pref, altitude_pref, target_priority,
   retreat_threshold, stealth_pref, swarm_coordination]

Каждое поколение: 50 агентов → турнир → отбор → скрещивание → мутация
После 100 поколений стратегии кристаллизуются.
"""

import math, random, time, json
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional
from collections import defaultdict
import statistics

# ═══════════════════════════════════════════════════════════════
# ГЕНОМ АГЕНТА (стратегия)
# ═══════════════════════════════════════════════════════════════

@dataclass
class Strategy:
    """8-мерный вектор стратегии"""
    aggression: float = 0.5        # 0=пассивный, 1=агрессивный
    caution: float = 0.5           # 0=рисковый, 1=осторожный
    flanking_pref: float = 0.3     # предпочтение фланговых заходов
    altitude_pref: float = 0.5     # 0=низко, 1=высоко
    target_priority: float = 0.5   # 0=ближайшая, 1=ценная цель
    retreat_threshold: float = 0.3 # при каком % батареи отступать
    stealth_pref: float = 0.2      # предпочтение скрытности
    coordination: float = 0.3      # скоординированность с роем

    def to_vector(self) -> List[float]:
        return [self.aggression, self.caution, self.flanking_pref,
                self.altitude_pref, self.target_priority,
                self.retreat_threshold, self.stealth_pref, self.coordination]

    @classmethod
    def from_vector(cls, vec: List[float]) -> "Strategy":
        return cls(*[max(0, min(1, v)) for v in vec])

    @classmethod
    def random(cls) -> "Strategy":
        return cls(*[random.random() for _ in range(8)])


# ═══════════════════════════════════════════════════════════════
# АГЕНТ
# ═══════════════════════════════════════════════════════════════

@dataclass
class Agent:
    id: str
    strategy: Strategy
    team: str = "red"  # противник — красный

    # Статистика боёв
    games_played: int = 0
    wins: int = 0
    losses: int = 0
    draws: int = 0
    kills: int = 0
    deaths: int = 0
    damage_dealt: float = 0
    damage_taken: float = 0
    survival_time: float = 0

    # Эволюционные
    fitness: float = 0.0
    generation: int = 0
    parent_ids: List[str] = field(default_factory=list)

    def win_rate(self) -> float:
        return self.wins / max(1, self.games_played)

    def kd_ratio(self) -> float:
        return self.kills / max(1, self.deaths)

    def compute_fitness(self) -> float:
        """Фитнес-функция: win_rate × K/D × survival"""
        wr = self.win_rate()
        kdr = self.kd_ratio()
        survival_bonus = min(1.0, self.survival_time / 500.0)
        self.fitness = wr * (0.5 + 0.5 * kdr) * (0.7 + 0.3 * survival_bonus)
        return self.fitness

    def decide(self, state: dict) -> str:
        """Принять тактическое решение на основе стратегии"""
        s = self.strategy

        # Что видит агент
        enemy_dist = state.get("nearest_enemy_dist", 1000)
        enemy_type = state.get("nearest_enemy_type", "unknown")
        battery = state.get("battery", 100)
        own_altitude = state.get("altitude", 100)
        friend_count = state.get("nearby_friends", 0)
        threat_level = state.get("threat_level", 0)

        # Отступление при низкой батарее
        if battery < s.retreat_threshold * 100:
            return "rtb"

        # Скрытное перемещение при высоком уровне угрозы
        if threat_level > 0.7 and s.stealth_pref > 0.5:
            return "stealth"

        # Атака
        if enemy_dist < 500 * (1 + s.aggression):
            if s.flanking_pref > 0.6 and enemy_dist > 200:
                return "flank"
            elif s.altitude_pref > 0.7 and own_altitude < 80:
                return "climb_attack"
            else:
                return "attack"

        # Приоритет ценной цели
        if enemy_dist < 1000 and s.target_priority > 0.7:
            if enemy_type in ("ew_station", "sam", "command_post"):
                return "priority_attack"

        # Патруль или наблюдение
        if s.caution > 0.6:
            return "observe"
        return "patrol"


# ═══════════════════════════════════════════════════════════════
# ЭВОЛЮЦИОННАЯ ПОПУЛЯЦИЯ
# ═══════════════════════════════════════════════════════════════

class EvolutionEngine:
    """
    Эволюционный движок: популяция → турнир → отбор → потомство.

    Параметры:
      population_size = 50
      elite_count = 5 (переходят без изменений)
      crossover_rate = 0.7
      mutation_rate = 0.1
      mutation_strength = 0.2
    """

    def __init__(self, population_size=50, elite_count=5):
        self.pop_size = population_size
        self.elite_count = elite_count
        self.crossover_rate = 0.7
        self.mutation_rate = 0.1
        self.mutation_strength = 0.2

        self.population: List[Agent] = []
        self.generation = 0
        self.history: List[Dict] = []  # история поколений

        # Инициализация случайной популяции
        self._init_population()

    def _init_population(self):
        for i in range(self.pop_size):
            agent = Agent(
                id=f"AG-{self.generation}-{i}",
                strategy=Strategy.random(),
                generation=self.generation,
            )
            self.population.append(agent)

    def run_tournament(self, game_simulator, games_per_pair=3):
        """
        Провести турнир: каждый с каждым (или случайные пары).
        game_simulator(blue_strategy, red_strategy) → (blue_wins, red_wins, stats)
        """
        # Для эффективности — каждый играет против 5 случайных противников
        for agent in self.population:
            opponents = random.sample(
                [a for a in self.population if a.id != agent.id],
                min(5, len(self.population) - 1)
            )
            for opponent in opponents:
                for _ in range(games_per_pair):
                    result = game_simulator(agent, opponent)
                    self._update_stats(agent, opponent, result)

        # Вычислить фитнес
        for agent in self.population:
            agent.compute_fitness()

    def _update_stats(self, agent: Agent, opponent: Agent, result: dict):
        """Обновить статистику — agent=красный, opponent=синий"""
        winner = result.get("winner", "draw")
        stats = result.get("stats", {})

        agent.games_played += 1; opponent.games_played += 1

        if winner == "red":
            agent.wins += 1; opponent.losses += 1
        elif winner == "blue":
            opponent.wins += 1; agent.losses += 1
        else:
            agent.draws += 1; opponent.draws += 1

        agent.kills += stats.get("red_kills", 0)
        agent.deaths += stats.get("red_deaths", 0)
        agent.damage_dealt += stats.get("red_damage", 0)
        agent.survival_time += stats.get("duration", 0)
        opponent.kills += stats.get("blue_kills", 0)
        opponent.deaths += stats.get("blue_deaths", 0)
        opponent.damage_dealt += stats.get("blue_damage", 0)

    def evolve(self) -> List[Agent]:
        """Одно поколение эволюции"""
        self.generation += 1

        # Сортировка по фитнесу
        self.population.sort(key=lambda a: a.fitness, reverse=True)

        # Запись истории
        top_fitness = [a.fitness for a in self.population[:10]]
        self.history.append({
            "generation": self.generation,
            "avg_fitness": statistics.mean([a.fitness for a in self.population]),
            "max_fitness": max(a.fitness for a in self.population),
            "top_strategies": [a.strategy.to_vector() for a in self.population[:3]],
        })

        # Элитизм: сохраняем лучших
        new_population = []
        for i in range(self.elite_count):
            elite = self.population[i]
            new_agent = Agent(
                id=f"AG-{self.generation}-elite-{i}",
                strategy=Strategy.from_vector(elite.strategy.to_vector()),
                generation=self.generation,
                parent_ids=[elite.id],
            )
            new_population.append(new_agent)

        # Скрещивание и мутация для заполнения популяции
        while len(new_population) < self.pop_size:
            # Tournament selection (выбираем двух родителей)
            parent1 = self._select_parent()
            parent2 = self._select_parent()

            if random.random() < self.crossover_rate:
                child_vec = self._crossover(parent1.strategy, parent2.strategy)
            else:
                child_vec = parent1.strategy.to_vector()

            # Мутация
            if random.random() < self.mutation_rate:
                child_vec = self._mutate(child_vec)

            child = Agent(
                id=f"AG-{self.generation}-child-{len(new_population)}",
                strategy=Strategy.from_vector(child_vec),
                generation=self.generation,
                parent_ids=[parent1.id, parent2.id],
            )
            new_population.append(child)

        self.population = new_population[:self.pop_size]
        return self.population

    def _select_parent(self) -> Agent:
        """Tournament selection: лучший из k случайных"""
        k = 3
        candidates = random.sample(self.population, min(k, len(self.population)))
        return max(candidates, key=lambda a: a.fitness)

    def _crossover(self, s1: Strategy, s2: Strategy) -> List[float]:
        """Uniform crossover"""
        v1, v2 = s1.to_vector(), s2.to_vector()
        return [v1[i] if random.random() < 0.5 else v2[i] for i in range(8)]

    def _mutate(self, vec: List[float]) -> List[float]:
        """Гауссова мутация"""
        return [max(0, min(1, v + random.gauss(0, self.mutation_strength))) for v in vec]

    def get_best_agent(self) -> Agent:
        return max(self.population, key=lambda a: a.fitness)

    def get_status(self) -> dict:
        best = self.get_best_agent()
        return {
            "generation": self.generation,
            "population": len(self.population),
            "best_fitness": round(best.fitness, 3),
            "best_strategy": best.strategy.to_vector(),
            "best_win_rate": round(best.win_rate(), 2),
            "best_kd": round(best.kd_ratio(), 2),
            "avg_fitness": round(statistics.mean([a.fitness for a in self.population]), 3),
            "history": self.history[-10:],
        }


# ═══════════════════════════════════════════════════════════════
# БЫСТРЫЙ СИМУЛЯТОР ИГРЫ (для эволюции)
# ═══════════════════════════════════════════════════════════════

def fast_game_simulator(red_agent: Agent, blue_agent: Agent) -> dict:
    """
    Быстрая симуляция боя 1v1 для турнира.
    Возвращает результат без полной физики — только стратегическое разрешение.
    """
    rs = red_agent.strategy
    bs = blue_agent.strategy

    # Параметры боя
    red_hp = 100 + rs.caution * 50
    blue_hp = 100 + bs.caution * 50

    red_damage = 20 + rs.aggression * 30
    blue_damage = 20 + bs.aggression * 30

    red_accuracy = 0.3 + rs.flanking_pref * 0.4 - bs.stealth_pref * 0.2
    blue_accuracy = 0.3 + bs.flanking_pref * 0.4 - rs.stealth_pref * 0.2

    red_defense = rs.caution * 0.3 + rs.stealth_pref * 0.2
    blue_defense = bs.caution * 0.3 + bs.stealth_pref * 0.2

    duration = 0
    red_kills = 0; blue_kills = 0
    red_total_dmg = 0; blue_total_dmg = 0

    # Бой до смерти или 1000 тиков
    while red_hp > 0 and blue_hp > 0 and duration < 1000:
        # Красный атакует
        if random.random() < red_accuracy:
            dmg = red_damage * (1 - blue_defense) * random.uniform(0.8, 1.2)
            blue_hp -= dmg
            red_total_dmg += dmg

        # Синий атакует
        if random.random() < blue_accuracy:
            dmg = blue_damage * (1 - red_defense) * random.uniform(0.8, 1.2)
            red_hp -= dmg
            blue_total_dmg += dmg

        duration += 1

    if red_hp <= 0 and blue_hp <= 0:
        winner = "draw"
    elif red_hp <= 0:
        winner = "blue"; blue_kills = 1
    elif blue_hp <= 0:
        winner = "red"; red_kills = 1
    else:
        winner = "red" if red_hp > blue_hp else "blue"

    return {
        "winner": winner,
        "stats": {
            "red_kills": red_kills, "blue_kills": blue_kills,
            "red_deaths": 1 if winner == "blue" else 0,
            "blue_deaths": 1 if winner == "red" else 0,
            "red_damage": red_total_dmg, "blue_damage": blue_total_dmg,
            "duration": duration,
        }
    }


# ═══════════════════════════════════════════════════════════════
# ТЕСТ ЭВОЛЮЦИИ
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("╔══════════════════════════════════════════════════╗")
    print("║  ЭВОЛЮЦИОННЫЙ SELF-PLAY — Адаптивный противник  ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    engine = EvolutionEngine(population_size=30, elite_count=3)
    print(f"Популяция: {engine.pop_size} агентов")
    print(f"Элита: {engine.elite_count}")
    print()

    for gen in range(20):
        engine.run_tournament(fast_game_simulator, games_per_pair=2)
        engine.evolve()

        if gen % 5 == 0 or gen == 19:
            status = engine.get_status()
            bs = status["best_strategy"]
            print(f"Gen {gen}: best_fit={status['best_fitness']:.3f} "
                  f"WR={status['best_win_rate']:.0%} KD={status['best_kd']:.1f} "
                  f"avg={status['avg_fitness']:.3f}")
            print(f"  Strategy: agg={bs[0]:.2f} caution={bs[1]:.2f} "
                  f"flank={bs[2]:.2f} stealth={bs[6]:.2f}")

    print()
    print(f"Эволюция завершена. {engine.generation} поколений.")
    print(f"Лучший агент: {engine.get_best_agent().id}")

    # Показать эволюцию топ-стратегий
    print()
    print("Эволюция стратегий (aggression, caution, stealth):")
    for h in engine.history[::5]:
        top = h["top_strategies"][0]
        print(f"  Gen {h['generation']:2d}: "
              f"agg={top[0]:.2f} caution={top[1]:.2f} flank={top[2]:.2f} stealth={top[6]:.2f} "
              f"fitness={h['max_fitness']:.3f}")
