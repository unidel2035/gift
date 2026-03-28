/**
 * gift-validator.mjs — валидация GiftAct против JSON Schema
 *
 * «Буква убивает, Дух животворит» (2 Кор 3:6).
 * Схема — не клетка, а форма: она защищает от бессмысленных актов,
 * не убивая богатство смысла.
 *
 * Использование:
 *   import { validateAct, validateActs } from './gift-validator.mjs';
 *   const { valid, errors } = validateAct(act);
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(
  readFileSync(join(__dir, '../data/gift-act.schema.json'), 'utf8')
);

const REQUIRED  = SCHEMA.required;
const PROPS     = SCHEMA.properties;
const TYPE_ENUM = PROPS.type.enum;

/**
 * Валидирует один акт дара.
 * Лёгкая валидация без внешних зависимостей — ручная реализация
 * ключевых правил JSON Schema.
 *
 * @param {object} act
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAct(act) {
  const errors = [];

  // required
  for (const field of REQUIRED) {
    if (act[field] === undefined || act[field] === null) {
      errors.push(`Обязательное поле отсутствует: ${field}`);
    }
  }

  // giverId / receiverId: string, non-empty
  if (act.giverId !== undefined && (typeof act.giverId !== 'string' || act.giverId.trim() === '')) {
    errors.push(`giverId должен быть непустой строкой, получено: ${JSON.stringify(act.giverId)}`);
  }
  if (act.receiverId !== undefined && (typeof act.receiverId !== 'string' || act.receiverId.trim() === '')) {
    errors.push(`receiverId должен быть непустой строкой, получено: ${JSON.stringify(act.receiverId)}`);
  }

  // giverId !== receiverId (дар себе — не дар)
  if (act.giverId && act.receiverId && act.giverId === act.receiverId) {
    errors.push(`giverId === receiverId (${act.giverId}): дар самому себе лишён телоса`);
  }

  // type: enum
  if (act.type !== undefined && !TYPE_ENUM.includes(act.type)) {
    errors.push(`Неизвестный тип дара: "${act.type}". Допустимые: ${TYPE_ENUM.join(', ')}`);
  }

  // weight: number, 0.5–10
  if (act.weight !== undefined) {
    if (typeof act.weight !== 'number' || isNaN(act.weight)) {
      errors.push(`weight должен быть числом, получено: ${JSON.stringify(act.weight)}`);
    } else if (act.weight < 0.5 || act.weight > 10) {
      errors.push(`weight вне диапазона [0.5, 10]: ${act.weight}`);
    }
  }

  // reception: enum
  if (act.reception !== undefined) {
    const valid = ['accepted', 'declined', 'pending'];
    if (!valid.includes(act.reception)) {
      errors.push(`reception должен быть одним из: ${valid.join(', ')}, получено: "${act.reception}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Валидирует массив актов. Возвращает статистику и список ошибок.
 *
 * @param {object[]} acts
 * @param {{ strict?: boolean, source?: string }} opts
 * @returns {{ total: number, valid: number, invalid: number, results: Array }}
 */
export function validateActs(acts, { strict = false, source = '?' } = {}) {
  let validCount = 0;
  const results = [];

  for (let i = 0; i < acts.length; i++) {
    const { valid, errors } = validateAct(acts[i]);
    if (valid) {
      validCount++;
    } else {
      results.push({ index: i, act: acts[i], errors });
      if (strict) {
        throw new Error(
          `[gift-validator] ${source} — акт #${i} невалиден:\n` +
          errors.map(e => `  • ${e}`).join('\n')
        );
      }
    }
  }

  return {
    total:   acts.length,
    valid:   validCount,
    invalid: acts.length - validCount,
    results,
  };
}

/**
 * Краткий отчёт для загрузчика.
 */
export function reportValidation(stats, source = '') {
  if (stats.invalid === 0) {
    return `  ${source.padEnd(35)} ✓ ${stats.total} актов валидны`;
  }
  const lines = [`  ${source} — ${stats.invalid}/${stats.total} актов невалидны:`];
  for (const r of stats.results) {
    lines.push(`    акт ${r.index} (${r.act.giverId}→${r.act.receiverId}): ${r.errors.join('; ')}`);
  }
  return lines.join('\n');
}
