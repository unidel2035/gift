/**
 * GiftCompiler v0.1 — Interpreter for the Gift language (.gift files)
 *
 * Parses .gift source into a simple AST and executes against GiftEngine.
 * Regex-based parser — not a full grammar, but sufficient for v0.1.
 *
 * «В начале было Слово» (Ин 1:1)
 */

import { DivineEnergy } from '../theology/DivineEnergy.js';
import { Trit, Tryte, TernaryALU, PARA, KATA, HYPER } from './TernaryCore.js';

// ── Троичная математика (Сетунь) ──────────────────────
// Подключена к языку: операции НЕ, И, ИЛИ, консенсус
// работают на настоящих тритах, не на числах.
const TernaryOps = {
  НЕ: (a) => new Trit(a).not().value,
  И: (a, b) => new Trit(a).and(new Trit(b)).value,
  ИЛИ: (a, b) => new Trit(a).or(new Trit(b)).value,
  консенсус: (...vals) => {
    // Если все одинаковы → это значение. Иначе → невычислимое.
    const set = new Set(vals.filter(v => v !== null));
    if (set.size === 1) return [...set][0];
    return null; // невычислимое
  },
  мера: (a, b) => {
    // Троичная мера: не ratio, а качественное различение
    const diff = (a || 0) - (b || 0);
    if (diff > 0) return HYPER;   // surplus
    if (diff < 0) return PARA;    // kenosis
    return KATA;                   // со-мерность
  },
  трайт: (логос, энергия, связь) => new Tryte([
    new Trit(логос), new Trit(энергия), new Trit(связь)
  ]),
};

// Trit values — English + Russian
const TRIT_VALUES = {
  para: PARA, kata: KATA, hyper: HYPER, incalculable: null,
  // Русские алиасы
  'против-природы': -1, 'παρὰ': -1,
  'по-природе': 0, 'κατὰ': 0,
  'выше-природы': 1, 'ὑπὲρ': 1,
  'невычислимое': null,
};

// Русские ключевые слова → английские
const RU_KEYWORDS = {
  'лицо': 'person',
  'дарит': 'gift_inline',
  'дар': 'gift',
  'от': 'from',
  'кому': 'to',
  'через': 'through',
  'содержание': 'content',
  'ценой': 'cost',
  'ради': 'telos',
  'помня': 'anamnesis',
  'принимает': 'accept',
  'отклоняет': 'decline',
  'потому что': 'reason',
  'призвание': 'calling',
  'энергия': 'energy',
  'логос': 'logos',
  'свидетельство': 'witness',
  'невычислимое': 'incalculable',
  'суббота': 'sabbath',
  'длительность': 'duration',
  'причина': 'reason',
  'благодать': 'grace',
  'перихоресис': 'perichoresis',
  'литургия': 'liturgy',
  'пусть': 'let',
  'если': 'if',
  'когда': 'when',
  'есть': 'is',
  'фантом': 'phantom',
  'смерть': 'death',
  'воскресить': 'resurrect',
  'кеносис': 'kenosis',
  'ритм': 'rhythm',
  'рождение': 'birth',
  'служение': 'service',
  'завет': 'covenant',
  'покаяние': 'metanoia',
  'пророчество': 'prophecy',
  'община': 'community',
  'связь': 'relation',
  'кайрос': 'kairos',
  'днесь': 'mortis_kairos',
  'апофатика': 'apophatic',
  'соборно': 'conciliar',
  'содержание_пророчества': 'prophecy_content',
  'исполнение': 'fulfillment',
  'было': 'was_state',
  'стало': 'became_state',
  'свидетель': 'witness_person',
  'обещание': 'promise',
  'знак': 'sign',
  'условие': 'condition',
  'члены': 'members',
  'тип': 'rel_type',
  'граница': 'boundary',
  'источник': 'source_ref',
  'действие': 'action',
  'происхождение': 'origin',
};

// Слои данных — не мешаются в графе
const ORIGINS = {
  'реальность': 'real',
  'пророчество': 'prophecy',
  'анамнезис': 'anamnesis',
  'эмуляция': 'simulation',
};

export class GiftCompiler {
  constructor(engine) {
    this._engine = engine;
    this._vars = new Map();       // variable bindings
    this._gifts = new Map();      // gift name → gift object
    this._persons = new Map();    // person name → person object
    this._log = [];               // witness log
    this._services = new Map();   // служение name → { params, body }
    this._events = new Map();     // когда event → body
    this._covenants = new Map();  // завет name → { parties, props }
    this._prophecies = new Map(); // пророчество name → { content, status }
    this._communities = new Map(); // община name → { members }
    this._kairos = new Map();     // кайрос name → { condition, action }
    this._mortisKairos = new Map(); // днесь name → { action, witness } (без условия)
  }

  /**
   * Нормализация: русский → английские ключевые слова.
   * «лицо Адам» → «person Адам»
   * «Адам дарит Строителю» → «gift _inline from Адам to Строитель»
   * «свидетельство "текст"» → «witness "текст"»
   */
  _normalizeRussian(source) {
    let s = source;
    // Заменяем «кавычки» на обычные
    s = s.replace(/[«»]/g, '"');
    // Inline дарение: "Адам дарит Строителю" → "gift _auto from Адам to Строитель"
    s = s.replace(/^(\S+)\s+дарит\s+(\S+)\s+(.+)/gm, 'gift _auto from $1 to $2 { content: "$3" }');
    // рождение Каин от (Адам, Ева) { ... } → birth Каин from (Адам, Ева) { ... }
    s = s.replace(/^рождение\s+(\S+)\s+от\s+/gm, 'birth $1 from ');
    // связь Адам → Ева { тип: "..." } → relation Адам → Ева { ... }
    s = s.replace(/^связь\s+/gm, 'relation ');
    // соборно { ... } → conciliar { ... }
    s = s.replace(/^соборно\s*\{/gm, 'conciliar {');
    // покаяние X { было: ..., стало: ... } → metanoia X { ... }
    s = s.replace(/^покаяние\s+/gm, 'metanoia ');
    // пророчество X { содержание: "..." } → prophecy X { ... }
    s = s.replace(/^пророчество\s+/gm, 'prophecy ');
    // община X { члены: [...] } → community X { ... }
    s = s.replace(/^община\s+/gm, 'community ');
    // апофатика X { граница: "..." } → apophatic X { ... }
    s = s.replace(/^апофатика\s+/gm, 'apophatic ');
    // кайрос "X" { ... } → kairos "X" { ... }
    s = s.replace(/^кайрос\s+/gm, 'kairos ');
    // днесь "X" { ... } → mortis_kairos "X" { ... }
    s = s.replace(/^днесь\s+/gm, 'mortis_kairos ');
    // ритм 30мин { ... } → rhythm 30мин { ... }
    s = s.replace(/^ритм\s+/gm, 'rhythm ');
    // служение X (params) { ... } → service X (params) { ... }
    s = s.replace(/^служение\s+/gm, 'service ');
    // завет X с Y { ... } → covenant X with Y { ... }
    s = s.replace(/^завет\s+/gm, 'covenant ');
    // «когда дар-принят» needs special handling (already keyword-mapped to 'when')
    // «с» in завет → 'with' (не \b — Cyrillic не word character в JS)
    s = s.replace(/\sс\s+(\S+)\s*\{/gm, ' with $1 {');
    // Принимает/отклоняет
    s = s.replace(/^(\S+)\s+принимает:\s*"([^"]*)"/gm, 'accept _last { transformation: "$2" }');
    s = s.replace(/^(\S+)\s+отклоняет\s+потому что\s*"([^"]*)"/gm, 'decline _last reason "$2"');
    // Простые замены ключевых слов в начале строки
    for (const [ru, en] of Object.entries(RU_KEYWORDS)) {
      // Только в начале строки или после пробела, не внутри кавычек
      const regex = new RegExp(`(^|\\s)${ru}(\\s|:)`, 'gm');
      s = s.replace(regex, `$1${en}$2`);
    }
    // Русские значения тритов
    s = s.replace(/по-природе/g, 'kata');
    s = s.replace(/против-природы/g, 'para');
    s = s.replace(/выше-природы/g, 'hyper');
    return s;
  }

