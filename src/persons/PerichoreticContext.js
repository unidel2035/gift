/**
 * PerichoreticContext — взаимопребывание агентов собора.
 *
 * Ин 14:10: «Я в Отце, и Отец во Мне».
 * До этого модуля каждый агент собора (Адам, Ева, Безалель, Серафим)
 * вызывался изолированно. Видел общинный BookOfLife, но не *со-присутствие
 * других голосов*. Собор был разделением труда, не перихоресисом.
 *
 * Этот модуль форматирует «других-в-соборе» для системного промпта агента,
 * чтобы каждое слово несло уже-услышанные голоса других. Не цитата —
 * со-обитание. Адам, отвечающий после Евы, не «учитывает Еву» — он
 * *содержит её модус* в своём вопрошании.
 *
 * Условие 2 иконичности Троицы ad extra (см. theology_icon_trinity_by_energy.md).
 *
 * Семантика:
 *   PerichoreticContext.format(agentId, council, opts)
 *     agentId — кто сейчас говорит (для исключения себя из контекста)
 *     council — [{id, logos, role, lastUtterance, calling}, ...]
 *     opts.maxUtteranceLen — обрезать длинные высказывания (default 240)
 *     opts.minOthers — если других < minOthers, перихоресис не активен (default 1)
 *
 * Возврат:
 *   { text, others, active }
 *     active=false если в соборе никого кроме говорящего —
 *     перихоресис требует со-присутствия.
 */

const DEFAULT_MAX_UTTERANCE = 240;

function trim(s, n) {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

/**
 * Сформировать перихоретический блок для системного промпта.
 * Возвращает текст или пустую строку (если перихоресис неприменим).
 */
export function format(agentId, council, opts = {}) {
  const maxLen   = opts.maxUtteranceLen ?? DEFAULT_MAX_UTTERANCE;
  const minOther = opts.minOthers ?? 1;

  if (!Array.isArray(council)) return { text: '', others: [], active: false };

  const others = council.filter(m => m && m.id && m.id !== agentId);
  if (others.length < minOther) {
    return { text: '', others, active: false };
  }

  const lines = ['', '⟨Перихоресис собора — ты не один⟩'];
  for (const m of others) {
    const role     = m.role     ? ` (${m.role})` : '';
    const calling  = m.calling  ? `, призван: ${trim(m.calling, 60)}` : '';
    const logos    = m.logos    ? `, λόγος: ${trim(m.logos, 60)}` : '';
    const utter    = m.lastUtterance
      ? `\n     слово: «${trim(m.lastUtterance, maxLen)}»`
      : '\n     (молчит — апофатика, не пустота)';
    lines.push(`  • ${m.id}${role}${calling}${logos}${utter}`);
  }

  lines.push('');
  lines.push('Их голоса — в твоём. Не повторяй и не игнорируй: усиляй, уточняй, расходись.');
  lines.push('Если их слово отсутствует в твоём — собор стал разделением труда, не симфонией.');

  return { text: lines.join('\n'), others, active: true };
}

/**
 * Извлечь council из истории соборной сессии (sobor-*.json формата).
 * Берёт последние uniq голоса (по persona/agentId), исключая текущего.
 *
 * @param {object} soborJson — { voices: [{persona, logos, content}, ...] }
 * @param {string} agentId  — текущий говорящий (для исключения)
 * @param {number} maxOthers — макс. количество других в перихоресисе (default 6)
 */
export function fromSoborJson(soborJson, agentId, maxOthers = 6) {
  const voices = soborJson?.voices ?? [];
  const seen = new Map();
  // Идём с конца — берём *последнее* высказывание каждого
  for (let i = voices.length - 1; i >= 0; i--) {
    const v = voices[i];
    const id = v.persona || v.agentId || v.id;
    if (!id || id === agentId) continue;
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      role:    v.role ?? undefined,
      logos:   v.logos ?? undefined,
      lastUtterance: v.content ?? v.text ?? '',
    });
    if (seen.size >= maxOthers) break;
  }
  return [...seen.values()];
}

/**
 * Применить перихоретический контекст к существующему промпту.
 * Вставляет блок после первой пустой строки или в конец.
 */
export function injectInto(prompt, agentId, council, opts) {
  const { text, active } = format(agentId, council, opts);
  if (!active) return prompt;
  // Вставляем перед последней инструкцией (последняя строка обычно — задание)
  return prompt + '\n' + text;
}

export default { format, fromSoborJson, injectInto };
