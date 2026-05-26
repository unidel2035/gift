/**
 * ConciliarDissent — первый примитив соборной модели.
 *
 * Способность I из specs/theology/conciliar-capabilities.gift:
 * НЕСВОДИМОЕ РАЗНОГЛАСИЕ (dissentus irreducibilis).
 *
 * Принцип: на один вопрос — n голосов от n лиц, без усреднения.
 * Вес голоса = authority лица в матрице W (сумма принятых им даров).
 * Выход — Polyphony { voices, dominant?, silent?, apophatic? },
 * где dominant НЕ всегда существует. Два голоса с одинаковым авторитетом
 * и противоположными logos → apophatic: true (истина апофатична).
 *
 * Принципиальное отличие от LLM-ensemble:
 *   - LLM-ensemble усредняет/голосует
 *   - Polyphony СОХРАНЯЕТ разногласие как позитивный результат
 *
 * Богословский корень: Халкидон 451. Две природы во Христе — неслитно,
 * неизменно, нераздельно, неразлучно. Различие сохраняется в единстве.
 */

const NOUS_URL = process.env.NOUS_URL || 'http://localhost:8089';

/**
 * Воспринимает голоса лиц. Каждый голос имеет:
 *   persona:  имя лица (должно существовать в W)
 *   logos:    'kata' | 'para' | 'hyper'  (ниже / рядом / выше)
 *             kata  — возражение
 *             para  — равноправный вариант
 *             hyper — превосходящее различение
 *   content:  текст голоса
 *   metadata: опционально
 */
export class ConciliarDissent {
  constructor({ nousUrl = NOUS_URL, apophasisThreshold = 0.15, immuneSystem = null } = {}) {
    this.nousUrl = nousUrl;
    this.apophasisThreshold = apophasisThreshold;
    this.immuneSystem = immuneSystem; // КИС для анти-сговора
  }

  /**
   * Собирает голоса. Не вызывает LLM — получает уже сформированные голоса.
   * (Интеграция с LLM-субагентами — на уровень выше, здесь — ядро.)
   *
   * @param {Array<{persona,logos,content}>} voices
   * @returns {Promise<Polyphony>}
   */
  async assemble(voices) {
    if (!Array.isArray(voices) || voices.length === 0) {
      return this._silent('нет голосов — собор не собрался');
    }

    // Авторитет каждого лица — из матрицы W (сумма принятых даров)
    const authorities = await this._fetchAuthorities(voices.map(v => v.persona));

    const weighted = voices.map(v => ({
      ...v,
      authority: authorities[v.persona] ?? 1.0,
    }));

    // Группируем по logos — возражения отдельно, равноправные отдельно
    const byLogos = {
      kata:  weighted.filter(v => v.logos === 'kata'),
      para:  weighted.filter(v => v.logos === 'para'),
      hyper: weighted.filter(v => v.logos === 'hyper'),
    };

    // hyper-голос, если он есть, превосходит остальное — но НЕ подавляет
    const hyperVoices = byLogos.hyper.sort((a, b) => b.authority - a.authority);
    const paraVoices  = byLogos.para.sort((a, b) => b.authority - a.authority);
    const kataVoices  = byLogos.kata.sort((a, b) => b.authority - a.authority);

    // Апофатика: если два главных голоса противоположны по logos и почти равны
    // по авторитету — истина апофатична, собор не даёт единого ответа.
    const apophatic = this._detectApophasis(weighted);

    // Dominant — только если есть явное превосходство (>apophasisThreshold).
    // Иначе dominant = null (это не слабость, это правило).
    const dominant = apophatic ? null : this._selectDominant(weighted);

    // Анти-сговор: проверка коллективных аномалий перед финализацией
    let collusionResult = null;
    if (this.immuneSystem) {
      const wMatrix = await this._fetchWMatrix();
      collusionResult = this.immuneSystem.detectCollusion(weighted, wMatrix);
    }

    return new Polyphony({
      voices: weighted,
      byLogos: { kata: kataVoices, para: paraVoices, hyper: hyperVoices },
      dominant,
      apophatic,
      silent: false,
      totalAuthority: weighted.reduce((s, v) => s + v.authority, 0),
      collusion: collusionResult,
    });
  }

  /**
   * Получает authority лиц из nous. Offline-резерв — 1.0 для всех.
   */
  async _fetchAuthorities(personas) {
    const out = {};
    try {
      const r = await fetch(`${this.nousUrl}/summary`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!r.ok) throw new Error(`nous ${r.status}`);
      const data = await r.json();

      // summary.persons: { name: { given, received, ... } }
      // authority ≈ received (сколько принято — столько авторитета)
      const persons = data.persons || data.people || {};
      for (const p of personas) {
        const entry = persons[p];
        out[p] = entry ? (entry.received || entry.accepted || 1.0) : 1.0;
      }
    } catch {
      // Офлайн: все равны. Соборная модель должна работать и без сервера.
      for (const p of personas) out[p] = 1.0;
    }
    return out;
  }

