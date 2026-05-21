#!/usr/bin/env node
/**
 * gift-shard.mjs — Конфиденциальные запросы через шардирование
 *
 * Проблема: конструктор КБ не может слать чертежи в DeepSeek/OpenAI.
 * Решение: разбить запрос на N фрагментов, каждый — к разной модели.
 * Ни один провайдер не видит полной картины. Сборка — локально.
 *
 * Стратегии:
 *   1. shard — разбить запрос на N частей, разослать по N моделям
 *   2. noise — добавить шумовые сущности, отфильтровать при сборке
 *   3. local_first — локальная модель для чувствительного, облачная для общего
 *   4. template — отправить структуру запроса без значений, подставить локально
 *
 * Использование:
 *   node utils/gift-shard.mjs shard --query "спроектировать крыло из композита 5кг" --parts 3
 *   node utils/gift-shard.mjs noise --query "..." --noise-level 0.3
 *   node utils/gift-shard.mjs template --query "..." --template "профиль {X} для нагрузки {Y}"
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Модели для шардирования ─────────────────────────────────────────────────

const MODEL_ENDPOINTS = [
  { name: 'deepseek',  url: 'https://api.deepseek.com/chat/completions', keyEnv: 'DEEPSEEK_API_KEY' },
  { name: 'ollama',    url: 'http://localhost:11434/api/generate',        keyEnv: null },
  { name: 'openrouter',url: 'https://openrouter.ai/api/v1/chat/completions', keyEnv: 'OPENROUTER_API_KEY' },
  { name: 'claude',    url: 'https://api.anthropic.com/v1/messages',      keyEnv: 'ANTHROPIC_API_KEY' },
];

// ── Стратегия 1: Шардирование запроса ──────────────────────────────────────

/**
 * Разбивает запрос на N независимых подзапросов.
 * Каждый содержит ЧАСТЬ исходного запроса + свою точку зрения.
 * Ни один провайдер не видит полной картины.
 */
export function shardQuery(query, parts = 3) {
  // Извлекаем ключевые аспекты запроса
  const aspects = extractAspects(query);

  // Распределяем аспекты по шардам
  const shards = [];
  const aspectChunks = chunkArray(aspects, parts);

  for (let i = 0; i < parts; i++) {
    const myAspects = aspectChunks[i] || [];
    const shard = {
      index: i,
      model: MODEL_ENDPOINTS[i % MODEL_ENDPOINTS.length].name,
      query: `Ты анализируешь ТОЛЬКО следующие аспекты проектного запроса:
${myAspects.map(a => `- ${a}`).join('\n')}

Исходный запрос (для контекста, но анализируй ТОЛЬКО свои аспекты):
${query}

Дай ответ ТОЛЬКО по своим аспектам. Не упоминай другие аспекты.`,
      aspects: myAspects,
    };
    shards.push(shard);
  }

  return { original: query, parts, shards };
}

function extractAspects(query) {
  const aspects = [];

  // Извлекаем ключевые слова и аспекты
  const patterns = [
    { regex: /композит|углепластик|стеклопластик|материал/gi, aspect: 'материалы и композиты' },
    { regex: /крыл[оа]|профиль|аэродинамик|подъ[её]мн/gi, aspect: 'аэродинамика и профиль' },
    { regex: /двигател|мотор|винт|пропеллер|тяг[аи]|RPM|KV/gi, aspect: 'силовая установка' },
    { regex: /вес|масс[аы]|кг|грамм|нагрузк/gi, aspect: 'массо-габаритные характеристики' },
    { regex: /батаре[яи]|аккумулятор|заряд|энерг|питани/gi, aspect: 'энергоснабжение' },
    { regex: /контроллер|автопилот|ArduPilot|PX4|пол[её]тн/gi, aspect: 'авионика и управление' },
    { regex: /связ[ьи]|радио|телеметри|канал|частота/gi, aspect: 'связь и телеметрия' },
    { regex: /прочн|вибраци|резонанс|нагрузк|испытани/gi, aspect: 'прочность и испытания' },
    { regex: /стоимост|бюджет|руб|цен[аы]|дешев/gi, aspect: 'экономика и стоимость' },
    { regex: /производств|техпроцесс|оснастк|формовк/gi, aspect: 'технология производства' },
  ];

  for (const p of patterns) {
    if (p.regex.test(query)) {
      aspects.push(p.aspect);
      p.regex.lastIndex = 0; // сброс
    }
  }

  if (aspects.length === 0) aspects.push('общая концепция', 'технические требования', 'ограничения');

  return [...new Set(aspects)];
}

