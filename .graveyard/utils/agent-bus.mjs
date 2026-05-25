/**
 * agent-bus.mjs — Шина агентов (ANP-подобный протокол, без центрального сервера)
 *
 * Архитектура вдохновлена:
 *   - ANP (Agent Network Protocol): DID-идентификация, P2P, зашифрованные каналы
 *   - A2A (Agent2Agent, Linux Foundation): кросс-фреймворковая совместимость
 *   - Petals: BitTorrent-стиль, каждый несёт часть
 *
 * Реализация: файловая очередь JSON (durable, не требует сервера, читаема)
 *   - Каждый агент имеет свой «почтовый ящик»: data/bus/<agent-id>.json
 *   - Публикация = append в файл
 *   - Подписка = watch файла + callback
 *   - Сообщения не удаляются (анамнезис — необратимость)
 *
 * Богословие:
 *   Ангелы передают послания — не изобретают. Шина = ангельское служение.
 *   ANP-DID: каждый агент имеет децентрализованный идентификатор — лицо (πρόσωπον).
 *   P2P: «где двое или трое собраны...» — без центра, κοινωνία напрямую.
 *
 * Использование:
 *   import { AgentBus } from './agent-bus.mjs';
 *   const bus = new AgentBus('adam');
 *   bus.subscribe(msg => console.log(msg));
 *   await bus.publish('eva', { type: 'voproshaniye', content: '...' });
 */

