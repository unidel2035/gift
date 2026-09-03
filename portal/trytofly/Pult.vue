<script setup>
// Раздел «Пульт» — первый экран портала: что с организацией и что ждёт тебя.
//
// ПРИНЦИП ЭКРАНА. Прежняя главная была колонной из восьми равных секций, и
// главный вопрос читателя — «что мне делать?» — приходилось вычитывать. Здесь
// на него отвечает ПЕРВЫЙ экран, а не восьмой: пульс организации пятью
// плитками, блок «ждёт тебя» и доска конвейера под ней. Справочное уехало в
// отдельный модуль Reference.vue и свёрнуто.
//
// ДАННЫЕ — из таблиц воркспейса через /portal/api/tables/:id/objects (сессия
// портала; у среды custom_code нет ключа к /api/v2, проверено 01.09.2026).
// Снапшот кладёт пульс бэкофиса (utils/org-backoffice.mjs, cron 03:40).
//
// СТИЛИ — только имена из общей таблицы журнала (второй блок стилей Nav.vue);
// новые узлы (плитки, строки «ждёт тебя», граф доски) добавлены туда же.
// Своих чисел цвета нет ни одного — раздел живёт в двух темах.
import { reactive, computed, onMounted } from 'vue'
import { StateChip, dayStamp, fmtDate } from '@kit'
import Nav from './Nav.vue'

const props = defineProps({
  bindings: { type: Object, default: () => ({}) },
  api: { type: Object, required: true },
  db: { type: String, required: true },
})

// Доска конвейера живёт в воркспейсе gift-koinon — не в том же, где портал.
const PM = '/gift-koinon/pm'

// ── Данные ────────────────────────────────────────────────────────────────
const tables = reactive({ board: [], sessions: [], shelf: [], portfolio: [], people: [] })
const errs = reactive({})

const tid = (k) => (String(props.bindings?.[k] ?? '').match(/table:(\d+)/) || [])[1]

async function load(k) {
  const id = tid(k)
  if (!id) { errs[k] = 'привязка не задана'; return }
  try {
    const d = await props.api.apiFetch(`${window.location.origin}/api/v2/${props.db}/portal/api/tables/${id}/objects?limit=200`)
    const items = (Array.isArray(d) ? d : (d?.data?.items || d?.items || []))
    tables[k] = items.map(r => ({ name: String(r.value ?? r.name ?? ''), fields: r.fields || {} }))
  } catch (e) { errs[k] = String(e.message || e) }
}
onMounted(() => { for (const k of Object.keys(tables)) load(k) })

const f = (r, name) => r.fields?.[name]

// ── Плитки пульса: как организация живёт по потоку конвейера ─────────────
// Пять статусов доски PM gift-koinon, их кладёт пульс в таблицу «Доска».
const NODE_TITLES = [
  { key: 'backlog',     title: 'Полка',  note: 'сырьё и вопросы' },
  { key: 'todo',        title: 'План',   note: 'ждёт разбора' },
  { key: 'in_progress', title: 'Рой',    note: 'ведёт конвейер' },
  { key: 'in_review',   title: 'Ревью',  note: 'требует взгляда' },
  { key: 'done',        title: 'Готово', note: 'за неделю' },
]

const board = computed(() => tables.board.map(r => ({
  num: r.name,
  title: String(f(r, 'титул') ?? ''),
  status: String(f(r, 'статус') ?? ''),
  measure: String(f(r, 'мера') ?? ''),
  run: String(f(r, 'прогон') ?? ''),
})))

const nodes = computed(() => NODE_TITLES.map(n => ({
  ...n,
  cards: board.value.filter(c => c.status === n.key),
})))

// Мера на незакрытой карточке — потрачена впустую. Неуспех тоже стоит
// токенов, и прятать это нечестно.
const wasted = computed(() => board.value.filter(c => c.status !== 'done' && c.measure).length)

