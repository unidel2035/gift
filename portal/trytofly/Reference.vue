<script setup>
// Раздел «Справка» — всё справочное с прежней главной, свёрнутое до заголовков.
//
// ЗАЧЕМ СВЁРНУТО. Прежняя главная держала восемь секций одинаковой плотности,
// и «Портфель» стоял вровень с «ждёт тебя». Справка нужна реже пульса, и
// потому живёт раскрытием: заголовок и счётчик видны всегда, содержимое — по
// клику. Стандартный <details> без скриптов: свёрнутое состояние — свойство
// браузера, а не нашей логики, и оно переживёт любую перезагрузку.
//
// ПОРЯДОК РАЗДЕЛОВ — по частоте обращения, а не по порядку таблиц: журнал,
// решения, портфель, люди, полка.
//
// СТИЛИ — только имена из общей таблицы журнала (Nav.vue); правила для
// <details> добавлены туда же. Данные — тем же портальным каналом, что у
// Пульта. Хвосты сессий не дублируются: непокрытые показаны на Пульте в
// «ждёт тебя», здесь только сводный счёт.
import { reactive, computed, onMounted } from 'vue'
import { fmtDate } from '@kit'
import Nav from './Nav.vue'

const props = defineProps({
  bindings: { type: Object, default: () => ({}) },
  api: { type: Object, required: true },
  db: { type: String, required: true },
})

const tables = reactive({ portfolio: [], shelf: [], people: [], sessions: [], decisions: [] })
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

// Хвосты считаются по тому же правилу, что и на Пульте (и в пульсе): «не
// закрыто» непусто и не начинается с «ЗАКРЫТО:». Граница слова — взгляд
// «вперёд не-буква», потому что \b не определён для кириллицы. Здесь нужен
// только счёт.
const tailCount = computed(() => {
  let n = 0
  for (const r of tables.sessions) {
    const t = String(f(r, 'не закрыто') ?? '').trim()
    if (t && !/^закрыто(?![а-яё])/i.test(t)) n++
  }
  return n
})

const spots = computed(() =>
  tables.shelf.filter(r => String(f(r, 'ярлыки') ?? '').includes('белое-пятно'))
)
const restShelf = computed(() =>
  tables.shelf.filter(r => !String(f(r, 'ярлыки') ?? '').includes('белое-пятно'))
)

const recentDecisions = computed(() =>
  tables.decisions.slice(-5).reverse().map(r => ({
    name: r.name,
    решение: String(f(r, 'решение') ?? ''),
  }))
)
</script>

