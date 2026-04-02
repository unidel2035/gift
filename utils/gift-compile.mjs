#!/usr/bin/env node
/**
 * gift-compile.mjs — Компиляция .gift спецификаций в runtime-конфиги
 *
 * Пайплайн: specs/*.gift → GiftCompiler.compile() → dist/compiled/*.json
 *
 * Использование:
 *   node utils/gift-compile.mjs                     # компилировать всё
 *   node utils/gift-compile.mjs specs/persons/claude-person.gift  # один файл
 *   node utils/gift-compile.mjs --validate          # только валидация
 *   node utils/gift-compile.mjs --persons           # показать скомпилированные лица
 *   node utils/gift-compile.mjs --register          # + зарегистрировать в PersonRegistry
 *
 * «В начале было Слово» (Ин 1:1) — спецификация становится исполнимой.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, basename, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPECS_DIR = resolve(ROOT, 'specs');
const DIST_DIR = resolve(ROOT, 'dist/compiled');

const PERSONS_DIR = resolve(ROOT, 'dist/persons');

const argv = process.argv.slice(2);
const VALIDATE_ONLY = argv.includes('--validate');
const SHOW_PERSONS = argv.includes('--persons');
const REGISTER = argv.includes('--register');
const MODULES = argv.includes('--modules');
const fileArg = argv.find(a => a.endsWith('.gift'));

// ── Собрать все .gift файлы рекурсивно ──────────────────────────────────
function findGiftFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...findGiftFiles(full));
    } else if (entry.endsWith('.gift')) {
      results.push(full);
    }
  }
  return results;
}

// ── Главный поток ────────────────────────────────────────────────────────
async function main() {
  const { GiftCompiler } = await import(resolve(ROOT, 'src/core/GiftCompiler.js'));

  const files = fileArg
    ? [resolve(fileArg)]
    : findGiftFiles(SPECS_DIR);

  if (!files.length) {
    console.log('Нет .gift файлов для компиляции.');
    process.exit(0);
  }

  console.log(`\n═══ GiftCompiler — компиляция ${files.length} спецификаций ═══\n`);

  const allPersons = [];
  const allGiftTemplates = [];
  const allCovenants = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let compiled = 0;

  for (const file of files) {
    const rel = relative(ROOT, file);
    const source = readFileSync(file, 'utf8');

    // Валидация
    const validation = GiftCompiler.validate(source);
    const icon = validation.valid ? '✓' : '✗';
    const statsStr = `p:${validation.stats.persons} g:${validation.stats.gifts} c:${validation.stats.covenants} l:${validation.stats.liturgies}`;

    if (validation.errors.length) {
      console.log(`  ${icon} ${rel}  [${statsStr}]`);
      for (const e of validation.errors) {
        console.log(`    ✗ ${e}`);
      }
      totalErrors += validation.errors.length;
    }

    for (const w of validation.warnings) {
      totalWarnings++;
      if (!validation.valid) console.log(`    ⚠ ${w}`);
    }

    if (VALIDATE_ONLY) {
      if (validation.valid) {
        console.log(`  ${icon} ${rel}  [${statsStr}]`);
      }
      continue;
    }

    // Компиляция
    try {
      const result = GiftCompiler.compile(source);

      if (result.errors.length) {
        for (const e of result.errors) {
          console.log(`    ✗ compile: ${e}`);
          totalErrors++;
        }
      }

      allPersons.push(...result.persons);
      allGiftTemplates.push(...result.giftTemplates);
      allCovenants.push(...result.covenants);
      compiled++;

      if (validation.valid && !result.errors.length) {
        console.log(`  ✓ ${rel}  [${statsStr}]  → ${result.persons.length} лиц, ${result.giftTemplates.length} шаблонов, ${result.covenants.length} заветов`);
      }
    } catch (e) {
      console.log(`  ✗ ${rel}  compile error: ${e.message}`);
      totalErrors++;
    }
  }

  // Сводка
  console.log(`\n─── Итого ───`);
  console.log(`  Файлов:     ${files.length}`);
  console.log(`  Скомпилировано: ${compiled}`);
  console.log(`  Лиц:        ${allPersons.length}`);
  console.log(`  Шаблонов:   ${allGiftTemplates.length}`);
  console.log(`  Заветов:    ${allCovenants.length}`);
  console.log(`  Ошибок:     ${totalErrors}`);
  console.log(`  Предупреждений: ${totalWarnings}`);

  if (SHOW_PERSONS) {
    console.log(`\n─── Скомпилированные лица ───`);
    for (const p of allPersons) {
      const k = p.behaviorPolicy.kenosis;
      console.log(`  ${p.name}`);
      console.log(`    calling: ${p.calling}`);
      console.log(`    logos:   ${p.logos}`);
      console.log(`    telos:   ${p.behaviorPolicy.telos}`);
      console.log(`    kenosis: enforced=${k.enforced}, holdsNothing=${k.holdsNothing}, givesAway=${k.givesAway}`);
    }
  }

  if (!VALIDATE_ONLY) {
    // Сохранить compiled bundle
    if (!existsSync(DIST_DIR)) mkdirSync(DIST_DIR, { recursive: true });

    const bundle = {
      compiledAt: new Date().toISOString(),
      persons: allPersons,
      giftTemplates: allGiftTemplates,
      covenants: allCovenants,
      stats: {
        files: files.length,
        compiled,
        persons: allPersons.length,
        giftTemplates: allGiftTemplates.length,
        covenants: allCovenants.length,
      },
    };

    const bundlePath = resolve(DIST_DIR, 'gift-bundle.json');
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
    console.log(`\n  → ${relative(ROOT, bundlePath)}`);

    // Генерация per-person JS runtime модулей (--modules или по умолчанию)
    if (MODULES || !VALIDATE_ONLY) {
      if (!existsSync(PERSONS_DIR)) mkdirSync(PERSONS_DIR, { recursive: true });
      let moduleCount = 0;
      for (const file of files) {
        const rel = relative(ROOT, file);
        const source = readFileSync(file, 'utf8');
        const specName = basename(file, '.gift');
        try {
          const moduleSource = GiftCompiler.compileToModule(source, specName);
          const outPath = resolve(PERSONS_DIR, `${specName}.js`);
          writeFileSync(outPath, moduleSource, 'utf8');
          moduleCount++;
        } catch (e) {
          console.log(`  ⚠ module ${rel}: ${e.message}`);
        }
      }
      console.log(`  → ${moduleCount} JS модулей в ${relative(ROOT, PERSONS_DIR)}/`);
    }

    // Если --register, загрузить в PersonRegistry
    if (REGISTER && allPersons.length) {
      try {
        const { PersonRegistry } = await import(resolve(ROOT, 'src/persons/PersonRegistry.js'));
        const registry = new PersonRegistry();
        // Don't await init — work in memory-only mode for offline
        let registered = 0;
        for (const p of allPersons) {
          registry.applyCompiledSpec(p.name, p);
          registered++;
        }
        console.log(`  → ${registered} лиц зарегистрировано в PersonRegistry (memory-only)`);
      } catch (e) {
        console.log(`  ⚠ PersonRegistry: ${e.message}`);
      }
    }
  }

  if (totalErrors > 0) process.exit(1);
}

await main();