  _detectApophasis(weighted) {
    // Находим топ-2 голоса по авторитету. Если они противоположны (kata vs hyper)
    // и их авторитеты близки — апофатика.
    if (weighted.length < 2) return false;

    const sorted = [...weighted].sort((a, b) => b.authority - a.authority);
    const [first, second] = sorted;

    const opposite = (first.logos === 'kata' && second.logos === 'hyper') ||
                     (first.logos === 'hyper' && second.logos === 'kata');
    if (!opposite) return false;

    const sum  = first.authority + second.authority;
    const diff = Math.abs(first.authority - second.authority);
    return sum > 0 && diff / sum < this.apophasisThreshold;
  }

  _selectDominant(weighted) {
    // hyper-голоса превосходят para и kata при равенстве авторитетов;
    // но кatа с очень большим авторитетом может победить hyper с малым.
    const logosBonus = { hyper: 1.5, para: 1.0, kata: 0.8 };
    const scored = weighted.map(v => ({
      ...v,
      score: v.authority * (logosBonus[v.logos] || 1.0),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0];
  }

  /**
   * Получает срез W-матрицы для анти-сговора.
   */
  async _fetchWMatrix() {
    try {
      const r = await fetch(`${this.nousUrl}/matrix`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  _silent(reason) {
    return new Polyphony({
      voices: [],
      byLogos: { kata: [], para: [], hyper: [] },
      dominant: null,
      apophatic: false,
      silent: true,
      silenceReason: reason,
      totalAuthority: 0,
    });
  }

  /**
   * Проверка кворума и субботы — если не выполнены, возвращаем молчание.
   */
  async convene(voices, { quorum = 2, sabbath = false } = {}) {
    if (sabbath) return this._silent('суббота — собор молчит');
    if (voices.length < quorum) {
      return this._silent(`нет кворума: ${voices.length} < ${quorum}`);
    }
    return this.assemble(voices);
  }
}

/**
 * Polyphony — выход соборной операции.
 * НЕ строка. НЕ один ответ. Структура, сохраняющая различие.
 */
export class Polyphony {
  constructor({
    voices, byLogos, dominant, apophatic, silent,
    silenceReason, totalAuthority, collusion,
  }) {
    this.voices = voices;
    this.byLogos = byLogos;
    this.dominant = dominant;
    this.apophatic = apophatic;
    this.silent = silent;
    this.silenceReason = silenceReason || null;
    this.totalAuthority = totalAuthority;
    this.collusion = collusion || null; // { anomalies: [], trustScore: 0..1 }
    Object.freeze(this);
  }

  /**
   * Текстовое представление — для логов и демонстрации.
   * НЕ «ответ модели». Это протокол собора.
   */
  toText() {
    if (this.silent) {
      return `⟨молчание⟩ ${this.silenceReason}`;
    }
    const lines = [];
    if (this.apophatic) {
      lines.push('⟨апофатика⟩ собор не дал единого голоса — истина не высказывается');
    } else if (this.dominant) {
      lines.push(`⟨dominant⟩ ${this.dominant.persona} (${this.dominant.logos}, вес ${this.dominant.authority.toFixed(1)})`);
    }
    // Предупреждение о сговоре
    if (this.collusion && this.collusion.anomalies.length > 0) {
      lines.push(`⟨анти-сговор⟩ trust=${this.collusion.trustScore.toFixed(2)}, аномалий: ${this.collusion.anomalies.length}`);
      for (const a of this.collusion.anomalies) {
        lines.push(`  ⚠ [${a.type}] ${a.description}`);
      }
      if (this.collusion.trustScore < 0.3) {
        lines.push('  ⛔ ДОВЕРИЕ НИЖЕ ПОРОГА — раунд на пересмотр');
      }
    }
    lines.push('─── голоса собора ───');
    for (const v of this.voices) {
      const prefix = { kata: '✗', para: '≈', hyper: '↑' }[v.logos] || '•';
      lines.push(`  ${prefix} ${v.persona.padEnd(14)} [${v.authority.toFixed(1)}]  ${v.content}`);
      // Nested reasoning steps (если есть)
      if (v.steps && v.steps.length > 0) {
        for (const s of v.steps) {
          const icon = { warning: '⚠', proposal: '→', reasoning: '∵', step: '·', point: '·', statement: '…' }[s.type] || '·';
          lines.push(`      ${icon} ${s.content.slice(0, 100)}`);
        }
      }
    }
    return lines.join('\n');
  }

  /**
   * Структурный экспорт для записи в nous / логи.
   */
  toJSON() {
    return {
      type: 'Polyphony',
      silent: this.silent,
      apophatic: this.apophatic,
      dominant: this.dominant && {
        persona: this.dominant.persona,
        logos: this.dominant.logos,
        authority: this.dominant.authority,
      },
      voices: this.voices.map(v => ({
        persona: v.persona,
        logos: v.logos,
        content: v.content,
        authority: v.authority,
      })),
      totalAuthority: this.totalAuthority,
      silenceReason: this.silenceReason,
    };
  }

  /**
   * Есть ли у собора единый голос? В монархической модели — всегда да.
   * В соборной — может быть нет. Это честный ответ, не баг.
   */
  get hasDominant() {
    return !this.silent && !this.apophatic && this.dominant !== null;
  }
}
