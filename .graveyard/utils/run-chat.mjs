#!/usr/bin/env node
/**
 * run-chat.mjs — backend для `gift chat`.
 *
 * Запускается из bin/gift через spawn('node', ...) — это даёт корректную
 * инициализацию TF env (TF_CPP_MIN_LOG_LEVEL=3 устанавливается ДО загрузки
 * tfjs-node, который притягивается через core/GiftMemory.js).
 *
 * Аргументы:
 *   --resume <id|last>   продолжить сессию
 *   --list               список сессий
 *   (без аргументов)     новая сессия
 */

// КРИТИЧНО: эти env должны быть установлены ДО любого import GiftMemory /
// tfjs-node, иначе TF native-binding уже инициализирован и читать их поздно.
process.env.TF_CPP_MIN_LOG_LEVEL    = '3';
process.env.TF_ENABLE_ONEDNN_OPTS   = '0';
process.env.TF_CPP_MIN_VLOG_LEVEL   = '3';

const { runGiftRepl, giftReplApi } = await import('../src/agent-cli/repl.js');

const args = process.argv.slice(2);

if (args[0] === '--list') {
  const ls = giftReplApi.listSessions(20);
  if (!ls.length) { console.log('Сессий нет.'); process.exit(0); }
  console.log('\n\x1b[1mПоследние REPL-сессии:\x1b[0m');
  for (const s of ls) {
    const title = s.title ? `  \x1b[1m${s.title}\x1b[0m` : '';
    console.log(`  ${s.id}  \x1b[2m${s.turns} turns\x1b[0m  \x1b[2m${s.updatedAt}\x1b[0m${title}`);
  }
  console.log();
  process.exit(0);
}

const resumeIdx = args.indexOf('--resume');
const resumeId  = resumeIdx >= 0 ? args[resumeIdx + 1] : null;

try {
  await runGiftRepl({ resumeId });
} catch (e) {
  console.error(`Ошибка: ${e.message}`);
  process.exit(1);
}