  // ═══════════════════════════════════════════════════════════════
  // compile() — статическая компиляция .gift → runtime-конфиг
  // Не исполняет (не нужен engine). Извлекает:
  //   persons → behaviorPolicy (kenosis, telos, logos)
  //   gifts   → шаблоны (required fields, validation, irreversibility)
  //   covenants → ImmutableRule (вес 10, необратимо)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Compile .gift source into runtime config without engine execution.
   * @param {string} source — .gift file content
   * @returns {CompiledSpec} — structured runtime config
   */
  static compile(source) {
    const inst = new GiftCompiler(null);
    const normalized = inst._normalizeRussian(source);
    const blocks = inst._splitIntoBlocks(normalized);

    const persons = [];
    const giftTemplates = [];
    const covenants = [];
    const witnesses = [];
    const liturgies = [];
    const errors = [];

    function compileBlocks(blockList) {
      for (const block of blockList) {
        const firstLine = block.split('\n')[0].trim();
        if (firstLine.startsWith('//')) continue;
        if (firstLine.startsWith('use ')) continue;

        // ── person ──────────────────────────────────────────────
        if (firstLine.startsWith('person ')) {
          const m = block.match(/^person\s+(\S+)\s*\{/);
          if (!m) { errors.push(`person: parse error: ${firstLine}`); continue; }
          const name = m[1];
          const body = inst._extractBody(block);

          const calling = inst._extractStringProp(body, 'calling') || name;
          const energy = inst._extractNumberProp(body, 'energy');
          const logos = inst._extractWordProp(body, 'logos') || 'kata';

          // Извлечь kenosis-блок внутри person
          const kenosisBlock = body.match(/kenosis\s*\{([^}]*)\}/);
          const kenosisPolicy = {};
          if (kenosisBlock) {
            const kb = kenosisBlock[1];
            const givesAway = kb.match(/gives_away:\s*(\S+)/);
            const holdsNothing = kb.match(/holds_nothing:\s*(\S+)/);
            if (givesAway) kenosisPolicy.givesAway = givesAway[1].replace(/,/, '');
            if (holdsNothing) kenosisPolicy.holdsNothing = holdsNothing[1] === 'true';
          }

          // Извлечь telos (telos: или цель:)
          const telos = inst._extractStringProp(body, 'telos')
            || inst._extractStringProp(body, 'цель')
            || inst._extractWordProp(body, 'telos')
            || inst._extractWordProp(body, 'цель');

          persons.push({
            name,
            calling,
            energy: energy !== null ? energy : undefined,
            logos,
            telos: telos || undefined,
            behaviorPolicy: {
              kenosis: {
                givesAway: kenosisPolicy.givesAway || 'surplus',
                holdsNothing: kenosisPolicy.holdsNothing === true,
                enforced: Object.keys(kenosisPolicy).length > 0,
              },
              telos: telos || 'give',
              logos,
            },
          });
          continue;
        }

        // ── gift ────────────────────────────────────────────────
        if (firstLine.startsWith('gift ')) {
          // Support tuple receivers: to (A, B) and single: to A
          const m = block.match(
            /^gift\s+(\S+)\s+(?:from\s+(\S+)\s+)?(?:through\s+(\S+)\s+)?(?:(?:to|кому)\s+(?:\(([^)]+)\)|(\S+))\s*)?\{/
          );
          if (!m) { errors.push(`gift: parse error: ${firstLine}`); continue; }
          const [, giftName, giver, mediator, tupleReceivers, singleReceiver] = m;
          const receiver = singleReceiver || (tupleReceivers ? tupleReceivers.split(/\s*,\s*/)[0].trim() : undefined);
          const body = inst._extractBody(block);

          // from/to can be in header OR in body (от:/кому: properties)
          const bodyFrom = inst._extractWordProp(body, 'from')
            || inst._extractWordProp(body, 'от');
          const bodyTo = inst._extractWordProp(body, 'to')
            || inst._extractWordProp(body, 'кому');
          const bodyThrough = inst._extractWordProp(body, 'through')
            || inst._extractWordProp(body, 'через');

          const content = inst._extractStringProp(body, 'content')
            || inst._extractStringProp(body, 'содержание') || giftName;
          const telos = inst._extractStringProp(body, 'telos')
            || inst._extractStringProp(body, 'цель');
          const anamnesis = inst._extractListProp(body, 'anamnesis')
            || inst._extractListProp(body, 'анамнезис');
          const type = inst._extractWordProp(body, 'type')
            || inst._extractWordProp(body, 'тип')
            || inst._extractWordProp(body, 'rel_type');
          const weight = inst._extractNumberProp(body, 'weight') || inst._extractNumberProp(body, 'вес');
          const irreversible = body.includes('irreversible: true')
            || body.includes('необратим: да')
            || body.includes('необратим: true');

          giftTemplates.push({
            name: giftName,
            from: giver || bodyFrom || undefined,
            to: receiver || bodyTo || 'all',
            through: mediator || bodyThrough || undefined,
            content,
            telos: telos || undefined,
            type: type || undefined,
            weight: weight || undefined,
            irreversible,
            anamnesis: anamnesis || [],
            validation: {
              requiresKenosis: true,
              requiresTelos: !!telos,
              requiresAnamnesis: (anamnesis || []).length > 0,
              irreversibilityEnforced: irreversible,
            },
          });
          continue;
        }

        // ── covenant ────────────────────────────────────────────
        if (firstLine.startsWith('covenant ')) {
          const m = block.match(/^covenant\s+(\S+)\s+with\s+(\S+)\s*\{/);
          if (!m) { errors.push(`covenant: parse error: ${firstLine}`); continue; }
          const [, party1, party2] = m;
          const body = inst._extractBody(block);

          const promise = inst._extractStringProp(body, 'promise')
            || inst._extractStringProp(body, 'обещание') || '';
          const sign = inst._extractStringProp(body, 'sign')
            || inst._extractStringProp(body, 'знак') || '';
          const condition = inst._extractStringProp(body, 'condition')
            || inst._extractStringProp(body, 'условие') || '';

          covenants.push({
            parties: [party1, party2],
            promise, sign, condition,
            weight: 10,
            irreversible: true,
            immutable: true,
          });
          continue;
        }

        // ── witness ─────────────────────────────────────────────
        if (firstLine.startsWith('witness ')) {
          const m = firstLine.match(/^witness\s+"([^"]*)"$/);
          if (m) witnesses.push(m[1]);
          continue;
        }

        // ── liturgy — рекурсивно компилируем внутренние блоки ───
        if (firstLine.startsWith('liturgy ')) {
          const m = block.match(/^liturgy\s+(\S+)\s*\{/);
          if (!m) continue;
          const name = m[1];
          const telosM = block.match(/telos:\s*"([^"]*)"/)
            || block.match(/цель:\s*"([^"]*)"/);
          liturgies.push({
            name,
            telos: telosM ? telosM[1] : undefined,
          });
          const innerContent = inst._extractBody(block);
          const innerBlocks = inst._splitIntoBlocks(innerContent);
          compileBlocks(innerBlocks);
          continue;
        }
      }
    }

