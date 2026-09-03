<script setup>
// Раздел «Фонд» — квадратная матрица команды фонда ФСТ.
//
// Gift-матрица (главная, ниже по странице) отвечает за общину проекта:
// _claude, заветы, богословие. Эта — за живую команду фонда: роли, поручения,
// ревью, решения. Две матрицы не конкурируют, как план и факт.
//
// ФОРМА — квадрат (донор × получатель), как морфологический ящик uav-портала
// (drondoc.online/uav): там челлендж × пространство и карточки в клетках,
// здесь лицо × лицо и счётчик актов в клетке. Клетка пустая — белое пятно
// той же природы, что пустыня gift-матрицы.
//
// ДАННЫЕ кладёт пульс бэкофиса (syncFundTeam, cron 03:40) из живых данных
// воркспейса фонда: PM-карточки (кто кому ставит работу), голоса ИК (агент →
// вердикт), решения (кто утвердил). Квадрат пересчитывается вперёд каждую
// ночь из платформы — здесь срез, а не копия.
import { reactive, computed, onMounted } from 'vue'
import { StateChip } from '@kit'
import Nav from './Nav.vue'

const props = defineProps({
  bindings: { type: Object, default: () => ({}) },
  api: { type: Object, required: true },
  db: { type: String, required: true },
})

const tables = reactive({ square: [], roster: [], votes: [], decisions: [] })
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

// ── Квадрат: клетки из таблицы (от, кому, актов) ───────────────────────────
const cells = computed(() => tables.square.map(r => ({
  from: String(f(r, 'от') ?? ''),
  to: String(f(r, 'кому') ?? ''),
  n: num(f(r, 'актов')),
  done: num(f(r, 'закрыто')),
  open: num(f(r, 'открыто')),
  kind: String(f(r, 'род') ?? ''),
})))

// Оси квадрата: все лица из клеток — строки-доноры, колонки-получатели.
// Порядок устойчивый (по алфавиту), кроме «Постановщика» — он источник
// всей работы фонда, стоит первым, как ось конвейера.
const axis = computed(() => {
  const set = new Set()
  cells.value.forEach(c => { if (c.from) set.add(c.from); if (c.to) set.add(c.to) })
  tables.roster.forEach(r => set.add(r.name))
  return [...set].sort((a, b) => (a !== 'Постановщик' ? 1 : -1) - (b !== 'Постановщик' ? 1 : -1) || a.localeCompare(b, 'ru'))
})

const cellAt = (a, b) => cells.value.find(c => c.from === a && c.to === b)

const maxN = computed(() => Math.max(1, ...cells.value.map(c => c.n)))

// Итоги по лицам квадрата — та же книга, что в gift-матрице, но в актах фонда.
const ledger = computed(() => {
  const m = new Map(axis.value.map(n => [n, { name: n, gave: 0, got: 0 }]))
  cells.value.forEach(c => {
    if (m.has(c.from)) m.get(c.from).gave += c.n
    if (m.has(c.to)) m.get(c.to).got += c.n
  })
  return [...m.values()].filter(p => p.gave || p.got).sort((a, b) => b.gave - a.gave)
})

// ── Состав: роли и логины ──────────────────────────────────────────────────
const roster = computed(() => tables.roster.map(r => ({
  name: r.name,
  role: String(f(r, 'роль') ?? ''),
  login: String(f(r, 'логин') ?? ''),
  critical: String(f(r, 'критичные сигналы') ?? '') === 'да',
})))

// ── Ревью: голоса ИК — вердикт, до дебатов, скор, уверенность ──────────────
const votes = computed(() => tables.votes.map(r => ({
  agent: String(f(r, 'агент') ?? ''),
  verdict: String(f(r, 'вердикт') ?? ''),
  before: String(f(r, 'до дебатов') ?? ''),
  score: String(f(r, 'скор') ?? ''),
  conf: String(f(r, 'уверенность') ?? ''),
  solution: String(f(r, 'решение') ?? ''),
})))

// ── Решения: итоги и утвердившие ───────────────────────────────────────────
const decisions = computed(() => tables.decisions.map(r => ({
  name: r.name,
  outcome: String(f(r, 'итог') ?? ''),
  by: String(f(r, 'утвердил') ?? ''),
})))
</script>