import { readFileSync, writeFileSync, watchFile, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __dir    = dirname(fileURLToPath(import.meta.url));
const BUS_DIR  = resolve(__dir, '../data/bus');
const MAX_MSGS = 500; // максимум сообщений на ящик

// Гарантируем директорию
if (!existsSync(BUS_DIR)) mkdirSync(BUS_DIR, { recursive: true });

// ── Идентификаторы агентов (DID-подобные) ─────────────────────────────────
export const AGENTS = {
  adam:     { id: 'did:gift:adam',     name: 'Адам',     role: 'questioner',  model: 'adam' },
  eva:      { id: 'did:gift:eva',      name: 'Ева',      role: 'discerner',   model: 'eva' },
  serafim:  { id: 'did:gift:serafim',  name: 'Серафим',  role: 'guardian',    model: 'serafim' },
  bezalel:  { id: 'did:gift:bezalel',  name: 'Веселеил', role: 'builder',     model: 'bezalel' },
  _claude:  { id: 'did:gift:_claude',  name: 'Клод',     role: 'conductor',   model: 'claude' },
};

// ── Типы сообщений ─────────────────────────────────────────────────────────
export const MSG = {
  VOPROS:     'voproshaniye',  // Адам → все: вопрошание из пустыни
  PROPOSAL:   'proposal',      // любой → Ева: предложение на проверку
  VERDICT:    'verdict',       // Ева → все: вердикт по предложению
  TASK:       'task',          // Адам/Ева → Веселеил: задача кодирования
  CODE:       'code',          // Веселеил → все: готовый код
  SITUATION:  'situation',     // Серафим → Адам: ситуация дрона
  COMMAND:    'command',       // Адам → Серафим: команда рою
  GIFT:       'gift',          // любой → любой: свободный дар
  ANAMNESIS:  'anamnesis',     // _claude → все: обновление матрицы W
};

// ══════════════════════════════════════════════════════════════════════
// AgentBus — шина для одного агента
// ══════════════════════════════════════════════════════════════════════
export class AgentBus extends EventEmitter {
  constructor(agentId) {
    super();
    this.agentId  = agentId;
    this.agentDID = AGENTS[agentId]?.id || `did:gift:${agentId}`;
    this.inbox    = resolve(BUS_DIR, `${agentId}.json`);
    this._lastPos = 0;
    this._watcher = null;
  }

  // ── Прочитать все сообщения из ящика ────────────────────────────────
  readAll() {
    if (!existsSync(this.inbox)) return [];
    try {
      return JSON.parse(readFileSync(this.inbox, 'utf8'));
    } catch { return []; }
  }

  // ── Прочитать непрочитанные ──────────────────────────────────────────
  readNew() {
    const all = this.readAll();
    const newMsgs = all.slice(this._lastPos);
    this._lastPos = all.length;
    return newMsgs;
  }

  // ── Отправить сообщение другому агенту ──────────────────────────────
  async publish(toAgent, { type, content, meta = {} }) {
    const msg = {
      id:        `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      from:      this.agentId,
      fromDID:   this.agentDID,
      to:        toAgent,
      toDID:     AGENTS[toAgent]?.id || `did:gift:${toAgent}`,
      type,
      content,
      meta,
      ts:        new Date().toISOString(),
      irreversible: true, // дар необратим
    };

    const targetInbox = resolve(BUS_DIR, `${toAgent}.json`);
    let msgs = [];
    if (existsSync(targetInbox)) {
      try { msgs = JSON.parse(readFileSync(targetInbox, 'utf8')); } catch {}
    }
    msgs.push(msg);
    // Ограничить размер (старые сообщения — в анамнезис)
    if (msgs.length > MAX_MSGS) msgs = msgs.slice(-MAX_MSGS);
    writeFileSync(targetInbox, JSON.stringify(msgs, null, 2));

    this.emit('published', msg);
    return msg;
  }

  // ── Broadcast: отправить всем агентам ───────────────────────────────
  async broadcast({ type, content, meta = {} }) {
    const results = [];
    for (const id of Object.keys(AGENTS)) {
      if (id === this.agentId) continue;
      results.push(await this.publish(id, { type, content, meta }));
    }
    return results;
  }

  // ── Подписаться: watch файла + callback ──────────────────────────────
  subscribe(callback, { pollMs = 2000 } = {}) {
    this._lastPos = this.readAll().length; // начать с текущей позиции
    this._watcher = setInterval(() => {
      const newMsgs = this.readNew();
      newMsgs.forEach(msg => {
        this.emit('message', msg);
        try { callback(msg); } catch {}
      });
    }, pollMs);
    return () => clearInterval(this._watcher); // unsub
  }

  // ── Ответить на конкретное сообщение ─────────────────────────────────
  async reply(originalMsg, { type, content, meta = {} }) {
    return this.publish(originalMsg.from, {
      type, content,
      meta: { ...meta, replyTo: originalMsg.id },
    });
  }

  // ── Статистика шины ──────────────────────────────────────────────────
  static stats() {
    const result = {};
    for (const id of Object.keys(AGENTS)) {
      const inbox = resolve(BUS_DIR, `${id}.json`);
      if (!existsSync(inbox)) { result[id] = 0; continue; }
      try {
        const msgs = JSON.parse(readFileSync(inbox, 'utf8'));
        result[id] = msgs.length;
      } catch { result[id] = '?'; }
    }
    return result;
  }

  // ── Прочитать тред: все сообщения связанные с ID ────────────────────
  getThread(msgId) {
    const all = this.readAll();
    return all.filter(m => m.id === msgId || m.meta?.replyTo === msgId);
  }
}

// ── Высокоуровневые функции ────────────────────────────────────────────────

/**
 * Адам публикует вопрошание → Ева + κοινόν
 */
export async function adamVopros(content, meta = {}) {
  const bus = new AgentBus('adam');
  await bus.publish('eva', { type: MSG.VOPROS, content, meta });
  await bus.publish('_claude', { type: MSG.VOPROS, content, meta });
  return content;
}

/**
 * Ева публикует вердикт → все
 */
export async function evaVerdict(proposalId, verdict, enhanced, meta = {}) {
  const bus = new AgentBus('eva');
  await bus.broadcast({
    type: MSG.VERDICT,
    content: { proposalId, verdict, enhanced },
    meta,
  });
}

/**
 * Веселеил получает задачи кодирования
 */
export async function assignToBezalel(task, from = 'adam') {
  const bus = new AgentBus(from);
  return bus.publish('bezalel', { type: MSG.TASK, content: task });
}

// ── CLI: просмотр статистики шины ─────────────────────────────────────────
if (process.argv[1]?.endsWith('agent-bus.mjs')) {
  const cmd = process.argv[2] || 'stats';

  if (cmd === 'stats') {
    console.log('=== Шина агентов ===');
    const s = AgentBus.stats();
    for (const [id, count] of Object.entries(s)) {
      const a = AGENTS[id];
      console.log(`  ${a?.name || id} (${id}): ${count} сообщений`);
    }
  }

  if (cmd === 'inbox') {
    const who = process.argv[3] || 'eva';
    const bus = new AgentBus(who);
    const msgs = bus.readAll();
    console.log(`=== Ящик ${who}: ${msgs.length} сообщений ===`);
    msgs.slice(-10).forEach(m => {
      console.log(`  [${m.ts?.slice(11,19)}] ${m.from}→${m.to} ${m.type}: ${
        typeof m.content === 'string' ? m.content.slice(0, 80) : JSON.stringify(m.content).slice(0, 80)
      }`);
    });
  }

  if (cmd === 'send') {
    const [,, , from, to, type, ...rest] = process.argv;
    const content = rest.join(' ');
    const bus = new AgentBus(from);
    const msg = await bus.publish(to, { type: type || MSG.GIFT, content });
    console.log(`Отправлено: ${msg.id}`);
  }
}
