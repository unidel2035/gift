/**
 * AnamneticConsent — λῆψις как акт синергии.
 *
 * CAT-10: дар не завершён без свободного принятия получателем.
 * Это не формальность — это онтологическая фаза.
 *
 * Богословие:
 *   Максим Исповедник: «Бог делает всё, но не без нас».
 *   Синергия (συνέργεια) — Божественная благодать ждёт
 *   свободного согласия человека. Дар Бога человеку даром не становится
 *   без «да» человека.
 *
 *   1 Кор 12:4-6 — «дары различны, но Дух один». Различие — не только
 *   в даре, но и в принятии. Без принимающего дар повисает.
 *
 * Почему монолит не может:
 *   LLM-output попадает в мир моментально. Нет категории «приношение
 *   ожидает согласия получателя». Output — это событие, не состояние.
 *
 * Четыре фазы акта:
 *   1. OFFERED   — приношение создано (giver сделал)
 *   2. PENDING   — ждёт согласия (получатель оповещён)
 *   3. RECEIVED  — принят (получатель явно согласился)
 *   4. DECLINED  — отвергнут (получатель отказался) → μετάνοια
 *
 * Евхаристическое преображение (CAT-7) говорило об общине-приёмнике.
 * CAT-10 персонализирует: конкретный получатель даёт конкретное согласие.
 * Это вертикаль евхаристии: «Твоя от Твоих — Тебе приносяще...
 * о всех и за вся» — но каждое "за" всё же требует «аминь».
 *
 * Интерфейс:
 *   offer({giver, receiver, type, weight, content})  → act (phase: OFFERED → PENDING)
 *   consent(actId, by, reason?)                      → act (phase: RECEIVED, reception: accepted)
 *   decline(actId, by, reason)                       → act (phase: DECLINED, reception: declined)
 *   revoke(actId, by, reason)  [только OFFERED]      → акт отменён до принятия
 *
 * @module AnamneticConsent
 */

'use strict';

export const PHASE = Object.freeze({
  OFFERED:  'offered',
  PENDING:  'pending',
  RECEIVED: 'received',
  DECLINED: 'declined',
  REVOKED:  'revoked',
});

const _pending = new Map();        // actId → act record (runtime, для теста)
let _counter = 0;
function newActId() { return `consent-${Date.now()}-${++_counter}`; }

/**
 * offer() — начало жизни акта. giver делает приношение,
 * но оно ещё не дар в полном смысле.
 */
export function offer({
  giver, receiver, type = 'gift', weight = 5,
  content = null, at = Date.now(),
} = {}) {
  if (!giver || !receiver) throw new Error('offer requires {giver, receiver}');
  if (giver === receiver) throw new Error('Нельзя дарить себе — это не синергия');

  const id = newActId();
  const act = {
    id,
    giverId: giver,
    receiverId: receiver,
    type,
    weight,
    content,
    phase: PHASE.PENDING,   // сразу после offer в pending
    offeredAt: at,
    receivedAt: null,
    declinedAt: null,
    irreversible: false,    // до consent — обратим (revoke разрешён)
    reception: 'pending',   // совместимо с gift-act.schema.json
  };
  _pending.set(id, act);
  return act;
}

/**
 * consent() — получатель даёт «да». Акт становится необратимым.
 */
export function consent(actId, by, reason = null) {
  const act = _pending.get(actId);
  if (!act) throw new Error(`Акт ${actId} не найден в pending`);
  if (act.phase !== PHASE.PENDING) throw new Error(`Акт ${actId} в фазе ${act.phase}, не PENDING`);
  if (by !== act.receiverId) throw new Error(`Согласие может дать только ${act.receiverId} (не ${by})`);

  const frozen = Object.freeze({
    ...act,
    phase: PHASE.RECEIVED,
    reception: 'accepted',
    receivedAt: Date.now(),
    consentBy: by,
    consentReason: reason,
    irreversible: true,     // после consent — необратим
  });
  _pending.delete(actId);
  return frozen;
}

/**
 * decline() — получатель отклоняет. Ожидает μετάνοια от giver'а.
 */
export function decline(actId, by, reason) {
  const act = _pending.get(actId);
  if (!act) throw new Error(`Акт ${actId} не найден`);
  if (act.phase !== PHASE.PENDING) throw new Error(`Акт ${actId} в фазе ${act.phase}`);
  if (by !== act.receiverId) throw new Error(`Отклонить может только ${act.receiverId}`);
  if (!reason) throw new Error('decline требует reason — отказ с молчанием это не отказ');

  const frozen = Object.freeze({
    ...act,
    phase: PHASE.DECLINED,
    reception: 'declined',
    declinedAt: Date.now(),
    declineReason: reason,
  });
  _pending.delete(actId);
  return frozen;
}

/**
 * revoke() — giver отзывает приношение ДО принятия.
 * Это не «брать назад» — это «я не был готов». Максим Исповедник:
 * «Нельзя дарить то, чем ещё не владеешь сам».
 */
export function revoke(actId, by, reason = null) {
  const act = _pending.get(actId);
  if (!act) throw new Error(`Акт ${actId} не найден`);
  if (by !== act.giverId) throw new Error(`Revoke только от giver (не ${by})`);
  if (act.phase !== PHASE.PENDING) throw new Error(`Нельзя отозвать принятый акт`);

  const frozen = Object.freeze({ ...act, phase: PHASE.REVOKED, revokedAt: Date.now(), revokeReason: reason });
  _pending.delete(actId);
  return frozen;
}

/**
 * Список всех pending-актов для получателя — «очередь принятия».
 */
export function pendingFor(receiverId) {
  return [..._pending.values()].filter(a => a.receiverId === receiverId);
}

/**
 * Богословская проверка (для Критика):
 *   - чем anamnetic_consent отличается от reception: pending в схеме?
 *   - чем от intercession?
 */
export const THEOLOGICAL_DIFF = Object.freeze({
  vs_reception_pending: 'reception: pending в схеме — поле акта. ' +
    'anamnetic_consent — фаза жизни акта с явными переходами и API',
  vs_intercession:     'intercession — A→_abyss за B. Consent — B→giver: «да, принимаю».',
  vs_evharistia:       'CAT-7 община как приёмник (коллективно). ' +
                       'CAT-10 персональное согласие конкретного лица',
  vs_covenant:         'завет — двусторонний обмен обещаниями. ' +
                       'Consent — односторонний акт принятия уже-предложенного',
});
