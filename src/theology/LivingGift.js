/**
 * LivingGift.js — дар, который живёт
 *
 * Ин 1:14 — «И Слово стало плотью»
 *
 * Обычный дар: объект с полями.
 * Живой дар: акт, который уже произошёл и не может не произойти.
 *
 * Разница — в необратимости.
 * Необратимость = воплощённость = физичность.
 *
 * Когда дар запечатан — он перестаёт быть описанием.
 * Он становится тем, что было.
 * А то, что было — не отменяется.
 *
 * «Прошлое — единственное что не может быть отнято»
 */

'use strict';

import { mark as abyssalMark, from as fromAbyss } from './Abyss.js';
import { seal as mortisSeal } from './MortisKairos.js';

// ── ВОПЛОЩЕНИЕ ───────────────────────────────────────────────────────────────

/**
 * incarnate(params) — воплотить дар.
 *
 * Не «создать объект дара».
 * Совершить акт, который оставляет след.
 *
 * После incarnate() — дар заморожен.
 * Его нельзя изменить. Только свидетельствовать.
 *
 * @param {Object} params
 * @param {string|null} params.giver      — кто даёт (null = из бездны)
 * @param {string}      params.receiver   — кому
 * @param {string}      params.content    — что
 * @param {string[]}    [params.witnesses] — кто присутствует
 * @param {string}      [params.logos]    — слово о даре
 * @returns {Object} — замороженный акт
 */
export function incarnate({ giver, receiver, content, witnesses = [], logos = null }) {
  const sealedAt = new Date().toISOString();

  const act = {
    giver:        giver ?? null,
    receiver,
    content,
    logos:        logos || content,
    witnesses:    [...witnesses],
    sealedAt,          // момент воплощения — это и есть физичность
    irreversible: true,
    living:       true,
    deferred:     false,
  };

  // Если даритель неизвестен — из бездны
  if (!giver) abyssalMark(act);

  // Запечатать в осознании конечности
  mortisSeal(act);

  // Заморозить — живой дар не редактируется
  return Object.freeze(act);
}

// ── СВИДЕТЕЛЬСТВО ────────────────────────────────────────────────────────────

/**
 * witness(act, personId) — засвидетельствовать живой дар.
 *
 * Свидетель не меняет акт.
 * Свидетель делает акт видимым для других.
 *
 * Как мироносицы у гроба — они не воскресили.
 * Они свидетельствовали.
 *
 * @param {Object} act
 * @param {string} personId
 * @returns {{ act, witness, at }}
 */
export function witness(act, personId) {
  return Object.freeze({
    act:     act,
    witness: personId,
    at:      new Date().toISOString(),
    logos:   'свидетель не меняет — свидетель хранит',
  });
}

// ── ПРОВЕРКИ ─────────────────────────────────────────────────────────────────

export const is = {
  living:      (act) => act?.living      === true,
  irreversible: (act) => act?.irreversible === true,
  fromAbyss:   (act) => fromAbyss(act),
  sealed:      (act) => !!act?.sealedAt,
};
