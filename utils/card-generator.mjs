#!/usr/bin/env node
/**
 * card-generator.mjs — генератор продуктовых карт через роевой собор.
 *
 * Архитектура «небывалого»:
 *   Образ (апофатический seed) → роевой собор (5 линз) → верификация скачка → карта .gift
 *
 * Команды (через gift card):
 *   gift card образ "домен" [--tech T31] [--platform P01] [--space Подземное]
 *   gift card sobor <obraz.json>  — роевой собор на образ-файл
 *   gift card verify <obraz.json> — проверка новизны через W-матрицу
 *   gift card gen   <obraz.json> [--out path/to/card.gift]
 *
 * Полный цикл одной командой:
 *   gift card run "образ запроса" [--tech T05] [--platform P01] [--space Когнитивно]
 *
 * Линзы собора:
 *   инженер     — что физически реализуемо прямо сейчас
 *   оператор    — как ощущает человек на петле управления
 *   богослов    — какой образ Царства здесь, τέλος и κένωσис
 *   угроза      — как это сломать, перехватить, обойти
 *   прорыв      — что в этом НЕБЫВАЛО, чего не было в истории
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Цвета ────────────────────────────────────────────────────────────────────
const C = {
  b: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  violet: s => `\x1b[35m${s}\x1b[0m`,
  gold: s => `\x1b[33m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
};

// ── Линзы роевого собора ─────────────────────────────────────────────────────

const LENSES = [
  {
    id: 'engineer',
    name: 'Инженер',
    icon: '⚙',
    system: `Ты — инженер-конструктор систем.
Тебе дан апофатический образ: что ОТСУТСТВУЕТ в данном пространстве, и τέλος — куда должна прийти система.
Твоя задача: назвать КОНКРЕТНОЕ изделие, которое физически реализуемо сегодня.
Отвечай в формате JSON:
{
  "name": "название изделия",
  "image": "что за вещь (образ, не техописание)",
  "stage": "Взаимодействие|Интеграция|Гибридизация",
  "stageReason": "почему именно эта стадия",
  "paramShift": { "label": "как называется", "metric": "что измеряем" },
  "keyComponent": "один критический компонент",
  "feasibility": "что уже есть, что нужно создать"
}`,
  },
  {
    id: 'operator',
    name: 'Оператор',
    icon: '👤',
    system: `Ты — оператор, который будет работать с этой системой.
Тебе дан апофатический образ будущего изделия.
Опиши: что ты держишь в руках, что видишь на экране, где граница твоего контроля.
Отвечай в формате JSON:
{
  "name": "название как назовёт оператор в поле",
  "image": "что держу в руках / что вижу",
  "stage": "Взаимодействие|Интеграция|Гибридизация",
  "stageReason": "где кончается мой контроль",
  "humanMoment": "момент когда человек ДОЛЖЕН быть в петле",
  "autonomyBoundary": "что машина делает сама, что я"
}`,
  },
  {
    id: 'theologian',
    name: 'Богослов',
    icon: '✝',
    system: `Ты — богослов православной традиции, размышляющий о технологиях.
Тебе дан апофатический образ системы: чего НЕТ в данном пространстве, и куда система должна прийти.
Назови τέλος (куда это ведёт человека), κένωσις (что делегируется машине), образ Царства.
Отвечай в формате JSON:
{
  "name": "имя изделия через призму смысла",
  "image": "феноменологический образ — что за вещь в мире",
  "telos": "кого и как это возвышает (θέωσις)",
  "kenosis": "что человек отдаёт машине и что при этом сохраняет",
  "kingdomImage": "какой образ Царства здесь проявлен",
  "stage": "Взаимодействие|Интеграция|Гибридизация",
  "liturgicalAnalogy": "аналогия из литургической жизни если есть"
}`,
  },
  {
    id: 'threat',
    name: 'Угроза',
    icon: '⚔',
    system: `Ты — специалист по уязвимостям и противодействию.
Тебе дан образ будущей системы. Найди: как её сломать, перехватить, обойти, нейтрализовать.
Это нужно чтобы сделать систему прочной, а не чтобы атаковать.
Отвечай в формате JSON:
{
  "name": "как противник назовёт эту систему",
  "image": "что видит противник",
  "primaryVulnerability": "главная уязвимость",
  "countermeasures": ["как нейтрализовать", "как перехватить"],
  "robustnessCriteria": "что нужно добавить чтобы устоять",
  "stage": "Взаимодействие|Интеграция|Гибридизация",
  "deltaOrStar": "△ модификация существующего ИЛИ ★ новая боевая сущность"
}`,
  },
  {
    id: 'breakthrough',
    name: 'Прорыв',
    icon: '⚡',
    system: `Ты — мыслитель на границе известного и небывалого.
Тебе дан апофатический образ. Апофатис — это то, чего НЕТ в данном пространстве.
Твоя задача: найти то, чего НИКОГДА НЕ БЫЛО в истории этого домена.
Не улучшение. Не аналогия из другого домена. Именно ТРАНСВЕРСИЯ — новая форма.
Признак небывалого: у этого нет имени в существующем языке.
Отвечай в формате JSON:
{
  "name": "название (возможно придётся придумать новое слово)",
  "image": "образ небывалого — как объяснить человеку впервые",
  "whyUnprecedented": "почему этого не было: какие два несовместимых мира соединяются",
  "newWord": "если нужен новый термин — предложи его",
  "stage": "Взаимодействие|Интеграция|Гибридизация",
  "isLeap": true,
  "leapDescription": "через какое пространство произошёл скачок"
}`,
  },
];

// ── Claude / Ollama runner ────────────────────────────────────────────────────

const CLAUDE_BIN = existsSync('/home/new/.local/bin/claude') ? '/home/new/.local/bin/claude'
  : (process.env.CLAUDE_BIN || 'claude');
const OLLAMA     = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MDL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

function stripThink(s) {
  return String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// Env-переменные для LLM:
//   CARD_LLM_URL   — OpenAI-совместимый base URL (напр. http://127.0.0.1:8091/v1)
//   CARD_LLM_KEY   — API-ключ (или 'local')
//   CARD_LLM_MODEL — модель (напр. claude/sonnet)
const LLM_URL   = process.env.CARD_LLM_URL   || process.env.OPENAI_BASE_URL || null;
const LLM_KEY   = process.env.CARD_LLM_KEY   || process.env.OPENAI_API_KEY  || 'local';
const LLM_MODEL = process.env.CARD_LLM_MODEL || 'claude/sonnet';

function viaOpenAI(system, user) {
  if (!LLM_URL) return null;
  try {
    const body = JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: system + '\n\nОтвечай ТОЛЬКО JSON, без markdown-блоков.' },
        { role: 'user',   content: user },
      ],
      temperature: 0.5,
      max_tokens: 1500,
    });
    const r = spawnSync('curl', [
      '-s', '--max-time', '90',
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${LLM_KEY}`,
      `${LLM_URL}/chat/completions`, '-d', body,
    ], { encoding: 'utf8', timeout: 95_000, maxBuffer: 4e6 });
    const j = JSON.parse(r.stdout);
    return stripThink(j?.choices?.[0]?.message?.content) || null;
  } catch { return null; }
}

function viaOllama(system, user) {
  try {
    const body = JSON.stringify({
      model: OLLAMA_MDL, system,
      prompt: user + '\n\nОтвечай ТОЛЬКО JSON, без markdown-блоков.',
      stream: false, options: { temperature: 0.5 },
    });
    const r = spawnSync('curl', ['-s', '--max-time', '90',
      `${OLLAMA}/api/generate`, '-d', body],
      { encoding: 'utf8', timeout: 95_000, maxBuffer: 4e6 });
    if (!r.stdout) return null;
    const j = JSON.parse(r.stdout);
    return stripThink(j.response) || null;
  } catch { return null; }
}

function viaClaude(system, user) {
  try {
    const r = spawnSync(CLAUDE_BIN,
      ['--print', '--append-system-prompt',
       system + '\n\nОтвечай ТОЛЬКО JSON, без markdown-блоков.'],
      { input: user, encoding: 'utf8', timeout: 120_000, maxBuffer: 4e6 });
    const out = stripThink(r.stdout);
    if (!out || out.includes('Not logged in')) return null;
    return out;
  } catch { return null; }
}

function runClaude(system, user, { demo = false, obraz = null } = {}) {
  if (demo) return buildDemoResponse(system, obraz);

  const raw = viaClaude(system, user)
           || viaOpenAI(system, user)
           || viaOllama(system, user);

  if (!raw) return { _raw: 'no LLM available — run with --demo or set CARD_LLM_URL' };

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { _raw: raw };
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { _raw: raw };
  }
}

// ── Demo-режим: реалистичные ответы без LLM (для тестирования структуры) ──

function buildDemoResponse(system, obraz = null) {
  const sp = obraz?.space || 'Подземное';
  const req = obraz?.request || '';

  // Шаблоны по пространству
  const SPACE_DEMOS = {
    Когнитивно: {
      engineer: {
        name: 'Контур когнитивной перегрузки оператора ПВО',
        image: 'Серверная программа: синхронизирует рой пустышек в единую ложную картину на экране',
        stage: 'Гибридизация',
        stageReason: 'ИИ ведёт согласование роя; цель — перегрузить решение оператора',
        paramShift: { label: 'рой ложных целей', metric: 'перегрузка ёмкости решения: ложных/реальную ёмкость расчёта' },
        keyComponent: 'агент-координатор роя + модель психологической нагрузки оператора',
        feasibility: 'Мультиагентный фреймворк + синтетические траектории: ~12 мес',
      },
      operator: {
        name: 'Туман войны, который я сам создал',
        image: 'Я вижу их экран: 40 отметок, 3 настоящие, 37 пустышки — попробуй выбери',
        stage: 'Гибридизация',
        stageReason: 'Решение за ИИ-координатором; я ставлю задачу и время атаки',
        humanMoment: 'Момент запуска роя и подтверждение реальных целей после пробоя',
        autonomyBoundary: 'Машина: синхронизация 37 пустышек в картину. Я: выбор момента',
      },
      theologian: {
        name: 'Прелесть как оружие',
        image: 'Истина скрыта среди умноженного ложного',
        telos: 'Возвращение решения к своему — пока противник парализован выбором',
        kenosis: 'Оператор отдаёт красоту простого решения; сохраняет право конечного выбора',
        kingdomImage: 'Искуситель умножает возможности, пока не отнимает способность выбирать',
        stage: 'Гибридизация',
        liturgicalAnalogy: 'Прелесть: истина среди ложных образов — нужен наставник чтобы различить',
      },
      threat: {
        name: 'Ловушка симметрии',
        image: 'Противник запускает свой рой ложных целей против нашего роя',
        primaryVulnerability: 'Паттерн синхронизации роя — если его засечь, вся картина рассыпается',
        countermeasures: ['Случайное поведение пустышек', 'Разные эмиттеры разных производителей'],
        robustnessCriteria: 'Стохастическая траектория + разные сигнатуры у каждой пустышки',
        stage: 'Гибридизация',
        deltaOrStar: '★ новая боевая сущность — рой-картина как когнитивное оружие',
      },
      breakthrough: {
        name: 'Семантическая бомба',
        image: 'Атака не на тело — на смысл: оператор ПВО теряет не ресурс, а понимание',
        whyUnprecedented: 'Война всегда атаковала тела и машины. Это атакует категорию: само понятие "цель" становится ненадёжным',
        newWord: 'семантическая насыщенность — плотность ложных смыслов на единицу внимания оператора',
        stage: 'Гибридизация',
        isLeap: true,
        leapDescription: 'Когнитивное пространство переплавило физическую атаку в эпистемологическую',
      },
    },
  };

  const DEMO_DEFAULT = {
    engineer: {
      name: `Система для пространства: ${sp}`,
      image: `Изделие, работающее в условиях: ${(obraz?.apophasis||[]).join(', ')}`,
      stage: 'Интеграция',
      stageReason: 'Человек ставит задачу, машина исполняет в слепой зоне',
      paramShift: { label: 'адаптивная система', metric: 'время автономии при нулевых внешних сигналах' },
      keyComponent: 'бортовой процессор + датчики без внешних привязок',
      feasibility: '6–18 мес в зависимости от компонентной базы',
    },
    operator: {
      name: `Работа в ${sp}: мой контроль через другой канал`,
      image: 'Вижу только то что прислала машина; принимаю решение на основе косвенных данных',
      stage: 'Интеграция',
      stageReason: 'Я на петле, но не в прямом управлении',
      humanMoment: 'Авторизация критического действия остаётся за мной',
      autonomyBoundary: 'Машина: навигация и ситуационная осведомлённость. Я: решение о действии',
    },
    theologian: {
      name: `Присутствие через отсутствие в ${sp}`,
      image: 'Человек действует там где его нет телесно',
      telos: 'Расширение человеческого присутствия в пространства, ранее недоступные без риска жизни',
      kenosis: 'Тело остаётся в безопасности; воля и разум простираются в опасное место',
      kingdomImage: 'Пророк говорит туда куда не может войти — слово идёт вместо него',
      stage: 'Интеграция',
      liturgicalAnalogy: 'Заочное причастие: присутствие без физического тела',
    },
    threat: {
      name: `Ловушка ${sp}: слабые стороны`,
      image: 'Противник знает об ограничениях пространства и использует их',
      primaryVulnerability: 'Зависимость от нестандартного канала — его можно имитировать или подавить',
      countermeasures: ['Резервный канал', 'Аутентификация команд'],
      robustnessCriteria: 'Множественные независимые каналы + верификация источника команд',
      stage: 'Интеграция',
      deltaOrStar: '★ новая боевая сущность',
    },
    breakthrough: {
      name: `Инверсия ограничений ${sp}`,
      image: 'То чего нет в пространстве становится его главной силой',
      whyUnprecedented: `Апофатис пространства (${(obraz?.apophasis||[]).join(', ')}) превращается из слабости в уникальное преимущество`,
      newWord: `${sp.toLowerCase()}-инверсия — превращение ограничения в дифференцирующую способность`,
      stage: 'Гибридизация',
      isLeap: true,
      leapDescription: `Пространство ${sp} принудило к форме, которая невозможна без этих ограничений`,
    },
  };

  const templates = SPACE_DEMOS[sp] || DEMO_DEFAULT;

  if (system.includes('инженер-конструктор')) return templates.engineer;
  if (system.includes('оператор'))            return templates.operator;
  if (system.includes('богослов'))            return templates.theologian;
  if (system.includes('уязвимостях'))         return templates.threat;
  if (system.includes('границе известного'))  return templates.breakthrough;
  return { _raw: 'demo: unknown lens' };
}

// ── Образ (apophatic seed) ───────────────────────────────────────────────────

export function buildObraz({ request, tech, platform, space, telos, apophasis = [] }) {
  const id = createHash('md5')
    .update(`${tech||''}:${platform||''}:${space||''}:${request||''}`)
    .digest('hex')
    .slice(0, 8);

  return {
    id,
    request,
    tech:     tech     || null,
    platform: platform || null,
    space:    space    || null,
    apophasis: apophasis.length ? apophasis : buildDefaultApophasis(space),
    telos:    telos    || null,
    createdAt: new Date().toISOString(),
  };
}

function buildDefaultApophasis(space) {
  const map = {
    'Подземное':    ['нет GNSS', 'нет радиосвязи', 'нет привычной ориентации'],
    'Кибер':        ['нет физического тела', 'нет пространственной привязки', 'нет видимых границ'],
    'Когнитивно':   ['нет объективной истины', 'нет прямого принуждения', 'нет физического следа'],
    'Электромаг':   ['нет видимости', 'нет звука', 'нет тактильного контакта'],
    'ИИ-пространство': ['нет человеческой интуиции', 'нет сна', 'нет забывания'],
    'Подводное':    ['нет света', 'нет GPS', 'нет воздуха'],
    'Космическое':  ['нет атмосферы', 'нет немедленной помощи', 'нет привычного времени'],
    'Биологическое':['нет чёткой границы живое/неживое', 'нет детерминированного поведения'],
    'Ядерное':      ['нет права на ошибку', 'нет обратимости', 'нет немедленного сигнала'],
  };
  return map[space] || ['нет привычных ориентиров', 'нет стандартных решений'];
}

function obrazToPrompt(obraz) {
  const lines = [
    obraz.request && `Запрос: ${obraz.request}`,
    obraz.tech     && `Технология: ${obraz.tech}`,
    obraz.platform && `Платформа: ${obraz.platform}`,
    obraz.space    && `Ведущее пространство: ${obraz.space}`,
    obraz.apophasis.length && `Апофатис (чего НЕТ в этом пространстве):\n${obraz.apophasis.map(a => `  - ${a}`).join('\n')}`,
    obraz.telos    && `τέλος (куда должна прийти система): ${obraz.telos}`,
  ].filter(Boolean);

  return lines.join('\n');
}

// ── Роевой собор ─────────────────────────────────────────────────────────────

export async function runSobor(obraz, { lenses = LENSES, silent = false, demo = false } = {}) {
  const prompt = obrazToPrompt(obraz);
  const results = {};

  if (!silent) {
    console.log(C.b('\n══ Роевой собор ══') + (demo ? C.gold(' [demo]') : ''));
    console.log(C.dim(`Образ [${obraz.id}]: ${obraz.request || obraz.space || '—'}\n`));
  }

  for (const lens of lenses) {
    if (!silent) process.stdout.write(`  ${lens.icon} ${C.cyan(lens.name)}... `);
    try {
      const res = runClaude(lens.system, prompt, { demo, obraz });
      results[lens.id] = { ...res, _lens: lens.id, _name: lens.name };
      if (!silent) console.log(C.green('✓'));
    } catch (err) {
      results[lens.id] = { _error: err.message, _lens: lens.id, _name: lens.name };
      if (!silent) console.log(C.red(`✗ ${err.message.slice(0, 60)}`));
    }
  }

  return results;
}

// ── Синтез собора ────────────────────────────────────────────────────────────

export function synthesizeSobor(obraz, saborResults) {
  const variants = Object.values(saborResults).filter(r => !r._error && r.name);

  // Имена и образы от каждой линзы
  const names   = [...new Set(variants.map(v => v.name).filter(Boolean))];
  const images  = [...new Set(variants.map(v => v.image).filter(Boolean))];
  const stages  = variants.map(v => v.stage).filter(Boolean);

  // Большинство голосов за стадию
  const stageCounts = stages.reduce((acc, s) => { acc[s] = (acc[s]||0)+1; return acc; }, {});
  const stage = Object.entries(stageCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || 'Интеграция';

  // Прорыв если есть
  const breakthrough = saborResults.breakthrough;
  const isLeap = breakthrough?.isLeap === true || obraz.apophasis?.length > 1;

  // τέλος из богослова или образа
  const telos = saborResults.theologian?.telos || obraz.telos || null;
  const kenosis = saborResults.theologian?.kenosis || null;
  const kingdomImage = saborResults.theologian?.kingdomImage || null;

  // Угроза
  const threat = saborResults.threat;

  // Небывалое: элемент который назвала ТОЛЬКО линза прорыва
  const breakthroughWord = breakthrough?.newWord || breakthrough?.name || null;
  const breakNames = new Set(breakthrough ? [breakthrough.name, breakthrough.newWord].filter(Boolean) : []);
  const otherNames = new Set(Object.values(saborResults)
    .filter(r => r._lens !== 'breakthrough')
    .map(r => r.name).filter(Boolean));
  const unprecedentedElement = [...breakNames].find(n => !otherNames.has(n)) || null;

  return {
    id: obraz.id,
    address: [obraz.tech, obraz.platform, obraz.space].filter(Boolean).join('×') || obraz.id,
    request: obraz.request,
    // Синтезированные поля
    name:    breakthrough?.name || variants[0]?.name || '—',
    image:   images[0] || '—',
    stage,
    telos,
    kenosis,
    kingdomImage,
    isLeap,
    unprecedentedElement,
    deltaOrStar: threat?.deltaOrStar || null,
    robustness: threat?.robustnessCriteria || null,
    paramShift: saborResults.engineer?.paramShift || null,
    stageReason: saborResults.engineer?.stageReason || saborResults.operator?.stageReason || null,
    humanMoment: saborResults.operator?.humanMoment || null,
    // Все варианты для анамнезиса
    variants: Object.fromEntries(
      Object.entries(saborResults).map(([k,v]) => [k, { name: v.name, image: v.image }])
    ),
    createdAt: new Date().toISOString(),
  };
}

// ── Форматирование карты ─────────────────────────────────────────────────────

export function formatCard(card) {
  const lines = [
    `${C.b('╔══ ПРОДУКТОВАЯ КАРТА')} ${C.dim(`[${card.address}]`)}`,
    `║ ${C.b(card.name)}`,
    `║ ${C.dim('Образ:')} ${card.image}`,
    `╠══ Стадия: ${C.gold(card.stage)} ${card.isLeap ? C.gold('⚡') : ''}`,
    card.stageReason && `║ ${C.dim(card.stageReason)}`,
    `╠══ τέλος: ${C.violet(card.telos || '—')}`,
    card.kenosis && `║ κένωσις: ${card.kenosis}`,
    card.humanMoment && `║ Момент человека: ${card.humanMoment}`,
    card.paramShift && `╠══ Параметр-сдвиг: ${C.cyan(card.paramShift.label)} → ${C.cyan(card.paramShift.metric)}`,
    card.deltaOrStar && `╠══ Угроза: ${card.deltaOrStar}`,
    card.robustness && `║ ${C.dim(card.robustness)}`,
    card.unprecedentedElement && `╠══ ⚡ НЕБЫВАЛОЕ: ${C.gold(card.unprecedentedElement)}`,
    card.kingdomImage && `╠══ Образ Царства: ${C.violet(card.kingdomImage)}`,
    `╚══ ${C.dim(card.createdAt)}`,
  ].filter(Boolean);

  return lines.join('\n');
}

// ── Gift-формат карты ────────────────────────────────────────────────────────

export function cardToGift(card, obraz) {
  return `/**
 * Продуктовая карта: ${card.name}
 * Адрес: ${card.address}
 * Стадия: ${card.stage}${card.isLeap ? ' ⚡' : ''}
 * Создано: ${card.createdAt}
 */

