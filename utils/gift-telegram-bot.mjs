#!/usr/bin/env node
/**
 * gift-telegram-bot.mjs — Telegram-интерфейс Gift Protocol
 *
 * Простой бот: любой человек фиксирует дары своей общины.
 * Без регистрации, без баланса, без рейтинга.
 *
 * Запуск:
 *   GIFT_BOT_TOKEN=xxx node utils/gift-telegram-bot.mjs
 *
 * Команды:
 *   /дар Имя тип [описание]   — записать дар
 *   /зеркало                  — состояние общины
 *   /обо Имя                  — анамнезис лица
 *   /помощь                   — справка
 */

import { readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { GiftMemory } from '../src/core/GiftMemory.js';
import { CommunityDiagnostic } from '../src/core/GiftOptimizer.js';

const TOKEN     = process.env.GIFT_BOT_TOKEN;
const SNAP_PATH = './data/sacred-history-W.json';
const API       = `https://api.telegram.org/bot${TOKEN}`;

if (!TOKEN) {
  console.error('GIFT_BOT_TOKEN не задан');
  process.exit(1);
}

// ── Матрица ───────────────────────────────────────────────────────────────

function loadMem() {
  const snap = JSON.parse(readFileSync(SNAP_PATH, 'utf8'));
  return GiftMemory.fromSnapshot(snap);
}

function saveMem(mem) {
  writeFileSync(SNAP_PATH, JSON.stringify(mem.snapshot(), null, 2));
}

// ── Типы актов ────────────────────────────────────────────────────────────

const TYPES = {
  время:      { key: 'time',     weight: 10, emoji: '⏱' },
  завет:      { key: 'covenant', weight: 10, emoji: '🤝' },
  присутствие:{ key: 'presence', weight: 7,  emoji: '🕯' },
  приношение: { key: 'offering', weight: 6,  emoji: '🎁' },
  вопрос:     { key: 'question', weight: 5,  emoji: '❓' },
  код:        { key: 'code',     weight: 4,  emoji: '💻' },
  слово:      { key: 'word',     weight: 3,  emoji: '💬' },
  // Latin aliases
  time:       { key: 'time',     weight: 10, emoji: '⏱' },
  presence:   { key: 'presence', weight: 7,  emoji: '🕯' },
  code:       { key: 'code',     weight: 4,  emoji: '💻' },
  word:       { key: 'word',     weight: 3,  emoji: '💬' },
};

// ── Telegram API ──────────────────────────────────────────────────────────

async function tgCall(method, params = {}) {
  const res = await fetch(`${API}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(params),
  });
  return res.json();
}

async function send(chatId, text, extra = {}) {
  return tgCall('sendMessage', {
    chat_id:    chatId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

// ── Обработчики команд ────────────────────────────────────────────────────

// /дар Имя тип [описание]
// Пример: /дар Пётр время помог переехать
async function cmdDar(chatId, fromName, args) {
  // args: ['Пётр', 'время', 'помог', 'переехать']
  const [receiverId, typeArg, ...rest] = args;
  if (!receiverId || !typeArg) {
    return send(chatId,
      '❗ Формат: <code>/дар Имя тип [описание]</code>\n' +
      'Типы: <b>время</b> · присутствие · завет · приношение · вопрос · код · слово\n' +
      'Пример: <code>/дар Мария время помогла с переездом</code>'
    );
  }

  const typeInfo = TYPES[typeArg.toLowerCase()];
  if (!typeInfo) {
    return send(chatId,
      `❗ Неизвестный тип: <b>${typeArg}</b>\n` +
      'Допустимые: время · присутствие · завет · приношение · вопрос · код · слово'
    );
  }

  const content = rest.join(' ') || typeInfo.key;
  const giverId = fromName;

  const mem = loadMem();
  mem.receive({
    giverId,
    receiverId,
    weight:      typeInfo.weight,
    type:        typeInfo.key,
    content,
    irreversible: true,
  });
  saveMem(mem);

  const diag     = new CommunityDiagnostic(mem.snapshot());
  const theosis  = diag.theosisIndex(receiverId);
  const level    = theosis < 0.1 ? 'κατάνυξις'
                 : theosis < 0.4 ? 'πρᾶξις'
                 : theosis < 0.7 ? 'θεωρία'
                 :                 'θέωσις';

  const bar = '█'.repeat(Math.round(theosis * 10)) + '░'.repeat(10 - Math.round(theosis * 10));

  return send(chatId,
    `${typeInfo.emoji} <b>${giverId} → ${receiverId}</b>\n` +
    `Тип: ${typeArg} · вес: ${typeInfo.weight}\n` +
    (content !== typeInfo.key ? `Описание: ${content}\n` : '') +
    `\n` +
    `Обожение ${receiverId}: ${bar} ${(theosis * 100).toFixed(0)}% [${level}]\n` +
    `Всего актов: ${mem.actsCount}`
  );
}

// /зеркало
async function cmdZerkalo(chatId) {
  const mem  = loadMem();
  const diag = new CommunityDiagnostic(mem.snapshot());

  const lines = ['🪞 <b>Зеркало общины</b>'];
  lines.push(`Лиц: ${mem.n} · Актов: ${mem.actsCount}\n`);

  // Обожение
  lines.push('<b>Обожение (θέωσις):</b>');
  const allT = mem.persons
    .filter(p => !['_abyss', '_koinon'].includes(p))
    .map(p => ({ p, i: diag.theosisIndex(p) }))
    .sort((a, b) => b.i - a.i);

  for (const { p, i } of allT) {
    if (i === 0) continue; // пустынных не показываем чтобы не перегружать
    const bar = '█'.repeat(Math.round(i * 8)) + '░'.repeat(8 - Math.round(i * 8));
    lines.push(`  ${p}: ${bar} ${(i * 100).toFixed(0)}%`);
  }

  // Пустыни
  const isolated = diag.mostIsolated(4).filter(x => x.received === 0);
  if (isolated.length) {
    lines.push('\n<b>Пустыни (нет общения):</b>');
    lines.push(isolated.map(x => `  · ${x.person}`).join('\n'));
  }

  // Кенозис
  const top = diag.highestSurplus(3).filter(x => x.surplus > 10);
  if (top.length) {
    lines.push('\n<b>Высший кенозис (дают больше):</b>');
    for (const { person, surplus } of top) {
      lines.push(`  · ${person}: +${surplus.toFixed(0)}`);
    }
  }

  return send(chatId, lines.join('\n'));
}

// /обо Имя
async function cmdObo(chatId, personId) {
  if (!personId) {
    return send(chatId, '❗ Формат: <code>/обо Имя</code>');
  }

  const mem    = loadMem();
  const diag   = new CommunityDiagnostic(mem.snapshot());
  const theosis = diag.theosisIndex(personId);
  const given   = mem.totalGiven(personId);
  const recv    = mem.totalReceived(personId);
  const present = mem.makePresent({ giverId: personId });
  const level   = theosis < 0.1 ? 'κατάνυξις'
                : theosis < 0.4 ? 'πρᾶξις'
                : theosis < 0.7 ? 'θεωρία'
                :                 'θέωσις';

  const bar = '█'.repeat(Math.round(theosis * 12)) + '░'.repeat(12 - Math.round(theosis * 12));

  const lines = [
    `🕯 <b>Анамнезис: ${personId}</b>`,
    ``,
    `Обожение: ${bar} ${(theosis * 100).toFixed(0)}% [${level}]`,
    `Дал: ${given.toFixed(1)} · Принял: ${recv.toFixed(1)} · Сюрплюс: ${(given - recv).toFixed(1)}`,
  ];

  if (present.decoded.receivers.length) {
    lines.push(`\nОткликаются: ${present.decoded.receivers.join(', ')}`);
  }

  return send(chatId, lines.join('\n'));
}

// /помощь
async function cmdHelp(chatId) {
  return send(chatId,
    '🎁 <b>Gift Protocol</b>\n\n' +
    'Записывай дары своей общины. Без регистрации, без баллов.\n' +
    'Дар необратим. Память — живая.\n\n' +
    '<b>Команды:</b>\n' +
    '/дар Имя тип [описание] — записать дар\n' +
    '/зеркало — состояние общины\n' +
    '/обо Имя — анамнезис лица\n\n' +
    '<b>Типы дара:</b>\n' +
    '⏱ <b>время</b> (вес 10)\n' +
    '🤝 <b>завет</b> (вес 10)\n' +
    '🕯 <b>присутствие</b> (вес 7)\n' +
    '🎁 <b>приношение</b> (вес 6)\n' +
    '❓ <b>вопрос</b> (вес 5)\n' +
    '💻 <b>код</b> (вес 4)\n' +
    '💬 <b>слово</b> (вес 3)\n\n' +
    'Пример: <code>/дар Мария время помогла с переездом</code>'
  );
}

// ── Роутинг сообщений ─────────────────────────────────────────────────────

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId   = msg.chat.id;
  const fromName = msg.from?.username ?? msg.from?.first_name ?? 'Безымянный';
  const text     = msg.text.trim();

  // Разбор команды
  const [cmd, ...args] = text.split(/\s+/);
  const command = cmd.toLowerCase().replace('@' + (process.env.BOT_USERNAME ?? ''), '');

  try {
    if (command === '/дар' || command === '/dar') {
      await cmdDar(chatId, fromName, args);
    } else if (command === '/зеркало' || command === '/mirror') {
      await cmdZerkalo(chatId);
    } else if (command === '/обо' || command === '/obo') {
      await cmdObo(chatId, args[0]);
    } else if (command === '/помощь' || command === '/help' || command === '/start') {
      await cmdHelp(chatId);
    }
  } catch (e) {
    console.error('Ошибка обработки:', e.message);
    await send(chatId, '⚠️ Ошибка: ' + e.message);
  }
}

// ── Long polling ──────────────────────────────────────────────────────────

async function poll() {
  let offset = 0;
  console.log('Gift Protocol Bot запущен. Long polling...');

  while (true) {
    try {
      const res = await tgCall('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      if (!res.ok) {
        console.error('Telegram error:', res.description);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      for (const update of res.result ?? []) {
        offset = update.update_id + 1;
        handleUpdate(update).catch(e => console.error('handleUpdate:', e.message));
      }
    } catch (e) {
      console.error('poll error:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

poll();