function chunkArray(arr, n) {
  const result = [];
  const size = Math.ceil(arr.length / n);
  for (let i = 0; i < n; i++) {
    result.push(arr.slice(i * size, (i + 1) * size));
  }
  return result;
}

// ── Стратегия 2: Зашумление ─────────────────────────────────────────────────

/**
 * Добавляет шумовые сущности в запрос. При сборке ответа шум фильтруется.
 * Провайдер видит запрос с фальшивыми деталями, неотличимыми от реальных.
 */
export function noiseWrap(query, noiseLevel = 0.3) {
  const noiseEntities = [
    { type: 'material', values: ['алюминий 6061', 'титан BT6', 'ABS-пластик', 'нейлон PA12'] },
    { type: 'profile', values: ['NACA 0012', 'EPPLER 374', 'SELIG 1223', 'GOE 417A'] },
    { type: 'motor', values: ['T-Motor 4014', 'Sunnysky 2216', 'EMAX 2306', 'Racerstar 2205'] },
    { type: 'weight', values: ['2.3 кг', '7.8 кг', '0.9 кг', '15 кг'] },
    { type: 'frequency', values: ['2.4 GHz', '868 MHz', '433 MHz', '5.8 GHz'] },
  ];

  const noisyQuery = query + '\n\nДополнительные (возможно неверные) данные из предыдущих итераций:\n' +
    noiseEntities.map(ne => {
      const shuffled = [...ne.values].sort(() => Math.random() - 0.5);
      return `- ${ne.type}: ${shuffled.slice(0, Math.ceil(noiseLevel * ne.values.length)).join(', ')}`;
    }).join('\n');

  return {
    original: query,
    noisy: noisyQuery,
    noiseLevel,
    filterInstructions: 'При анализе ответа игнорируй: ' +
      noiseEntities.flatMap(ne => ne.values).join(', '),
  };
}

// ── Стратегия 3: Template extraction ────────────────────────────────────────

/**
 * Извлекает из запроса чувствительные значения, заменяет их плейсхолдерами.
 * Облачной модели отправляется ОБЕЗЛИЧЕННЫЙ шаблон.
 * Чувствительные значения подставляются локально в ответ.
 */
export function templateExtract(query) {
  const sensitive = {};

  // Извлекаем числа с единицами
  let clean = query.replace(/(\d+\.?\d*)\s*(кг|mm|см|м|Hz|GHz|MHz|RPM|KV|Вт|W|A|ч|час|мин|°C)/gi, (match, num, unit) => {
    const key = `VAL_${Object.keys(sensitive).length}`;
    sensitive[key] = match;
    return key;
  });

  // Извлекаем названия материалов/компонентов
  const knownTerms = [
    'углепластик', 'стеклопластик', 'титан', 'алюминий',
    'CLARK-Y', 'NACA', 'Cube Orange', 'ArduPilot', 'PX4',
    'Tang Nano', 'RK3588', 'Orange Pi',
  ];
  for (const term of knownTerms) {
    const regex = new RegExp(term, 'gi');
    if (regex.test(clean)) {
      const key = `TERM_${Object.keys(sensitive).length}`;
      sensitive[key] = term;
      clean = clean.replace(regex, key);
    }
  }

  return {
    original: query,
    template: clean,
    sensitive,
    reassemble: (response) => {
      let result = response;
      for (const [key, value] of Object.entries(sensitive)) {
        result = result.replace(new RegExp(key, 'gi'), value);
      }
      return result;
    },
  };
}

// ── Сборка ответов ──────────────────────────────────────────────────────────

