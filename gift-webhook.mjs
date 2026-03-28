import { createServer } from 'http';
import { createHmac } from 'crypto';
import { spawn } from 'child_process';
import { appendFileSync, mkdirSync } from 'fs';

const PORT   = 8088;
const SECRET = process.env.WEBHOOK_SECRET || '';
const LOG    = '/home/hive/gift-worker/data/webhook.log';
mkdirSync('/home/hive/gift-worker/data', { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  appendFileSync(LOG, line);
}

function verify(secret, payload, sig) {
  if (!secret || !sig) return true; // skip if not configured
  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  return expected === sig;
}

let running = false; // один запуск за раз

function triggerDevLoop() {
  if (running) { log('dev-loop уже запущен, пропускаю'); return; }
  running = true;
  log('▶ Запускаю dev-loop...');

  const proc = spawn('/home/hive/gift-worker/run-dev-loop.sh', [], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.on('data', d => log('  ' + d.toString().trim()));
  proc.stderr.on('data', d => log('  ERR: ' + d.toString().trim()));
  proc.on('exit', code => {
    running = false;
    log(`◼ dev-loop завершён (exit ${code})`);
  });
  proc.unref();
}

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404); res.end('not found'); return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;

  const sig   = req.headers['x-hub-signature-256'];
  const event = req.headers['x-github-event'];

  if (!verify(SECRET, body, sig)) {
    log('WARN: invalid signature');
    res.writeHead(401); res.end('unauthorized'); return;
  }

  res.writeHead(200); res.end('ok');

  let data;
  try { data = JSON.parse(body); } catch { return; }

  log(`Event: ${event} action=${data.action} issue=#${data.issue?.number}`);

  // Триггер: issue получила метку plan-approved
  const isPlanApproved = event === 'issues'
    && data.action === 'labeled'
    && data.label?.name === 'plan-approved';

  // Триггер: issue создана с меткой gift-ready (новое вопрошание)
  const isNewGiftReady = event === 'issues'
    && data.action === 'opened'
    && data.issue?.labels?.some(l => l.name === 'gift-ready');

  if (isPlanApproved) {
    log(`✦ plan-approved на issue #${data.issue.number}: ${data.issue.title}`);
    // Сначала запустить gift-plan если нет плана, потом dev-loop
    triggerDevLoop();
  } else if (isNewGiftReady) {
    log(`✦ Новое вопрошание #${data.issue.number}: ${data.issue.title}`);
    // Генерировать план (без реализации — ждём одобрения)
    // triggerPlanOnly(); // TODO
  }
});

server.listen(PORT, () => log(`Gift Webhook сервер на ::${PORT}/webhook`));
