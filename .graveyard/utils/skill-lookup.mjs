#!/usr/bin/env node
/**
 * skill-lookup.mjs — поиск навыка по описанию задачи
 *
 * Использование:
 *   node utils/skill-lookup.mjs "добавить новый express route"
 *   node utils/skill-lookup.mjs --project fund "перезапустить сервер"
 *   node utils/skill-lookup.mjs --all          # показать все навыки
 *
 * Возвращает markdown с найденным паттерном (инжектируется в контекст агента).
 * Выход: 0 если нашёл, 1 если нет совпадений
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_FILE = resolve(ROOT, 'data/skills.json')

const args = process.argv.slice(2)
const projectIdx = args.indexOf('--project')
const projectFilter = projectIdx >= 0 ? args[projectIdx + 1] : null
const showAll = args.includes('--all')
const query = args.filter(a => !a.startsWith('--') && a !== projectFilter).join(' ').toLowerCase().trim()

if (!existsSync(SKILLS_FILE)) process.exit(1)

const { skills } = JSON.parse(readFileSync(SKILLS_FILE, 'utf8'))

// ── Поиск по триггерам (быстро, без embeddings) ───────────────────────────

function score(skill, q) {
  if (!q) return 0
  let s = 0
  const words = q.split(/\s+/)
  for (const trigger of skill.triggers) {
    if (q.includes(trigger.toLowerCase())) s += 10
    for (const w of words) {
      if (trigger.toLowerCase().includes(w) && w.length > 2) s += 3
    }
  }
  if (skill.title.toLowerCase().includes(q)) s += 5
  for (const w of words) {
    if (skill.title.toLowerCase().includes(w) && w.length > 2) s += 2
    if ((skill.type || '').toLowerCase().includes(w)) s += 1
  }
  return s
}

function renderSkill(skill) {
  const lines = [
    `### НАВЫК: ${skill.title}`,
    `*Тип: ${skill.type} | Проект: ${skill.project || 'any'} | Применялось: ${skill.usedCount}x*`,
    '',
    '**Паттерн (шаги):**',
    ...skill.pattern.steps.map(s => `- ${s}`),
  ]
  if (skill.pattern.pitfalls?.length) {
    lines.push('', '**Ловушки (уже были ошибки):**')
    skill.pattern.pitfalls.forEach(p => lines.push(`- ⚠ ${p}`))
  }
  if (skill.pattern.files?.length) {
    lines.push('', `**Ключевые файлы:** ${skill.pattern.files.join(', ')}`)
  }
  return lines.join('\n')
}

// ── Режим --all ───────────────────────────────────────────────────────────
if (showAll) {
  const filtered = projectFilter ? skills.filter(s => s.project === projectFilter) : skills
  console.log(`## Матрица навыков _claude (${filtered.length} паттернов)\n`)
  console.log('| ID | Тип | Описание | Триггеры |')
  console.log('|----|-----|----------|----------|')
  for (const sk of filtered) {
    console.log(`| ${sk.id} | ${sk.type} | ${sk.title} | ${sk.triggers.slice(0, 3).join(', ')} |`)
  }
  process.exit(0)
}

// ── Поиск ─────────────────────────────────────────────────────────────────
if (!query) {
  console.error('Укажи запрос: node utils/skill-lookup.mjs "описание задачи"')
  process.exit(1)
}

let filtered = skills
if (projectFilter) filtered = filtered.filter(s => !s.project || s.project === projectFilter)

const scored = filtered
  .map(sk => ({ sk, s: score(sk, query) }))
  .filter(x => x.s > 0)
  .sort((a, b) => b.s - a.s)

if (!scored.length) {
  process.exit(1)
}

const best = scored[0]
console.log(`\n--- SKILL MATRIX: найден паттерн (score=${best.s}) ---\n`)
console.log(renderSkill(best.sk))

// Если есть второй близкий результат — показать его тоже
if (scored[1] && scored[1].s >= best.s * 0.6) {
  console.log('\n--- Альтернативный паттерн ---\n')
  console.log(renderSkill(scored[1].sk))
}

console.log('\n--- END SKILL MATRIX ---\n')
process.exit(0)