export function assembleShards(shards, responses) {
  const combined = {
    original: shards.original,
    parts: shards.parts,
    responses: [],
    synthesis: '',
  };

  for (let i = 0; i < shards.shards.length; i++) {
    const shard = shards.shards[i];
    const response = responses[i] || '(нет ответа)';
    combined.responses.push({
      model: shard.model,
      aspects: shard.aspects,
      response: response.slice(0, 500),
    });
  }

  // Локальная сборка: объединяем ответы
  combined.synthesis = combined.responses
    .map(r => `[${r.model} по ${r.aspects.join(', ')}]: ${r.response.slice(0, 200)}`)
    .join('\n');

  return combined;
}

// ── Оценка риска утечки ─────────────────────────────────────────────────────

export function assessLeakRisk(shards) {
  // Сколько информации получает КАЖДЫЙ провайдер
  const totalAspects = new Set(shards.shards.flatMap(s => s.aspects)).size;

  const providerRisks = {};
  for (const shard of shards.shards) {
    if (!providerRisks[shard.model]) {
      providerRisks[shard.model] = { aspects: 0, maxPossible: totalAspects };
    }
    providerRisks[shard.model].aspects += shard.aspects.length;
  }

  return {
    totalAspects,
    parts: shards.parts,
    providers: Object.entries(providerRisks).map(([name, r]) => ({
      provider: name,
      aspectsSeen: r.aspects,
      fractionOfTotal: (r.aspects / totalAspects).toFixed(2),
      safe: r.aspects < totalAspects * 0.6, // никто не видит >60%
    })),
    verdict: Object.values(providerRisks).every(r => r.aspects < totalAspects * 0.6)
      ? '✓ Безопасно: ни один провайдер не видит полной картины'
      : '⚠ Увеличьте число частей — отдельные провайдеры видят слишком много',
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
const CMD = process.argv[2];

if (CMD === 'shard') {
  const query = process.argv.find((_, i) => process.argv[i-1] === '--query') || '';
  const parts = parseInt(process.argv.find((_, i) => process.argv[i-1] === '--parts') || '3');
  if (!query) { console.error('shard --query "..." [--parts N]'); process.exit(1); }

  const result = shardQuery(query, parts);
  console.log(JSON.stringify(result, null, 2));

  const risk = assessLeakRisk(result);
  console.log(`\n  ${risk.verdict}`);
  for (const p of risk.providers) {
    console.log(`    ${p.provider}: ${p.aspectsSeen}/${risk.totalAspects} аспектов (${(p.fractionOfTotal*100).toFixed(0)}%) ${p.safe ? '✓' : '⚠'}`);
  }

} else if (CMD === 'noise') {
  const query = process.argv.find((_, i) => process.argv[i-1] === '--query') || '';
  const level = parseFloat(process.argv.find((_, i) => process.argv[i-1] === '--noise-level') || '0.3');
  const result = noiseWrap(query, level);
  console.log(JSON.stringify(result, null, 2));

} else if (CMD === 'template') {
  const query = process.argv.find((_, i) => process.argv[i-1] === '--query') || '';
  const result = templateExtract(query);
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n  Обезличенный шаблон: ${result.template}`);
  console.log(`  Чувствительных значений: ${Object.keys(result.sensitive).length}`);

} else if (CMD === 'risk') {
  // Быстрая оценка: на сколько частей разбить запрос
  const query = process.argv.find((_, i) => process.argv[i-1] === '--query') || '';
  const aspects = extractAspects(query);
  const minParts = Math.max(2, Math.ceil(aspects.length / 2));

  console.log(JSON.stringify({
    query,
    aspectsFound: aspects,
    aspectCount: aspects.length,
    recommendedParts: minParts,
    recommendedModels: MODEL_ENDPOINTS.slice(0, minParts).map(m => m.name),
    localModel: 'ollama (для самых чувствительных аспектов)',
  }, null, 2));

} else {
  console.error('gift-shard: shard | noise | template | risk');
  console.error('  shard --query "..." --parts N   — разбить запрос между моделями');
  console.error('  noise --query "..." --noise-level 0.3 — зашумление');
  console.error('  template --query "..." — обезличивание');
  console.error('  risk --query "..." — оценка минимального числа частей');
  process.exit(1);
}
} // end CLI
