<script setup>
// Раздел «Рой» — нодовый пульт конвейера.
//
// Узел здесь — не украшение, а статус доски gift-koinon: карточки нельзя
// выдумать, они приходят из таблицы «Доска», которую кладёт пульс бэкофиса
// (utils/org-backoffice.mjs, cron 3:40). Поток слева направо повторяет
// настоящий путь задачи: полка → план → рой → ревью → готово.
//
// Чего здесь НЕТ и почему: перетаскивания карточек. Канал тот же, что у
// бэкофиса: ключ к PM у агента, у портала — только своя сессия на чтение
// таблиц. Живой поток карточек ведёт конвейер, человек двигает их на доске.
//
// Честность данных, как во всём журнале: рисуем ровно то, что в снапшоте.
// PM-API отдаёт не более 200 карточек за прогон — полка (их сотни) показана
// не целиком, это свойство канала, а не ошибка.
import { reactive, computed, onMounted } from 'vue'

const props = defineProps({
  bindings: { type: Object, default: () => ({}) },
  api: { type: Object, required: true },
  db: { type: String, required: true },
})

const rows = reactive({ items: [], err: '' })

// id таблицы из привязки вида 'table:7217'
const tid = () => (String(props.bindings?.board ?? '').match(/table:(\d+)/) || [])[1]

onMounted(async () => {
  const id = tid()
  if (!id) { rows.err = 'привязка board не задана'; return }
  try {
    const d = await props.api.apiFetch(`${window.location.origin}/api/v2/${props.db}/portal/api/tables/${id}/objects?limit=200`)
    const items = (Array.isArray(d) ? d : (d?.data?.items || d?.items || []))
    rows.items = items.map(r => ({
      num: String(r.value ?? r.name ?? ''),
      title: String(r.fields?.['титул'] ?? ''),
      status: String(r.fields?.['статус'] ?? ''),
      measure: String(r.fields?.['мера'] ?? ''),
      run: String(r.fields?.['прогон'] ?? ''),
    }))
  } catch (e) { rows.err = String(e.message || e) }
})

// Пять узлов = пять статусов доски конвейера. Имена машинные — их пишет
// пульс, синонимов не выдумываем.
const NODES = [
  { key: 'backlog',     title: 'Полка',  note: 'сырое' },
  { key: 'todo',        title: 'План',   note: 'ждёт тебя' },
  { key: 'in_progress', title: 'Рой',    note: 'конвейер ведёт' },
  { key: 'in_review',   title: 'Ревью',  note: 'требует взгляда' },
  { key: 'done',        title: 'Готово', note: 'за неделю' },
]

const nodes = computed(() => NODES.map(n => ({
  ...n,
  cards: rows.items.filter(c => c.status === n.key),
})))

const lastRun = computed(() => {
  const runs = rows.items.map(c => c.run).filter(Boolean).sort()
  return runs.length ? runs[runs.length - 1] : ''
})

// Мера на незакрытой карточке — потрачено впустую. Неуспех тоже стоит
// токенов, и прятать это нечестно.
const wasted = computed(() =>
  rows.items.filter(c => c.status !== 'done' && c.measure).length
)
</script>

<template>
  <section class="np-sec">
    <div class="np-head">
      <h2 class="np-title">Рой — доска конвейера <a class="np-src" href="/gift-koinon/pm">gift-koinon ↗</a></h2>
      <span v-if="lastRun" class="np-meta">прогон {{ lastRun }}</span>
    </div>

    <p v-if="rows.err" class="np-quiet">Доска не прочитана: {{ rows.err }}</p>
    <p v-else-if="!rows.items.length" class="np-quiet">Снапшота ещё нет — пульс не запускался.</p>

    <div v-else class="np-graph">
      <template v-for="(n, i) in nodes" :key="n.key">
        <div class="np-node" :class="{ 'np-node--review': n.key === 'in_review' && n.cards.length }">
          <div class="np-node__head">
            <span class="np-node__title">{{ n.title }}</span>
            <span class="np-node__count">{{ n.cards.length }}</span>
          </div>
          <div class="np-node__note">{{ n.note }}</div>
          <ul class="np-list">
            <li v-for="c in n.cards.slice(0, 4)" :key="c.num" class="np-card" :title="c.title">
              <span class="np-num">{{ c.num }}</span> {{ c.title.slice(0, 60) }}<template v-if="c.title.length > 60">…</template>
              <span v-if="c.measure" class="np-measure">{{ c.measure }}</span>
            </li>
            <li v-if="n.cards.length > 4" class="np-quiet">… ещё {{ n.cards.length - 4 }}</li>
            <li v-if="!n.cards.length" class="np-quiet">пусто</li>
          </ul>
        </div>
        <span v-if="i < nodes.length - 1" class="np-arrow" aria-hidden="true">→</span>
      </template>
    </div>

    <p class="np-foot">
      Данные кладёт пульс бэкофиса (ежедневно в 03:40). Карточки двигает
      конвейер и ты — на доске PM, портал только смотрит. PM-API отдаёт
      не более 200 карточек за прогон, полка показана не целиком.
      <template v-if="wasted"> Мера истрачена впустую на {{ wasted }} незакрытых — неуспех тоже стоит токенов.</template>
    </p>
  </section>
</template>

<style>
.np-sec { font-family: inherit; color: var(--portal-text, #1c2430); }
.np-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin: 30px 0 4px; }
.np-title { font-size: 17px; margin: 0; }
.np-src { font-size: 12px; font-weight: 400; margin-left: 8px; }
.np-meta { color: #6b7686; font-size: 12px; font-variant-numeric: tabular-nums; }
.np-quiet { color: #8a94a3; font-style: italic; font-size: 13px; }

/* Граф: пять узлов в ряд, между ними стрелки. На узком экране переносится
   строками — порядок чтения не теряется. */
.np-graph { display: flex; align-items: stretch; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.np-node { flex: 1 1 150px; min-width: 140px; max-width: 230px; padding: 10px 12px;
  border: 1px solid rgba(0,0,0,.1); border-radius: 6px; background: rgba(0,0,0,.02); }
.np-node__head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
.np-node__title { font-weight: 600; font-size: 14px; }
.np-node__count { color: #6b7686; font-size: 13px; font-variant-numeric: tabular-nums lining-nums; }
.np-node__note { color: #6b7686; font-size: 11px; margin-top: 1px; }

/* Ревью — единственный узел, где карточка ждёт человека, а не машины. */
.np-node--review { border-color: #b3261e; }

.np-list { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 3px; font-size: 12px; }
.np-card { padding: 3px 5px; border-radius: 4px; background: rgba(0,0,0,.04); line-height: 1.35; }
.np-num { color: #6b7686; font-variant-numeric: tabular-nums; margin-right: 4px; }
.np-measure { display: block; color: #6b7686; font-size: 11px; font-variant-numeric: tabular-nums; }
.np-arrow { align-self: center; color: #6b7686; }
.np-foot { max-width: 64ch; color: #6b7686; font-size: 12.5px; line-height: 1.5; margin: 10px 0 0; }
</style>
