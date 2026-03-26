/**
 * @koinon/gift-protocol/adapters/github
 *
 * GitHub Actions adapter for Gift Protocol.
 *
 * Converts GitHub events (push, pull_request, issues, release)
 * into GiftActs and submits them to a Κοινόν server.
 *
 * Usage in GitHub Action (gift-record.yml):
 *
 *   - name: Record gift
 *     uses: actions/github-script@v7
 *     with:
 *       script: |
 *         const { createGithubAdapter } = await import(
 *           'https://esm.sh/@koinon/gift-protocol/adapters/github'
 *         );
 *         const gift = createGithubAdapter({
 *           koinonUrl: process.env.KOINON_URL,
 *           repo: context.repo.owner + '/' + context.repo.repo,
 *         });
 *         const result = await gift.giveFromContext(context);
 *         console.log(result.ok ? '✓ gift recorded' : '✗ ' + result.errors.join(', '));
 *
 * Or as a standalone script:
 *
 *   import { createGithubAdapter } from '@koinon/gift-protocol/adapters/github';
 *
 *   const gift = createGithubAdapter({ koinonUrl: 'http://my-koinon.org:8086' });
 *   const payload = JSON.parse(process.env.GITHUB_EVENT_JSON);
 *   const result  = await gift.giveFromPayload(process.env.GITHUB_EVENT_NAME, payload);
 */

import { GiftValidator, GiftClient, createAct } from '../index.js';

/**
 * createGithubAdapter(options) — фабрика GitHub-адаптера.
 *
 * @param {object} options
 * @param {string} [options.koinonUrl]     — URL Κοινόν сервера
 * @param {string} [options.repo]          — owner/repo (по умолчанию из GITHUB_REPOSITORY)
 * @param {string} [options.defaultGiver]  — personId дарителя по умолчанию ('_ci')
 * @param {string} [options.defaultReceiver] — personId получателя ('_koinon')
 * @param {function} [options.resolvePersonId] — (githubLogin) → koinonPersonId
 */
export function createGithubAdapter(options = {}) {
  const client          = options.koinonUrl ? new GiftClient(options.koinonUrl) : null;
  const repo            = options.repo ?? (typeof process !== 'undefined' ? process.env?.GITHUB_REPOSITORY : null);
  const defaultGiver    = options.defaultGiver    ?? '_ci';
  const defaultReceiver = options.defaultReceiver ?? '_koinon';
  const resolveId       = options.resolvePersonId ?? (login => `gh/${login}`);

  async function _submit(raw) {
    if (client) return client.give(raw);
    return GiftValidator.validate(raw);
  }

  /**
   * _actFromEvent(eventName, payload) — определить тип и параметры акта по событию.
   *
   * @returns {{ from, to, type, content, proof } | null}
   */
  function _actFromEvent(eventName, payload) {
    switch (eventName) {
      case 'push': {
        const login  = payload.pusher?.name ?? payload.sender?.login ?? defaultGiver;
        const sha    = payload.after ?? payload.head_commit?.id;
        const branch = (payload.ref ?? '').replace('refs/heads/', '');
        const msg    = payload.head_commit?.message?.slice(0, 200) ?? 'push';
        const r      = repo ?? payload.repository?.full_name;
        return {
          from:    resolveId(login),
          to:      defaultReceiver,
          type:    'code',
          content: `push to ${branch}: ${msg}`,
          proof:   (sha && r) ? { commit: sha.slice(0, 12), repo: r } : undefined,
        };
      }

      case 'pull_request': {
        const login  = payload.pull_request?.user?.login ?? defaultGiver;
        const action = payload.action ?? '';
        const title  = payload.pull_request?.title ?? '';
        const num    = payload.pull_request?.number;
        const r      = repo ?? payload.repository?.full_name;
        // Только открытие и мёрж — значимые акты
        if (!['opened', 'closed'].includes(action)) return null;
        const isMerged = action === 'closed' && payload.pull_request?.merged;
        return {
          from:    resolveId(login),
          to:      defaultReceiver,
          type:    isMerged ? 'offering' : 'code',
          content: `PR #${num}: ${title}`.slice(0, 200),
          proof:   (num && r) ? { issue: num, repo: r } : undefined,
        };
      }

      case 'issues': {
        const login  = payload.issue?.user?.login ?? defaultGiver;
        const action = payload.action ?? '';
        const title  = payload.issue?.title ?? '';
        const num    = payload.issue?.number;
        const r      = repo ?? payload.repository?.full_name;
        if (!['opened', 'closed'].includes(action)) return null;
        return {
          from:    resolveId(login),
          to:      defaultReceiver,
          type:    'question',
          content: `issue #${num}: ${title}`.slice(0, 200),
          proof:   (num && r) ? { issue: num, repo: r } : undefined,
        };
      }

      case 'release': {
        const login   = payload.release?.author?.login ?? defaultGiver;
        const tag     = payload.release?.tag_name ?? '';
        const r       = repo ?? payload.repository?.full_name;
        const sha     = payload.release?.target_commitish;
        return {
          from:    resolveId(login),
          to:      defaultReceiver,
          type:    'offering',
          content: `release ${tag}`.slice(0, 200),
          proof:   (sha && r) ? { commit: sha.slice(0, 12), repo: r } : undefined,
        };
      }

      default:
        return null;
    }
  }

  return {
    /**
     * giveFromPayload(eventName, payload) — создать и отправить дар из GitHub event payload.
     *
     * @param {string} eventName — имя события ('push', 'pull_request', 'issues', 'release')
     * @param {object} payload   — GitHub event payload
     * @returns {Promise<{ ok: true, act: object } | { ok: false, errors: string[] } | null>}
     *   null — если событие не требует записи дара
     */
    async giveFromPayload(eventName, payload) {
      const params = _actFromEvent(eventName, payload);
      if (!params) return null;

      const raw = {
        ...createAct(params.from, params.to, params.type, params.content),
        ...(params.proof ? { proof: params.proof } : {}),
      };
      return _submit(raw);
    },

    /**
     * giveFromContext(context) — используется в github-script action.
     *
     * @param {object} context — GitHub Actions context (context.eventName, context.payload)
     */
    async giveFromContext(context) {
      return this.giveFromPayload(context.eventName, context.payload);
    },

    /**
     * giveFromEnv() — прочитать GITHUB_EVENT_NAME и GITHUB_EVENT_PATH из окружения.
     * Используется в standalone Node.js скриптах.
     */
    async giveFromEnv() {
      if (typeof process === 'undefined') throw new Error('process is not available');
      const eventName = process.env.GITHUB_EVENT_NAME;
      const eventPath = process.env.GITHUB_EVENT_PATH;
      if (!eventName || !eventPath) throw new Error('GITHUB_EVENT_NAME / GITHUB_EVENT_PATH not set');

      const { readFileSync } = await import('node:fs');
      const payload = JSON.parse(readFileSync(eventPath, 'utf8'));
      return this.giveFromPayload(eventName, payload);
    },

    validate: GiftValidator.validate.bind(GiftValidator),
    client,
  };
}

export default createGithubAdapter;
