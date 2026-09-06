<template>
  <div class="gift-cli">
    <!-- Шапка: логотип + статус -->
    <header class="gcli-head">
      <div class="gcli-logo">⛬ gift</div>
      <div class="gcli-sub">Онтология Дара · Κοινὸν τοῦ Νοῦ · веб-морда CLI</div>
      <div class="gcli-status">
        <span class="dot" :class="running ? 'on' : 'idle'"></span>
        {{ running ? 'агент работает' : 'готов' }}
        <span v-if="convId" class="conv">· беседа #{{ convId }}</span>
      </div>
    </header>

    <!-- Лента сообщений -->
    <div class="gcli-log" ref="logEl">
      <div v-if="!messages.length" class="gcli-empty">
        <div class="gcli-hint">Задай вопрос об онтологии дара, матрице W или данных общины:</div>
        <div class="gcli-chips">
          <button v-for="h in hints" :key="h" class="chip" @click="ask(h)">{{ h }}</button>
        </div>
      </div>
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <span class="who">{{ m.role === 'user' ? '❯' : '⛬' }}</span>
        <div class="body">
          <div class="text" v-html="md(m.text)"></div>
          <div v-if="m.tools && m.tools.length" class="tools">
            <div v-for="(t, j) in m.tools" :key="j" class="tool">
              ● {{ t.name }} <span class="arg">{{ short(t.args) }}</span>
              <span v-if="t.result" class="res">⎿ {{ short(t.result) }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-if="streamText" class="msg assistant streaming">
        <span class="who">⛬</span>
        <div class="body"><div class="text" v-html="md(streamText)"></div></div>
      </div>
    </div>

    <!-- Ввод -->
    <footer class="gcli-input">
      <span class="prompt">❯</span>
      <input v-model="draft" @keydown.enter="ask(draft)" :disabled="running"
             placeholder="спроси о дарах, матрице, конвейере…" autocomplete="off" />
      <button class="send" @click="ask(draft)" :disabled="running || !draft.trim()">↑</button>
    </footer>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue';

const messages = ref([]);
const streamText = ref('');
const running = ref(false);
const draft = ref('');
const convId = ref(null);
const logEl = ref(null);
const hints = [
  'Что такое дар в этой онтологии?',
  'Покажи топ нитей матрицы W',
  'Кому Дионисий должен больше всех?',
  'Что в конвейере сейчас?',
];

// Простой markdown → HTML (жёстко ��кранируем всё, потом раскрашиваем своё)
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function md(s) {
  let t = esc(s);
  t = t.replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => '<pre>' + code.trimEnd() + '</pre>');
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  t = t.replace(/^### (.+)$/gm, '<h4>$1</h4>').replace(/^## (.+)$/gm, '<h3>$1</h3>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/^[-•] (.+)$/gm, '<span class="li">$1</span>');
  return t;
}
function short(x) {
  const s = typeof x === 'string' ? x : JSON.stringify(x);
  return (s || '').replace(/\s+/g, ' ').slice(0, 80);
}

function scroll() {
  nextTick(() => { if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight; });
}

// ── SSE-клиент к портальному оркестратору ──
// Контракт (portal/router.js:3810): POST /api/v2/gift/portal/api/agent/run
//   body: { message, convId }  → SSE: RUN_STARTED {convId},
//   TEXT_MESSAGE_CONTENT {content}, TOOL_CALL_START {toolName, args},
//   TOOL_CALL_END {toolName, result}, RUN_FINISHED {content, outcome}
async function ask(text) {
  text = (text || '').trim();
  if (!text || running.value) return;
  draft.value = '';
  messages.value.push({ role: 'user', text });
  running.value = true;
  streamText.value = '';
  const cur = { role: 'assistant', text: '', tools: [] };
  let attached = false;
  const attach = () => {
    if (attached) return;
    attached = true;
    messages.value.push(cur);
    streamText.value = '';
  };

  try {
    const resp = await fetch('/api/v2/gift/portal/api/agent/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message: text, convId: convId.value || undefined }),
    });
    if (!resp.ok) {
      let msg = 'HTTP ' + resp.status;
      try {
        const j = await resp.json();
        msg += ': ' + (j?.error?.message || j?.error?.code || '');
      } catch {}
      throw new Error(msg);
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;   // heartbeat «: …» пропускаем
        let ev;
        try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        if (ev.type === 'RUN_STARTED' && ev.convId) convId.value = ev.convId;
        else if (ev.type === 'TEXT_MESSAGE_CONTENT') {
          streamText.value += ev.content || '';
          cur.text += ev.content || '';
          scroll();
        }
        else if (ev.type === 'TOOL_CALL_START') {
          cur.tools.push({ name: ev.toolName, args: ev.args });
          attach();
        }
        else if (ev.type === 'TOOL_CALL_END') {
          const open = cur.tools.find(t => t.name === ev.toolName && t.result == null);
          if (open) open.result = ev.result;
          scroll();
        }
        else if (ev.type === 'RUN_FINISHED') {
          if (ev.convId) convId.value = ev.convId;
          if (ev.content && ev.content !== cur.text) {
            cur.text = ev.content;   // итог без болтовни — заменяет накопленный поток
          }
          attach();
        }
        else if (ev.type === 'RUN_ERROR') {
          cur.text += (cur.text ? '\n\n' : '') + '✗ ' + (ev.message || 'агент не дал ответа');
          attach();
        }
        else if (ev.type === 'error') {
          throw new Error(ev.message || 'ошибка сервера');
        }
      }
    }
  } catch (e) {
    cur.text = cur.text || ('✗ ' + (e.message || e));
  }
  attach();
  running.value = false;
  scroll();
}
</script>

