#!/usr/bin/env node
/**
 * skill-inject.mjs — UserPromptSubmit хук
 *
 * Читает запрос пользователя из stdin (JSON от Claude Code).
 * Ищет релевантный навык в skills.json.
 * Если нашёл — выводит паттерн в stdout (Claude Code инжектирует в контекст).
 *
 * Подключается в .claude/settings.json:
 *   "UserPromptSubmit": [{ "type": "command", "command": "node .../skill-inject.mjs" }]
 *
 * Вывод: injectedContext (читается Claude Code как дополнение к промпту).
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_FILE = resolve(ROOT, 'data/skills.json')

// ── Читать prompt из stdin ────────────────────────────────────────────────
let userPrompt = ''
try {
  const raw = readFileSync('/dev/stdin', 'utf8').trim()
  if (raw) {
    const event = JSON.parse(raw)
    userPrompt = (event.prompt || event.message || event.input || '').toLowerCase().trim()
  }
} catch { process.exit(0) }

if (!userPrompt || !existsSync(SKILLS_FILE)) process.exit(0)

// ── Загрузить матрицу навыков ─────────────────────────────────────────────
const { skills } = JSON.parse(readFileSync(SKILLS_FILE, 'utf8'))

// ── Скоринг ───────────────────────────────────────────────────────────────
function score(skill, q) {
  let s = 0
  const words = q.split(/\s+/).filter(w => w.length > 2)
  for (const trigger of skill.triggers) {
    if (q.includes(trigger.toLowerCase())) s += 10
    for (const w of words) {
      if (trigger.toLowerCase().includes(w)) s += 3
    }
  }
  if (skill.title.toLowerCase().includes(q.slice(0, 30))) s += 5
  for (const w of words) {
    if (skill.title.toLowerCase().includes(w)) s += 2
    if ((skill.type || '').toLowerCase().includes(w)) s += 1
  }
  return s
}

const scored = skills
  .map(sk => ({ sk, s: score(sk, userPrompt) }))
  .filter(x => x.s >= 5)   // порог релевантности
  .sort((a, b) => b.s - a.s)
  .slice(0, 2)              // максимум 2 паттерна

if (!scored.length) process.exit(0)

// ── Форматировать вывод ───────────────────────────────────────────────────
function renderSkill(skill) {
  const lines = [
    `**НАВЫК [${skill.id}]**: ${skill.title}`,
    `*тип: ${skill.type} | применялось: ${skill.usedCount}x*`,
    '',
    'Паттерн:',
    ...skill.pattern.steps.map(s => `  ${s}`),
  ]
  if (skill.pattern.pitfalls?.length) {
    lines.push('')
    lines.push('Ловушки (уже были ошибки — не повторять):')
    skill.pattern.pitfalls.forEach(p => lines.push(`  ⚠ ${p}`))
  }
  return lines.join('\n')
}

const output = [
  '─── SKILL MATRIX (из памяти _claude) ───',
  '',
  ...scored.map(x => renderSkill(x.sk)),
  '',
  '─── END SKILL MATRIX ───',
].join('\n')

// Claude Code ожидает JSON с полем injectedContext ИЛИ просто stdout текст
// Попробуем оба формата — выводим структурированный JSON
console.log(JSON.stringify({ injectedContext: output }))