    compileBlocks(blocks);

    return Object.freeze({
      persons,
      giftTemplates,
      covenants,
      witnesses,
      liturgies,
      errors,
      compiledAt: new Date().toISOString(),
    });
  }

  /**
   * Compile .gift source into a CommonJS runtime module string.
   * Generated module exports: persons, giftTemplates, covenants, register().
   * register(PersonRegistry) — applies all persons' behaviorPolicy.
   *
   * @param {string} source — .gift file content
   * @param {string} specName — module name (e.g. 'claude-person')
   * @returns {string} — CommonJS module source code
   */
  static compileToModule(source, specName = 'gift-spec') {
    const compiled = GiftCompiler.compile(source);
    const json = JSON.stringify(compiled, null, 2);

    return `// Auto-generated by GiftCompiler from ${specName}.gift
// compiledAt: ${compiled.compiledAt}
// persons: ${compiled.persons.map(p => p.name).join(', ')}
// covenants: ${compiled.covenants.length}
// giftTemplates: ${compiled.giftTemplates.length}
//
// «Слово стало плотью» (Ин 1:14) — спецификация стала исполнимой.

'use strict';

const _compiled = ${json};

/** All compiled persons with behaviorPolicy */
const persons = _compiled.persons;

/** Gift templates with validation rules */
const giftTemplates = _compiled.giftTemplates;

/** Covenants — immutable rules (weight=10, irreversible) */
const covenants = _compiled.covenants;

/** Witnesses extracted from spec */
const witnesses = _compiled.witnesses;

/** Liturgies extracted from spec */
const liturgies = _compiled.liturgies;

/**
 * Register all persons from this spec into a PersonRegistry.
 * Applies behaviorPolicy (kenosis, telos, logos) to each person.
 *
 * @param {PersonRegistry} registry
 * @returns {{ registered: string[], covenants: number }}
 */
function register(registry) {
  const registered = [];
  for (const p of persons) {
    registry.applyCompiledSpec(p.name, p);
    registered.push(p.name);
  }
  return { registered, covenants: covenants.length };
}

/**
 * Validate an act against the kenosis policy of a person from this spec.
 * @param {string} personName
 * @param {object} act — { telos, surplusRetained, ... }
 * @returns {{ allowed: boolean, violation: object|null }}
 */
function checkKenosis(personName, act) {
  const person = persons.find(p => p.name === personName);
  if (!person?.behaviorPolicy?.kenosis?.enforced) {
    return { allowed: true, violation: null };
  }
  const policy = person.behaviorPolicy.kenosis;
  if (policy.holdsNothing && act.surplusRetained) {
    return {
      allowed: false,
      violation: { type: 'surplus_retained', person: personName, policy },
    };
  }
  if (act.telos === 'win' || act.telos === 'extract') {
    return {
      allowed: false,
      violation: { type: 'telos_inverted', person: personName, actTelos: act.telos, policy },
    };
  }
  return { allowed: true, violation: null };
}

module.exports = { persons, giftTemplates, covenants, witnesses, liturgies, register, checkKenosis };
`;
  }

  /**
   * Compile from file path (static).
   * @param {string} filePath
   * @returns {CompiledSpec}
   */
  static async compileFile(filePath) {
    const fs = await import('fs');
    const source = fs.default.readFileSync(filePath, 'utf8');
    return GiftCompiler.compile(source);
  }

  /**
   * Compile .gift file to a CommonJS runtime module file.
   * Writes to dist/persons/<name>.js
   *
   * @param {string} filePath — source .gift file
   * @param {string} outDir — output directory (default: dist/persons)
   * @returns {{ outPath: string, persons: string[] }}
   */
  static async compileFileToModule(filePath, outDir) {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.default.readFileSync(filePath, 'utf8');
    const specName = path.default.basename(filePath, '.gift');
    const moduleSource = GiftCompiler.compileToModule(source, specName);

    const dir = outDir || path.default.resolve(path.default.dirname(filePath), '../../dist/persons');
    if (!fs.default.existsSync(dir)) fs.default.mkdirSync(dir, { recursive: true });

    const outPath = path.default.resolve(dir, `${specName}.js`);
    fs.default.writeFileSync(outPath, moduleSource, 'utf8');

    const compiled = GiftCompiler.compile(source);
    return { outPath, persons: compiled.persons.map(p => p.name) };
  }

  /**
   * Validate .gift source syntax without executing.
   * Returns { valid, errors, warnings, stats }.
   */
  static validate(source) {
    const errors = [];
    const warnings = [];
    const stats = { persons: 0, gifts: 0, covenants: 0, liturgies: 0, witnesses: 0 };

    const inst = new GiftCompiler(null);
    let normalized;
    try {
      normalized = inst._normalizeRussian(source);
    } catch (e) {
      return { valid: false, errors: [`Normalization failed: ${e.message}`], warnings, stats };
    }

    const blocks = inst._splitIntoBlocks(normalized);
    if (blocks.length === 0) {
      warnings.push('Empty spec: no blocks found');
    }

    // Check brace balance
    let codeBraces = 0;
    for (const ch of normalized) {
      if (ch === '{') codeBraces++;
      if (ch === '}') codeBraces--;
    }
    if (codeBraces !== 0) {
      errors.push(`Unbalanced braces: ${codeBraces > 0 ? 'missing }' : 'extra }'} (delta: ${codeBraces})`);
    }

    for (const block of blocks) {
      const firstLine = block.split('\n')[0].trim();
      if (firstLine.startsWith('//') || firstLine.startsWith('use ')) continue;

      const KNOWN = [
        'person', 'gift', 'accept', 'decline', 'sabbath', 'witness',
        'grace', 'let', 'phantom', 'liturgy', 'perichoresis', 'if', 'when',
        'kenosis', 'rhythm', 'birth', 'service', 'covenant', 'metanoia',
        'prophecy', 'community', 'relation', 'kairos', 'mortis_kairos',
        'apophatic', 'conciliar',
      ];
      const keyword = firstLine.split(/\s/)[0];
      if (!KNOWN.includes(keyword)) {
        warnings.push(`Unknown keyword: "${keyword}" in: ${firstLine.slice(0, 60)}`);
      }

      // Count stats
      if (keyword === 'person') stats.persons++;
      if (keyword === 'gift') stats.gifts++;
      if (keyword === 'covenant') stats.covenants++;
      if (keyword === 'liturgy') stats.liturgies++;
      if (keyword === 'witness') stats.witnesses++;

      // Validate person has calling
      if (keyword === 'person') {
        const body = inst._extractBody(block);
        if (!body.includes('calling') && !body.includes('призвание')) {
          warnings.push(`person block missing calling: ${firstLine.slice(0, 60)}`);
        }
      }

      // Validate gift has from (in header or body)
      if (keyword === 'gift') {
        const hasFromInHeader = firstLine.includes('from') || firstLine.includes('от');
        const blockBody = block.includes('{') ? inst._extractBody(block) : '';
        const hasFromInBody = /(?:^|\n)\s*(?:from|от)\s*:/m.test(blockBody);
        if (!hasFromInHeader && !hasFromInBody) {
          errors.push(`gift missing 'from': ${firstLine.slice(0, 60)}`);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings, stats };
  }

  /**
   * Parse and execute .gift source code
   */
  async execute(source) {
    // Предобработка: русские ключевые слова → английские
    const normalized = this._normalizeRussian(source);
    const blocks = this._splitIntoBlocks(normalized);
    for (const block of blocks) {
      await this._executeBlock(block);
    }
    return {
      vars: Object.fromEntries(this._vars),
      gifts: this._gifts.size,
      persons: this._persons.size,
      log: this._log,
      services: this._services?.size || 0,
      covenants: this._covenants?.size || 0,
      prophecies: this._prophecies?.size || 0,
      communities: this._communities?.size || 0,
      mortisKairos: this._mortisKairos?.size || 0,
    };
  }

  /**
   * Execute from file path
   */
  async executeFile(filePath) {
    const fs = await import('fs');
    const source = fs.default.readFileSync(filePath, 'utf8');
    return this.execute(source);
  }

  // ═══════════════════════════════════════════════════════════════
  // Block splitter — handles { } nesting
  // ═══════════════════════════════════════════════════════════════

  _splitIntoBlocks(source) {
    const blocks = [];
    const lines = source.split('\n');
    let current = '';
    let depth = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments at top level
      if (depth === 0 && (!trimmed || trimmed.startsWith('//'))) continue;

      // Count braces
      for (const ch of trimmed) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }

      current += (current ? '\n' : '') + trimmed;

      // Block complete when depth returns to 0
      if (depth <= 0) {
        if (current.trim()) blocks.push(current.trim());
        current = '';
        depth = 0;
      }
    }

    // Leftover (single-line statements without braces)
    if (current.trim()) blocks.push(current.trim());

    return blocks;
  }

  // ═══════════════════════════════════════════════════════════════
  // Block executor — dispatches to specific parsers
  // ═══════════════════════════════════════════════════════════════

  async _executeBlock(block) {
    const firstLine = block.split('\n')[0].trim();

    // Skip comments
    if (firstLine.startsWith('//')) return;

    // use — import (no-op for now)
    if (firstLine.startsWith('use ')) return;

    // person declaration
    if (firstLine.startsWith('person ')) {
      return this._parsePerson(block);
    }

    // gift
    if (firstLine.startsWith('gift ')) {
      return this._parseGift(block);
    }

    // accept
    if (firstLine.startsWith('accept ')) {
      return this._parseAccept(block);
    }

    // decline
    if (firstLine.startsWith('decline ')) {
      return this._parseDecline(block);
    }

    // sabbath
    if (firstLine.startsWith('sabbath ')) {
      return this._parseSabbath(block);
    }

    // witness
    if (firstLine.startsWith('witness ')) {
      return this._parseWitness(firstLine);
    }

    // grace
    if (firstLine.startsWith('grace ')) {
      return this._parseGrace(firstLine);
    }

    // let
    if (firstLine.startsWith('let ')) {
      return this._parseLet(firstLine);
    }

    // phantom
    if (firstLine.startsWith('phantom ')) {
      return this._parsePhantom(firstLine);
    }

    // liturgy — unwrap and execute inner blocks
    if (firstLine.startsWith('liturgy ')) {
      return this._parseLiturgy(block);
    }

    // perichoresis
    if (firstLine.startsWith('perichoresis ')) {
      return this._parsePerichoresis(block);
    }

    // if / when conditionals — but only if it has 'is' (conditional), not event handler
    if (firstLine.startsWith('if ') || firstLine.startsWith('when ')) {
      if (firstLine.includes(' is ')) {
        return this._parseConditional(block);
      }
      // when without 'is' = event handler (когда дар-принят { ... })
      return this._parseEventHandler(block);
    }

    // kenosis
    if (firstLine.startsWith('kenosis ')) {
      return this._parseKenosis(firstLine);
    }

    // rhythm (ритм)
    if (firstLine.startsWith('rhythm ')) {
      return this._parseRhythm(block);
    }

    // birth (рождение)
    if (firstLine.startsWith('birth ')) {
      return this._parseBirth(block);
    }

    // service (служение)
    if (firstLine.startsWith('service ')) {
      return this._parseService(block);
    }

    // covenant (завет)
    if (firstLine.startsWith('covenant ')) {
      return this._parseCovenant(block);
    }

    // metanoia (покаяние)
    if (firstLine.startsWith('metanoia ')) {
      return this._parseMetanoia(block);
    }

    // prophecy (пророчество)
    if (firstLine.startsWith('prophecy ')) {
      return this._parseProphecy(block);
    }

    // community (община)
    if (firstLine.startsWith('community ')) {
      return this._parseCommunity(block);
    }

    // relation (связь)
    if (firstLine.startsWith('relation ')) {
      return this._parseRelation(block);
    }

    // kairos (кайрос)
    if (firstLine.startsWith('kairos ')) {
      return this._parseKairos(block);
    }

    // mortis_kairos (днесь) — каиросность без условия
    if (firstLine.startsWith('mortis_kairos ')) {
      return this._parseMortisKairos(block);
    }

    // apophatic (апофатика)
    if (firstLine.startsWith('apophatic ')) {
      return this._parseApophatic(block);
    }

    // conciliar (соборно)
    if (firstLine.startsWith('conciliar ')) {
      return this._parseConciliar(block);
    }
    if (firstLine.startsWith('conciliar{') || firstLine === 'conciliar {') {
      return this._parseConciliar(block);
    }

    // когда (event handler — Russian «когда дар-принят» not yet normalized)
    if (firstLine.startsWith('когда ')) {
      return this._parseEventHandler(block);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Parsers
  // ═══════════════════════════════════════════════════════════════

  /**
   * person Name { calling: "...", energy: N, logos: kata }
   */
  _parsePerson(block) {
    const headerMatch = block.match(/^person\s+(\S+)\s*\{/);
    if (!headerMatch) return;
    const name = headerMatch[1];

    const body = this._extractBody(block);
    const calling = this._extractStringProp(body, 'calling') || name;
    const energy = this._extractNumberProp(body, 'energy');
    const logos = this._extractWordProp(body, 'logos');

    try {
      const person = this._engine.persons.register(name, {
        calling,
        description: calling,
        energy: energy !== null ? energy : undefined
      });

      this._persons.set(name, person);
      this._vars.set(name, { type: 'person', name, logos: logos || 'kata' });
      return person;
    } catch (e) {
      // Person may already exist — resolve instead
      const existing = this._engine.persons.resolve(name);
      if (existing) {
        this._persons.set(name, existing);
        this._vars.set(name, { type: 'person', name, logos: logos || 'kata' });
        return existing;
      }
      throw e;
    }
  }

  /**
   * gift Name from Giver [through Mediator] [to Receiver] { content: "...", telos: "...", anamnesis: [...] }
   */
  _parseGift(block) {
    // Pattern: gift Name from Giver [through Mediator] [to Receiver] {
    const headerMatch = block.match(
      /^gift\s+(\S+)\s+from\s+(\S+)(?:\s+through\s+(\S+))?(?:\s+to\s+(\S+))?\s*\{/
    );
    if (!headerMatch) return;

    const [, giftName, giver, mediator, receiver] = headerMatch;
    const body = this._extractBody(block);

    const content = this._extractStringProp(body, 'content') || giftName;
    const telos = this._extractStringProp(body, 'telos');
    const anamnesis = this._extractListProp(body, 'anamnesis');

    // Ensure giver is registered
    this._ensurePerson(giver);
    if (mediator) this._ensurePerson(mediator);
    if (receiver) this._ensurePerson(receiver);

    const giftData = {
      giver,
      receiver: receiver || 'all',
      content,
      telos,
      anamnesis: anamnesis || [],
      metadata: {
        giftLangName: giftName,
        mediator: mediator || undefined
      }
    };

    try {
      const gift = this._engine.offer(giftData);
      this._gifts.set(giftName, gift);
      this._vars.set(giftName, { type: 'gift', name: giftName, id: gift?.id });
      return gift;
    } catch (e) {
      this._log.push(`[gift-error] ${giftName}: ${e.message}`);
      return null;
    }
  }

  /**
   * accept GiftName { transformation: "..." }
   */
  _parseAccept(block) {
    const headerMatch = block.match(/^accept\s+(\S+)\s*\{/);
    if (!headerMatch) return;

    const giftName = headerMatch[1];
    const body = this._extractBody(block);
    const transformation = this._extractStringProp(body, 'transformation') || '';

    const gift = this._gifts.get(giftName);
    if (!gift || !gift.id) {
      this._log.push(`[accept-skip] ${giftName}: gift not found`);
      return null;
    }

    try {
      const result = this._engine.accept(gift.id, { description: transformation });
      this._log.push(`[accept] ${giftName}`);
      return result;
    } catch (e) {
      this._log.push(`[accept-error] ${giftName}: ${e.message}`);
      return null;
    }
  }

  /**
   * decline GiftName reason "..." { }
   */
  _parseDecline(block) {
    const headerMatch = block.match(/^decline\s+(\S+)\s+reason\s+"([^"]*)"/);
    if (!headerMatch) return;

    const [, giftName, reason] = headerMatch;
    const gift = this._gifts.get(giftName);
    if (!gift || !gift.id) {
      this._log.push(`[decline-skip] ${giftName}: gift not found`);
      return null;
    }

    try {
      const result = this._engine.decline(gift.id, reason);
      this._log.push(`[decline] ${giftName}: ${reason}`);
      return result;
    } catch (e) {
      this._log.push(`[decline-error] ${giftName}: ${e.message}`);
      return null;
    }
  }

  /**
   * sabbath Person duration Xhour reason "..." { }
   */
  _parseSabbath(block) {
    const headerMatch = block.match(
      /^sabbath\s+(\S+)\s+duration\s+(\S+)\s+reason\s+"([^"]*)"/
    );
    if (!headerMatch) return;

    const [, personName, durationStr, reason] = headerMatch;
    let hours = 1;

    if (durationStr === 'eternal') {
      hours = 8760; // 1 year — symbolic eternal
    } else {
      const numMatch = durationStr.match(/^(\d+)/);
      if (numMatch) hours = parseInt(numMatch[1], 10);
    }

    this._ensurePerson(personName);

    try {
      this._engine.clock.enterSabbath(personName, hours, true);
      this._log.push(`[sabbath] ${personName} for ${durationStr}: ${reason}`);
    } catch (e) {
      this._log.push(`[sabbath-error] ${personName}: ${e.message}`);
    }
  }

  /**
   * witness "text"
   * witness incalculable "text"
   */
  _parseWitness(line) {
    const incMatch = line.match(/^witness\s+incalculable\s+"([^"]*)"$/);
    if (incMatch) {
      const text = incMatch[1];
      this._log.push(`[witness:incalculable] ${text}`);
      console.log(`[witness:incalculable] ${text}`);
      return;
    }

    const match = line.match(/^witness\s+"([^"]*)"$/);
    if (match) {
      const text = match[1];
      this._log.push(`[witness] ${text}`);
      console.log(`[witness] ${text}`);
    }
  }

  /**
   * grace PersonName
   */
  _parseGrace(line) {
    const match = line.match(/^grace\s+(\S+)$/);
    if (!match) return;

    const personName = match[1];

    // Check if it's a variable name
    const varVal = this._vars.get(personName);

    // If it's a person, apply grace via engine
    this._ensurePerson(personName);

    try {
      // DivineEnergy.grace via engine.sustain
      this._engine.sustain(personName, true);
      this._log.push(`[grace] ${personName}`);
    } catch (e) {
      this._log.push(`[grace-error] ${personName}: ${e.message}`);
    }
  }

  /**
   * let name: type = value
   */
  _parseLet(line) {
    // let name: type = value
    const match = line.match(/^let\s+(\S+?)(?::?\s*(\S+))?\s*=\s*(.+)$/);
    if (!match) return;

    const [, name, type, rawValue] = match;
    let value = rawValue.trim();

    // Троичные операции
    const opMatch = value.match(/^(\S+)\s+(И|ИЛИ)\s+(\S+)$/);
    if (opMatch) {
      const [, a, op, b] = opMatch;
      const va = this._resolveTrit(a);
      const vb = this._resolveTrit(b);
      value = op === 'И' ? TernaryOps.И(va, vb) : TernaryOps.ИЛИ(va, vb);
    } else if (value.match(/^НЕ\s+(\S+)$/)) {
      const a = value.replace('НЕ ', '').trim();
      value = TernaryOps.НЕ(this._resolveTrit(a));
    } else if (value.match(/^консенсус\s*\((.+)\)$/)) {
      const args = RegExp.$1.split(',').map(v => this._resolveTrit(v.trim()));
      value = TernaryOps.консенсус(...args);
    } else if (value.match(/^мера\s*\((.+),\s*(.+)\)$/)) {
      value = TernaryOps.мера(Number(RegExp.$1), Number(RegExp.$2));
    } else if (value.match(/^трайт\s*\((.+)\)$/)) {
      const args = RegExp.$1.split(',').map(v => this._resolveTrit(v.trim()));
      value = TernaryOps.трайт(...args);
    // Простые значения
    } else if (value in TRIT_VALUES) {
      value = TRIT_VALUES[value];
    } else if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(v => {
        const t = v.trim();
        return t in TRIT_VALUES ? TRIT_VALUES[t] : t;
      });
    } else if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (!isNaN(value)) {
      value = Number(value);
    }

    this._vars.set(name, { type: type || 'auto', value });
  }

  /**
   * phantom name
   */
  _resolveTrit(val) {
    const v = (val || '').trim();
    if (v in TRIT_VALUES) return TRIT_VALUES[v];
    const varData = this._vars.get(v);
    if (varData) return varData.value;
    if (!isNaN(v)) return Number(v);
    return null;
  }

  _parsePhantom(line) {
    const match = line.match(/^phantom\s+(\S+)$/);
    if (!match) return;

    const name = match[1];
    this._vars.set(name, { ...(this._vars.get(name) || {}), phantom: true });
    this._log.push(`[phantom] ${name}`);
  }

  /**
   * liturgy Name { ... inner blocks ... }
   */
  async _parseLiturgy(block) {
    const headerMatch = block.match(/^liturgy\s+(\S+)\s*\{/);
    if (!headerMatch) return;

    const name = headerMatch[1];
    this._log.push(`[liturgy:begin] ${name}`);

    // Extract telos if present
    const telosMatch = block.match(/telos:\s*"([^"]*)"/);
    if (telosMatch) {
      this._vars.set(`${name}.telos`, { type: 'text', value: telosMatch[1] });
    }

    // Extract inner content (between first { and last })
    const innerContent = this._extractBody(block);

    // Re-parse inner content as blocks
    const innerBlocks = this._splitIntoBlocks(innerContent);
    for (const innerBlock of innerBlocks) {
      await this._executeBlock(innerBlock);
    }

    this._log.push(`[liturgy:end] ${name}`);
  }

  /**
   * perichoresis (A, B, C) { }
   */
  async _parsePerichoresis(block) {
    const match = block.match(/^perichoresis\s*\(([^)]+)\)/);
    if (!match) return;

    const names = match[1].split(',').map(n => n.trim());

    // Ensure all persons exist
    for (const name of names) {
      this._ensurePerson(name);
    }

    this._log.push(`[perichoresis] ${names.join(' ↔ ')}`);

    // Mutual gifts between all pairs
    for (let i = 0; i < names.length; i++) {
      for (let j = 0; j < names.length; j++) {
        if (i === j) continue;
        try {
          const gift = this._engine.offer({
            giver: names[i],
            receiver: names[j],
            content: `Perichoresis: ${names[i]} → ${names[j]}`,
            telos: 'mutual indwelling',
            metadata: { perichoresis: true }
          });
          if (gift) {
            this._engine.accept(gift.id, { description: 'perichoresis' });
          }
        } catch (e) {
          // Continue — perichoresis is non-failing
          this._log.push(`[perichoresis-partial] ${names[i]}→${names[j]}: ${e.message}`);
        }
      }
    }
  }

  /**
   * if X is para/kata/hyper/incalculable { ... }
   * when X is para/kata/hyper/incalculable { ... }
   */
  async _parseConditional(block) {
    const match = block.match(/^(?:if|when)\s+(\S+)\s+is\s+(\S+)\s*\{/);
    if (!match) return;

    const [, varName, expected] = match;
    const varVal = this._vars.get(varName);

    if (!varVal) return;

    const actual = varVal.value !== undefined ? varVal.value : varVal.logos;
    const expectedTrit = TRIT_VALUES[expected];

    // Compare: trit value match or string match
    let matches = false;
    if (expectedTrit !== undefined) {
      matches = actual === expectedTrit || actual === expected;
    } else {
      matches = actual === expected;
    }

    if (matches) {
      const innerContent = this._extractBody(block);
      const innerBlocks = this._splitIntoBlocks(innerContent);
      for (const innerBlock of innerBlocks) {
        await this._executeBlock(innerBlock);
      }
    }
  }

  /**
   * kenosis PersonName
   */
  _parseKenosis(line) {
    const match = line.match(/^kenosis\s+(\S+)$/);
    if (!match) return;

    const personName = match[1];
    this._ensurePerson(personName);

    // Kenosis = self-emptying: reduce energy, elevate spirit
    this._log.push(`[kenosis] ${personName}`);
    // engine doesn't have a direct kenosis method — log as witness
    console.log(`[kenosis] ${personName}: self-emptying`);
  }

  // ═══════════════════════════════════════════════════════════════
  // New constructs — 12 Russian Gift language extensions
  // ═══════════════════════════════════════════════════════════════

  /**
   * rhythm 30мин { ... }
   * ритм 30мин { ... }
   * Parses interval, executes body once (interpreter mode).
   */
  async _parseRhythm(block) {
    const headerMatch = block.match(/^rhythm\s+(\S+)\s*\{/);
    if (!headerMatch) return;

    const intervalStr = headerMatch[1];
    // Parse interval: 30мин, 1час, 5сек, 30min, 1h
    let ms = 0;
    const numMatch = intervalStr.match(/^(\d+)/);
    const num = numMatch ? parseInt(numMatch[1], 10) : 1;
    if (/мин|min/i.test(intervalStr)) ms = num * 60 * 1000;
    else if (/час|h/i.test(intervalStr)) ms = num * 3600 * 1000;
    else if (/сек|sec|s$/i.test(intervalStr)) ms = num * 1000;
    else ms = num * 1000; // default seconds

    this._log.push(`[rhythm] interval=${intervalStr} (${ms}ms), executing once`);

    const innerContent = this._extractBody(block);
    const innerBlocks = this._splitIntoBlocks(innerContent);
    for (const innerBlock of innerBlocks) {
      await this._executeBlock(innerBlock);
    }
  }

  /**
   * birth Child from (Parent1, Parent2) { призвание: "...", логос: по-природе }
   * рождение Каин от (Адам, Ева) { ... }
   */
  _parseBirth(block) {
    const headerMatch = block.match(/^birth\s+(\S+)\s+from\s+\(([^)]+)\)\s*\{/);
    if (!headerMatch) return;

    const childName = headerMatch[1];
    const parents = headerMatch[2].split(',').map(s => s.trim());
    const body = this._extractBody(block);

    const calling = this._extractStringProp(body, 'calling')
      || this._extractStringProp(body, 'призвание')
      || childName;
    const logos = this._extractWordProp(body, 'logos')
      || this._extractWordProp(body, 'логос')
      || 'kata';

    // Ensure parents exist
    for (const p of parents) {
      this._ensurePerson(p);
    }

    // Register child
    try {
      const person = this._engine.persons.register(childName, {
        calling,
        description: `Born from ${parents.join(', ')}`,
      });
      this._persons.set(childName, person);
      this._vars.set(childName, { type: 'person', name: childName, logos, parents });
    } catch (e) {
      const existing = this._engine.persons.resolve(childName);
      if (existing) {
        this._persons.set(childName, existing);
        this._vars.set(childName, { type: 'person', name: childName, logos, parents });
      }
    }

    // Create birth gifts from each parent to child
    for (const parent of parents) {
      try {
        const gift = this._engine.offer({
          giver: parent,
          receiver: childName,
          content: `Birth: ${parent} → ${childName}`,
          telos: calling,
          metadata: { birth: true, logos }
        });
        if (gift) {
          this._engine.accept(gift.id, { description: 'birth' });
          this._gifts.set(`birth_${parent}_${childName}`, gift);
        }
      } catch (e) {
        this._log.push(`[birth-gift-error] ${parent}→${childName}: ${e.message}`);
      }
    }

    this._log.push(`[birth] ${childName} from (${parents.join(', ')}), logos=${logos}`);
  }

  /**
   * service Name (param1, param2) { ... }
   * служение Исцеление (кого, чем) { ... }
   */
  _parseService(block) {
    const headerMatch = block.match(/^service\s+(\S+)\s*\(([^)]*)\)\s*\{/);
    if (!headerMatch) return;

    const name = headerMatch[1];
    const params = headerMatch[2].split(',').map(s => s.trim()).filter(Boolean);
    const body = this._extractBody(block);

    this._services.set(name, { params, body });
    this._log.push(`[service] ${name}(${params.join(', ')}) defined`);
  }

  /**
   * when event-name { ... }
   * когда дар-принят { ... }
   * когда дар-отклонён { ... }
   * Event handler registration (not conditional).
   */
  _parseEventHandler(block) {
    const headerMatch = block.match(/^(?:when|когда)\s+(\S+)\s*\{/);
    if (!headerMatch) return;

    const eventName = headerMatch[1];
    const body = this._extractBody(block);

    this._events.set(eventName, body);
    this._log.push(`[event] handler registered for '${eventName}'`);
  }

  /**
   * covenant Party1 with Party2 { обещание: "...", знак: "...", условие: "..." }
   * завет Авраам с Бог { ... }
   */
  _parseCovenant(block) {
    const headerMatch = block.match(/^covenant\s+(\S+)\s+with\s+(\S+)\s*\{/);
    if (!headerMatch) return;

    const [, party1, party2] = headerMatch;
    const body = this._extractBody(block);

    const promise = this._extractStringProp(body, 'promise')
      || this._extractStringProp(body, 'обещание') || '';
    const sign = this._extractStringProp(body, 'sign')
      || this._extractStringProp(body, 'знак') || '';
    const condition = this._extractStringProp(body, 'condition')
      || this._extractStringProp(body, 'условие') || '';

    this._ensurePerson(party1);
    this._ensurePerson(party2);

    this._covenants.set(`${party1}-${party2}`, {
      parties: [party1, party2],
      promise, sign, condition
    });

    // Create a covenant gift between parties
    try {
      const gift = this._engine.offer({
        giver: party1,
        receiver: party2,
        content: `Covenant: ${promise}`,
        telos: sign,
        metadata: { covenant: true, condition }
      });
      if (gift) {
        this._gifts.set(`covenant_${party1}_${party2}`, gift);
      }
    } catch (e) {
      this._log.push(`[covenant-gift-error] ${party1}↔${party2}: ${e.message}`);
    }

    this._log.push(`[covenant] ${party1} ↔ ${party2}: "${promise}", sign="${sign}"`);
  }

  /**
   * metanoia Person { was_state: ..., became_state: ..., witness_person: ... }
   * покаяние Строитель { было: против-природы, стало: по-природе, свидетель: Целитель }
   */
  _parseMetanoia(block) {
    const headerMatch = block.match(/^metanoia\s+(\S+)\s*\{/);
    if (!headerMatch) return;

    const personName = headerMatch[1];
    const body = this._extractBody(block);

    const fromState = this._extractWordProp(body, 'was_state')
      || this._extractWordProp(body, 'было') || 'para';
    const toState = this._extractWordProp(body, 'became_state')
      || this._extractWordProp(body, 'стало') || 'kata';
    const witness = this._extractWordProp(body, 'witness_person')
      || this._extractWordProp(body, 'свидетель') || null;

    this._ensurePerson(personName);
    if (witness) this._ensurePerson(witness);

    // Update movement if engine supports it
    if (this._engine.setMovement) {
      try {
        const tritTo = TRIT_VALUES[toState] !== undefined ? TRIT_VALUES[toState] : 0;
        this._engine.setMovement(personName, tritTo);
      } catch (e) {
        this._log.push(`[metanoia-movement-error] ${personName}: ${e.message}`);
      }
    }

    // Update person's logos in vars
    const tritVal = TRIT_VALUES[toState] !== undefined ? toState : 'kata';
    this._vars.set(personName, {
      ...(this._vars.get(personName) || {}),
      type: 'person', name: personName, logos: tritVal
    });

    // Create metanoia gift (self → self, witnessed)
    try {
      const gift = this._engine.offer({
        giver: personName,
        receiver: personName,
        content: `Metanoia: ${fromState} → ${toState}`,
        telos: 'repentance',
        metadata: { metanoia: true, from: fromState, to: toState, witness }
      });
      if (gift) {
        this._engine.accept(gift.id, { description: 'metanoia' });
        this._gifts.set(`metanoia_${personName}`, gift);
      }
    } catch (e) {
      this._log.push(`[metanoia-gift-error] ${personName}: ${e.message}`);
    }

    this._log.push(`[metanoia] ${personName}: ${fromState} → ${toState}` +
      (witness ? `, witness=${witness}` : ''));
  }

  /**
   * prophecy Name { prophecy_content: "...", fulfillment: awaiting }
   * пророчество Исаия { содержание: "...", исполнение: ожидает }
   */
  _parseProphecy(block) {
    const headerMatch = block.match(/^prophecy\s+(\S+)\s*\{/);
    if (!headerMatch) return;

    const name = headerMatch[1];
    const body = this._extractBody(block);

    const content = this._extractStringProp(body, 'prophecy_content')
      || this._extractStringProp(body, 'содержание')
      || this._extractStringProp(body, 'content') || '';
    const fulfillment = this._extractWordProp(body, 'fulfillment')
      || this._extractWordProp(body, 'исполнение') || 'awaiting';

    this._prophecies.set(name, {
      content,
      status: fulfillment === 'ожидает' ? 'awaiting' : fulfillment
    });

    this._log.push(`[prophecy] ${name}: "${content}" (${fulfillment})`);
  }

  /**
   * community Name { members: [A, B, C] }
   * община Церковь { члены: [Адам, Ева, Строитель] }
   */
  _parseCommunity(block) {
    const headerMatch = block.match(/^community\s+(\S+)\s*\{/);
    if (!headerMatch) return;

    const name = headerMatch[1];
    const body = this._extractBody(block);

    const members = this._extractListProp(body, 'members')
      || this._extractListProp(body, 'члены') || [];

    // Ensure all members exist
    for (const m of members) {
      this._ensurePerson(m);
    }

    this._communities.set(name, { members });
    this._log.push(`[community] ${name}: [${members.join(', ')}]`);
  }

  /**
   * relation From → To { rel_type: "..." }
   * связь Адам → Ева { тип: "со-бытие" }
   */
  _parseRelation(block) {
    const headerMatch = block.match(/^relation\s+(\S+)\s*[→→\->]+\s*(\S+)\s*\{/);
    if (!headerMatch) return;

    const [, from, to] = headerMatch;
    const body = this._extractBody(block);

    const relType = this._extractStringProp(body, 'rel_type')
      || this._extractStringProp(body, 'тип')
      || this._extractStringProp(body, 'type') || 'relation';

    this._ensurePerson(from);
    this._ensurePerson(to);

    // Add edge to gratitude graph if available
    if (this._engine.gratitude && this._engine.gratitude.addEdge) {
      try {
        this._engine.gratitude.addEdge(from, to, relType);
      } catch (e) {
        this._log.push(`[relation-edge-error] ${from}→${to}: ${e.message}`);
      }
    }

    this._log.push(`[relation] ${from} → ${to}: "${relType}"`);
  }

  /**
   * kairos "Name" { условие: ..., действие: ... }
   * кайрос "Воплощение" { условие: ..., действие: ... }
   */
  _parseKairos(block) {
    const headerMatch = block.match(/^kairos\s+"([^"]+)"\s*\{/)
      || block.match(/^kairos\s+(\S+)\s*\{/);
    if (!headerMatch) return;

    const name = headerMatch[1];
    const body = this._extractBody(block);

    const condition = this._extractStringProp(body, 'condition')
      || this._extractStringProp(body, 'условие') || '';
    const action = this._extractStringProp(body, 'action')
      || this._extractStringProp(body, 'действие') || '';

    this._kairos.set(name, { condition, action });
    this._log.push(`[kairos] "${name}": condition="${condition}", action="${action}"`);
  }

  /**
   * mortis_kairos "Name" { действие: ..., свидетель: ... }
   * днесь "Имя" { действие: ... }
   *
   * Каиросность без условия: смертность сама является условием.
   * «Днесь спасение миру бысть» — не однажды, а всегда сейчас.
   *
   * Отличие от kairos:
   *   kairos ждёт условие.
   *   mortis_kairos — не ждёт. Оно уже выполнено.
   */
  _parseMortisKairos(block) {
    const headerMatch = block.match(/^mortis_kairos\s+"([^"]+)"\s*\{/)
      || block.match(/^mortis_kairos\s+(\S+)\s*\{/);
    if (!headerMatch) return;

    const name   = headerMatch[1];
    const body   = this._extractBody(block);
    const action = this._extractStringProp(body, 'action')
      || this._extractStringProp(body, 'действие') || '';
    const witnessNote = this._extractStringProp(body, 'witness')
      || this._extractStringProp(body, 'свидетель') || '';

    this._mortisKairos.set(name, {
      action,
      witness:      witnessNote,
      // Условие не хранится — смертность безусловна
      condition:    undefined,
      dnyes:        true,
      urgent:       true,
      logos:        '«Ныне день спасения» (2 Кор 6:2) — καιρὸς θανάτου',
    });

    this._log.push(`[mortis_kairos] "${name}": action="${action}" — без условия, καιρὸς θανάτου`);
  }

  /**
   * apophatic Name { boundary: "...", source_ref: "..." }
   * апофатика Троица { граница: "...", источник: "..." }
   */
  _parseApophatic(block) {
    const headerMatch = block.match(/^apophatic\s+(\S+)\s*\{/);
    if (!headerMatch) return;

    const name = headerMatch[1];
    const body = this._extractBody(block);

    const boundary = this._extractStringProp(body, 'boundary')
      || this._extractStringProp(body, 'граница') || '';
    const source = this._extractStringProp(body, 'source_ref')
      || this._extractStringProp(body, 'источник') || '';

    this._log.push(`[witness:incalculable] apophatic ${name}: boundary="${boundary}", source="${source}"`);
    console.log(`[apophatic] ${name}: beyond computation — "${boundary}"`);
  }

  /**
   * conciliar { liturgy A { ... } liturgy B { ... } }
   * соборно { литургия А { ... } литургия Б { ... } }
   * Execute all inner blocks (sequentially, semantically parallel).
   */
  async _parseConciliar(block) {
    this._log.push(`[conciliar:begin]`);

    const innerContent = this._extractBody(block);
    const innerBlocks = this._splitIntoBlocks(innerContent);

    for (const innerBlock of innerBlocks) {
      await this._executeBlock(innerBlock);
    }

    this._log.push(`[conciliar:end] ${innerBlocks.length} blocks executed`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Extract body content between first { and last }
   */
  _extractBody(block) {
    const firstBrace = block.indexOf('{');
    const lastBrace = block.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return '';
    return block.slice(firstBrace + 1, lastBrace).trim();
  }

  /**
   * Extract string property: key: "value"
   */
  _extractStringProp(body, key) {
    const match = body.match(new RegExp(`${key}:\\s*"([^"]*)"`));
    return match ? match[1] : null;
  }

  /**
   * Extract number property: key: 123
   */
  _extractNumberProp(body, key) {
    const match = body.match(new RegExp(`${key}:\\s*(\\d+)`));
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Extract word property: key: word
   */
  _extractWordProp(body, key) {
    const match = body.match(new RegExp(`${key}:\\s*(\\S+)`));
    return match ? match[1] : null;
  }

  /**
   * Extract list property: key: [A, B, C]
   */
  _extractListProp(body, key) {
    const match = body.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`));
    if (!match) return null;
    return match[1].split(',').map(s => s.trim()).filter(Boolean);
  }

  /**
   * Ensure a person exists in engine, register if needed
   */
  _ensurePerson(name) {
    if (this._persons.has(name)) return;

    // Try to resolve existing
    try {
      const existing = this._engine.persons.resolve(name);
      if (existing) {
        this._persons.set(name, existing);
        return;
      }
    } catch (_) { /* not found */ }

    // Register new
    try {
      const person = this._engine.persons.register(name, { calling: name });
      this._persons.set(name, person);
      this._vars.set(name, { type: 'person', name, logos: 'kata' });
    } catch (e) {
      // May already exist under different lookup
      this._persons.set(name, { name });
    }
  }
}

export default GiftCompiler;