<template>
  <div class="j-page">
    <Nav :db="db" here="home" />
    <!-- Nav стоит только здесь: на главной два модуля (Пульт и Справка), и
         навигация от второго задвоила бы её. -->
    <h1 class="j-ref__title">Справка</h1>
    <p class="j-pult__sub">
      Снапшот кладёт пульс бэкофиса (ежедневно в 03:40). Здесь журналы — они
      нужны реже пульса, поэтому свёрнуты: раскрой нужный.
    </p>

    <details class="j-ref">
      <summary>
        Журнал сессий <span class="j-ref__count">{{ tables.sessions.length || '—' }}</span>
        <span v-if="tailCount" class="j-ref__flag">{{ tailCount }} хвостов</span>
      </summary>
      <div class="j-ref__body">
        <ul class="j-list">
          <li v-for="r in [...tables.sessions].reverse().slice(0, 12)" :key="r.name">
            <span class="j-when">{{ fmtDate(f(r, 'дата')) }}</span>
            <span v-if="f(r, 'тип')" class="j-kind" :data-kind="String(f(r, 'тип'))">{{ f(r, 'тип') }}</span>
            {{ r.name }}
          </li>
        </ul>
        <p class="j-meta">Последние 12. Полный журнал — в разделе «Сессии»; незакрытые хвосты — на Пульте.</p>
      </div>
    </details>

    <details class="j-ref">
      <summary>Свежие решения <span class="j-ref__count">{{ tables.decisions.length || '—' }}</span></summary>
      <div class="j-ref__body">
        <ul v-if="recentDecisions.length" class="j-list">
          <li v-for="d in recentDecisions" :key="d.name">
            <strong>{{ d.name }}</strong>
            <div class="j-ref__tail">{{ d.решение.slice(0, 200) }}<template v-if="d.решение.length > 200">…</template></div>
          </li>
        </ul>
        <p v-if="!recentDecisions.length" class="j-meta">Пока нет решений в журнале.</p>
        <p v-if="recentDecisions.length" class="j-meta">Последние 5. Полный перечень — в разделе «Решения».</p>
      </div>
    </details>

    <details class="j-ref">
      <summary>Портфель организации <span class="j-ref__count">{{ tables.portfolio.length || '—' }}</span></summary>
      <div class="j-ref__body">
        <table v-if="tables.portfolio.length" class="j-tbl">
          <thead><tr><th>воркспейс</th><th>всего</th><th>готово</th><th>в работе</th><th>просрочено</th><th>прогресс</th></tr></thead>
          <tbody>
            <tr v-for="w in tables.portfolio" :key="w.name">
              <td><a class="j-link" :href="`/${f(w, 'воркспейс') || 'gift-koinon'}/pm`">{{ w.name }}</a></td>
              <td class="j-tbl__num">{{ f(w, 'всего') }}</td>
              <td class="j-tbl__num">{{ f(w, 'готово') }}</td>
              <td class="j-tbl__num">{{ f(w, 'в работе') }}</td>
              <td class="j-tbl__num" :class="{ 'j-tbl__late': String(f(w, 'просрочено') ?? '') !== '' }">{{ f(w, 'просрочено') || '—' }}</td>
              <td class="j-tbl__num">{{ f(w, 'прогресс') }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="j-meta">{{ errs.portfolio ? 'Портфель не прочитан: ' + errs.portfolio : 'Снапшота ещё нет — пульс не запускался.' }}</p>
      </div>
    </details>

    <details class="j-ref">
      <summary>Люди <span class="j-ref__count">{{ tables.people.length || '—' }}</span></summary>
      <div class="j-ref__body">
        <table v-if="tables.people.length" class="j-tbl">
          <thead><tr><th>кто</th><th>открыто</th><th>просрочено</th></tr></thead>
          <tbody>
            <tr v-for="u in tables.people" :key="u.name">
              <td>{{ u.name }}</td>
              <td class="j-tbl__num">{{ f(u, 'открыто') }}</td>
              <td class="j-tbl__num" :class="{ 'j-tbl__late': String(f(u, 'просрочено') ?? '') !== '' }">{{ f(u, 'просрочено') || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="j-meta">Снапшота людей ещё нет.</p>
      </div>
    </details>

    <details class="j-ref">
      <summary>Полка бэкофиса <span class="j-ref__count">{{ restShelf.length || '—' }}</span></summary>
      <div class="j-ref__body">
        <ul class="j-list">
          <li v-for="r in restShelf" :key="r.name">
            <span class="j-ref__status">{{ f(r, 'статус') }}</span> {{ r.name }}
          </li>
          <li v-if="!restShelf.length" class="j-meta">Полка пуста.</li>
        </ul>
      </div>
    </details>

    <details class="j-ref">
      <summary>Белые пятна <span class="j-ref__count">{{ spots.length || '—' }}</span></summary>
      <div class="j-ref__body">
        <ul class="j-list">
          <li v-for="r in spots" :key="r.name">
            {{ r.name.replace(/^белое пятно:\s*/, '') }}
          </li>
          <li v-if="!spots.length" class="j-meta">Пятен нет — пульс молчит, когда всё закрыто.</li>
        </ul>
        <p v-if="spots.length" class="j-meta">Незакрытое из этого списка показано на Пульте в «ждёт тебя».</p>
      </div>
    </details>
  </div>
</template>