// Свежесть снапшота: самый поздний «прогон» из всех строк доски.
const lastRun = computed(() => {
  const runs = board.value.map(c => c.run).filter(Boolean).sort()
  return runs.length ? runs[runs.length - 1] : ''
})

// ── Ждёт тебя: что требует человека СЕЙЧАС ───────────────────────────────
// По одному ряду на каждый род ожидания, без лимита «три»: сколько есть,
// столько и показано. Пустой блок не рисуется вовсе — «рой справляется»
// и есть нормальное состояние организации.
// 1. Карточки в плане и ревью — статусы, в которых дальше двигает человек.
// 2. Незакрытые хвосты сессий — то же правило, по которому работает пульс:
//    «не закрыто» непусто и не начинается с «ЗАКРЫТО:».
// 3. Белые пятна полки — вопросы без ответа.
const waitingCards = computed(() =>
  board.value.filter(c => c.status === 'todo' || c.status === 'in_review')
)

const tails = computed(() => {
  const out = []
  for (const r of tables.sessions) {
    const t = String(f(r, 'не закрыто') ?? '').trim()
    // Соглашение журнала: хвост «ЗАКРЫТО: …» — фактически закрыт. Границу
    // слова \b для кириллицы писать нельзя: в JS она определена только на
    // латинице, и «закрыто:» не отсекается вовсе. Границу задаёт взгляд
    // «вперёд не-буква».
    if (!t || /^закрыто(?![а-яё])/i.test(t)) continue
    // Поле «дата» — Unix-время, а имя записи начинается с той же даты
    // («02.09 Предотчёт…»): печать обеих значила бы показать день дважды.
    // Префикс срезается по правилу раздела «Журнал», дата печатается fmtDate.
    const raw = f(r, 'дата')
    const name = r.name.replace(/^\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\s*[—–-]?\s*/, '')
    out.push({ name, tail: t, date: fmtDate(raw) })
  }
  return out.slice(-5).reverse()
})

const spots = computed(() =>
  tables.shelf.filter(r => String(f(r, 'ярлыки') ?? '').includes('белое-пятно'))
)

const hasWaiting = computed(() =>
  Boolean(waitingCards.value.length || tails.value.length || spots.value.length)
)

// ── Свежесть журнала: идёт ли работа ──────────────────────────────────────
const latestSession = computed(() => {
  let bestDay = null
  let bestRaw = ''
  for (const r of tables.sessions) {
    const raw = f(r, 'дата')
    const d = dayStamp(raw)
    if (d !== null && (bestDay === null || d > bestDay)) { bestDay = d; bestRaw = raw }
  }
  return bestRaw
})
</script>

