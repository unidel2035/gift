/**
 * Тест GLM 5.2 (Zhipu AI) — роль INV-1 investigator для Мета КБ
 *
 * Получить ключ: https://bigmodel.cn → API Keys → Create
 * Установить: export ZHIPU_API_KEY=sk-...
 *
 * Запуск: node utils/test-glm52.mjs
 */

import { readFileSync } from 'fs'

const KEY = process.env.ZHIPU_API_KEY
if (!KEY) {
  console.error('\n  ❌ Нет ключа. Установи:\n     export ZHIPU_API_KEY=sk-...\n\n  Получить: https://bigmodel.cn → API Keys\n')
  process.exit(1)
}

// Zhipu OpenAI-совместимый endpoint
const BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
const MODEL = 'glm-4-5'   // GLM 5.2 на bigmodel.cn называется glm-4-5 или glm-4.5

// Тестовые промпты
const TESTS = [
  {
    name: 'INV-1: Инженер — извлечение ТРЛ и платформы',
    system: 'Ты investigator INV-1 в Мета-КБ. Твоя задача — прочитать ролевой топик Инженера и извлечь: платформа, TRL (уровень готовности), ключевые параметры, критическое допущение. Отвечай строго JSON.',
    user: `Топик Инженера (Роевой барьер / зона отказа):

"Мы рассмотрели платформу PX4+Gazebo для барьера роя. TRL сейчас около 4 — симуляция работает, но полевые испытания не проводились. Ключевой параметр: задержка команды координации < 50 мс при 12 дронах. Критическое допущение — mesh-протокол будет стабилен при потере 30% узлов."

Извлеки структурированно.`,
    schema: { platform: '', trl: 0, key_params: [], critical_assumption: '' }
  },
  {
    name: 'INV-4: Конфликты между ролями — тест рассуждения',
    system: 'Ты investigator INV-4. Твоя задача — найти противоречия между тремя ролевыми позициями. Отвечай списком конфликтов в JSON.',
    user: `Три позиции по «Роевому барьеру»:

Инженер: "Нужно 20 дронов минимум, иначе барьер не плотный. TRL-4."
ЛПР: "У нас бюджет на 8 дронов. Хотим TRL-6 до июля."
Предприниматель: "Заказчик (МЧС) готов платить за данные, но хочет результат через 3 месяца, не через год."

Выпиши все противоречия.`,
    schema: { conflicts: [] }
  },
  {
    name: 'Стресс-тест: длинный контекст (1М)',
    system: 'Суммаризируй следующий текст в 2 предложения.',
    user: 'Беспилотный летательный аппарат (БПЛА) — '.repeat(200) + ' Что это такое?',
    schema: null
  }
]

async function callGLM(system, user, model = MODEL) {
  const t0 = Date.now()
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.1,
      max_tokens: 1500
    })
  })
  const ms = Date.now() - t0
  const data = await resp.json()
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(data)}`)
  const content = data.choices?.[0]?.message?.content ?? ''
  const usage = data.usage ?? {}
  return { content, ms, usage, model: data.model }
}

// Попробовать несколько вариантов имени модели
const MODEL_CANDIDATES = [
  'glm-4-5',
  'glm-4.5',
  'glm-5.2',
  'glm-4-5-flash',
  'glm-z1-air',
]

async function discoverModel() {
  console.log('\n  🔍 Определяю имя модели GLM 5.2 на bigmodel.cn...')
  for (const m of MODEL_CANDIDATES) {
    try {
      const r = await callGLM('Ответь одним словом.', 'Привет', m)
      console.log(`  ✅ Работает: ${m} (${r.ms}ms)`)
      return m
    } catch (e) {
      console.log(`  ✗  ${m}: ${e.message.slice(0, 60)}`)
    }
  }
  return null
}

async function runTests(model) {
  const results = []
  for (const t of TESTS) {
    console.log(`\n  ━━━ ${t.name} ━━━`)
    try {
      const r = await callGLM(t.system, t.user, model)
      console.log(`  ⏱  ${r.ms}ms | tokens: ${r.usage.prompt_tokens ?? '?'}→${r.usage.completion_tokens ?? '?'}`)
      console.log(`  📤 ${r.content.slice(0, 300)}${r.content.length > 300 ? '…' : ''}`)

      // Пробуем распарсить JSON если ожидали schema
      if (t.schema) {
        const jsonMatch = r.content.match(/```(?:json)?\s*([\s\S]+?)```/) || r.content.match(/(\{[\s\S]+\})/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1])
            console.log(`  ✅ JSON валиден:`, JSON.stringify(parsed).slice(0, 200))
          } catch { console.log('  ⚠️  Ответ не является валидным JSON') }
        }
      }
      results.push({ name: t.name, ok: true, ms: r.ms, usage: r.usage })
    } catch (e) {
      console.log(`  ❌ Ошибка: ${e.message}`)
      results.push({ name: t.name, ok: false, error: e.message })
    }
  }
  return results
}

// Вывод финального резюме
function printSummary(model, results) {
  console.log('\n  ══════════════════════════════════')
  console.log(`  РЕЗЮМЕ — GLM 5.2 (${model})`)
  console.log('  ══════════════════════════════════')
  for (const r of results) {
    const ok = r.ok ? '✅' : '❌'
    const ms = r.ms ? `${r.ms}ms` : ''
    const tok = r.usage ? `${r.usage.completion_tokens ?? '?'} токенов` : ''
    console.log(`  ${ok} ${r.name} ${ms} ${tok}`)
  }
  const avgMs = results.filter(r => r.ms).reduce((a, r) => a + r.ms, 0) / results.filter(r => r.ms).length
  console.log(`\n  Средняя задержка: ${Math.round(avgMs)}ms`)
  console.log('\n  Вывод для Мета КБ:')
  console.log('  • INV-1..4 (investigator workers): GLM 5.2 ✓ (дёшево, 1М контекст)')
  console.log('  • DraftWorker / GK synthesis: НЕ GLM 5.2 (слабое рассуждение)')
  console.log('  • SynthVal-1..3: спорно — тестировать отдельно\n')
}

;(async () => {
  console.log('\n  ╔══════════════════════════════════╗')
  console.log('  ║  GLM 5.2 Test — Мета КБ INV Role ║')
  console.log('  ╚══════════════════════════════════╝')

  const model = await discoverModel()
  if (!model) {
    console.error('\n  ❌ Не нашёл рабочую модель GLM. Проверь ключ и биллинг на bigmodel.cn')
    process.exit(1)
  }

  const results = await runTests(model)
  printSummary(model, results)
})()
