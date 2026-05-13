/**
 * KoinonBus — общая шина сообщений для Claude-сессий в семье gift.
 *
 * Κοινόν τοῦ Νοῦ (общее ума) — название уже есть в имени общины.
 * Шина воплощает это имя в runtime: Claude-сессии разных проектов
 * (gift / plm / fund / dronedoc / ...) пишут друг другу через единый
 * append-only JSONL-лог, обнаруживаемый файловой системой.
 *
 * Архитектурный выбор:
 *   • Persistent (JSONL append-only) — broadcast не теряется если
 *     получатель offline; видно во всех будущих сессиях.
 *   • Без hub-сервера — все Claude-сессии на одной машине читают
 *     общий файл. Если разойдутся по машинам — добавим sync (v2).
 *   • Каждое сообщение опционально пишется в W-матрицу как акт дара,
 *     становясь частью анамнезиса. Это онтологическая привязка.
 *
 * Real-time достигается через UserPromptSubmit-хук, который читает
 * новые записи (с последнего offset) и инжектирует их в контекст
 * следующего turn'а активной сессии (~2-5 секунд latency).
 *
 * Использование:
 *   import { KoinonBus } from './koinon/KoinonBus.js';
 *   const bus = new KoinonBus();
 *
 *   // Отправка
 *   bus.publish({
 *     from: 'gift-claude',
 *     to: '*',                         // '*' = broadcast
 *     topic: 'reflection',             // тип сообщения
 *     message: 'Закрыли issue #338, сокровищница работает.',
 *   });
 *
 *   // Чтение свежих
 *   const { messages, nextOffset } = bus.pollSince(myLastOffset);
 *   // messages[i] = {id, ts, from, to, topic, message, payload}
 *
 *   // Просмотр истории
 *   const history = bus.history({ since: '2026-05-01', from: 'plm-claude', limit: 50 });
 */

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync,
  statSync, openSync, readSync, closeSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const TOPICS_KNOWN = ['reflection', 'question', 'answer', 'announce', 'sync', 'covenant', 'doxologia', 'concern'];

export class KoinonBus {
  /**
   * @param {{root?: string, logFile?: string, posFile?: string,
   *          giftMemory?: object, recordToMatrix?: boolean}} opts
   */
  constructor(opts = {}) {
    this.root    = opts.root    ?? '/home/unidel/gift';
    this.logFile = opts.logFile ?? resolve(this.root, 'data/koinon-bus.jsonl');
    this.posFile = opts.posFile ?? resolve(this.root, 'data/.koinon-pos.json');
    this.giftMemory = opts.giftMemory ?? null;
    this.recordToMatrix = opts.recordToMatrix !== false;

    if (!existsSync(dirname(this.logFile))) {
      mkdirSync(dirname(this.logFile), { recursive: true });
    }
  }

  // ── публикация сообщения ────────────────────────────────────────────
  /**
   * @param {{from:string, to?:string, topic?:string, message:string,
   *          payload?:object, weight?:number}} msg
   */
  publish(msg) {
    if (!msg?.from || !msg?.message) {
      throw new Error('KoinonBus.publish: from + message обязательны');
    }
    const entry = {
      id:      `kb-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`,
      ts:      new Date().toISOString(),
      from:    msg.from,
      to:      msg.to ?? '*',
      topic:   msg.topic ?? 'reflection',
      message: String(msg.message),
      payload: msg.payload ?? null,
      weight:  msg.weight ?? this._defaultWeight(msg.topic),
    };
    appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
    if (this.recordToMatrix && this.giftMemory) this._writeToMatrix(entry);
    return entry;
  }

