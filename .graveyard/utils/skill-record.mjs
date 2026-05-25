#!/usr/bin/env node
/**
 * skill-record.mjs — записать новый навык после выполнения задачи
 *
 * Использование:
 *   node utils/skill-record.mjs \
 *     --id "fund-some-task" \
 *     --project fund \
 *     --type backend \
 *     --title "Что сделано" \
 *     --triggers "ключевое слово,другое слово" \
 *     --steps "шаг 1|шаг 2|шаг 3" \
 *     --pitfalls "ловушка 1|ловушка 2" \
 *     --files "path/to/file.js,other/file.js"
 *
 * Или интерактивно (агент пишет JSON напрямую):
 *   echo '{...}' | node utils/skill-record.mjs --json
 *
 * Также инкрементирует usedCount если навык уже существует:
 *   node utils/skill-record.mjs --use "fund-add-express-route"
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_FILE = resolve(ROOT, 'data/skills.json')

const args = process.argv.slice(2)

function getArg(name) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : null
}

// ── Режим --use: инкрементировать счётчик ─────────────────────────────────
if (args.includes('--use')) {
  const id = getArg('use')
  const data = JSON.parse(readFileSync(SKILLS_FILE, 'utf8'))
  const skill = data.skills.find(s => s.id === id)
  if (!skill) { console.error(`Навык ${id} не найден`); process.exit(1) }
  skill.usedCount = (skill.usedCount || 0) + 1
  skill.lastUsed = new Date().toISOString().slice(0, 10)
  data.updated = new Date().toISOString().slice(0, 10)
  writeFileSync(SKILLS_FILE, JSON.stringify(data, null, 2), 'utf8')
  console.log(`✓ ${id} usedCount → ${skill.usedCount}`)
  process.exit(0)
}

// ── Режим --json: принять JSON из stdin ───────────────────────────────────
if (args.includes('--json')) {
  const raw = readFileSync('/dev/stdin', 'utf8').trim()
  const skill = JSON.parse(raw)
  skill.firstRecorded = skill.firstRecorded || new Date().toISOString().slice(0, 10)
  skill.usedCount = skill.usedCount || 1

  const data = JSON.parse(readFileSync(SKILLS_FILE, 'utf8'))
  const existing = data.skills.findIndex(s => s.id === skill.id)
  if (existing >= 0) {
    data.skills[existing] = { ...data.skills[existing], ...skill }
    console.log(`✓ Обновлён навык: ${skill.id}`)
  } else {
    data.skills.push(skill)
    console.log(`✓ Записан новый навык: ${skill.id}`)
  }
  data.updated = new Date().toISOString().slice(0, 10)
  writeFileSync(SKILLS_FILE, JSON.stringify(data, null, 2), 'utf8')
  process.exit(0)
}

// ── Режим CLI-аргументов ──────────────────────────────────────────────────
const id       = getArg('id')
const project  = getArg('project') || 'any'
const type     = getArg('type') || 'general'
const title    = getArg('title')
const triggers = (getArg('triggers') || '').split(',').map(t => t.trim()).filter(Boolean)
const steps    = (getArg('steps') || '').split('|').map(s => s.trim()).filter(Boolean)
const pitfalls = (getArg('pitfalls') || '').split('|').map(p => p.trim()).filter(Boolean)
const files    = (getArg('files') || '').split(',').map(f => f.trim()).filter(Boolean)

if (!id || !title || !steps.length) {
  console.error('Обязательны: --id, --title, --steps')
  console.error('Пример: node utils/skill-record.mjs --id "fund-task" --title "Что сделано" --steps "шаг 1|шаг 2"')
  process.exit(1)
}

const skill = {
  id, project, type, title, triggers,
  pattern: { steps, pitfalls, files },
  firstRecorded: new Date().toISOString().slice(0, 10),
  usedCount: 1,
}

const data = JSON.parse(readFileSync(SKILLS_FILE, 'utf8'))
const existing = data.skills.findIndex(s => s.id === id)
if (existing >= 0) {
  data.skills[existing] = { ...data.skills[existing], ...skill }
  console.log(`✓ Обновлён: ${id}`)
} else {
  data.skills.push(skill)
  console.log(`✓ Записан: ${id}`)
}
data.updated = new Date().toISOString().slice(0, 10)
writeFileSync(SKILLS_FILE, JSON.stringify(data, null, 2), 'utf8')
