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
    openrouter: { url: 'https://openrouter.ai/api/v1',             keyEnv: 'OPENROUTER_API_KEY' },
    fireworks:  { url: 'https://api.fireworks.ai/inference/v1',     keyEnv: 'FIREWORKS_API_KEY' },
};

const LABELS = {
    deepseek:   'DeepSeek (api.deepseek.com)',
    routerai:   'RouterAI (routerai.ru) — рубли',
    openrouter: 'OpenRouter',
    fireworks:  'Fireworks AI',
    anthropic:  'Anthropic (оригинал)',
};

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

    // Fallback URL + key
    const fb = backends[defaultBackend] || backends.deepseek || Object.values(backends)[0];
    if (!fb) {
        console.error('Нет API-ключей. Установите хотя бы один:');
        console.error('  export DEEPSEEK_API_KEY=sk-...');
        console.error('  export ROUTERAI_API_KEY=sk-...');
        process.exit(1);
    }

    const proxy = await startModelProxy({
        targetUrl: fb.url,
        apiKey: fb.apiKey,
        startPort: port,
        backends,
        defaultMode: defaultBackend,
    });

    // Переключить на нужный бэкенд
    if (proxy.switchMode && defaultBackend !== 'anthropic') {
        proxy.switchMode(defaultBackend);
    }

    const activeLabel = LABELS[defaultBackend] || defaultBackend;
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
        ANTHROPIC_AUTH_TOKEN: process.env.DEEPSEEK_API_KEY || process.env.ROUTERAI_API_KEY || 'proxy',
        CLAUDE_CODE_EFFORT_LEVEL: 'max',
    };

    // Запустить gift standalone agent (без зависимости от claude бинарника)
    const agentPath = new URL('../agent-cli/gift-agent.js', import.meta.url).pathname;
    const args = [...(opts.claudeArgs || [])];
    // Сливаем буферизированные данные stdin от readline меню
    if (process.stdin.isTTY) {
        try { process.stdin.setRawMode(true); } catch {}
        await new Promise(r => setTimeout(r, 50));
        while (process.stdin.read() !== null) {}
        try { process.stdin.setRawMode(false); } catch {}
    }
    const agent = spawn('node', [agentPath, ...args], {
        env,
        stdio: 'inherit',
        cwd: process.cwd(),
    });

    agent.on('exit', (code) => {
        proxy.close();
        process.exit(code || 0);
    });

    process.on('SIGINT', () => {
        agent.kill('SIGINT');
        proxy.close();
    });
}
