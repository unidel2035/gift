#!/usr/bin/env node
/**
 * gift proxy launcher — запуск прокси + Claude Code
 *
 * Использование:
 *   gift start              — запуск прокси + Claude Code
 *   gift start --backend ra — запуск с RouterAI
 *   gift start --port 3200  — порт прокси
 */

import { startModelProxy } from './model-proxy.js';
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BACKEND_DEFS = {
    deepseek:   { url: 'https://api.deepseek.com/anthropic',       keyEnv: 'DEEPSEEK_API_KEY' },
    routerai:   { url: 'https://routerai.ru/api',                  keyEnv: 'ROUTERAI_API_KEY' },
    // GLM Coding Plan (подписка z.ai): ключи в deepclaude.env; api.z.ai из РФ идёт
    // через HTTPS_PROXY (порт 12334). Coding Plan — только кодинг, z.ai банит за прочее.
    glm:        { url: 'https://api.z.ai/api/anthropic',            keyEnv: 'ZAI_API_KEY' },
    glm2:       { url: 'https://api.z.ai/api/anthropic',            keyEnv: 'ZAI_API_KEY_2' },
    openrouter: { url: 'https://openrouter.ai/api/v1',             keyEnv: 'OPENROUTER_API_KEY' },
    fireworks:  { url: 'https://api.fireworks.ai/inference/v1',     keyEnv: 'FIREWORKS_API_KEY' },
};

const LABELS = {
    deepseek:   'DeepSeek (api.deepseek.com)',
    routerai:   'RouterAI (routerai.ru) — рубли',
    glm:        'GLM Coding Plan (z.ai, подписка)',
    glm2:       'GLM Coding Plan — второй аккаунт (z.ai)',
    openrouter: 'OpenRouter',
    fireworks:  'Fireworks AI',
    anthropic:  'Anthropic (оригинал)',
};

// Проба здоровья бэкенда: DeepSeek — /user/balance (проверяет и ключ, и баланс),
// прочие — /v1/models. 8 секунд, дальше считаем мёртвым.
async function pingBackend(name, cfg) {
    const probe = name === 'deepseek'
        ? { url: 'https://api.deepseek.com/user/balance', auth: `Bearer ${cfg.apiKey}` }
        : { url: cfg.url.replace(/\/anthropic$/, '').replace(/\/api$/, '/api/v1') + '/models', auth: `Bearer ${cfg.apiKey}` };
    try {
        const r = await fetch(probe.url, { headers: { Authorization: probe.auth }, signal: AbortSignal.timeout(8000) });
        if (r.status === 401 || r.status === 403) return { ok: false, reason: 'ключ отклонён' };
        if (r.status === 402) {
            const j = await r.json().catch(() => ({}));
            return { ok: false, reason: `баланс кончился (${j.balance_infos?.[0]?.total_balance ?? '?'}$)` };
        }
        if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
        if (name === 'deepseek') {
            const j = await r.json();
            if (j.is_available === false) return { ok: false, reason: `баланс ${j.balance_infos?.[0]?.total_balance ?? '?'}$` };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: e.name === 'TimeoutError' ? 'нет ответа' : e.message.slice(0, 60) };
    }
}

