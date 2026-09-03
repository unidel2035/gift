<script setup>
// Раздел «Матрица» — отношения, на которых стоит конвейер.
//
// ТРИ ВОПРОСА ЦЕХА. Доска отвечает «что делать», матрица — всё остальное:
//   1. СКОЛЬКО дано — таблица «Матрица»: нити с весом, кто кому сколько.
//   2. ПОЧЕМУ так — таблица «Дары»: журнал актов с провенансом (коммит, gh#).
//      Вес нити — не число с потолка: за каждым стоит запись журнала.
//   3. ЧЕГО НЕ ХВАТАЕТ — таблица «Пустыни»: где актов нет вовсе.
//      Это единственный вывод «от цели» в цехе, и он вшит руками в пульс —
//      общего механизма вывода от цели здесь нет и граница показана честно.
//
// ДАННЫЕ кладёт пульс бэкофиса (utils/org-backoffice.mjs, cron 03:40) из
// локального снапшота матрицы W и журнала act-index. Канал тот же, что у
// доски: ключ у агента, у портала — своя сессия на чтение таблиц.
//
// СТИЛИ — только имена из общей таблицы журнала (Nav.vue). Полоска веса
// нити — единственный график на странице: ширина ∝ весу, максимум —
// вся ширина строки. Числа печатает строка рядом — цвет не единственный
// носитель смысла.
import { reactive, computed, onMounted } from 'vue'
import { StateChip } from '@kit'
import Nav from './Nav.vue'

const props = defineProps({
  bindings: { type: Object, default: () => ({}) },
  api: { type: Object, required: true },
  db: { type: String, required: true },
})

const tables = reactive({ matrix: [], gifts: [], deserts: [] })
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
const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0

// ── Нити: таблица уже отсортирована пульсом по весу, верим порядку ────────
const threads = computed(() => tables.matrix.map(r => ({
  from: String(f(r, 'от') ?? ''),
  to: String(f(r, 'кому') ?? ''),
  w: num(f(r, 'вес')),
})))

const maxW = computed(() => Math.max(1, ...threads.value.map(t => t.w)))

// Всего дано: сумма нитей — сквозная мера богатства отношений цеха.
const totalGiven = computed(() => threads.value.reduce((s, t) => s + t.w, 0))

// Свежесть: самая поздняя запись в журнале даров.
const lastGift = computed(() => {
  const dates = tables.gifts.map(r => String(f(r, 'когда') ?? '')).filter(Boolean).sort()
  return dates.length ? dates[dates.length - 1] : ''
})

// ── Дары: журнал уже идёт новым-сверху (пульс кладёт так) ─────────────────
const gifts = computed(() => tables.gifts.map(r => ({
  when: String(f(r, 'когда') ?? ''),
  from: String(f(r, 'от') ?? ''),
  to: String(f(r, 'кому') ?? ''),
  kind: String(f(r, 'род') ?? ''),
  w: num(f(r, 'вес')),
  what: String(f(r, 'что') ?? ''),
  prov: String(f(r, 'провенанс') ?? ''),
})))

// ── Пустыни: тишины и затухания — то, что требует человека ────────────────
const deserts = computed(() => tables.deserts.map(r => ({
  kind: String(f(r, 'род') ?? ''),
  name: r.name,
  weight: String(f(r, 'тянется с') ?? ''),
  todo: String(f(r, 'что делать') ?? ''),
})))

const silences = computed(() => deserts.value.filter(d => d.kind === 'тишина'))
const fadings = computed(() => deserts.value.filter(d => d.kind === 'затухание'))

// ── Лица: из нитей и тишин — кто вообще живёт в матрице цеха ──────────────
const persons = computed(() => {
  const set = new Set()
  threads.value.forEach(t => { set.add(t.from); set.add(t.to) })
  silences.value.forEach(d => set.add(d.name.replace(/^тишина: /, '')))
  return [...set]
})

// Кто сколько отдал/принял: итоги по лицам для второй половины страницы.
const ledger = computed(() => {
  const m = new Map()
  for (const t of threads.value) {
    if (!m.has(t.from)) m.set(t.from, { from: 0, to: 0 })
    if (!m.has(t.to)) m.set(t.to, { from: 0, to: 0 })
    m.get(t.from).from += t.w
    m.get(t.to).to += t.w
  }
  return [...m.entries()]
    .map(([name, v]) => ({ name, ...v, net: +(v.from - v.to).toFixed(1) }))
    .sort((a, b) => b.from - a.from)
})
</script>