person ProductCard extends GiftAct {

  // ── Три-осный адрес ──
  tech:      "${obraz.tech || '—'}"
  platform:  "${obraz.platform || '—'}"
  space:     "${obraz.space || '—'}"
  address:   "${card.address}"

  // ── Образ и имя ──
  name:  "${card.name}"
  image: "${card.image}"

  // ── Стадия (граница человек↔машина) ──
  stage:       ${card.stage}
  stageReason: "${card.stageReason || ''}"
  humanMoment: "${card.humanMoment || ''}"
  isLeap:      ${card.isLeap}

  // ── Параметр-сдвиг (название vs измеримое) ──
  paramShift: {
    label:  "${card.paramShift?.label || ''}"
    metric: "${card.paramShift?.metric || ''}"
  }

  // ── Gift-онтология ──
  telos:        "${card.telos || ''}"
  kenosis:      "${card.kenosis || ''}"
  kingdomImage: "${card.kingdomImage || ''}"

  // ── Верификация новизны ──
  deltaOrStar:          "${card.deltaOrStar || '—'}"
  unprecedentedElement: "${card.unprecedentedElement || ''}"
  robustness:           "${card.robustness || ''}"

  // ── Апофатис (что отсутствует в пространстве) ──
  apophasis: [${(obraz.apophasis || []).map(a => `"${a}"`).join(', ')}]

  // ── Голоса собора ──
  soborVariants: {
${Object.entries(card.variants || {}).map(([k,v]) => `    ${k}: "${v.name || ''}"`).join('\n')}
  }
}
`;
}

// ── Точка входа CLI ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const subcmd = args[0];

function parseArg(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')
    ? args[idx + 1]
    : null;
}

if (!subcmd || subcmd === '--help' || subcmd === '-h') {
  console.log(`