<template>
  <div class="j-page">
    <Nav :db="db" here="home" />

    <div id="fund" class="j-pult__head">
      <div>
        <h1 class="j-pult__title">Фонд ФСТ — команда</h1>
        <p class="j-pult__sub">
          Квадратная матрица живых отношений фонда: кто кому ставит работу, кто кого
          ревьюит, кто утверждает. Клетка — счётчик актов, пустая клетка — белое пятно.
          Пересчёт из воркспейса фонда каждую ночь (03:40).
        </p>
      </div>
      <StateChip tone="ok" label="пульс жив" :at="''" />
    </div>

    <!-- КВАДРАТ: донор × получатель, клетка = акты -->
    <section aria-label="Квадрат фонда" class="j-card">
      <h2 class="j-card__title">
        Квадрат <span class="j-ref__count">{{ cells.length }}</span>
        <span class="j-board__note">лиц {{ axis.length }} · роды: поручение / ревью / утверждение</span>
      </h2>
      <p v-if="errs.square" class="j-meta">Квадрат не прочитан: {{ errs.square }}</p>
      <p v-else-if="!cells.length" class="j-meta">Среза ещё нет — пульс не запускался.</p>
      <div v-else class="j-sq__wrap">
        <table class="j-sq">
          <thead>
            <tr>
              <th class="j-sq__corner" scope="col">от ↓ · кому →</th>
              <th v-for="b in axis" :key="'h' + b" scope="col"><span class="j-sq__th">{{ b }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in axis" :key="a">
              <th scope="row" class="j-sq__rh">{{ a }}</th>
              <td v-for="b in axis" :key="a + b" :class="{ 'j-sq__self': a === b }">
                <template v-if="a !== b">
                  <span v-if="cellAt(a, b)" class="j-sq__cell" :data-kind="cellAt(a, b).kind"
                    :style="{ opacity: (0.45 + 0.55 * cellAt(a, b).n / maxN).toFixed(2) }"
                    :title="`${a} → ${b}: ${cellAt(a, b).n} актов (${cellAt(a, b).kind}, закрыто ${cellAt(a, b).done})`">
                    {{ cellAt(a, b).n }}
                  </span>
                  <span v-else class="j-sq__cell j-sq__cell--gap" title="актов нет — белое пятно">·</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="j-meta">
        Диагональ пуста: дар себе — не акт. Пустая клетка вне диагонали — белое пятно
        фонда: отношение возможно, но акта ещё не было. Наибольшая клетка выделена,
        число рядом подтверждает — цвет не единственный носитель смысла.
      </p>
    </section>

    <!-- ИТОГИ: кто в квадрате активен -->
    <section aria-label="Итоги фонда" class="j-card">
      <h2 class="j-card__title">Лица фонда <span class="j-ref__count">{{ ledger.length }}</span></h2>
      <table v-if="ledger.length" class="j-tbl">
        <thead><tr><th>кто</th><th class="j-tbl__num">отдал</th><th class="j-tbl__num">принял</th><th class="j-tbl__num">актов</th></tr></thead>
        <tbody>
          <tr v-for="p in ledger" :key="p.name">
            <td>{{ p.name }}</td>
            <td class="j-tbl__num">{{ p.gave }}</td>
            <td class="j-tbl__num">{{ p.got }}</td>
            <td class="j-tbl__num">{{ p.gave + p.got }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="j-meta">Лиц в квадрате нет.</p>
    </section>

    <!-- СОСТАВ: роли и логины -->
    <section aria-label="Состав фонда" class="j-card">
      <h2 class="j-card__title">Состав <span class="j-ref__count">{{ roster.length }}</span></h2>
      <p v-if="errs.roster" class="j-meta">Состав не прочитан: {{ errs.roster }}</p>
      <table v-else-if="roster.length" class="j-tbl">
        <thead><tr><th>лицо</th><th>роль</th><th>логин</th><th>критичные сигналы</th></tr></thead>
        <tbody>
          <tr v-for="p in roster" :key="p.name">
            <td>{{ p.name }}</td>
            <td>{{ p.role }}</td>
            <td class="j-meta">{{ p.login }}</td>
            <td>{{ p.critical ? 'да' : '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="j-meta">Состав не прочитан.</p>
    </section>

    <!-- РЕВЬЮ: голоса ИК -->
    <section aria-label="Ревью фонда" class="j-card">
      <h2 class="j-card__title">Ревью ИК <span class="j-ref__count">{{ votes.length }}</span></h2>
      <p v-if="errs.votes" class="j-meta">Ревью не прочитано: {{ errs.votes }}</p>
      <p v-else-if="!votes.length" class="j-meta">Голосов ИК в срезе нет.</p>
      <table v-else class="j-tbl">
        <thead><tr><th>агент</th><th>вердикт</th><th>до дебатов</th><th class="j-tbl__num">скор</th><th class="j-tbl__num">уверенность</th><th>решение</th></tr></thead>
        <tbody>
          <tr v-for="v in votes" :key="v.agent + v.solution">
            <td>{{ v.agent }}</td>
            <td><span class="j-kind" :data-kind="v.verdict">{{ v.verdict }}</span></td>
            <td>{{ v.before || '—' }}</td>
            <td class="j-tbl__num">{{ v.score || '—' }}</td>
            <td class="j-tbl__num">{{ v.conf || '—' }}</td>
            <td class="j-meta">{{ v.solution }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="votes.length" class="j-meta">
        «До дебатов» против «вердикта» — след кросс-дебата ИК: где сдвиг, там собор
        изменил мнение агента. Это динамика, которую квадрат не показывает.
      </p>
    </section>

    <!-- РЕШЕНИЯ: итоги -->
    <section aria-label="Решения фонда" class="j-card">
      <h2 class="j-card__title">Решения <span class="j-ref__count">{{ decisions.length }}</span></h2>
      <p v-if="errs.decisions" class="j-meta">Решения не прочитаны: {{ errs.decisions }}</p>
      <ul v-else-if="decisions.length" class="j-wait">
        <li v-for="d in decisions" :key="d.name" :data-stage="d.outcome.includes('Одобр') ? 'done' : 'todo'">
          <span class="j-wait__kind">{{ d.outcome || 'итог не записан' }}</span>
          {{ d.name }}
          <div v-if="d.by" class="j-wait__note">утвердил: {{ d.by }}</div>
        </li>
      </ul>
      <p v-else class="j-meta">Решений в срезе нет.</p>
    </section>
  </div>
</template>
