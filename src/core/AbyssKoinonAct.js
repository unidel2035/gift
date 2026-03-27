/**
 * AbyssKoinonAct — кенозис кода в общее
 *
 * Merge в main — момент, когда личное (_abyss) растворяется в κοινόν.
 * Автоматический дар — не метафора, а архитектура.
 *
 * «Если пшеничное зерно... умрёт, то принесёт много плода» (Ин 12:24)
 *
 * Событие:  merge в main
 * Движение: _abyss → _koinon
 * Тип:      abyss→koinon
 * Флаг:     irreversible: true (Object.freeze — богословская аксиома)
 */

export const ABYSS_KOINON_TYPE = 'abyss→koinon';

/**
 * Схема события abyss→koinon.
 *
 * @typedef {Object} AbyssKoinonEvent
 * @property {'_abyss'}         giverId      — источник (бездна, анонимный)
 * @property {'_koinon'}        receiverId   — приёмник (общее)
 * @property {number}           weight       — вес (7: merge тяжелее кода, но легче времени)
 * @property {'abyss→koinon'}   type         — тип акта
 * @property {'merge'}          trigger      — триггер
 * @property {true}             irreversible — необратим
 * @property {string}           content      — краткое описание (до 80 символов)
 * @property {string}           [sha]        — git SHA коммита
 * @property {string}           [repo]       — репозиторий owner/repo
 */

/**
 * Создать акт abyss→koinon.
 *
 * Результат заморожен (Object.freeze) — дар необратим.
 *
 * @param {object} params
 * @param {string} [params.sha]           — git SHA (полный или короткий)
 * @param {string} [params.commitMessage] — сообщение коммита
 * @param {string} [params.repo]          — репозиторий owner/repo
 * @returns {Readonly<AbyssKoinonEvent>}
 */
export function createAbyssKoinonAct({ sha = '', commitMessage = '', repo = '' } = {}) {
  const shortSha = sha ? sha.slice(0, 7) : 'unknown';
  const content  = commitMessage
    ? commitMessage.slice(0, 80)
    : `кенозис: merge ${shortSha}`;

  const act = {
    giverId:      '_abyss',
    receiverId:   '_koinon',
    weight:       7,
    type:         ABYSS_KOINON_TYPE,
    trigger:      'merge',
    irreversible: true,
    content,
  };

  if (sha)   act.sha  = shortSha;
  if (repo)  act.repo = repo;

  return Object.freeze(act);
}

/**
 * Сериализовать акт в тело POST-запроса для анамнезис-сервера.
 *
 * @param {Readonly<AbyssKoinonEvent>} act
 * @returns {string} JSON
 */
export function serializeForApi(act) {
  return JSON.stringify({
    giverId:      act.giverId,
    receiverId:   act.receiverId,
    weight:       act.weight,
    type:         act.type,
    trigger:      act.trigger,
    irreversible: act.irreversible,
    content:      act.content,
  });
}
