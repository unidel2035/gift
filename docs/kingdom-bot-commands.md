# Команды Царства славы для telegram-бота

Документ для ручной интеграции в `tg-koinon-bot.mjs` на сервере
`root@173.249.2.184`. В текущей сессии бот на сервере не модифицируется —
документ даёт готовые сниппеты.

## Требуемые команды

### `/похвала <лицо> [тип]`

Текстовая форма: «похвали _claude in-little» или «/похвала ОтецСергий until-death».

```js
// В обработчик сообщений tg-koinon-bot.mjs добавить:
import { LordsCommendation, Faithfulness } from '/path/to/gift/src/theology/LordsCommendation.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const COMMENDATIONS = '/path/to/gift/data/commendations.json';

bot.on('message', async ctx => {
  const text = ctx.message?.text || '';
  const m = /^\/похвала\s+(\S+)(?:\s+(\S+))?/i.exec(text);
  if (!m) return next();

  const receiver = m[1];
  const faithfulness = m[2] || 'in-little';
  const valid = Object.values(Faithfulness);
  if (!valid.includes(faithfulness)) {
    return ctx.reply(`Тип верности должен быть один из: ${valid.join(', ')}`);
  }

  const witness = ctx.from.username
    ? `tg:${ctx.from.username}`
    : `tg:${ctx.from.id}`;

  const lc = new LordsCommendation({ witness: () => true });
  const commend = lc.bestow({ receiver, faithfulness });

  const record = {
    id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`,
    ...commend.toJSON(),
    witnessedBy: witness,
    witnessNote: `свидетельство через telegram`,
  };

  const store = existsSync(COMMENDATIONS)
    ? JSON.parse(readFileSync(COMMENDATIONS, 'utf8'))
    : [];
  store.push(record);
  writeFileSync(COMMENDATIONS, JSON.stringify(store, null, 2));

  await ctx.reply(
    `⟨похвала⟩ ${commend.toText()}\n` +
    `\nГраница: это свидетельство общины через ${witness}. Сама похвала — у Христа.`
  );
});
```

### `/царство` или `/kingdom`

Возвращает статус КБ — фазы паломников, последний литургический такт,
текущий JoyMode.

```js
bot.command('царство', async ctx => {
  const r = await fetch('http://localhost:3700/api/kingdom');
  const d = await r.json();
  const c = d.commendations?.length || 0;
  const snap = d.litheartSnapshots?.[0];
  await ctx.reply(
    `⛪ Царство славы\n\n` +
    `Похвал общины: ${c}\n` +
    `Явленностей в W_slava: ${Object.keys(d.wSlava?.manifestedness || {}).length}\n` +
    (snap ? `Последний такт: ${snap.iso} · ${snap.season} · ${snap.joyMode}\n` : '') +
    `\nПолнее: http://localhost:3700/kingdom`
  );
});
```

## cron литургического такта

На сервере `root@173.249.2.184` добавить в crontab:

```
# Каждое воскресенье в 9:00 МСК (6:00 UTC) — литургический такт
0 6 * * 0 cd /home/unidel/gift && /usr/bin/node utils/liturgical-heartbeat.mjs >> /var/log/liturgical-heartbeat.log 2>&1
```

Снимки появляются в `data/snapshots/liturgical-preview-YYYY-WNN.json` и
видны на `/kingdom`.

## Границы

- Бот не даёт венцов — только фиксирует свидетельство о похвале
- Бот не совершает Суда — W_slava растёт только через соборное различение
- `/похвала` не проверяет «достоин ли» — это свидетельство говорящего,
  не приговор. Ответственность на свидетеле.
