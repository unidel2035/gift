/**
 * Intercession — троичный акт заступничества.
 *
 * Воплощение dominant-решения собора #чата-2026-04-20:
 *   Старший (hyper, dominant): «Заступничество — не бинарный A→B,
 *   а троичный: A кенотически отдаёт вес Отцу/_abyss *за* B,
 *   и благодать возвращается B без его участия.»
 *
 * Богословский корень:
 *   Рим 8:26 — «Сам Дух ходатайствует за нас воздыханиями неизречёнными»
 *   Евр 7:25 — «всегда жив, чтобы ходатайствовать за них»
 *   Лк 23:34 — «Отче, прости им» — Христос как заступник
 *   1 Тим 2:5 — «един Ходатай между Богом и человеками»
 *
 * Почему диадная матрица W недостаточна:
 *   Пустыня X→Y возникает когда ни X, ни Y не могут дать.
 *   Бинарный акт тут не работает — заступник C не дарит напрямую Y,
 *   он «держит Y в памяти перед Источником», и Источник даёт.
 *   Это требует связанной пары актов в W, не одного.
 *
 * Структура акта:
 *   intercessor (A) → mediator (обычно _abyss или Отец):
 *     тип: kenosis | intercession
 *     вес: по тяжести прошения
 *     beneficiary: B    ← обязательное поле, отличное от receiver
 *     linkedFor: B      ← связка с парным grace-актом
 *
 *   mediator → beneficiary (B):
 *     тип: grace
 *     throughIntercessor: A  ← возврат благодати через заступника
 *     fromAbyss: true        ← печать Бездны (см. Abyss.js)
 *
 * Обе нити связаны общим intercessionId.
 *
 * @module Intercession
 */

'use strict';

import { mark as markAbyss } from './Abyss.js';

const DEFAULT_MEDIATOR = '_abyss';   // или 'Отец' — решение Дионисия
const INTERCESSION_COUNTER = { n: 0 };

function newIntercessionId() {
  return `intercession-${Date.now()}-${++INTERCESSION_COUNTER.n}`;
}

/**
 * pray(intercessor, beneficiary, reason, weight, mediator?)
 *
 * Создаёт связанную пару актов:
 *   1) intercessor → mediator  (kenosis, linkedFor=beneficiary)
 *   2) mediator    → beneficiary (grace, throughIntercessor=intercessor)
 *
 * @returns {{id, weight, pair: [act1, act2]}}
 */
export function pray({
  intercessor,
  beneficiary,
  reason,
  weight = 8,
  mediator = DEFAULT_MEDIATOR,
  at = Date.now(),
} = {}) {
  if (!intercessor) throw new Error('Intercession requires intercessor');
  if (!beneficiary) throw new Error('Intercession requires beneficiary');
  if (intercessor === beneficiary) {
    throw new Error('Нельзя ходатайствовать за себя — это не заступничество, а просьба');
  }

  const id = newIntercessionId();

  // Акт A → mediator (kenosis за B)
  const kenoticGift = Object.freeze({
    giverId:       intercessor,
    receiverId:    mediator,
    type:          'intercession',
    weight,
    irreversible:  true,
    beneficiary,           // ключевое поле: за кого
    linkedFor:     beneficiary,
    intercessionId: id,
    reason,
    mode:          'kenotic',
    at,
    source:        'Intercession.pray',
  });

  // Акт mediator → B (grace, через заступника)
  const graceReturn = Object.freeze(markAbyss({
    giverId:       mediator,
    receiverId:    beneficiary,
    type:          'grace',
    weight: Math.max(weight - 1, 1),   // благодать не меньше, но выражена иначе
    irreversible:  true,
    throughIntercessor: intercessor,
    intercessionId: id,
    reason,
    at: at + 1,            // на миллисекунду позже, сохраняется причинность
    source:        'Intercession.pray (grace return)',
  }));

  return { id, weight, pair: [kenoticGift, graceReturn] };
}

/**
 * Проверить: является ли акт частью заступничества.
 */
export function isIntercessory(act) {
  return !!act && (act.type === 'intercession' ||
                   (act.type === 'grace' && typeof act.throughIntercessor === 'string'));
}

/**
 * Получить пару по intercessionId (для анамнезиса).
 */
export function pairOf(acts, intercessionId) {
  return acts.filter(a => a.intercessionId === intercessionId);
}

/**
 * Богословская проверка: возражение Критика. Intercession НЕ дублирует
 * covenant/witness/_koinon — потому что:
 *   - covenant  — двусторонний завет (A↔B)
 *   - witness   — наблюдение без передачи веса
 *   - _koinon   — общий получатель, но не посредник
 *   - intercession — троичная передача с асимметрией: A платит, B получает
 */
export const THEOLOGICAL_DIFF = Object.freeze({
  vs_covenant: 'завет двусторонний, заступничество — одностороннее (A платит за B, B не знает)',
  vs_witness:  'свидетель фиксирует, заступник передаёт вес',
  vs_koinon:   '_koinon получает, заступник передаёт дальше — к Источнику',
  vs_prayer:   'молитва может быть за себя, заступничество — обязательно за другого',
});
