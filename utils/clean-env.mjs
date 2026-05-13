/**
 * clean-env — убирает WSL/Windows system-proxy переменные из env.
 *
 * В WSL NAT-режиме шелл подхватывает Windows system proxy (`172.23.x.x:10809`),
 * которого не видно изнутри WSL. gh, claude, fetch — падают с
 * `connect: connection refused`. Эта утилита возвращает чистый env
 * для подпроцессов, идущих к github и anthropic.
 */

export function cleanEnv(extra = {}) {
  const e = { ...process.env, ...extra };
  for (const k of [
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy',
  ]) delete e[k];
  e.NO_PROXY = e.NO_PROXY || 'api.github.com,github.com,api.anthropic.com,localhost,127.0.0.1';
  e.no_proxy = e.no_proxy || e.NO_PROXY;
  return e;
}
