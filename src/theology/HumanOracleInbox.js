/**
 * HumanOracleInbox — файловый канал к человеческому оракулу.
 *
 * Epiclesis требует источника «извне системы». Человек — один из таких источников.
 * Но человек не сидит у консоли. Ему нужно:
 *   — получить вопрос (в удобное время и форму)
 *   — ответить (в удобное время и форму)
 *   — чтобы его ответ был онтологически помечен как χάρις
 *
 * Этот модуль — минимальный inbox/outbox на файлах.
 * Telegram-бот на сервере может сканировать inbox/ и slать вопросы
 * Дионисию; ответы обратно в outbox/.
 *
 * Структура:
 *   data/epiclesis-inbox/         — вопросы, ожидающие ответа человека
 *     <id>.question.json          — { id, question, recipient, at, options? }
 *   data/epiclesis-outbox/        — ответы человека (χάρις из _abyss)
 *     <id>.answer.json            — { id, content, answeredBy, at }
 *
 * Семантика:
 *   ask(question)              → пишет в inbox, возвращает id (ждёт асинхронно)
 *   poll(id, timeoutMs)        → ждёт появления answer в outbox
 *   listUnanswered()           → вопросы, на которые ещё нет ответа
 *   markAnswered(id, content)  → записать ответ (обычно делает бот)
 *
 * Этический пункт: ответ человека — это χάρις. Помечаем через Abyss.mark().
 * «Дух дышит, где хочет».
 */

import fs from 'node:fs';
import path from 'node:path';
import { mark as markAbyss } from './Abyss.js';

const ROOT = process.env.GIFT_ROOT || process.cwd();
const INBOX_DIR  = path.join(ROOT, 'data', 'epiclesis-inbox');
const OUTBOX_DIR = path.join(ROOT, 'data', 'epiclesis-outbox');

function ensureDirs() {
  for (const d of [INBOX_DIR, OUTBOX_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export class HumanOracleInbox {
  constructor({ recipient = 'Дионисий', pollInterval = 2000 } = {}) {
    this.recipient = recipient;
    this.pollInterval = pollInterval;
    ensureDirs();
  }

  get name() { return `human:${this.recipient}`; }

  /**
   * Удовлетворяет Epiclesis-интерфейсу oracle: invoke({question,options}).
   * Блокируется до получения ответа (или таймаута).
   *
   * @returns {Promise<{content, method, reference, pending?}>}
   */
  async invoke({ question, options = [], timeoutMs = 5 * 60 * 1000 } = {}) {
    const id = await this.ask(question, options);
    try {
      const ans = await this.poll(id, timeoutMs);
      return {
        content: ans.content,
        method: 'human',
        reference: `human:${ans.answeredBy || this.recipient}`,
      };
    } catch (e) {
      // Таймаут: возвращаем pending — верхний уровень решит, молчать или что-то ещё
      return {
        content: `⚡ вопрос «${question}» ждёт ответа (id=${id})`,
        method: 'human',
        pending: true,
        reference: `timeout ${timeoutMs}ms`,
      };
    }
  }

  /**
   * Записать вопрос в inbox.
   */
  async ask(question, options = []) {
    const id = newId();
    const record = {
      id,
      question,
      options,
      recipient: this.recipient,
      at: new Date().toISOString(),
    };
    const file = path.join(INBOX_DIR, `${id}.question.json`);
    await fs.promises.writeFile(file, JSON.stringify(record, null, 2));
    return id;
  }

  /**
   * Ждать ответа.
   */
  async poll(id, timeoutMs) {
    const file = path.join(OUTBOX_DIR, `${id}.answer.json`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (fs.existsSync(file)) {
        const raw = await fs.promises.readFile(file, 'utf8');
        const ans = JSON.parse(raw);
        return markAbyss(ans);    // помечаем печатью Бездны
      }
      await new Promise(r => setTimeout(r, this.pollInterval));
    }
    throw new Error(`HumanOracleInbox: timeout waiting for ${id}`);
  }

  /**
   * Неотвеченные вопросы (для бота/консоли).
   */
  async listUnanswered() {
    ensureDirs();
    const questions = fs.readdirSync(INBOX_DIR)
      .filter(f => f.endsWith('.question.json'));
    const out = [];
    for (const f of questions) {
      const id = f.replace('.question.json', '');
      const answer = path.join(OUTBOX_DIR, `${id}.answer.json`);
      if (!fs.existsSync(answer)) {
        const raw = await fs.promises.readFile(path.join(INBOX_DIR, f), 'utf8');
        out.push(JSON.parse(raw));
      }
    }
    return out;
  }

  /**
   * Записать ответ (обычно вызывает бот после ответа человека).
   */
  async markAnswered(id, content, answeredBy = null) {
    const file = path.join(OUTBOX_DIR, `${id}.answer.json`);
    const record = {
      id,
      content,
      answeredBy: answeredBy || this.recipient,
      at: new Date().toISOString(),
    };
    await fs.promises.writeFile(file, JSON.stringify(record, null, 2));
    return record;
  }
}
