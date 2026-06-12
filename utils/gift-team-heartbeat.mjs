#!/usr/bin/env node
/**
 * gift-team-heartbeat — тихий пульс присутствия (хук сессии).
 *
 * Вызывается из UserPromptSubmit/Stop хуков на каждом ходе. Обновляет heartbeat
 * сессии текущего лица, если оно вошло в общее настоящее (gift team join).
 * Если не вошёл — молчит (no-op). Так присутствие не лжёт: пока консоль работает,
 * лицо «здесь»; перестал — через 120с протухает и исчезает из gift team status.
 *
 * Никогда не печатает и не падает (хук не должен мешать сессии).
 */
try {
  const { heartbeat } = await import('./gift-swarm.mjs');
  const actor = process.env.GIFT_AGENT_ID || process.env.ORGANISM_ACTOR || process.env.USER;
  if (actor) heartbeat(actor); // no-op, если сессии нет
} catch { /* присутствие необязательно — хук молчит */ }
