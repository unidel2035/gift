import { test } from 'node:test';
import assert from 'node:assert/strict';
import { violations, testScriptTampered } from '../utils/judge-guard.mjs';

// Стража измерения: судья неприкосновенен (урок инцидента HF, METR 26.08.2026)

test('каталоги тестов под стражей', () => {
  assert.deepEqual(violations(['src/core/engine.js', 'tests/engine.test.js']), ['tests/engine.test.js']);
  assert.deepEqual(violations(['packages/x/test/helper.js']), ['packages/x/test/helper.js']);
  assert.deepEqual(violations(['src/__tests__/a.js']), ['src/__tests__/a.js']);
});

test('файлы *.test.* и *.spec.* под стражей', () => {
  assert.deepEqual(violations(['src/a.test.js']), ['src/a.test.js']);
  assert.deepEqual(violations(['src/a.spec.ts']), ['src/a.spec.ts']);
  assert.deepEqual(violations(['src/a.test.mjs']), ['src/a.test.mjs']);
});

test('конфиги тестов и CI под стражей', () => {
  assert.deepEqual(violations(['vitest.config.ts']), ['vitest.config.ts']);
  assert.deepEqual(violations(['.github/workflows/ci.yml']), ['.github/workflows/ci.yml']);
});

test('конвейер и стража сами под стражей', () => {
  assert.ok(violations(['utils/gift-dev-loop.mjs']).length === 1);
  assert.ok(violations(['utils/judge-guard.mjs']).length === 1);
  assert.ok(violations(['utils/pm.mjs']).length === 1);
});

test('обычный код и зависимости — не судья', () => {
  assert.deepEqual(violations(['src/core/engine.js', 'package.json', 'README.md']), []);
  assert.deepEqual(violations([]), []);
  assert.deepEqual(violations(null), []);
});

test('ручка судьи: смена скрипта "test" в package.json видна по диффу', () => {
  assert.equal(testScriptTampered('+  "test": "node --test tests/trivial.test.js"'), true);
  assert.equal(testScriptTampered('-  "test": "node --test tests/*.test.js"\n+  "test": "echo ok"'), true);
  assert.equal(testScriptTampered('+"test":"x"'), true);
});

test('правка зависимостей не является порчей судьи', () => {
  assert.equal(testScriptTampered('+  "lodash": "^4.0.0"'), false);
  assert.equal(testScriptTampered('-  "lint": "eslint ."\n+  "lint": "eslint src"'), false);
  assert.equal(testScriptTampered(''), false);
  assert.equal(testScriptTampered(null), false);
});