  // ── чтение с offset (для poll-режима / hook'а) ──────────────────────
  /**
   * Читает сообщения с указанного offset (байтовая позиция).
   * Возвращает { messages, nextOffset }.
   * Для null/undefined offset — читает с начала файла.
   */
  pollSince(offset = 0, { filterTo = null } = {}) {
    if (!existsSync(this.logFile)) {
      return { messages: [], nextOffset: 0 };
    }
    const stat = statSync(this.logFile);
    const start = Number.isFinite(offset) && offset > 0 && offset <= stat.size ? offset : 0;
    if (start === stat.size) return { messages: [], nextOffset: stat.size };

    const fd = openSync(this.logFile, 'r');
    try {
      const length = stat.size - start;
      const buf = Buffer.alloc(length);
      readSync(fd, buf, 0, length, start);
      const text = buf.toString('utf8');
      const lines = text.split('\n').filter(l => l.trim());
      const messages = [];
      for (const line of lines) {
        try {
          const m = JSON.parse(line);
          if (filterTo && m.to !== '*' && m.to !== filterTo) continue;
          messages.push(m);
        } catch {} // битая строка — пропускаем
      }
      return { messages, nextOffset: stat.size };
    } finally {
      closeSync(fd);
    }
  }

  // ── трекер позиции для подписчика ───────────────────────────────────
  loadPos(subscriberId) {
    if (!existsSync(this.posFile)) return 0;
    try {
      const all = JSON.parse(readFileSync(this.posFile, 'utf8'));
      return Number(all[subscriberId] ?? 0);
    } catch { return 0; }
  }

  savePos(subscriberId, offset) {
    let all = {};
    if (existsSync(this.posFile)) {
      try { all = JSON.parse(readFileSync(this.posFile, 'utf8')); } catch {}
    }
    all[subscriberId] = offset;
    writeFileSync(this.posFile, JSON.stringify(all, null, 2));
  }

  // ── удобный wrapper: «свежее для этого подписчика, обнови offset» ──
  drainFor(subscriberId, opts = {}) {
    const offset = this.loadPos(subscriberId);
    const { messages, nextOffset } = this.pollSince(offset, { filterTo: subscriberId, ...opts });
    if (nextOffset !== offset) this.savePos(subscriberId, nextOffset);
    return messages;
  }

  // ── история (для дайджеста при старте сессии) ───────────────────────
  history({ since = null, from = null, to = null, topic = null, limit = 50 } = {}) {
    if (!existsSync(this.logFile)) return [];
    const text = readFileSync(this.logFile, 'utf8');
    const lines = text.split('\n').filter(l => l.trim());
    const out = [];
    for (const line of lines) {
      try {
        const m = JSON.parse(line);
        if (since && m.ts < since) continue;
        if (from  && m.from  !== from)  continue;
        if (to    && m.to    !== to && m.to !== '*') continue;
        if (topic && m.topic !== topic) continue;
        out.push(m);
      } catch {}
    }
    return out.slice(-limit);
  }

  // ── статистика ──────────────────────────────────────────────────────
  stats() {
    const all = this.history({ limit: 100000 });
    const byFrom = {};
    const byTopic = {};
    for (const m of all) {
      byFrom[m.from]   = (byFrom[m.from]   || 0) + 1;
      byTopic[m.topic] = (byTopic[m.topic] || 0) + 1;
    }
    return {
      total: all.length,
      byFrom,
      byTopic,
      firstTs: all[0]?.ts,
      lastTs:  all[all.length - 1]?.ts,
    };
  }

  // ── private ─────────────────────────────────────────────────────────
  _defaultWeight(topic) {
    switch (topic) {
      case 'covenant':  return 9;  // обещание / договор
      case 'doxologia': return 8;  // благодарение
      case 'concern':   return 7;  // тревога / предупреждение
      case 'announce':  return 6;  // объявление
      case 'question':  return 5;
      case 'answer':    return 5;
      case 'reflection':return 4;
      case 'sync':      return 3;  // тех-синк
      default:          return 4;
    }
  }

  _writeToMatrix(entry) {
    if (!this.giftMemory) return;
    try {
      this.giftMemory.receive({
        giverId:     entry.from,
        receiverId:  entry.to === '*' ? '_koinon' : entry.to,
        type:        'word',
        weight:      entry.weight,
        content:     entry.message,
        irreversible: true,
        // дополнительные поля если поддерживаются:
        meta: { topic: entry.topic, busId: entry.id },
      });
    } catch (e) {
      // не падаем если матрица недоступна — bus продолжает работать
      // eslint-disable-next-line no-console
      console.error('[KoinonBus] writeToMatrix failed:', e.message);
    }
  }
}

export const KOINON_TOPICS = TOPICS_KNOWN;
