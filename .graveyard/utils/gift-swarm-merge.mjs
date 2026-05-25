#!/usr/bin/env node
/**
 * gift-swarm-merge.mjs — Threshold-based merge gate
 *
 * Паттерн: quorum sensing. Мёрж не по одобрению лида, а по достижению
 * порога внимания (K агентов оставили след на PR).
 *
 * Пороги (настраиваются):
 *   trivial: K=1 (документация, форматирование)
 *   standard: K=2 (обычный код)
 *   core: K=3 (core/, theology/, security)
 *
 * СЛЕД = review, comment, test run, approval, view
 *
 * Использование:
 *   node utils/gift-swarm-merge.mjs check --pr 123
 *   node utils/gift-swarm-merge.mjs gate --pr 123
 *   node utils/gift-swarm-merge.mjs config
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = resolve(ROOT, '.giftmerge.json');

// ── Default thresholds ──────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  thresholds: {
    trivial:  { K: 1, desc: 'docs, formatting, typos' },
    standard: { K: 2, desc: 'normal code changes' },
    core:     { K: 3, desc: 'core/, theology/, auth' },
  },
  coreModules: ['src/core/', 'src/theology/', 'src/memory/', 'specs/'],
  traceTypes: {
    review:      3,   // weight — code review
    comment:     1,   // weight — comment
    approval:    5,   // weight — explicit approval
    test_run:    2,   // weight — CI passed
    view:        0.5, // weight — viewed
    ai_review:   2,   // weight — AI agent review
  },
  minTraceWeight: 3,  // minimum total weight to count as "attention"
};

// ── Config ──────────────────────────────────────────────────────────────────

function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch {}
  return DEFAULT_CONFIG;
}

// ── PR trace collection ─────────────────────────────────────────────────────

function collectTraces(prNumber) {
  const traces = [];
  const env = { ...process.env, GITHUB_TOKEN: '' };

  try {
    // Reviews
    const reviews = JSON.parse(
      execSync(`gh pr view ${prNumber} --json reviews --jq '.reviews[] | {author:.author.login, state:.state, at:.submittedAt}'`, { cwd: ROOT, env }).toString().trim()
    );
    for (const r of reviews) {
      traces.push({
        agent: r.author,
        type: r.state === 'APPROVED' ? 'approval' : 'review',
        at: r.at,
        weight: r.state === 'APPROVED' ? 5 : 3,
      });
    }
  } catch {}

  try {
    // Comments (human)
    const comments = JSON.parse(
      execSync(`gh pr view ${prNumber} --json comments --jq '.comments[] | {author:.author.login, at:.createdAt}'`, { cwd: ROOT, env }).toString().trim()
    );
    for (const c of comments) {
      traces.push({ agent: c.author, type: 'comment', at: c.at, weight: 1 });
    }
  } catch {}

  try {
    // CI checks
    const checks = JSON.parse(
      execSync(`gh pr view ${prNumber} --json statusCheckRollup --jq '.statusCheckRollup[] | {name:.name, conclusion:.conclusion, at:.completedAt}' 2>/dev/null || echo '[]'`, { cwd: ROOT, env }).toString().trim()
    );
    for (const ch of checks) {
      if (ch.conclusion === 'SUCCESS') {
        traces.push({ agent: 'ci', type: 'test_run', at: ch.at, weight: 2, name: ch.name });
      }
    }
  } catch {}

  // Also check swarm: who's touched these files recently?
  try {
    const { readTouches } = require(resolve(ROOT, 'utils/gift-swarm.mjs'));
    // This would add swarm-level traces but requires file-level PR info
  } catch {}

  return traces;
}

// ── Classification ──────────────────────────────────────────────────────────

function classifyPR(prNumber) {
  try {
    const env = { ...process.env, GITHUB_TOKEN: '' };
    const files = JSON.parse(
      execSync(`gh pr view ${prNumber} --json files --jq '.files[].path'`, { cwd: ROOT, env }).toString().trim()
    );
    const config = loadConfig();
    const coreCount = files.filter(f => config.coreModules.some(m => f.startsWith(m))).length;

    if (coreCount > 0) return 'core';
    if (files.some(f => f.endsWith('.md') || f.endsWith('.txt'))) return 'trivial';
    return 'standard';
  } catch {
    return 'standard';
  }
}

// ── Gate check ──────────────────────────────────────────────────────────────

export function checkGate(prNumber) {
  const config = loadConfig();
  const classification = classifyPR(prNumber);
  const threshold = config.thresholds[classification].K;
  const traces = collectTraces(prNumber);

  // Unique agents that left traces
  const agents = new Set();
  let totalWeight = 0;
  const agentContribs = {};

  for (const t of traces) {
    agents.add(t.agent);
    totalWeight += t.weight;
    agentContribs[t.agent] = (agentContribs[t.agent] || 0) + t.weight;
  }

  const passed = agents.size >= threshold;

  return {
    pr: prNumber,
    classification,
    threshold,
    agentsCount: agents.size,
    totalWeight,
    passed,
    agents: [...agents],
    agentContribs,
    traces,
    verdict: passed
      ? `✓ ${agents.size}/${threshold} агентов — порог пройден`
      : `✗ ${agents.size}/${threshold} агентов — недостаточно`,
  };
}

// ── Auto-merge attempt ──────────────────────────────────────────────────────

export function gateAndMerge(prNumber) {
  const result = checkGate(prNumber);
  if (!result.passed) return { ...result, merged: false };

  try {
    const env = { ...process.env, GITHUB_TOKEN: '' };
    execSync(`gh pr merge ${prNumber} --squash --auto`, { cwd: ROOT, env });
    return { ...result, merged: true };
  } catch (e) {
    return { ...result, merged: false, error: e.message };
  }
}

// Only run CLI when this file is the main entry point
import { fileURLToPath as _ftu } from 'url';
import { resolve as _res } from 'path';
const _isMain = process.argv[1] && _res(process.argv[1]).includes('gift-swarm-merge');
if (_isMain) {
const CMD = process.argv[2];
const PR = parseInt(process.argv.find((_, i) => process.argv[i-1] === '--pr') || '0');

if (CMD === 'check' && PR) {
  const result = checkGate(PR);
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n  ${result.verdict}`);
  console.log(`  Классификация: ${result.classification} (порог: ${result.threshold})`);
  console.log(`  Агенты (${result.agentsCount}): ${result.agents.join(', ')}`);
  console.log(`  Общий вес внимания: ${result.totalWeight.toFixed(1)}`);
} else if (CMD === 'gate' && PR) {
  const result = gateAndMerge(PR);
  console.log(JSON.stringify(result, null, 2));
  if (result.merged) console.log(`\n  ✓ PR #${PR} слит автоматически`);
  else console.log(`\n  ✗ Мёрж невозможен: ${result.verdict}`);
} else if (CMD === 'config') {
  console.log(JSON.stringify(loadConfig(), null, 2));
} else {
  console.error('gift-swarm-merge: check --pr N | gate --pr N | config');
  process.exit(1);
}
} // end CLI block
