#!/usr/bin/env node
/**
 * gift-zulip.mjs — Легковесная среда общения Мета КБ
 *
 * Реверс-инжиниринг ключевых фич Zulip:
 *   1. Стримы = домены проектирования (aerodynamics, materials, ...)
 *   2. Топики = обсуждения внутри стрима (CLARK-Y-profile, wing-load)
 *   3. Сообщения = акты дара знания в топике
 *   4. Поиск = по стримам, топикам, авторам, содержимому
 *   5. API = агенты читают/пишут программно
 *
 * Хранение: JSONL (append-only), совместимо с git.
 * Интеграция: каждый топик → evidence в REG DecisionGraph.
 *
 * Закон Рида: каждый топик может объединить любую комбинацию кентавров.
 *
 * Использование:
 *   node utils/gift-zulip.mjs stream create --name aerodynamics
 *   node utils/gift-zulip.mjs topic create --stream aerodynamics --name "CLARK-Y profile"
 *   node utils/gift-zulip.mjs post --topic "CLARK-Y profile" --content "..."
 *   node utils/gift-zulip.mjs search --query "резонанс"
 *   node utils/gift-zulip.mjs read --topic "CLARK-Y profile"
 *   node utils/gift-zulip.mjs streams
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZULIP_DIR = resolve(ROOT, 'data', 'zulip');
const STREAMS_FILE = resolve(ZULIP_DIR, 'streams.json');
const MSGS_DIR = resolve(ZULIP_DIR, 'messages');

function ensure() {
  if (!existsSync(ZULIP_DIR)) mkdirSync(ZULIP_DIR, { recursive: true });
  if (!existsSync(MSGS_DIR)) mkdirSync(MSGS_DIR, { recursive: true });
}

function loadStreams() {
  ensure();
  try { return existsSync(STREAMS_FILE) ? JSON.parse(readFileSync(STREAMS_FILE, 'utf8')) : []; }
  catch { return []; }
}
function saveStreams(streams) {
  writeFileSync(STREAMS_FILE, JSON.stringify(streams, null, 2));
}

function topicFile(streamName, topicName) {
  const safe = `${streamName}__${topicName}`.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_');
  return resolve(MSGS_DIR, `${safe}.jsonl`);
}

// ── Streams ──────────────────────────────────────────────────────────────────

export function createStream(name, description = '') {
  ensure();
  const streams = loadStreams();
  if (streams.find(s => s.name === name)) return { error: 'stream exists', name };
  const s = { name, description, created: new Date().toISOString(), topics: [] };
  streams.push(s);
  saveStreams(streams);
  return s;
}

export function listStreams() {
  return loadStreams();
}

// ── Topics ───────────────────────────────────────────────────────────────────

export function createTopic(streamName, topicName, createdBy = 'unknown') {
  const streams = loadStreams();
  const stream = streams.find(s => s.name === streamName);
  if (!stream) return { error: 'stream not found', streamName };

  if (stream.topics.find(t => t.name === topicName)) {
    return { error: 'topic exists', streamName, topicName };
  }

  const topic = { name: topicName, createdBy, created: new Date().toISOString(), messageCount: 0 };
  stream.topics.push(topic);
  saveStreams(streams);
  return topic;
}

export function listTopics(streamName) {
  const streams = loadStreams();
  const stream = streams.find(s => s.name === streamName);
  return stream ? stream.topics : [];
}

// ── Messages ─────────────────────────────────────────────────────────────────

export function postMessage(streamName, topicName, content, author = null) {
  const streams = loadStreams();
  const stream = streams.find(s => s.name === streamName);
  if (!stream) return { error: 'stream not found', streamName };

  const topic = stream.topics.find(t => t.name === topicName);
  if (!topic) return { error: 'topic not found', topicName };

  const agent = author || process.env.GIFT_AGENT_ID || 'unknown';
  const msg = {
    ts: new Date().toISOString(),
    author: agent,
    content: content.slice(0, 4000),
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
  };

  const file = topicFile(streamName, topicName);
  writeFileSync(file, JSON.stringify(msg) + '\n', { flag: 'a' });

  topic.messageCount++;
  topic.lastMessage = msg.ts;
  saveStreams(streams);

  return msg;
}

export function readTopic(streamName, topicName, limit = 50) {
  const file = topicFile(streamName, topicName);
  if (!existsSync(file)) return [];

  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  return lines.slice(-limit).map(JSON.parse);
}

// ── Search ───────────────────────────────────────────────────────────────────

export function search(query, { streamName = null, author = null, limit = 30 } = {}) {
  ensure();
  const results = [];
  const ql = query.toLowerCase();

  const files = readdirSync(MSGS_DIR).filter(f => f.endsWith('.jsonl'));
  for (const f of files) {
    const [streamName_, topicName_] = f.replace('.jsonl', '').split('__');
    if (streamName && streamName_ !== streamName) continue;

    const lines = readFileSync(resolve(MSGS_DIR, f), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (author && msg.author !== author) continue;
        if (ql && !msg.content.toLowerCase().includes(ql)) continue;

        results.push({ stream: streamName_, topic: topicName_, ...msg });
      } catch {}
    }
  }

  return results.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit);
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function stats() {
  ensure();
  const streams = loadStreams();
  let totalTopics = 0, totalMsgs = 0;
  const authors = new Set();

  const files = readdirSync(MSGS_DIR).filter(f => f.endsWith('.jsonl'));
  for (const f of files) {
    const lines = readFileSync(resolve(MSGS_DIR, f), 'utf8').split('\n').filter(Boolean);
    totalMsgs += lines.length;
    for (const line of lines) {
      try { authors.add(JSON.parse(line).author); } catch {}
    }
  }

  for (const s of streams) {
    totalTopics += s.topics.length;
    const realCount = s.topics.reduce((sum, t) => sum + t.messageCount, 0);
    if (realCount === 0) {
      // Check actual file
      for (const t of s.topics) {
        const tf = topicFile(s.name, t.name);
        if (existsSync(tf)) {
          const n = readFileSync(tf, 'utf8').split('\n').filter(Boolean).length;
          t.messageCount = n;
        }
      }
    }
  }

  return {
    streams: streams.length,
    topics: totalTopics,
    messages: totalMsgs,
    authors: authors.size,
    reedPotential: Math.pow(2, authors.size),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
const CMD = process.argv[2];

if (CMD === 'stream') {
  const action = process.argv[3];
  if (action === 'create') {
    const name = process.argv.find((_, i) => process.argv[i-1] === '--name');
    const desc = process.argv.find((_, i) => process.argv[i-1] === '--desc') || '';
    if (!name) { console.error('stream create --name <name> [--desc "..."]'); process.exit(1); }
    const r = createStream(name, desc);
    console.log(JSON.stringify(r, null, 2));
  }
} else if (CMD === 'streams') {
  console.log(JSON.stringify(listStreams(), null, 2));
} else if (CMD === 'topic') {
  const action = process.argv[3];
  const stream = process.argv.find((_, i) => process.argv[i-1] === '--stream');
  const name = process.argv.find((_, i) => process.argv[i-1] === '--name');
  if (action === 'create' && stream && name) {
    console.log(JSON.stringify(createTopic(stream, name), null, 2));
  } else if (action === 'list' && stream) {
    console.log(JSON.stringify(listTopics(stream), null, 2));
  } else {
    console.error('topic create --stream <s> --name <t> | topic list --stream <s>');
    process.exit(1);
  }
} else if (CMD === 'post') {
  const stream = process.argv.find((_, i) => process.argv[i-1] === '--stream') || 'general';
  const topic = process.argv.find((_, i) => process.argv[i-1] === '--topic');
  const content = process.argv.find((_, i) => process.argv[i-1] === '--content');
  if (!topic || !content) { console.error('post --topic <t> [--stream <s>] --content "..."'); process.exit(1); }
  const r = postMessage(stream, topic, content);
  console.log(JSON.stringify(r, null, 2));
  console.log(`  ✓ Сообщение в ${stream}/${topic}`);
} else if (CMD === 'read') {
  const stream = process.argv.find((_, i) => process.argv[i-1] === '--stream') || 'general';
  const topic = process.argv.find((_, i) => process.argv[i-1] === '--topic');
  if (!topic) { console.error('read --topic <t> [--stream <s>]'); process.exit(1); }
  const msgs = readTopic(stream, topic);
  for (const m of msgs) {
    console.log(`[${m.ts.slice(11,19)}] ${m.author}: ${m.content.slice(0, 150)}`);
  }
  console.log(`  ── ${msgs.length} сообщений ──`);
} else if (CMD === 'search') {
  const query = process.argv.find((_, i) => process.argv[i-1] === '--query') || '';
  const stream = process.argv.find((_, i) => process.argv[i-1] === '--stream');
  const author = process.argv.find((_, i) => process.argv[i-1] === '--author');
  const results = search(query, { streamName: stream, author });
  console.log(JSON.stringify(results, null, 2));
  console.log(`\n  Найдено: ${results.length} сообщений`);
} else if (CMD === 'stats') {
  console.log(JSON.stringify(stats(), null, 2));
} else if (CMD === 'demo') {
  console.log('  Загружаю демо-данные Zulip...');

  createStream('aerodynamics', 'Аэродинамика и профили крыла');
  createStream('materials', 'Материалы и композиты');
  createStream('propulsion', 'Силовые установки');
  createStream('avionics', 'Авионика и управление');

  createTopic('aerodynamics', 'CLARK-Y-profile', 'Петров');
  createTopic('aerodynamics', 'NACA-rejection', 'Иванов');
  createTopic('materials', 'carbon-3k-tests', 'Сидоров');
  createTopic('materials', 'delamination-problem', 'Петров');
  createTopic('propulsion', 'X450-resonance', 'Козлов');
  createTopic('avionics', 'Cube-Orange-setup', 'Петров');

  postMessage('aerodynamics', 'CLARK-Y-profile',
    'Расчёт показывает Су=0.45 на скорости 15 м/с. Подходит для 5кг.', 'Петров');
  postMessage('aerodynamics', 'CLARK-Y-profile',
    'Проверил CFD — ламинарный обрыв на 40% хорды. Нужна турбулизация.', 'Иванов');
  postMessage('aerodynamics', 'NACA-rejection',
    'NACA 2412 даёт Сх на 15% выше чем CLARK-Y на целевой скорости. Отклоняем.', 'Иванов');
  postMessage('materials', 'carbon-3k-tests',
    'Испытания углепластика 3K: прочность 450 МПа, вес 340г/м². Проходит.', 'Сидоров');
  postMessage('materials', 'carbon-3k-tests',
    'Важно: ориентация волокон ±45° даёт максимальную жёсткость на кручение.', 'Сидоров');
  postMessage('materials', 'delamination-problem',
    'На 4-м часу виброиспытаний — расслоение у корня. Частота 120 Hz.', 'Петров');
  postMessage('materials', 'delamination-problem',
    'Предлагаю усилить корневую зону дополнительным слоем с ориентацией 0/90.', 'Сидоров');
  postMessage('propulsion', 'X450-resonance',
    'Двигатель X450 на 3000 RPM даёт резонанс с крылом из углепластика. Амплитуда 2.3мм.', 'Козлов');
  postMessage('propulsion', 'X450-resonance',
    'Варианты: (1) демпфер, (2) смена материала крыла, (3) ограничение RPM до 2500.', 'Козлов');
  postMessage('avionics', 'Cube-Orange-setup',
    'Контроллер Cube Orange+ прошит ArduPilot 4.5. Вес 73г. Совместим с X450 по ШИМ.', 'Петров');

  const s = stats();
  console.log(`  ✓ Загружено: ${s.streams} стримов, ${s.topics} топиков, ${s.messages} сообщений`);
  console.log(`  Авторов: ${s.authors}, потенциал Рида: 2^${s.authors} ≈ ${s.reedPotential.toLocaleString()}`);
  console.log(`\n  Готово. Попробуй:`);
  console.log(`    node utils/gift-zulip.mjs read --stream aerodynamics --topic "CLARK-Y-profile"`);
  console.log(`    node utils/gift-zulip.mjs search --query "резонанс"`);
} else {
  console.error('gift-zulip: stream | topic | post | read | search | stats | demo');
  process.exit(1);
}
} // end CLI