${C.b('gift card')} — генератор продуктовых карт через роевой собор

${C.b('Использование:')}
  gift card run  "запрос"  [--tech T31] [--platform P01] [--space Подземное] [--out путь]
  gift card образ "запрос" [--tech T31] [--platform P01] [--space Подземное]
  gift card sobor <obraz.json>  [--out путь]
  gift card show  <card.json>

${C.b('Примеры:')}
  gift card run "перехват в тоннеле без радио" --tech T31 --platform P01 --space Подземное
  gift card run "автономный агент как штабной узел" --tech T34 --platform P29 --space ИИ-пространство
  gift card образ "что умеет нейроморфный рой" --tech T02 --space Когнитивно
`);
  process.exit(0);
}

if (subcmd === 'образ') {
  const request  = args.find(a => !a.startsWith('--') && a !== 'образ');
  const tech     = parseArg('--tech');
  const platform = parseArg('--platform');
  const space    = parseArg('--space');
  const telos    = parseArg('--telos');
  const out      = parseArg('--out');

  const obraz = buildObraz({ request, tech, platform, space, telos });
  const json = JSON.stringify(obraz, null, 2);

  if (out) {
    writeFileSync(out, json, 'utf8');
    console.log(`Образ сохранён: ${out}`);
  } else {
    console.log(C.b('\n═══ Апофатический образ ═══'));
    console.log(`  ID:         ${obraz.id}`);
    console.log(`  Технология: ${obraz.tech || '—'}`);
    console.log(`  Платформа:  ${obraz.platform || '—'}`);
    console.log(`  Пространство: ${obraz.space || '—'}`);
    console.log(`  Апофатис:`);
    obraz.apophasis.forEach(a => console.log(`    - ${a}`));
    console.log(`  τέλος: ${obraz.telos || '—'}\n`);
    console.log(C.dim('JSON:'));
    console.log(json);
  }
  process.exit(0);
}

if (subcmd === 'sobor') {
  const obrazFile = args[1];
  if (!obrazFile || !existsSync(obrazFile)) {
    console.error('Нужен путь к obraz.json'); process.exit(1);
  }
  const obraz = JSON.parse(readFileSync(obrazFile, 'utf8'));
  const out   = parseArg('--out');

  const soborResults = await runSobor(obraz);
  const card = synthesizeSobor(obraz, soborResults);

  console.log('\n' + formatCard(card));

  const result = { obraz, soborResults, card };
  if (out) {
    writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
    console.log(C.dim(`\nСохранено: ${out}`));
  }
  process.exit(0);
}

if (subcmd === 'show') {
  const file = args[1];
  if (!file || !existsSync(file)) { console.error('Нужен путь к card.json'); process.exit(1); }
  const { card } = JSON.parse(readFileSync(file, 'utf8'));
  console.log(formatCard(card));
  process.exit(0);
}

if (subcmd === 'run') {
  const request  = args.find(a => !a.startsWith('--') && a !== 'run');
  const tech     = parseArg('--tech');
  const platform = parseArg('--platform');
  const space    = parseArg('--space');
  const telos    = parseArg('--telos');
  const out      = parseArg('--out');
  const demo     = args.includes('--demo');

  const obraz = buildObraz({ request, tech, platform, space, telos });

  console.log(C.b('\n═══ Образ ═══'));
  console.log(`  ${obraz.space || request || obraz.id}`);
  if (obraz.apophasis.length) {
    console.log(C.dim('  Апофатис: ') + obraz.apophasis.join(' · '));
  }

  const soborResults = await runSobor(obraz, { demo });
  const card = synthesizeSobor(obraz, soborResults);

  console.log('\n' + formatCard(card));

  if (out) {
    const giftPath = out.endsWith('.gift') ? out : out + '.gift';
    const jsonPath = out.endsWith('.json') ? out : out + '.json';
    writeFileSync(jsonPath, JSON.stringify({ obraz, soborResults, card }, null, 2), 'utf8');
    writeFileSync(giftPath, cardToGift(card, obraz), 'utf8');
    console.log(C.dim(`\nКарта: ${jsonPath}`));
    console.log(C.dim(`Gift-спека: ${giftPath}`));
  }

  process.exit(0);
}

console.error(`Неизвестная подкоманда: ${subcmd}`); process.exit(1);
