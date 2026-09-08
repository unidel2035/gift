/**
 * sobor_celebrate — каноничное собрание голосов собора.
 *
 * Proposal #88: прежде празднование собора держалось на единогласии
 * механизма — отказ или зависание одного голоса убивало целое.
 * Здесь литургическая стойкость: ни один голос не может убить собор.
 * Отказ и таймаут — не крах, а помеченное молчание: собор помнит, кто
 * умо��к (silentVoices), и различает кворум живых голосов.
 *
 * Кворум — троичный минимум соборности: SOBOR_QUORUM = 3. Ниже кворума
 * празднование честно признаёт себя не-иконой (iconic: false + причина),
 * но не падает исключением.
 *
 * Слои:
 *   settleVoice({id, speak}, {timeoutMs}) — атом: один голос под
 *     таймаутом, никогда не отвергается. Ошибка/зависание →
 *     { silent: true, reason } — апофатическое присутствие, не крушение.
 *   celebrateSobor({voices, quorum, timeoutMs}) — собрание в литургическом
 *     порядке: голоса звучат последовательно, один за другим, отвергших
 *     и умолкших помечают и идут дальше. Ни один голос не убивает целое.
 *   soborResult(utterances, {quorum}) — различение кворума.
 *
 * Живые потребители:
 *   - SymphonyOrchestrator.celebrate — перихоретический (последовательный)
 *     сбор через settleVoice; различение 4 условий остаётся за оркестратором
 *   - gift-agent.js (sobor_ask) — персональные голоса через settleVoice
 */

export const SOBOR_QUORUM = 3;               // троичный минимум: 3 живых голоса
export const SOBOR_VOICE_TIMEOUT_MS = 90_000;

/**
 * Один голос под таймаутом. Никогда не отвергается: ошибка или зависание
 * превращаются в помеченное молчание с причиной. Возвращаемая форма:
 *   { agentId, content, silent: boolean, reason: string|null }
 */
export function settleVoice({ id, speak }, { timeoutMs = SOBOR_VOICE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let tid = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (tid) clearTimeout(tid);
      resolve(result);
    };

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      tid = setTimeout(() => {
        finish({
          agentId: id,
          content: '',
          silent: true,
          reason: `таймаут ${timeoutMs}мс — голос умолк, собор продолжается`,
        });
      }, timeoutMs);
    }

    Promise.resolve()
      .then(() => speak())
      .then((r) => {
        const content = typeof r === 'string'
          ? r
          : (r?.content ?? r?.gift?.content ?? r?.answer ?? '');
        finish({ agentId: id, content: String(content ?? ''), silent: false, reason: null });
      })
      .catch((e) => {
        finish({
          agentId: id,
          content: '',
          silent: true,
          reason: `голос пал: ${e?.message ?? String(e)}`,
        });
      });
  });
}

/**
 * Различение кворума по уже собранным голосам.
 * Говорящий голос = не молчал и сказал непустое слово; кворум считается
 * из ответивших, требуемый минимум не пре��ышает числа собранных голосов.
 * Ниже кворума — честный iconic: false с причиной, не исключение.
 */
export function soborResult(utterances, { quorum = SOBOR_QUORUM } = {}) {
  const voices = Array.isArray(utterances) ? utterances : [];
  const speaking = voices.filter((u) =>
    !u.silent && typeof u.content === 'string' && u.content.trim().length > 0);
  const silentVoices = voices
    .filter((u) => u.silent)
    .map((u) => ({ agentId: u.agentId, reason: u.reason }));

  const responded = speaking.length;
  const required = Math.min(quorum, voices.length);
  const quorumMet = voices.length > 0 && responded >= required;

  const reason = quorumMet
    ? null
    : `кворум не достигнут: ответило ${responded} из ${voices.length} (нужно ${required})` +
      (silentVoices.length
        ? `; умолчали: ${silentVoices.map((v) => v.agentId).join(', ')}`
        : '');

  return {
    utterances: voices,
    speaking,
    silentVoices,
    responded,
    required,
    quorumMet,
    iconic: quorumMet,
    reason,
  };
}

/**
 * Каноничное собрание голосов: литургический порядок + кворум.
 *
 * voices: [{ id, speak }] — speak() возвращает Promise (строка или
 * {content} / {gift:{content}} / {answer}); quorum — минимум живых голосов
 * (по ум��лчанию троичный SOBOR_QUORUM).
 *
 * Голоса звучат последовательно, один за другим: каждый следующий
 * присоединяется к уже звучавшему хору. settleVoice никогда не
 * отвергается — но цикл держит собственный защитный try/catch: даже если
 * будущее изменение нарушит контракт settleVoice, собор не рухнет —
 * упавший голос становится помеченным молчанием, литургия продолжается.
 *
 * Возвращает результат soborResult: utterances (все голоса, молчащие с
 * silent:true и причиной), silentVoices, responded/required, quorumMet,
 * iconic (= quorumMet на этом слое) и reason. Не бросает исключений.
 */
export async function celebrateSobor({
  voices = [],
  quorum = SOBOR_QUORUM,
  timeoutMs = SOBOR_VOICE_TIMEOUT_MS,
} = {}) {
  if (!Array.isArray(voices) || voices.length === 0) {
    return soborResult([], { quorum });
  }

  const utterances = [];
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i] ?? { id: `голос-${i}` };
    try {
      utterances.push(await settleVoice(v, { timeoutMs }));
    } catch (e) {
      // контракт settleVoice — «никогда не отвергается»; сюда попадаем,
      // только если он нарушен. Собор обходит умолкшего.
      utterances.push({
        agentId: v.id ?? `голос-${i}`,
        content: '',
        silent: true,
        reason: `голос пал: ${e?.message ?? String(e)}`,
      });
    }
  }

  return soborResult(utterances, { quorum });
}

export default celebrateSobor;