<template>
  <div class="j-page">
    <Nav :db="db" here="matrix" />

    <div class="j-pult__head">
      <div>
        <h1 class="j-pult__title">Матрица даров</h1>
        <p class="j-pult__sub">
          Конвейер стоит на отношениях: кто, кому и сколько дал. Вес нити — не число
          с потолка, за каждым стоит акт в журнале. Снапшот кладёт пульс каждую ночь (03:40).
        </p>
      </div>
      <StateChip tone="ok" label="журнал жив" :at="lastGift" :stale-after="14" />
    </div>

    <!-- НИТИ: три вопроса цеха, вопрос первый — сколько -->
    <section aria-label="Нити матрицы" class="j-card">
      <h2 class="j-card__title">
        Нити <span class="j-ref__count">{{ threads.length }}</span>
        <span class="j-board__note">всего дано {{ totalGiven.toFixed(0) }} · лиц {{ persons.length }}</span>
      </h2>
      <p v-if="errs.matrix" class="j-meta">Матрица не прочитана: {{ errs.matrix }}</p>
      <p v-else-if="!threads.length" class="j-meta">Снапшота ещё нет — пульс не запускался.</p>
      <ul v-else class="j-threads">
        <li v-for="t in threads" :key="t.from + '→' + t.to" class="j-thread">
          <span class="j-thread__pair">
            <strong>{{ t.from }}</strong>
            <span class="j-thread__arrow" aria-hidden="true">→</span>
            <strong>{{ t.to }}</strong>
          </span>
          <span class="j-thread__bar" aria-hidden="true">
            <span class="j-thread__fill" :style="{ width: (100 * t.w / maxW).toFixed(1) + '%' }" />
          </span>
          <span class="j-thread__w">{{ t.w }}</span>
        </li>
      </ul>
      <p class="j-meta">
        Вес — необратимая сумма актов: время тяжелее денег, код тяжелее отчёта.
        Пересчёт вперёд: новый акт удлиняет нить, стереть нельзя.
      </p>
    </section>

    <!-- ПУСТЫНИ: вопрос третий — чего не хватает. Ждёт человека, стоит первым. -->
    <section v-if="deserts.length" aria-label="Пустыни" class="j-card j-card--waiting">
      <h2 class="j-card__title">Пустыни <span class="j-ref__count">{{ deserts.length }}</span></h2>
      <ul class="j-wait">
        <li v-for="d in deserts" :key="d.name" data-stage="todo">
          <span class="j-wait__kind">{{ d.kind }}</span>
          {{ d.name.replace(/^тишина: /, '') }}
          <div v-if="d.todo" class="j-wait__note">{{ d.todo }}</div>
        </li>
      </ul>
      <p class="j-meta">
        Обратный вопрос цеха: не «что произошло», а «где ничего не происходит».
        Единственный вшит вручную: общего вывода от цели в матрице нет — она помнит, не выводит.
      </p>
    </section>

    <!-- ЖУРНАЛ АКТОВ: вопрос второй — почему. Провенанс каждой строки. -->
    <section aria-label="Журнал даров" class="j-card">
      <h2 class="j-card__title">Журнал актов <span class="j-ref__count">{{ gifts.length }}</span></h2>
      <p v-if="errs.gifts" class="j-meta">Журнал не прочитан: {{ errs.gifts }}</p>
      <p v-else-if="!gifts.length" class="j-meta">Журнал пуст — акты ещё не записаны.</p>
      <table v-else class="j-tbl">
        <thead><tr><th>когда</th><th>кто → кому</th><th>род</th><th class="j-tbl__num">вес</th><th>что</th></tr></thead>
        <tbody>
          <tr v-for="g in gifts" :key="g.when + g.from">
            <td class="j-tbl__num">{{ g.when }}</td>
            <td><strong>{{ g.from }}</strong> → {{ g.to }}</td>
            <td><span v-if="g.kind" class="j-kind" :data-kind="g.kind">{{ g.kind }}</span></td>
            <td class="j-tbl__num">{{ g.w || '—' }}</td>
            <td>
              {{ g.what.slice(0, 90) }}<template v-if="g.what.length > 90">…</template>
              <span v-if="g.prov" class="j-thread__prov">{{ g.prov }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="j-meta">
        Свежие 200. Провенанс — коммит и gh#: любой вес раскрывается до акта,
        любой акт — до коммита. Это ответ на «почему нить такая».
      </p>
    </section>

    <!-- ИТОГИ ПО ЛИЦАМ: кому цех должен вниманием -->
    <section aria-label="Итоги по лицам" class="j-card">
      <h2 class="j-card__title">Лица <span class="j-ref__count">{{ ledger.length }}</span></h2>
      <table v-if="ledger.length" class="j-tbl">
        <thead><tr><th>кто</th><th class="j-tbl__num">отдал</th><th class="j-tbl__num">принял</th><th class="j-tbl__num">сальдо</th></tr></thead>
        <tbody>
          <tr v-for="p in ledger" :key="p.name">
            <td>{{ p.name }}</td>
            <td class="j-tbl__num">{{ p.from.toFixed(1) }}</td>
            <td class="j-tbl__num">{{ p.to.toFixed(1) }}</td>
            <td class="j-tbl__num">{{ p.net > 0 ? '+' : '' }}{{ p.net }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="j-meta">Лиц в снапшоте нет.</p>
      <p v-if="ledger.length" class="j-meta">
        Сальдо — не долг: дар не транзакция и не возвращается. Это карта внимания —
        куда цех уже смотрит и куда ещё не смотрел.
      </p>
    </section>
  </div>
</template>