<style scoped>
.gift-cli {
  font-family: ui-monospace, 'Cascadia Mono', Menlo, monospace;
  display: flex; flex-direction: column;
  height: 560px; max-height: 80vh;
  border: 1px solid #2d3748; border-radius: 10px;
  background: #0d1117; color: #e6edf3;
  overflow: hidden;
}
.gcli-head { padding: 10px 14px; border-bottom: 1px solid #2d3748; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.gcli-logo { font-weight: 700; color: #f0b429; font-size: 15px; }
.gcli-sub { color: #8b949e; font-size: 12px; }
.gcli-status { margin-left: auto; color: #8b949e; font-size: 11px; }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #484f58; margin-right: 4px; }
.dot.on { background: #3fb950; }
.gcli-log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.gcli-empty { color: #8b949e; text-align: center; margin-top: 60px; }
.gcli-hint { font-size: 13px; margin-bottom: 10px; }
.gcli-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.chip { background: #161b22; border: 1px solid #30363d; color: #79c0ff; padding: 5px 12px; border-radius: 999px; font-size: 12px; cursor: pointer; }
.chip:hover { background: #1f2937; }
.msg { display: flex; gap: 8px; }
.msg .who { flex-shrink: 0; width: 18px; color: #f0b429; }
.msg.user .who { color: #79c0ff; }
.msg .body { flex: 1; min-width: 0; }
.msg.user .text { color: #a5d6ff; }
.text { font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.text :deep(h3), .text :deep(h4) { color: #f0b429; margin: 8px 0 4px; font-size: 13px; }
.text :deep(code) { background: #161b22; padding: 1px 5px; border-radius: 4px; color: #ffa657; }
.text :deep(pre) { background: #161b22; padding: 8px 10px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
.text :deep(.li) { display: block; padding-left: 14px; }
.text :deep(.li)::before { content: '• '; color: #79c0ff; }
.tools { margin-top: 6px; }
.tool { font-size: 11px; color: #d2a8ff; margin: 2px 0; }
.tool .arg, .tool .res { color: #6e7681; }
.gcli-input { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid #2d3748; align-items: center; }
.gcli-input .prompt { color: #f0b429; }
.gcli-input input { flex: 1; background: #161b22; border: 1px solid #30363d; color: #e6edf3; border-radius: 6px; padding: 8px 10px; font-family: inherit; font-size: 13px; outline: none; }
.gcli-input input:focus { border-color: #f0b429; }
.send { background: #21262d; border: 1px solid #30363d; color: #f0b429; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 14px; }
.send:disabled { opacity: 0.4; cursor: default; }
</style>
