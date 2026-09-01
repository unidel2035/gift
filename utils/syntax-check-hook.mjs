#!/usr/bin/env node
/**
 * syntax-check-hook.mjs — PostToolUse(Write|Edit): проверка синтаксиса за 0 LLM-токенов.
 *
 * Мера (ДОТУ): проверка не должна стоить материи. Если модель записала битый
 * .js/.mjs/.cjs/.json — ошибка возвращается ей СРАЗУ (exit 2 → stderr видит модель),
 * а не через упавший цикл тестов (дорогая петля: тесты → ошибка → перечитывание).
 *
 * Гарантия качества: файл синтаксически валиден прежде, чем модель двинется дальше.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

let input = '';
try { input = readFileSync(0, 'utf8'); } catch { /* пустой stdin */ }
let file = '';
try { file = JSON.parse(input)?.tool_input?.file_path || ''; } catch { /* не JSON */ }
if (!file) process.exit(0);

const ext = extname(file);
try {
  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe', timeout: 5000 });
  } else if (ext === '.json') {
    JSON.parse(readFileSync(file, 'utf8'));
  } else {
    process.exit(0); // не код — не наша мера
  }
} catch (e) {
  const msg = (e.stderr?.toString() || e.message || '').split('\n').slice(0, 8).join('\n').slice(0, 600);
  console.error(`✗ Синтаксическая ошибка в ${file} — исправь до следующих действий:\n${msg}`);
  process.exit(2);
}
process.exit(0);