export async function launchProxy(opts = {}) {
    const port = opts.port || 3200;
    const defaultBackend = opts.backend || 'deepseek';

    // Suppress proxy noise — redirect [MODEL-PROXY] and [DNS] to log file
    const fs = await import('node:fs');
    const logStream = fs.createWriteStream('/tmp/gift-proxy.log', { flags: 'a' });
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args) => {
        const msg = args.join(' ');
        if (msg.includes('[MODEL-PROXY]') || msg.includes('[DNS]')) {
            logStream.write(msg + '\n');
        } else {
            origLog(...args);
        }
    };
    console.error = (...args) => {
        const msg = args.join(' ');
        if (msg.includes('[MODEL-PROXY]') || msg.includes('[DNS]')) {
            logStream.write(msg + '\n');
        } else {
            origError(...args);
        }
    };

    // Собрать бэкенды из env
    const backends = {};
    for (const [name, def] of Object.entries(BACKEND_DEFS)) {
        const key = process.env[def.keyEnv];
        if (key) backends[name] = { url: def.url, apiKey: key };
    }
    if (!Object.keys(backends).length) {
        console.error('Нет API-ключей. Установите хотя бы один:');
        console.error('  export DEEPSEEK_API_KEY=sk-...');
        console.error('  export ROUTERAI_API_KEY=sk-...');
        process.exit(1);
    }

    // Живой бэкенд: дефолтный мог умереть (баланс в минусе, ключ отозван).
    // Быстрая проба здоровья (таймаут 8с) и честная причина на консоль —
    // «Authentication Fails» от DeepSeek при балансе −0.03$ звучит как
    // «ключ неверен», хотя лечится пополнением, а не сменой ключа.
    // Порт занят живым прокси? (deepclaude с GLM Coding Plan поднял :3200 раньше.)
    // Тогда gift не воюет за порт — подключается к нему: один и тот же
    // живой контур LLM на всю машину, подписка одна.
    try {
        const r = await fetch(`http://127.0.0.1:${port}/_proxy/status`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
            const st = await r.json();
            console.error(`  ✓ Порт ${port} занят живым прокси (${st.label || st.mode}) — gift подключается к нему`);
            return { port, mode: st.mode, label: st.label, external: true, switchMode: () => {} };
        }
    } catch { /* порт свободен — поднимаем свой */ }

    let backend = defaultBackend;
    if (backends[backend]) {
        const health = await pingBackend(backend, backends[backend]);
        if (!health.ok) {
            console.error(`  ⚠ ${LABELS[backend] || backend}: ${health.reason} — ищу живой бэкенд…`);
            for (const [name, cfg] of Object.entries(backends)) {
                if (name === backend) continue;
                const h = await pingBackend(name, cfg);
                if (h.ok) { backend = name; break; }
            }
            if (backend === defaultBackend) {
                console.error('  ✗ Живых бэкендов нет. Пополни баланс или обнови ключ.');
                process.exit(1);
            }
            console.error(`  ✓ Переключаюсь на ${LABELS[backend] || backend}`);
        }
    }
    const fb = backends[backend];

    const proxy = await startModelProxy({
        targetUrl: fb.url,
        apiKey: fb.apiKey,
        startPort: port,
        backends,
        defaultMode: backend,
    });

    // Переключить на нужный бэкенд
    if (proxy.switchMode && backend !== 'anthropic') {
        proxy.switchMode(backend);
    }

    const activeLabel = LABELS[backend] || backend;
    const availableBackends = Object.keys(backends).join(', ');

    // Баннер покажет gift-agent

    return proxy;
}

export async function launchWithClaude(opts = {}) {
    const proxy = await launchProxy(opts);

    // Запустить Claude Code
    const env = {
        ...process.env,
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}`,
        // Внешний прокси (deepclaude/glm) знает свой ключ сам; свой — из выбранного бэкенда.
        ANTHROPIC_AUTH_TOKEN: proxy.external
            ? (process.env.ANTHROPIC_AUTH_TOKEN || 'proxy')
            : (process.env.DEEPSEEK_API_KEY || process.env.ROUTERAI_API_KEY || 'proxy'),
        CLAUDE_CODE_EFFORT_LEVEL: 'max',
    };

    // Запустить gift standalone agent (без зависимости от claude бинарника).
    // По умолчанию — современный Ink-UI (как Claude Code). Классический term-ui: GIFT_CLASSIC_UI=1
    const uiFile = process.env.GIFT_CLASSIC_UI ? 'gift-agent.js' : 'ink-cli.mjs';
    const agentPath = new URL('../agent-cli/' + uiFile, import.meta.url).pathname;
    const args = [...(opts.claudeArgs || [])];
    // Родитель (gift) остаётся жив, ожидая ребёнка, и делит с ним TTY (stdio:inherit).
    // Если он продолжает читать stdin — ввод расщепляется «через один символ», а при
    // смене ребёнком raw-режима родитель ловит EIO и падает (роняя терминал в raw).
    // Поэтому: снимаем listeners, глушим EIO, ставим на паузу, а ПОСЛЕ spawn —
    // уничтожаем поток stdin родителя (ребёнок уже владеет своим fd0).
    const isTTY = process.stdin.isTTY;
    if (isTTY) {
        try { process.stdin.setRawMode(false); } catch {}
        process.stdin.removeAllListeners('data');
        process.stdin.removeAllListeners('readable');
        process.stdin.removeAllListeners('keypress');
        process.stdin.on('error', () => {});   // глушим EIO — не падаем, не роняем терминал
        process.stdin.pause();
    }
    const agent = spawn('node', [agentPath, ...args], {
        env,
        stdio: 'inherit',
        cwd: process.cwd(),
    });
    // Ребёнок получил собственный fd0 при spawn → можно убрать stdin родителя совсем,
    // чтобы он гарантированно не конкурировал за ввод.
    if (isTTY) { try { process.stdin.destroy(); } catch {} }

    agent.on('exit', (code) => {
        proxy.close();
        process.exit(code || 0);
    });

    process.on('SIGINT', () => {
        agent.kill('SIGINT');
        proxy.close();
    });
}
