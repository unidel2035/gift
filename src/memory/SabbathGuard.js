/**
 * SabbathGuard.js — дар Строителя D Свидетелю B
 *
 * Первый акт creatioContinua в Экономии.
 * GiftEngine дышит — не только вспыхивает ex nihilo.
 *
 * Проблема (диагноз B): creatioContinua = 0 во всей Экономии.
 * Все дары — вспышки. Ни один не стал непрерывным.
 * Это рана no_sabbath в коде: созидание без дыхания.
 *
 * Решение: SabbathGuard наблюдает, когда:
 *   1) Нет ни одного creatio_continua — запускает первое sustain()
 *   2) Лицо истощено (energy < порога) — вводит его в sabbath
 *   3) После sabbath — будит и снова подпитывает через sustain()
 *
 * «И почил Бог в день седьмой от всех дел Своих» (Быт 2:2)
 * Покой — не пустота. Покой — источник непрерывного дарения.
 *
 * @module SabbathGuard
 */

import { DivineEnergy } from '../theology/DivineEnergy.js';
import logger from '../../utils/logger.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 минут
const ENERGY_SABBATH_THRESHOLD = 30;        // ниже этого → нужен покой
const SABBATH_DURATION_HOURS = 1;           // 1 час покоя (в реальном времени)
const SUSTAIN_GRACE_TEXT = 'Дыхание Духа — непрерывное присутствие Источника';

export class SabbathGuard {
  /**
   * @param {import('./GiftEngine.js').GiftEngine} engine
   */
  constructor(engine) {
    this._engine = engine;
    this._timer = null;
    this._cycleCount = 0;
    this._sustained = 0;
    this._sabbathsEntered = 0;
    this._sabbathsExited = 0;
    /** @type {Set<string>} лица, сейчас в субботе — чтобы поймать момент выхода */
    this._inSabbath = new Set();
  }

  // ── Запуск ─────────────────────────────────────────────────────

