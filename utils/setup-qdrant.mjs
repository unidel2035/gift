/**
 * setup-qdrant.mjs — Qdrant векторная БД для онтологии дара
 *
 * Qdrant (Rust, MIT): production-grade, Node.js client, self-hosted.
 * Заменяет SQLite spec-vectors.db на полноценный vector store.
 *
 * Запуск Qdrant локально (Docker):
 *   docker run -p 6333:6333 -v $(pwd)/data/qdrant:/qdrant/storage qdrant/qdrant
 *
 * Или без Docker (binary):
 *   curl -L https://github.com/qdrant/qdrant/releases/latest/download/qdrant-x86_64-unknown-linux-musl.tar.gz | tar xz
 *   ./qdrant
 *
 * Использование:
 *   node utils/setup-qdrant.mjs              — создать коллекции
 *   node utils/setup-qdrant.mjs index        — переиндексировать spec-vectors.db
 *   node utils/setup-qdrant.mjs search "дар" — найти похожие спецификации
 */

const QDRANT_URL  = process.env.QDRANT_URL  || 'http://localhost:6333';
const OLLAMA_URL  = process.env.OLLAMA_URL  || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const VECTOR_DIM  = 768; // nomic-embed-text размерность

// ── REST API к Qdrant (без внешних зависимостей) ────────────────────────────
async function qdrant(method, path, body) {
  const res = await fetch(`${QDRANT_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Qdrant ${method} ${path}: ${res.status} ${err.slice(0, 200)}`);
  }
  return res.json();
}

async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Embed ${res.status}`);
  const data = await res.json();
  return data.embedding;
}

// ── Коллекции онтологии ────────────────────────────────────────────────────
export const COLLECTIONS = {
  specs:    { name: 'gift_specs',    dim: VECTOR_DIM, desc: '.gift спецификации' },
  acts:     { name: 'gift_acts',     dim: VECTOR_DIM, desc: 'акты дара (тексты)' },
  insights: { name: 'gift_insights', dim: VECTOR_DIM, desc: 'инсайты и богословские выводы' },
  persons:  { name: 'gift_persons',  dim: VECTOR_DIM, desc: 'профили лиц онтологии' },
};

// ── Создать коллекции ──────────────────────────────────────────────────────
export async function setupCollections() {
  // Проверить доступность Qdrant
  try {
    const health = await qdrant('GET', '/');
    console.log(`✓ Qdrant: ${JSON.stringify(health).slice(0, 60)}`);
  } catch (e) {
    console.error('✗ Qdrant недоступен:', e.message);
    console.log('\nЗапусти Qdrant:');
    console.log('  docker run -p 6333:6333 qdrant/qdrant');
    console.log('  # или: ./qdrant (бинарник)');
    return false;
  }

  for (const [key, col] of Object.entries(COLLECTIONS)) {
    try {
      // Попробовать получить коллекцию
      await qdrant('GET', `/collections/${col.name}`);
      console.log(`  ⊙ ${col.name} уже существует`);
    } catch {
      // Создать если не существует
      await qdrant('PUT', `/collections/${col.name}`, {
        vectors: {
          size:     col.dim,
          distance: 'Cosine',  // косинусное сходство для семантического поиска
        },
        optimizers_config: { default_segment_number: 2 },
        replication_factor: 1,
      });
      console.log(`  ✓ ${col.name} создана (${col.desc})`);
    }
  }
  return true;
}

// ── Векторный поиск ────────────────────────────────────────────────────────
export async function search(collectionName, query, { limit = 5, filter } = {}) {
  const vector = await embed(query);
  const body = { vector, limit, with_payload: true };
  if (filter) body.filter = filter;
  const result = await qdrant('POST', `/collections/${collectionName}/points/search`, body);
  return result.result || [];
}

// ── Добавить документ ──────────────────────────────────────────────────────
export async function upsert(collectionName, { id, text, payload = {} }) {
  const vector = await embed(text);
  await qdrant('PUT', `/collections/${collectionName}/points`, {
    points: [{ id: typeof id === 'number' ? id : hashId(id), vector, payload: { ...payload, text } }],
  });
}

function hashId(str) {
  let h = 5381;
  for (const c of str) h = ((h << 5) + h) ^ c.charCodeAt(0);
  return Math.abs(h) % 2_000_000_000;
}

// ── Переиндексировать spec-vectors.db → Qdrant ────────────────────────────
async function indexSpecs() {
  const { default: Database } = await import('better-sqlite3').catch(() => null) || {};
  if (!Database) {
    console.error('better-sqlite3 не установлен: npm install better-sqlite3');
    return;
  }
  const db = new Database('./data/spec-vectors.db', { readonly: true });
  const rows = db.prepare('SELECT * FROM specs').all();
  console.log(`Индексируем ${rows.length} спецификаций → Qdrant...`);

  let ok = 0;
  for (const row of rows) {
    try {
      await upsert(COLLECTIONS.specs.name, {
        id: row.id || row.path,
        text: row.content || row.text || row.path,
        payload: { path: row.path, ts: row.ts },
      });
      ok++;
      if (ok % 10 === 0) process.stdout.write(`  ${ok}/${rows.length}\r`);
    } catch (e) {
      console.error(`  ✗ ${row.path}: ${e.message}`);
    }
  }
  console.log(`\n✓ Проиндексировано ${ok}/${rows.length} спецификаций`);
}

// ── CLI ────────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('setup-qdrant.mjs')) {
  const cmd = process.argv[2] || 'setup';

  if (cmd === 'setup') {
    await setupCollections();
  }

  if (cmd === 'index') {
    const ok = await setupCollections();
    if (ok) await indexSpecs();
  }

  if (cmd === 'search') {
    const query = process.argv.slice(3).join(' ') || 'дар кенозис';
    console.log(`Поиск: "${query}"`);
    try {
      const results = await search(COLLECTIONS.specs.name, query, { limit: 5 });
      if (!results.length) { console.log('Нет результатов (коллекция пуста?)'); process.exit(0); }
      results.forEach((r, i) => {
        console.log(`\n[${i+1}] score=${r.score?.toFixed(3)} id=${r.id}`);
        console.log(`  ${(r.payload?.text || '').slice(0, 120)}`);
      });
    } catch (e) {
      console.error('Qdrant недоступен:', e.message);
    }
  }
}
