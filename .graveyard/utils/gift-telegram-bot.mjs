#!/usr/bin/env node
/**
 * gift-telegram-bot.mjs — @dar_gift_bot
 *
 * Жест: не «запиши свой дар» — а «замети что дал другой».
 * Благодарность естественна. Хвастовство — нет.
 *
 * Каждый чат — своя матрица. Своя община.
 *
 * Команды:
 *   /благодарю Имя тип [описание]  — замети дар другого
 *   /зеркало                        — кто невидим в общине
 *   /обо Имя                        — история лица
 *   /помощь                         — справка
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { GiftMemory } from '../src/core/GiftMemory.js';
import { CommunityDiagnostic } from '../src/core/GiftOptimizer.js';
import { GiftDAO } from '../src/dao/GiftDAO.js';

const dao = new GiftDAO();

const TOKEN    = process.env.GIFT_BOT_TOKEN;
const API      = `https://api.telegram.org/bot${TOKEN}`;
const DATA_DIR = './data/communities';

if (!TOKEN) { console.error('GIFT_BOT_TOKEN не задан'); process.exit(1); }
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ── Матрица на чат ────────────────────────────────────────────────────────

function snapPath(chatId) {
  return `${DATA_DIR}/${chatId}.json`;
}

function loadMem(chatId) {
  const p = snapPath(chatId);
  if (existsSync(p)) {
    return GiftMemory.fromSnapshot(JSON.parse(readFileSync(p, 'utf8')));
  }
  return new GiftMemory(['_koinon']);
}

function saveMem(chatId, mem) {
  writeFileSync(snapPath(chatId), JSON.stringify(mem.snapshot(), null, 2));
}

// ── Типы даров ────────────────────────────────────────────────────────────

const TYPES = {
  время:       { key: 'time',     weight: 10, emoji: '⏱', label: 'время' },
  завет:       { key: 'covenant', weight: 10, emoji: '🤝', label: 'завет' },
  присутствие: { key: 'presence', weight: 7,  emoji: '🕯', label: 'присутствие' },
  приношение:  { key: 'offering', weight: 6,  emoji: '🎁', label: 'приношение' },
  вопрос:      { key: 'question', weight: 5,  emoji: '💬', label: 'вопрос' },
  код:         { key: 'code',     weight: 4,  emoji: '💻', label: 'код' },
  слово:       { key: 'word',     weight: 3,  emoji: '✍️', label: 'слово' },
  time:        { key: 'time',     weight: 10, emoji: '⏱', label: 'время' },
  presence:    { key: 'presence', weight: 7,  emoji: '🕯', label: 'присутствие' },
  code:        { key: 'code',     weight: 4,  emoji: '💻', label: 'код' },
};

// ── Тёплые фразы ─────────────────────────────────────────────────────────

const WITNESS_PHRASES = [
  'замечен. Это останется.',
  'теперь в памяти общины.',
  'не исчезнет. Дар необратим.',
  'записан. Невидимое стало видимым.',
  'свидетель есть.',
];

const TYPE_MEANING = {
  time:     'отдал время — самое невозвратное',
  covenant: 'связал себя заветом',
  presence: 'был рядом — дар себя',
  offering: 'принёс из своего',
  question: 'открыл мысль в другом',
  code:     'воплотил слово в дело',
  word:     'сказал — и это стало',
};

function witness(name) {
  return WITNESS_PHRASES[Math.floor(Math.random() * WITNESS_PHRASES.length)];
}

// ── Telegram API ──────────────────────────────────────────────────────────

async function tgCall(method, params = {}) {
  const res = await fetch(`${API}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(params),
  });
  return res.json();
}

async function send(chatId, text) {
  return tgCall('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

// ── Команды ───────────────────────────────────────────────────────────────

// /благодарю Имя тип [описание]
// Жест: ты замечаешь что ДРУГОЙ тебе дал.
// В матрице: Имя → ты [type, weight]
async function cmdBlagodaryu(chatId, fromName, args) {
  const [giverName, typeArg, ...rest] = args;

  if (!giverName || !typeArg) {
    return send(chatId,
      '✍️ Формат: <code>/благодарю Имя тип [что сделал]</code>\n\n' +
      'Типы:\n' +
      '⏱ <b>время</b>  🕯 <b>присутствие</b>  🤝 <b>завет</b>\n' +
      '🎁 <b>приношение</b>  💬 <b>вопрос</b>  💻 <b>код</b>  ✍️ <b>слово</b>\n\n' +
      'Пример: <code>/благодарю Мария время помогла с переездом</code>'
    );
  }

  const t = TYPES[typeArg.toLowerCase()];
  if (!t) {
    return send(chatId,
      `Неизвестный тип: <b>${typeArg}</b>\n` +
      'Используй: время · присутствие · завет · приношение · вопрос · код · слово'
    );
  }

  const content  = rest.join(' ') || t.label;
  const receiver = fromName; // ты благодаришь → ты получатель
  const giver    = giverName;

  const mem = loadMem(chatId);
  mem.receive({ giverId: giver, receiverId: receiver, weight: t.weight, type: t.key, content, irreversible: true });
  saveMem(chatId, mem);

  const diag    = new CommunityDiagnostic(mem.snapshot());
  const total   = mem.totalGiven(giver);
  const meaning = TYPE_MEANING[t.key] ?? t.label;

  // Подбираем тёплую фразу
  const lines = [
    `${t.emoji} <b>${giver}</b> — ${witness(giver)}`,
    ``,
    `${giver} ${meaning}.`,
  ];

  if (content && content !== t.label) {
    lines.push(`«${content}»`);
  }

  if (total > 0) {
    lines.push(`\nВсего отдал общине: ${total.toFixed(0)}`);
  }

  // Если человек давал уже много — особое слово
  if (total >= 30) {
    lines.push(`\n<i>Это человек который держит общину.</i>`);
  }

  return send(chatId, lines.join('\n'));
}

// /зеркало — кто невидим, кто держит общину
async function cmdZerkalo(chatId) {
  const mem  = loadMem(chatId);
  const diag = new CommunityDiagnostic(mem.snapshot());
  const snap = mem.snapshot();

  if (mem.actsCount === 0) {
    return send(chatId,
      '🪞 Зеркало пусто.\n\n' +
      'Начни: <code>/благодарю Имя время описание</code>\n' +
      'И невидимое станет видимым.'
    );
  }

  const lines = [`🪞 <b>Зеркало общины</b> · ${mem.actsCount} актов\n`];

  // Кто держит (высокий кенозис)
  const holders = diag.highestSurplus(3).filter(x => x.surplus > 5);
  if (holders.length) {
    lines.push('<b>Держат общину:</b>');
    for (const { person, given, received } of holders) {
      lines.push(`  · ${person} — отдал ${given.toFixed(0)}, принял ${received.toFixed(0)}`);
    }
  }

  // Кто невидим (изолированы)
  const invisible = diag.mostIsolated(4).filter(x => x.received === 0 && !['_koinon','_abyss'].includes(x.person));
  if (invisible.length) {
    lines.push(`\n<b>Невидимые (ещё не замечены):</b>`);
    for (const { person } of invisible) {
      lines.push(`  · ${person}`);
    }
    lines.push(`<i>Быть может, они тоже дают — но никто не сказал «благодарю».</i>`);
  }

  // Общий портрет
  const allPersons = snap.persons.filter(p => !['_koinon','_abyss'].includes(p));
  if (allPersons.length > 0) {
    lines.push(`\nЛиц в общине: ${allPersons.length}`);
  }

  return send(chatId, lines.join('\n'));
}

// /обо Имя — история лица
async function cmdObo(chatId, name) {
  if (!name) return send(chatId, 'Формат: <code>/обо Имя</code>');

  const mem    = loadMem(chatId);
  const diag   = new CommunityDiagnostic(mem.snapshot());
  const given  = mem.totalGiven(name);
  const recv   = mem.totalReceived(name);
  const surplus = given - recv;

  if (given === 0 && recv === 0) {
    return send(chatId, `<b>${name}</b> пока не замечен в общине.\n\nЕсли он что-то дал — скажи: <code>/благодарю ${name} время ...</code>`);
  }

  const present = mem.makePresent({ giverId: name });
  const lines   = [`🕯 <b>${name}</b>\n`];

  if (given > 0) lines.push(`Дал общине: ${given.toFixed(0)}`);
  if (recv > 0)  lines.push(`Принял: ${recv.toFixed(0)}`);

  if (surplus > 20) {
    lines.push(`\n<i>Даёт больше чем принимает. Кенозис.</i>`);
  } else if (surplus < -20) {
    lines.push(`\n<i>Принимает больше чем даёт. Добрая почва.</i>`);
  }

  if (present.decoded.receivers.length) {
    lines.push(`\nОткликаются: ${present.decoded.receivers.filter(p => p !== '_koinon').join(', ')}`);
  }

  return send(chatId, lines.join('\n'));
}

// /join — вступить в Gift DAO
async function cmdJoin(chatId, userId, fromName) {
  const existing = dao.profile(userId);
  if (existing) {
    const t = dao.tokensAvailable(userId);
    return send(chatId,
      `✅ Ты уже в DAO, <b>${existing.name}</b>\n\n` +
      `Токенов доступно: <b>${t.available.toLocaleString()}</b>\n` +
      `Дал общине: ${existing.given.toFixed(0)} · Принял: ${existing.received.toFixed(0)}\n` +
      `Бонус за щедрость: +${t.bonus.toLocaleString()} токенов\n\n` +
      `<i>Помогаешь другим → получаешь больше AI.</i>`
    );
  }

  dao.join(userId, fromName, 1);

  return send(chatId,
    `🎁 <b>${fromName}</b>, ты в Gift DAO!\n\n` +
    `Получаешь: <b>${(50_000).toLocaleString()} токенов/месяц</b> к Claude\n\n` +
    `Как получить больше:\n` +
    `· Помогай другим → /благодарю фиксирует твой вклад\n` +
    `· Каждый +10 surplus = +10 000 токенов бонуса\n\n` +
    `Не деньги — щедрость даёт доступ.\n\n` +
    `Эндпоинт: <code>http://173.249.2.184:4444/v1/messages</code>\n` +
    `Заголовок: <code>x-telegram-user-id: ${userId}</code>`
  );
}

// /dao — мой статус и таблица щедрых
async function cmdDao(chatId, userId) {
  const profile = dao.profile(userId);

  if (!profile) {
    return send(chatId,
      '🏛 <b>Gift DAO</b>\n\n' +
      'Общая инфраструктура Claude для тех кто помогает друг другу.\n' +
      'Не «скидываемся» — зарабатываем доступ щедростью.\n\n' +
      'Вступить: /join\n\n' +
      `Участников сейчас: ${dao.memberCount}`
    );
  }

  const t = dao.tokensAvailable(userId);
  const board = dao.leaderboard(5);

  const lines = [
    `🏛 <b>Gift DAO — твой статус</b>\n`,
    `Токены: <b>${t.available.toLocaleString()}</b> / ${t.total.toLocaleString()}`,
    `  базовые: ${t.base.toLocaleString()}`,
    `  бонус за щедрость: +${t.bonus.toLocaleString()}`,
    `  использовано: ${t.used.toLocaleString()}\n`,
    `Дал общине: ${profile.given.toFixed(0)} · Принял: ${profile.received.toFixed(0)}`,
    `Сюрплюс (кенозис): ${profile.surplus.toFixed(0)}\n`,
    `<b>Самые щедрые:</b>`,
    ...board.map((m, i) => `  ${i+1}. ${m.name} · сюрплюс ${m.surplus.toFixed(0)} · ${m.tokens.toLocaleString()} ток.`),
  ];

  return send(chatId, lines.join('\n'));
}

// /помощь
async function cmdHelp(chatId) {
  return send(chatId,
    '🎁 <b>Дар</b> — живая память общины + Claude DAO\n\n' +
    '<b>Память общины:</b>\n' +
    '/blagodaryu Имя тип [что сделал] — замети дар другого\n' +
    '/zerkalo — кто держит общину, кто невидим\n' +
    '/obo Имя — история человека\n\n' +
    '<b>Gift DAO (Claude для общины):</b>\n' +
    '/join — вступить, получить доступ к Claude\n' +
    '/dao — мой статус и таблица щедрых\n\n' +
    '<b>Типы дара:</b>\n' +
    '⏱ время (10)  · 🤝 завет (10)\n' +
    '🕯 присутствие (7)  · 🎁 приношение (6)\n' +
    '💬 вопрос (5)  · 💻 код (4)  · ✍️ слово (3)\n\n' +
    '<i>Помогаешь другим → больше токенов Claude.</i>'
  );
}

// ── Роутинг ───────────────────────────────────────────────────────────────

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId   = msg.chat.id;
  const from     = msg.from;
  const fromName = from?.username ?? from?.first_name ?? 'Безымянный';
  const text     = msg.text.trim();
  const [cmd, ...args] = text.split(/\s+/);
  const command  = cmd.toLowerCase().split('@')[0];

  try {
    if (['/join'].includes(command)) {
      await cmdJoin(chatId, String(from?.id ?? chatId), fromName);
    } else if (['/dao'].includes(command)) {
      await cmdDao(chatId, String(from?.id ?? chatId));
    } else if (['/благодарю', '/blagodaryu', '/dar', '/дар'].includes(command)) {
      await cmdBlagodaryu(chatId, fromName, args);
    } else if (['/зеркало', '/zerkalo', '/mirror'].includes(command)) {
      await cmdZerkalo(chatId);
    } else if (['/обо', '/obo'].includes(command)) {
      await cmdObo(chatId, args[0]);
    } else if (['/помощь', '/help', '/start', '/start@dar_gift_bot'].includes(command)) {
      await cmdHelp(chatId);
    }
  } catch (e) {
    console.error('error:', e.message);
  }
}

// ── Long polling ──────────────────────────────────────────────────────────

async function poll() {
  let offset = 0;
  console.log('🎁 @dar_gift_bot запущен');

  while (true) {
    try {
      const r = await tgCall('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      if (!r.ok) { await new Promise(x => setTimeout(x, 5000)); continue; }
      for (const u of r.result ?? []) {
        offset = u.update_id + 1;
        handleUpdate(u).catch(e => console.error('handle:', e.message));
      }
    } catch (e) {
      console.error('poll:', e.message);
      await new Promise(x => setTimeout(x, 5000));
    }
  }
}

poll();
