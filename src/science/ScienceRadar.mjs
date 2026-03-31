/**
 * ScienceRadar — детектор прорывов через матрицу цитирований
 *
 * Паттерн Накамуры: высокий surplus + изоляция + кросс-домен =
 * потенциальный прорыв который мейнстрим игнорирует.
 *
 * Цитирование = дар идеи:
 *   статья A цитирует B → B дала идею A → W[B→A] += 1
 *
 * Ищем: статьи которые ДАЮТ идеи разным областям
 *        но сами ПОЛУЧАЮТ мало признания.
 *
 * API: OpenAlex (бесплатно, без ключа, 100k запросов/день)
 *   https://docs.openalex.org
 */

const OA_API  = 'https://api.openalex.org';
const MAILTO  = process.env.OA_EMAIL ?? 'gift-protocol@example.org'; // вежливый polite pool

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── OpenAlex API ──────────────────────────────────────────────────────────

async function oa(path, params = {}, retries = 3) {
  const url = new URL(`${OA_API}${path}`);
  url.searchParams.set('mailto', MAILTO); // polite pool: 10 req/sec
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const wait = 1500 * attempt;
      process.stdout.write(`  пауза ${wait / 1000}s...\r`);
      await sleep(wait);
    }
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GiftProtocol/1.0 ScienceRadar (mailto:gift-protocol@example.org)' }
    });
    if (res.status === 429 && attempt < retries) continue;
    if (!res.ok) throw new Error(`OpenAlex ${res.status}: ${await res.text()}`);
    return res.json();
  }
}

// OpenAlex concept → краткое имя
function conceptName(c) {
  return c?.display_name ?? c?.id?.split('/').pop() ?? '?';
}

// ── Сканирование области ──────────────────────────────────────────────────

export class ScienceRadar {
  constructor(query, options = {}) {
    this.query   = query;
    this.limit   = options.limit   ?? 40;
    this.minYear = options.minYear ?? 2000;
    this.papers  = new Map(); // openAlexId → metadata
    this.edges   = [];        // { from, to, fields[] }
  }

  // Загрузить статьи по запросу через OpenAlex /works?search=
  async fetchPapers() {
    console.log(`\nПоиск: «${this.query}»...`);

    // OpenAlex возвращает до 200 за запрос (per_page)
    const perPage = Math.min(this.limit, 50);
    const data = await oa('/works', {
      search:    this.query,
      per_page:  perPage,
      filter:    `publication_year:${this.minYear}-2025,has_references:true`,
      select:    'id,title,publication_year,cited_by_count,referenced_works_count,concepts,abstract_inverted_index',
      sort:      'relevance_score:desc',
    });

    for (const w of data.results ?? []) {
      const id     = w.id; // https://openalex.org/W123...
      const fields = (w.concepts ?? [])
        .filter(c => c.level <= 1)  // только верхний уровень
        .map(c => conceptName(c));

      // abstract из inverted index
      let abstract = '';
      if (w.abstract_inverted_index) {
        const words = Object.entries(w.abstract_inverted_index)
          .flatMap(([word, positions]) => positions.map(pos => ({ word, pos })))
          .sort((a, b) => a.pos - b.pos)
          .map(x => x.word);
        abstract = words.join(' ').slice(0, 200);
      }

      this.papers.set(id, {
        id,
        title:    (w.title ?? '?').slice(0, 80),
        year:     w.publication_year,
        cited:    w.cited_by_count ?? 0,
        refs:     w.referenced_works_count ?? 0,
        fields,
        abstract,
        // хранить referenced_works для построения рёбер
        _refsRaw: null,
      });
    }
    console.log(`Найдено статей: ${this.papers.size}`);
  }

  // Загрузить referenced_works для каждой статьи и построить рёбра
  async fetchCitations() {
    const ids   = [...this.papers.keys()].slice(0, 30);
    const idSet = new Set(ids);
    let done    = 0;

    for (const id of ids) {
      try {
        await sleep(120); // polite pool допускает ~10 req/sec

        // OpenAlex: GET /works/W123 возвращает referenced_works[]
        const shortId = id.replace('https://openalex.org/', '');
        const work    = await oa(`/works/${shortId}`, {
          select: 'id,referenced_works,concepts',
        });

        const myFields = new Set(
          (work.concepts ?? []).filter(c => c.level <= 1).map(conceptName)
        );

        for (const refId of work.referenced_works ?? []) {
          if (idSet.has(refId)) {
            // refId дала идею work (id)
            const refPaper = this.papers.get(refId);
            const refFields = refPaper?.fields ?? [];
            this.edges.push({ from: refId, to: id, fields: refFields });
          }
        }

        done++;
        process.stdout.write(`  загружено ${done}/${ids.length}...\r`);
      } catch (e) {
        // пропускаем недоступные
      }
    }
    console.log(`\nРёбра цитирований: ${this.edges.length}`);
  }

  // Построить метрики прорыва
  analyze() {
    const metrics = new Map();

    for (const [id, p] of this.papers) {
      metrics.set(id, {
        ...p,
        gifted:      0,
        received:    0,
        crossDomains: new Set(),
        ownFields:   new Set(p.fields),
      });
    }

    for (const { from, to, fields } of this.edges) {
      const giver    = metrics.get(from);
      const receiver = metrics.get(to);
      if (!giver || !receiver) continue;

      giver.gifted++;
      receiver.received++;

      // Кросс-доменный вклад: поля дарителя которых нет у получателя
      for (const f of fields) {
        if (!receiver.ownFields.has(f)) {
          receiver.crossDomains.add(f);
        }
      }
    }

    const results = [];
    for (const [id, m] of metrics) {
      const surplus     = m.gifted - m.received;
      const crossScore  = m.crossDomains.size;
      const globalCited = m.cited;

      // Паттерн Накамуры:
      //   surplus > 0: даёт больше чем получает
      //   crossScore > 0: цитируется из других областей
      //   globalCited мало: мейнстрим не заметил
      const breakScore = (surplus + crossScore * 2) / (1 + Math.log10(1 + globalCited));

      results.push({
        id,
        title:       m.title,
        year:        m.year,
        fields:      [...m.ownFields].join(', '),
        gifted:      m.gifted,
        received:    m.received,
        surplus,
        crossDomains: crossScore,
        globalCited,
        breakScore:  parseFloat(breakScore.toFixed(3)),
        abstract:    m.abstract,
      });
    }

    return results.sort((a, b) => b.breakScore - a.breakScore);
  }

  async run() {
    await this.fetchPapers();
    await this.fetchCitations();
    return this.analyze();
  }
}