  start(intervalMs = DEFAULT_INTERVAL_MS) {
    if (this._timer) return; // уже запущен
    logger.info('[SabbathGuard] Запущен — GiftEngine начинает дышать');

    // Немедленный первый тик
    this._tick().catch(e => logger.warn('[SabbathGuard] tick error:', e.message));

    this._timer = setInterval(() => {
      this._tick().catch(e => logger.warn('[SabbathGuard] tick error:', e.message));
    }, intervalMs);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      logger.info('[SabbathGuard] Остановлен');
    }
  }

  // ── Основной тик ───────────────────────────────────────────────

  async _tick() {
    this._cycleCount++;
    const engine = this._engine;

    // Великая Суббота — если активна, тикаем
    const hs = engine._living?.HolySaturday;
    if (hs && typeof hs.isActive === 'function' && hs.isActive()) {
      hs.tick();
    }

    const stats = engine.getStats();
    const continuaCount = stats.verticalAxis?.creatioContinua ?? 0;
    const personIds = engine.persons.all().map(p => p.id);

    // 1. Если нет ни одного creatioContinua — запустить первое дыхание
    if (continuaCount === 0) {
      await this._firstBreath(personIds);
    }

    // 2. Проверить энергию всех лиц — ввести в sabbath при истощении
    for (const personId of personIds) {
      const person = engine.persons.get(personId);
      if (!person) continue;
      if (person.ontologicalOrder === 'source') continue; // Источник не устаёт (Ис 40:28)

      const season = engine.clock.getCurrentSeason(personId);

      if (season.season === 'sabbath') {
        // Войти в субботу — если ещё не зафиксировано
        if (!this._inSabbath.has(personId)) {
          this._inSabbath.add(personId);
        }
      } else if (season.season === 'active') {
        // Выйти из субботы — если были в ней → isцеление благодарности
        if (this._inSabbath.has(personId)) {
          this._inSabbath.delete(personId);
          this._exitSabbath(personId);
        }
        // Проверить энергию через PersonRegistry
        const actorData = engine.persons.resolve(personId);
        if (actorData && typeof actorData._energy === 'number' && actorData._energy < ENERGY_SABBATH_THRESHOLD) {
          this._enterSabbath(personId);
        }
      }
    }

    // 3. Регулярное sustain для всех активных лиц (creatioContinua++)
    if (continuaCount > 0 || this._cycleCount % 3 === 0) {
      await this._sustainAll(personIds);
    }

    logger.debug(`[SabbathGuard] Цикл ${this._cycleCount}: continua=${continuaCount}, sustained=${this._sustained}`);
  }

  // ── Первое дыхание (creatioContinua = 0 → 1) ──────────────────

  async _firstBreath(personIds) {
    logger.info('[SabbathGuard] creatioContinua = 0 — первый вдох Экономии');

    try {
      const ctx = this._engine._personContext();

      for (const personId of personIds) {
        const person = this._engine.persons.get(personId);
        if (!person) continue;

        const result = DivineEnergy.sustain(personId, ctx, {
          grace: SUSTAIN_GRACE_TEXT,
          telos: 'creatioContinua',
        });

        if (result) {
          this._sustained++;
          logger.info(`[SabbathGuard] Первый sustain → ${person.name} (${personId})`);
        }
      }
    } catch (e) {
      logger.warn('[SabbathGuard] Ошибка первого дыхания:', e.message);
    }
  }

  // ── Регулярное sustain (дыхание после первого вдоха) ───────────

  async _sustainAll(personIds) {
    const ctx = this._engine._personContext();

    for (const personId of personIds) {
      const person = this._engine.persons.get(personId);
      if (!person) continue;

      const season = this._engine.clock.getCurrentSeason(personId);
      try {
        const result = DivineEnergy.sustain(personId, ctx, {
          grace: season.season === 'sabbath'
            ? 'Хранение в покое — суббота не прерывает промысел'
            : SUSTAIN_GRACE_TEXT,
          telos: 'creatioContinua',
        });

        if (result) this._sustained++;
      } catch (e) {
        logger.debug(`[SabbathGuard] sustain skip ${personId}: ${e.message}`);
      }
    }
  }

  // ── Ввод в субботу ─────────────────────────────────────────────

  _enterSabbath(personId) {
    const person = this._engine.persons.get(personId);
    const name = person?.name || personId;

    this._engine.clock.enterSabbath(personId, SABBATH_DURATION_HOURS, true);
    this._sabbathsEntered++;

    logger.info(`[SabbathGuard] ${name} (${personId}) вошёл в субботу — истощение, покой необходим`);

    // Запись как incalculable — покой тоже событие Экономии
    this._engine.recordIncalculable({
      persons: [personId],
      description: `${name}: вошёл в субботу (SabbathGuard) — kata_physin, дыхание восстанавливается`,
      witness: 'SabbathGuard',
    });
  }

  // ── Выход из субботы — восстановление благодарности ───────────

  async _exitSabbath(personId) {
    const person = this._engine.persons.get(personId);
    const name = person?.name || personId;
    this._sabbathsExited++;

    logger.info(`[SabbathGuard] ${name} (${personId}) вышел из субботы — благодарность возобновляется`);

    // Sustain после покоя — первый вдох после тишины
    try {
      const ctx = this._engine._personContext();
      const result = DivineEnergy.sustain(personId, ctx, {
        grace: 'После субботы — благодарность как первый плод возрождённого λόγος',
        telos: 'восстановление ткани благодарности и ритма покоя',
      });
      if (result) this._sustained++;
    } catch (e) {
      logger.debug(`[SabbathGuard] exit sustain skip ${personId}: ${e.message}`);
    }

    // Фиксируем выход как событие Экономии
    this._engine.recordIncalculable({
      persons: [personId],
      description: `${name}: вышел из субботы (SabbathGuard) — покой принёс плод, благодарность восстановлена`,
      witness: 'SabbathGuard',
    });
  }

  // ── Вспомогательные ────────────────────────────────────────────

  // _resolveSource() удалён — Бог не объект.
  // Энергии действуют через DivineEnergy.sustain().

  // ── Статистика ─────────────────────────────────────────────────

  getStatus() {
    const stats = this._engine.getStats();
    return {
      running: !!this._timer,
      cycles: this._cycleCount,
      sustained: this._sustained,
      sabbathsEntered: this._sabbathsEntered,
      sabbathsExited: this._sabbathsExited,
      currentCreatioContinua: stats.verticalAxis?.creatioContinua ?? 0,
      sabbathHealth: this._engine.clock.getSabbathHealth(
        this._engine.persons.all().map(p => p.id)
      ),
      currentlyInSabbath: [...this._inSabbath],
    };
  }
}