<template>
  <div class="j-page">
    <Nav :db="db" here="home" />

    <div class="j-pult__head">
      <div>
        <h1 class="j-pult__title">Пульт</h1>
        <p class="j-pult__sub">
          Организация работает конвейером: пульс бэкофиса замеряет её каждую ночь (03:40),
          рой агентов ведёт задачи, человек разбирает вопросы.
          Снапшот: <template v-if="lastRun">прогон {{ lastRun.slice(0, 10) }}</template><template v-else>ещё не снят</template>.
        </p>
      </div>
      <StateChip tone="ok" label="работа идёт" :at="latestSession" :stale-after="14" />
    </div>

    <!-- ПЛИТКИ ПУЛЬСА: пять статусов доски, каждая окрашена своей стадией. -->
    <section aria-label="Пульс конвейера" class="j-tiles j-anim">
      <div
        v-for="n in nodes" :key="n.key"
        class="j-tile" :data-stage="n.key"
        :class="{ 'j-tile--hot': n.key === 'in_review' && n.cards.length }"
      >
        <span class="j-tile__num">{{ n.cards.length }}</span>
        <span class="j-tile__name">{{ n.title }}</span>
        <span class="j-tile__note">{{ n.note }}</span>
      </div>
    </section>
    <p v-if="wasted" class="j-pult__wasted">
      Мера истрачена впустую на {{ wasted }} незакрытых карточках — неуспех тоже стоит токенов.
    </p>
    <p v-else-if="!tables.board.length" class="j-meta">
      {{ errs.board ? 'Доска не прочитана: ' + errs.board : 'Снапшота ещё нет — пульс не запускался.' }}
    </p>

    <!-- ЖДЁТ ТЕБЯ: единственный блок с действием — дальше двигает человек. -->
    <section v-if="hasWaiting" aria-label="Ждёт тебя" class="j-card j-card--waiting">
      <h2 class="j-card__title">Ждёт тебя</h2>

      <ul v-if="waitingCards.length" class="j-wait">
        <li v-for="c in waitingCards" :key="c.num" :data-stage="c.status">
          <span class="j-wait__kind">{{ c.status === 'todo' ? 'разобрать' : 'взять на ревью' }}</span>
          <a class="j-link" :href="PM">{{ c.num }}</a>
          {{ c.title.slice(0, 80) }}<template v-if="c.title.length > 80">…</template>
        </li>
      </ul>

      <ul v-if="tails.length" class="j-wait">
        <li v-for="t in tails" :key="t.name" data-stage="backlog">
          <span class="j-wait__kind">закрыть хвост</span>
          <span class="j-wait__date">{{ t.date }}</span>
          {{ t.name }}
          <div class="j-wait__note">{{ t.tail.slice(0, 200) }}<template v-if="t.tail.length > 200">…</template></div>
        </li>
      </ul>

      <ul v-if="spots.length" class="j-wait">
        <li v-for="s in spots.slice(0, 5)" :key="s.name" data-stage="todo">
          <span class="j-wait__kind">белое пятно</span>
          {{ s.name.replace(/^белое пятно:\s*/, '') }}
        </li>
        <li v-if="spots.length > 5" class="j-meta">
          … ещё {{ spots.length - 5 }} — весь перечень на Полке в Справке
        </li>
      </ul>
    </section>
    <p v-else class="j-pult__calm">Рой справляется — ничего не ждёт человека.</p>

    <!-- ДОСКА: поток карточек слева направо, как в конвейере. -->
    <section v-if="tables.board.length" aria-label="Доска конвейера" class="j-board">
      <h2 class="j-board__title">Доска конвейера <a class="j-link" :href="PM">открыть в PM ↗</a></h2>
      <div class="j-board__flow">
        <template v-for="(n, i) in nodes" :key="n.key">
          <div
            class="j-board__col"
            :data-stage="n.key"
            :class="{ 'j-board__col--hot': n.key === 'in_review' && n.cards.length }"
          >
            <div class="j-board__colhead">
              <span>{{ n.title }}</span>
              <span class="j-board__count">{{ n.cards.length }}</span>
            </div>
            <div v-if="n.note" class="j-board__note">{{ n.note }}</div>
            <ul class="j-board__list">
              <li v-for="c in n.cards.slice(0, 4)" :key="c.num" :title="c.title">
                <span class="j-board__num">{{ c.num }}</span>
                {{ c.title.slice(0, 56) }}<template v-if="c.title.length > 56">…</template>
                <span v-if="c.measure" class="j-board__measure">{{ c.measure }}</span>
              </li>
              <li v-if="n.cards.length > 4" class="j-meta">… ещё {{ n.cards.length - 4 }}</li>
              <li v-if="!n.cards.length" class="j-board__empty">пусто</li>
            </ul>
          </div>
          <span v-if="i < nodes.length - 1" class="j-board__arrow" aria-hidden="true">→</span>
        </template>
      </div>
      <p class="j-meta">
        Карточки двигает конвейер и ты — на доске PM, портал только смотрит.
        PM-API отдаёт не более 200 карточек за прогон, полка показана не целиком.
      </p>
    </section>
  </div>
</template>
