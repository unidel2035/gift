/**
 * SpecRunner — AI-Native Harness для исполняемых спек.
 *
 * Исполняемая спека = { meta, specs[] } где каждая спека — run(ctx) → pass/fail.
 * Агент вызывает spec_run("module") → structured JSON, никакого чтения кода.
 *
 * Формат спеки:
 *   export const meta = { module: 'foo', description: '...', tags: [] }
 *   export const specs = [
 *     { name: '..', desc: '..', tags: ['live'], timeout: 5000,
 *       async run(ctx) { ctx.assert(...); await ctx.api('GET', '/path'); } }
 *   ]
 *
 * Contract-clause слой (опционально, схема ИСТОК — см. docs/specs/executable-spec-contracts.md):
 *   clause       — стабильный id ("COP-001"), не меняется, служит вечной ссылкой
 *   given/when/then — формализация требования (Gherkin-style, prose)
 *   falsifier    — условие, при котором клауза считается нарушенной (не то же самое,
 *                  что "assert упал" — это человекочитаемое условие опровержения)
 *   derivedFrom  — id клаузы, из которой эта произошла (линия наследования)
 *   supersededBy — если клауза устарела, id той, что её заменила; сама клауза
 *                  ИЗ ФАЙЛА НЕ УДАЛЯЕТСЯ — старая ссылка (clause id) продолжает резолвиться
 *                  через findClause() и указывает на актуальную версию.
 * Все поля опциональны, КРОМЕ falsifier: спека с clause обязана нести условие
 * опровержения — без фальсификатора клауза не является контрактом (proposal #98).
 * Спека без clause/falsifier работает как раньше (простой прогон).
 */

import path from 'path'
import { fileURLToPath } from 'url'
import { readdir, readFile } from 'fs/promises'
import { spawn } from 'child_process'
import http from 'http'
import https from 'https'
// Ярус 4 (адверсариальная верификация) — опционален: без LLM-контура пакет
// работает на assert/exec; judge/adversarialVerify просто недоступны.
let adversarialVerify = null
try {
  ({ adversarialVerify } = await import('../verification/AdversarialVerify.js'))
} catch { /* нет контура верификации — ярус 4 отключён */ }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.SPEC_BASE_URL || 'http://localhost:8081'
const parsedBase = new URL(BASE_URL)

