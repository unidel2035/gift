/**
 * GiftSpecLoader — загрузка скомпилированных .gift спецификаций при старте
 *
 * Пайплайн:
 *   specs/*.gift → GiftCompiler.compile() → dist/compiled/gift-bundle.json
 *   → GiftSpecLoader.load() → PersonRegistry + GiftMemory (W-матрица)
 *
 * «Слово стало плотью» (Ин 1:14) — спецификация стала исполнимой.
 *
 * Загрузчик:
 *   1. Читает dist/compiled/gift-bundle.json (или компилирует на лету)
 *   2. Применяет behaviorPolicy к каждому лицу (PersonRegistry.applyCompiledSpec)
 *   3. Записывает covenants в W-матрицу как необратимые акты (вес 10)
 *   4. Возвращает сводку: сколько лиц, шаблонов, заветов загружено
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../../utils/logger.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '../..');
const BUNDLE_PATH = resolve(ROOT, 'dist/compiled/gift-bundle.json');

export class GiftSpecLoader {
  /**
   * Load compiled specs into PersonRegistry and GiftMemory.
   *
   * @param {PersonRegistry} registry — person registry
   * @param {GiftMemory} [memory] — W-matrix (optional, for covenants)
   * @param {object} [opts]
   * @param {string} [opts.bundlePath] — override bundle path
   * @param {boolean} [opts.compileIfMissing] — compile on the fly if bundle absent
   * @returns {{ persons: number, giftTemplates: number, covenants: number, errors: string[] }}
   */
  static async load(registry, memory = null, opts = {}) {
    const bundlePath = opts.bundlePath || BUNDLE_PATH;
    const errors = [];
    let bundle;

    // 1. Load or compile bundle
    if (existsSync(bundlePath)) {
      try {
        bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
        logger.info(`[GiftSpecLoader] Loaded bundle: ${bundlePath} (${bundle.stats?.files || '?'} files)`);
      } catch (e) {
        errors.push(`Failed to read bundle: ${e.message}`);
        return { persons: 0, giftTemplates: 0, covenants: 0, errors };
      }
    } else if (opts.compileIfMissing) {
      try {
        bundle = await GiftSpecLoader._compileAll();
        logger.info(`[GiftSpecLoader] Compiled on the fly: ${bundle.stats?.files || '?'} files`);
      } catch (e) {
        errors.push(`Failed to compile: ${e.message}`);
        return { persons: 0, giftTemplates: 0, covenants: 0, errors };
      }
    } else {
      logger.warn('[GiftSpecLoader] No bundle found. Run: node utils/gift-compile.mjs');
      return { persons: 0, giftTemplates: 0, covenants: 0, errors: ['Bundle not found'] };
    }

    // 2. Apply behaviorPolicy to all persons
    let personsApplied = 0;
    for (const p of (bundle.persons || [])) {
      try {
        registry.applyCompiledSpec(p.name, p);
        personsApplied++;
      } catch (e) {
        errors.push(`Person ${p.name}: ${e.message}`);
      }
    }

    // 3. Write covenants to W-matrix as immutable acts
    let covenantsWritten = 0;
    if (memory && bundle.covenants?.length) {
      for (const cov of bundle.covenants) {
        try {
          GiftSpecLoader._writeCovenant(memory, cov);
          covenantsWritten++;
        } catch (e) {
          errors.push(`Covenant ${cov.parties?.join('↔')}: ${e.message}`);
        }
      }
    }

    const result = {
      persons: personsApplied,
      giftTemplates: (bundle.giftTemplates || []).length,
      covenants: covenantsWritten,
      errors,
    };

    logger.info(
      `[GiftSpecLoader] ✓ ${result.persons} лиц, ` +
      `${result.giftTemplates} шаблонов, ` +
      `${result.covenants} заветов` +
      (errors.length ? ` (${errors.length} ошибок)` : '')
    );

    return result;
  }

  /**
   * Write a covenant as an immutable act in W-matrix.
   * Covenant = heaviest type of act (weight=10, irreversible).
   *
   * @param {GiftMemory} memory
   * @param {object} cov — { parties, promise, sign, condition, weight, irreversible }
   */
  static _writeCovenant(memory, cov) {
    if (!cov.parties || cov.parties.length < 2) return;

    const [party1, party2] = cov.parties;
    const act = {
      giverId: party1,
      receiverId: party2,
      type: 'covenant',
      weight: cov.weight || 10,
      irreversible: true,
      content: cov.promise || '',
      sign: cov.sign || '',
      condition: cov.condition || '',
      reception: 'accepted', // covenants are always accepted
    };

    memory.receive(act);

    // Freeze: covenant is immutable, both directions
    Object.freeze(act);
  }

  /**
   * Compile all specs on the fly (fallback when bundle missing).
   * @returns {object} bundle
   */
  static async _compileAll() {
    const { GiftCompiler } = await import('./GiftCompiler.js');
    const { readdirSync, statSync } = await import('fs');
    const { resolve: res } = await import('path');

    const specsDir = res(ROOT, 'specs');
    const files = [];

    function walk(dir) {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir)) {
        const full = res(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.gift')) files.push(full);
      }
    }
    walk(specsDir);

    const allPersons = [];
    const allGiftTemplates = [];
    const allCovenants = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      try {
        const result = GiftCompiler.compile(source);
        allPersons.push(...result.persons);
        allGiftTemplates.push(...result.giftTemplates);
        allCovenants.push(...result.covenants);
      } catch { /* skip broken specs */ }
    }

    return {
      compiledAt: new Date().toISOString(),
      persons: allPersons,
      giftTemplates: allGiftTemplates,
      covenants: allCovenants,
      stats: { files: files.length, persons: allPersons.length },
    };
  }
}
