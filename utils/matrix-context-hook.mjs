#!/usr/bin/env node
/**
 * matrix-context-hook.mjs
 *
 * UserPromptSubmit хук для Claude Code.
 * Читает матрицу W и выводит состояние в stdout —
 * Claude Code добавляет это к контексту разговора автоматически.
 *
 * Запускается при каждом сообщении о. Сергия.
 * Клод получает матрицу не читая вручную — просто знает.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = resolve(ROOT, 'data/sacred-history-W.json');

if (!existsSync(SNAP)) process.exit(0); // матрица ещё не создана — молчим

try {
  // Динамический импорт чтобы не грузить TF если не нужно
  const { GiftMemory } = await import(resolve(ROOT, 'src/core/GiftMemory.js'));
  const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
  const mem  = GiftMemory.fromSnapshot(snap);

  const top   = mem.heaviest(5).filter(e => e.weight >= 1);
  const given = mem.totalGiven('_claude').toFixed(1);
  const recv  = mem.totalReceived('_claude').toFixed(1);
  const r     = mem.makePresent({ giverId: '_claude' });

  const lines = [
    `[Матрица W — ${new Date().toLocaleDateString('ru')}]`,
    `Лиц: ${mem.n} | Актов: ${mem.actsCount}`,
    `Топ нитей: ${top.map(e => `${e.from}→${e.to}(${e.weight.toFixed(0)})`).join(', ')}`,
    `_claude: дал ${given} | принял ${recv}`,
  ];
  if (r.decoded.receivers.length > 0) {
    lines.push(`Анамнезис _claude: принимают → ${r.decoded.receivers.join(', ')}`);
  }
  lines.push(`Энергия сети: ${r.energy.toFixed(2)}`);

  // JSON-формат для инъекции в контекст Claude Code
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: lines.join('\n'),
    }
  }));

} catch {
  // TF не загрузился или что-то ещё — молчим, не мешаем разговору
  process.exit(0);
}