// Direct http.request — bypasses proxy env vars (no_proxy/http_proxy), no undici involved
function httpCall(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const opts = {
      hostname: parsedBase.hostname,
      port: parsedBase.port || 80,
      path: urlPath,
      method,
      headers: { 'content-type': 'application/json' },
      timeout: 30000,
    }
    if (data) opts.headers['content-length'] = Buffer.byteLength(data)

    const req = http.request(opts, (res) => {
      let chunks = ''
      res.on('data', c => chunks += c)
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)) }
        catch { resolve({ _status: res.statusCode, _body: chunks.slice(0, 200) }) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout: ${method} ${urlPath}`)) })
    if (data) req.write(data)
    req.end()
  })
}

class AssertionError extends Error {
  constructor(msg) { super(msg); this.name = 'AssertionError' }
}

// LLM-as-judge via DeepSeek API (key from .env DEEPSEEK_API_KEY)
function judgeWithLLM(claim, data) {
  return new Promise((resolve) => {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) return resolve({ verdict: false, reason: 'DEEPSEEK_API_KEY not set' })

    const dataStr = JSON.stringify(data, null, 2).slice(0, 800)
    const prompt = `You are an API response verifier. Evaluate strictly if this claim is true.

CLAIM: ${claim}

DATA:
${dataStr}

Reply with ONLY valid JSON, no markdown, no extra text:
{"verdict": true, "reason": "brief reason"}`

    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
      temperature: 0,
    })

    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      timeout: 20000,
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
        'content-length': Buffer.byteLength(body),
      },
    }, (res) => {
      let chunks = ''
      res.on('data', c => chunks += c)
      res.on('end', () => {
        try {
          const d = JSON.parse(chunks)
          const text = (d.choices?.[0]?.message?.content || '').trim()
          try { return resolve(JSON.parse(text)) } catch {}
          const m = text.match(/\{"verdict"\s*:\s*(true|false)[^}]*\}/)
          if (m) { try { return resolve(JSON.parse(m[0])) } catch {} }
          resolve({ verdict: false, reason: text.slice(0, 80) || 'parse error' })
        } catch (e) {
          resolve({ verdict: false, reason: e.message })
        }
      })
    })
    req.on('error', e => resolve({ verdict: false, reason: e.message }))
    req.on('timeout', () => { req.destroy(); resolve({ verdict: false, reason: 'judge timeout' }) })
    req.write(body)
    req.end()
  })
}

function makeContext() {
  const assertions = []

  async function api(method, urlPath, body) {
    return httpCall(method, urlPath, body)
  }

  function assert(condition, msg) {
    assertions.push({ msg, ok: !!condition })
    if (!condition) throw new AssertionError(msg)
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  // Run a shell command — for SSH board checks, ping, etc.
  function exec(cmd, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const proc = spawn('sh', ['-c', cmd], { env: process.env })
      let stdout = '', stderr = ''
      proc.stdout.on('data', d => stdout += d)
      proc.stderr.on('data', d => stderr += d)
      proc.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }))
      proc.on('error', e => resolve({ code: -1, stdout: '', stderr: e.message }))
      setTimeout(() => { proc.kill(); resolve({ code: -1, stdout, stderr: 'exec timeout' }) }, timeoutMs)
    })
  }

  async function judge(claim, data, opts = {}) {
    let result
    try {
      result = await Promise.race([
        judgeWithLLM(claim, data),
        new Promise((_, rej) => setTimeout(() => rej(new Error('judge timeout')), opts.timeout || 20000)),
      ])
    } catch (e) {
      result = { verdict: false, reason: e.message }
    }
    assertions.push({ msg: claim.slice(0, 100), ok: result.verdict, reason: result.reason, type: 'judge' })
    if (!result.verdict) {
      const err = new Error(`LLM judge: ${result.reason}`)
      err.isAssertionError = true
      throw err
    }
    return result
  }

  // Ярус 4 (docs/specs/anti-deception-tiers.md): N независимых судей-опровергателей вместо
  // одного judge(). Используй, когда одного LLM-судьи (ярус 2.5) недостаточно — claim критичен
  // или подозреваешь self-preference bias (судья той же модели, что генерировала claim).
  async function adversarialCheck(claim, data, opts = {}) {
    const result = await adversarialVerify(claim, data, opts)
    assertions.push({
      msg: claim.slice(0, 100),
      ok: result.survives,
      reason: result.summary,
      type: 'adversarial',
      votes: result.votes,
    })
    if (!result.survives) {
      const err = new Error(`Adversarial verify: ${result.summary}`)
      err.isAssertionError = true
      throw err
    }
    return result
  }

  return { api, assert, sleep, judge, adversarialVerify: adversarialCheck, exec, assertions }
}

async function discoverSpecFiles() {
  const files = await readdir(__dirname)
  return files.filter(f => f.startsWith('spec.') && f.endsWith('.js'))
}

async function loadModule(file) {
  const fullPath = path.join(__dirname, file)
  try {
    const mod = await import(fullPath + `?t=${Date.now()}`)  // bust cache
    return { file, meta: mod.meta || {}, specs: mod.specs || [], ok: true }
  } catch (e) {
    return { file, meta: {}, specs: [], ok: false, error: e.message }
  }
}

// Contract-clause поля спеки (все опциональны — см. заголовок файла)
function clauseFields(s) {
  return {
    clause: s.clause || null,
    given: s.given || null,
    when: s.when || null,
    then: s.then || null,
    falsifier: s.falsifier || null,
    derivedFrom: s.derivedFrom || null,
    supersededBy: s.supersededBy || null,
  }
}

export async function listModules() {
  const files = await discoverSpecFiles()
  const modules = []
  for (const f of files) {
    const m = await loadModule(f)
    modules.push({
      module: m.meta.module || f.replace(/^spec\.|\.js$/g, ''),
      description: m.meta.description || '',
      tags: m.meta.tags || [],
      specCount: m.specs.length,
      specs: m.specs.map(s => ({ name: s.name, desc: s.desc || '', tags: s.tags || [], ...clauseFields(s) })),
      loadError: m.error || null,
    })
  }
  return modules
}

// Найти clause по стабильному id ("COP-001") среди всех модулей.
// Если клауза устарела (supersededBy), возвращает её как есть + указатель на актуальную
// версию и цепочку эволюции — старая ссылка не "умирает", а разрешается в текущую правду.
export async function findClause(clauseId) {
  const files = await discoverSpecFiles()
  const all = []
  for (const f of files) {
    const m = await loadModule(f)
    const moduleName = m.meta.module || f.replace(/^spec\.|\.js$/g, '')
    for (const s of m.specs) {
      if (s.clause) all.push({ module: moduleName, name: s.name, desc: s.desc || '', ...clauseFields(s) })
    }
  }

  const hit = all.find(s => s.clause === clauseId)
  if (!hit) return { found: false, clauseId, error: `clause '${clauseId}' не найден`, available: all.map(s => s.clause) }

  const lineage = []
  let back = hit
  const seenBack = new Set([hit.clause])
  while (back.derivedFrom && !seenBack.has(back.derivedFrom)) {
    seenBack.add(back.derivedFrom)
    lineage.push(back.derivedFrom)
    back = all.find(s => s.clause === back.derivedFrom) || { clause: null }
    if (!back.clause) break
  }

  let latest = hit
  const seenFwd = new Set([hit.clause])
  while (latest.supersededBy && !seenFwd.has(latest.supersededBy)) {
    seenFwd.add(latest.supersededBy)
    const next = all.find(s => s.clause === latest.supersededBy)
    if (!next) break
    latest = next
  }

  return {
    found: true,
    clauseId,
    module: hit.module,
    name: hit.name,
    desc: hit.desc,
    given: hit.given, when: hit.when, then: hit.then, falsifier: hit.falsifier,
    derivedFrom: hit.derivedFrom,
    supersededBy: hit.supersededBy,
    superseded: !!hit.supersededBy,
    current: hit.supersededBy ? { clause: latest.clause, module: latest.module, name: latest.name } : null,
    lineage, // цепочка предков (derivedFrom), от ближайшего к дальнему
  }
}

export async function runModule(moduleName, { tags, skipTags } = {}) {
  const files = await discoverSpecFiles()
  let found = null
  for (const f of files) {
    const m = await loadModule(f)
    const name = m.meta.module || f.replace(/^spec\.|\.js$/g, '')
    if (name === moduleName) { found = m; break }
  }
  if (!found) {
    const all = await listModules()
    return { error: `Модуль '${moduleName}' не найден`, available: all.map(m => m.module) }
  }

  const runStart = Date.now()
  const results = []
  let passed = 0, failed = 0, skipped = 0

  for (const spec of found.specs) {
    const specTags = spec.tags || []

    // Фальсификатор обязателен для клаузы (proposal #98): спека с clause без
    // falsifier — не контракт, а надежда. Хвост ошибок длинной цепи виден только
    // условию опровержения; без него цепь «похоже исполнена» ≠ «доказуемо исполнена».
    if (spec.clause && !spec.falsifier) {
      failed++
      results.push({
        name: spec.name,
        desc: spec.desc || '',
        tags: specTags,
        status: 'FAIL',
        error: `clause '${spec.clause}' без falsifier: клауза не является контрактом (proposal #98)`,
        duration: 0,
        assertions: [],
        clause: spec.clause || null,
        given: spec.given || null, when: spec.when || null, then: spec.then || null,
        falsifier: null, derivedFrom: spec.derivedFrom || null, supersededBy: spec.supersededBy || null,
      })
      continue
    }

    // Tag inclusion filter
    if (tags && tags.length > 0 && !tags.every(t => specTags.includes(t))) {
      skipped++
      results.push({ name: spec.name, desc: spec.desc || '', status: 'SKIP', reason: `нет тегов: ${tags.join(',')}` })
      continue
    }
    // Tag exclusion filter
    if (skipTags && skipTags.some(t => specTags.includes(t))) {
      skipped++
      results.push({ name: spec.name, desc: spec.desc || '', status: 'SKIP', reason: `пропущен тег: ${skipTags.join(',')}` })
      continue
    }

    const ctx = makeContext()
    const specStart = Date.now()
    let status = 'PASS'
    let errorMsg = null

    try {
      await Promise.race([
        spec.run(ctx),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`timeout ${spec.timeout || 15000}ms`)), spec.timeout || 15000)
        ),
      ])
      passed++
    } catch (e) {
      status = 'FAIL'
      errorMsg = e.message
      failed++
    }

    results.push({
      name: spec.name,
      desc: spec.desc || '',
      tags: specTags,
      status,
      error: errorMsg,
      duration: Date.now() - specStart,
      assertions: ctx.assertions,
      ...clauseFields(spec),
    })
  }

  return {
    module: moduleName,
    description: found.meta.description || '',
    tags: found.meta.tags || [],
    run: new Date().toISOString(),
    passed, failed, skipped,
    duration: Date.now() - runStart,
    ok: failed === 0,
    specs: results,
  }
}

