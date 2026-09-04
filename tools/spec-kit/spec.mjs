#!/usr/bin/env node
/**
 * spec.mjs — CLI над SpecRunner: гоняет исполняемые спеки проекта.
 *
 *   node spec.mjs                     — все модули (все spec.*.js рядом)
 *   node spec.mjs <module>            — один модуль (имя из meta.module)
 *   node spec.mjs <module> --json     — машиночитаемо (для CI/agентов)
 *
 * Exit code: 0 = GREEN, 1 = RED. Клади в package.json:
 *   "scripts": { "spec": "node tools/spec/spec.mjs" }
 */
import { runModule, runAll } from './SpecRunner.mjs'

const args = process.argv.slice(2)
const json = args.includes('--json')
const moduleName = args.find(a => !a.startsWith('--'))

const result = moduleName
  ? await runModule(moduleName)
  : await runAll()

if (json) {
  console.log(JSON.stringify(result, null, 2))
} else {
  for (const m of result.modules ?? [result]) {
    console.log(`\n${m.module} — ${m.ok ? 'GREEN' : 'RED'} (${m.passed}/${m.passed + m.failed})`)
    for (const s of m.specs ?? []) {
      if (s.status === 'PASS') console.log(`  ✓ ${s.name}`)
      else if (s.status === 'FAIL') console.log(`  ✗ ${s.name} — ${s.error}`)
      else console.log(`  · ${s.name} [${s.status}] ${s.reason ?? ''}`)
    }
  }
  console.log(`\n${result.ok ? 'GREEN' : 'RED'}: ${result.passed} passed, ${result.failed} failed`)
}
process.exit(result.ok ? 0 : 1)
