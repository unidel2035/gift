/**
 * BookOfConscience — liber conscientiae, книга совести.
 *
 * «И увидел я мёртвых, малых и великих, стоящих пред Богом,
 *  и книги раскрыты были... и судимы были мёртвые по написанному в книгах,
 *  сообразно с делами своими» (Откр 20:12).
 *
 * По учению св. отцов (Ефрем Сирин, «Слово о Суде»; Иоанн Златоуст, Беседы
 * на 1 Кор 3; Феофан Затворник, «Что есть духовная жизнь»), книги Суда
 * — это не внешний архив, а сама совесть, раскрытая перед Лицом Христа.
 * Каждое дело, каждое слово, каждая мысль явлены как они есть.
 *
 * В нашей онтологии: книга совести лица — это проекция всех актов
 * нити этого лица в матрице W, читаемая в режиме «как видит Христос».
 *
 * Две координаты каждого акта:
 *   weight        — как мы его записали (вес дара в W)
 *   manifestedness — как он выглядит перед Лицом (истина акта)
 *
 * Совесть = |weight − manifestedness|.
 * На Суде эта разность обнуляется — акт виден таков, каков он есть.
 *
 * ГРАНИЦА: модуль НЕ судит. Он только читает. Оценка — у Христа.
 * Мы лишь предоставляем форму чтения.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';

const ROOT = process.env.GIFT_ROOT || process.cwd();
const W_SLAVA = path.join(ROOT, 'data', 'W_slava.json');

/**
 * BookEntry — одна запись книги совести: акт + его явленность.
 * Заморожен.
 */
export class BookEntry {
  constructor({ actId, giver, receiver, content, weight, manifestedness, kind }) {
    this.actId = actId;
    this.giver = giver;
    this.receiver = receiver;
    this.content = content;
    this.weight = weight;              // вес акта в W
    this.manifestedness = manifestedness; // явленность перед Лицом
    this.kind = kind;
    this.conscienceDelta = Math.abs(weight - manifestedness);
    Object.freeze(this);
  }

  /**
   * true если запись «истинна» — вес и явленность совпадают (или разница мала).
   */
  get aligned() {
    return this.conscienceDelta < 0.5;
  }

  toJSON() {
    return {
      actId: this.actId,
      giver: this.giver,
      receiver: this.receiver,
      content: this.content,
      weight: this.weight,
      manifestedness: this.manifestedness,
      conscienceDelta: this.conscienceDelta,
      aligned: this.aligned,
      kind: this.kind,
    };
  }
}

/**
 * BookOfConscience — книга совести одного лица.
 *
 * Создаётся чтением матрицы W для данного persona + чтением W_slava
 * (если существует) для явленности. Если W_slava отсутствует — явленность
 * равна весу (честный отказ от симуляции Суда: мы не знаем разницы).
 */
export class BookOfConscience {
  constructor(persona, entries = []) {
    this.persona = persona;
    this.entries = entries;
    this.openedAt = new Date().toISOString();
    Object.freeze(this);
  }

  /**
   * Открыть книгу совести для persona по данным W-матрицы.
   *
   * @param {string} persona
   * @param {Array<object>} acts — акты из W (giver/receiver/weight/...)
   * @returns {Promise<BookOfConscience>}
   */
  static async open(persona, acts) {
    let manifestedness = {};
    try {
      const raw = await fsp.readFile(W_SLAVA, 'utf8');
      manifestedness = JSON.parse(raw).manifestedness || {};
    } catch {
      // W_slava ещё не собрана — честно: явленность = вес
      manifestedness = {};
    }

    const related = acts.filter(a =>
      a.giver === persona || a.receiver === persona
    );

    const entries = related.map(a => {
      const key = `${a.id || a.actId || `${a.giver}→${a.receiver}:${a.content}`}`;
      const w = Number(a.weight) || 0;
      const m = manifestedness[key] !== undefined
        ? Number(manifestedness[key])
        : w; // честно: если не знаем — равна весу
      return new BookEntry({
        actId: key,
        giver: a.giver,
        receiver: a.receiver,
        content: a.content || a.text || '',
        weight: w,
        manifestedness: m,
        kind: a.kind || a.type || 'gift',
      });
    });

    return new BookOfConscience(persona, entries);
  }

  /**
   * Суммарная «невыровненность» — чем больше, тем больше работы совести.
   * НЕ приговор, а диагностика разрыва.
   */
  get totalDelta() {
    return this.entries.reduce((s, e) => s + e.conscienceDelta, 0);
  }

  /**
   * Записи, где явленность МЕНЬШЕ веса — «переоценённые» дары
   * (казались тяжелее, чем на самом деле).
   */
  get overweighted() {
    return this.entries.filter(e => e.weight > e.manifestedness + 0.5);
  }

  /**
   * Записи, где явленность БОЛЬШЕ веса — «недооценённые» дары
   * (малое в мире, великое перед Богом; «две лепты вдовы», Мк 12:42).
   */
  get underweighted() {
    return this.entries.filter(e => e.manifestedness > e.weight + 0.5);
  }

  toJSON() {
    return {
      type: 'BookOfConscience',
      persona: this.persona,
      openedAt: this.openedAt,
      totalDelta: this.totalDelta,
      overweightedCount: this.overweighted.length,
      underweightedCount: this.underweighted.length,
      alignedCount: this.entries.filter(e => e.aligned).length,
      entries: this.entries.map(e => e.toJSON()),
    };
  }

  toText() {
    const lines = [
      `⟨книга совести: ${this.persona}⟩ открыта ${this.openedAt}`,
      `  записей: ${this.entries.length}`,
      `  выровнено: ${this.entries.filter(e => e.aligned).length}`,
      `  переоценено (казались тяжелее): ${this.overweighted.length}`,
      `  недооценено (малое в мире, великое перед Богом): ${this.underweighted.length}`,
      `  совокупная δ: ${this.totalDelta.toFixed(2)}`,
    ];
    return lines.join('\n');
  }
}

export default BookOfConscience;