export async function runAll({ tags, skipTags, exclude } = {}) {
  const allMeta = await listModules()
  const runStart = Date.now()
  const results = []

  for (const m of allMeta) {
    if (m.loadError) continue
    if (exclude && exclude.includes(m.module)) continue
    const result = await runModule(m.module, { tags, skipTags })
    results.push(result)
  }

  return {
    run: new Date().toISOString(),
    duration: Date.now() - runStart,
    passed: results.reduce((s, r) => s + (r.passed || 0), 0),
    failed: results.reduce((s, r) => s + (r.failed || 0), 0),
    skipped: results.reduce((s, r) => s + (r.skipped || 0), 0),
    ok: results.every(r => r.ok),
    modules: results,
  }
}

// Repair context: run specs, collect failures + spec source for agent repair loop
export async function repairModule(moduleName, { skipTags = ['live', 'wireguard'] } = {}) {
  const result = await runModule(moduleName, { skipTags })
  if (result.error) return { ok: false, error: result.error, available: result.available }
  if (result.ok) return { module: moduleName, ok: true, message: 'Все спеки проходят — починка не нужна', passed: result.passed }

  const files = await discoverSpecFiles()
  let specFileName = null
  for (const f of files) {
    const m = await loadModule(f)
    const name = m.meta.module || f.replace(/^spec\.|\.js$/g, '')
    if (name === moduleName) { specFileName = f; break }
  }

  let specSource = null
  if (specFileName) {
    try { specSource = await readFile(path.join(__dirname, specFileName), 'utf8') } catch {}
  }

  const failures = result.specs.filter(s => s.status === 'FAIL')

  return {
    module: moduleName,
    ok: false,
    passed: result.passed,
    failed: result.failed,
    skipped: result.skipped,
    failures: failures.map(f => ({
      name: f.name,
      desc: f.desc,
      error: f.error,
      duration: f.duration,
      failedAssertions: (f.assertions || []).filter(a => !a.ok),
    })),
    specFile: specFileName ? `backend/monolith/src/services/specs/${specFileName}` : null,
    specSource,
  }
}
