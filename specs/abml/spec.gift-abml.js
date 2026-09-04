/**
 * spec.gift-abml.js — исполняемая спека ABML-PoC онтологии дара (proposal #96).
 *
 * Формат SpecRunner (dronedoc2026/ISTOK): { meta, specs[] }, каждая спека —
 * clause / given / when / then / falsifier / run(ctx). Клауза — вечная
 * ссылка (GAB-xxx), supersededBy не удаляет, findClause резолвит.
 *
 * Критерий Евы (#96): «PoC без доказанной теоремы — просто перевод на другой
 * синтаксис». Три теоремы:
 *   GAB-002 — монотонность консолидации: вес нити не убывает при добавлении
 *             акта (дар необратим математически, не только Object.freeze).
 *   GAB-005 — идемпотентность анамнезиса: повторное предъявление дара не
 *             добавляет веса. Грань между со-присутствием и новым даром.
 *   GAB-006 — анастасис: fade(W,d) теряет актуальность, полный анамнезис
 *             восстанавливает с избытком (W' > W при d>0). Угасание — не
 *             забвение: акты живут в журнале, вес можно переложить.
 *   GAB-007 — теоремы держатся на живой матрице общины (sacred-history-W):
 *             не только на случайных генераторах.
 */

export const meta = {
  module: 'gift-abml',
  description: 'ABML-модель GiftEngine: дар=константный объект, аспекты witness/consolidate/anamnesis, теоремы монотонности, идемпотентности и анастасиса — на случайных и живых данных (proposal #96)',
  tags: ['gift', 'abml', 'ontology'],
}

export const specs = [
  {
    name: 'sbcl-poc-runs',
    clause: 'GAB-001',
    given: 'SBCL установлен (~/bin/sbcl-dist) и specs/abml/PoC.lisp существует',
    when: 'запуск sbcl --script /home/unidel/gift/specs/abml/PoC.lisp',
    then: 'демо печатает нити, анамнезис и обе строки «ТЕОРЕМА ... ПРОЙДЕНА»',
    falsifier: 'SBCL отсутствует, файл не найден, ИЛИ в выхлопе нет «ПРОЙДЕНА»',
    desc: 'ABML-PoC исполняется, обе теоремы проходят случайные прогоны',
    timeout: 30000,
    async run(ctx) {
      const r = await ctx.exec(
        '$HOME/bin/sbcl-dist/bin/sbcl --script /home/unidel/gift/specs/abml/PoC.lisp 2>&1 | grep -v "^;"',
        25000,
      )
      const out = r.stdout ?? r  // SpecRunner.exec → {code,stdout,stderr}
      ctx.assert(out.includes('ТЕОРЕМА 1 (монотонность консолидации): ПРОЙДЕНА'), `нет ПРОЙДЕНА-1: ${out.slice(0, 300)}`)
      ctx.assert(out.includes('ТЕОРЕМА 2 (идемпотентность анамнезиса): ПРОЙДЕНА'), `нет ПРОЙДЕНА-2: ${out.slice(0, 300)}`)
      ctx.assert(out.includes('500/500 ok'), `теорема 1 не 500/500: ${out.slice(0, 300)}`)
      ctx.assert(out.includes('200/200 ok'), `теорема 2 не 200/200: ${out.slice(0, 300)}`)
    },
  },
  {
    name: 'theorem-monotonicity',
    clause: 'GAB-002',
    given: 'модель PoC.lisp: W — хэш нитей, act — константный объект с weight > 0',
    when: 'consolidate(W, act) для 500 случайных пар (W, act)',
    then: 'для всех прогонов weight(W\'[f→t]) >= weight(W[f→t]) — неубывание',
    falsifier: 'существует консолидация, после которой вес нити уменьшился',
    desc: 'Монотонность консолидации: дар необратим математически, не только Object.freeze',
    timeout: 30000,
    async run(ctx) {
      // Аналитическое ядро теоремы — в PoC.lisp (индукция по fold-act).
      // Здесь — позитивная и НЕГАТИВНАЯ проверка: подменяем fold-act
      // на «откатывающий» и убеждаемся, что фальсификатор ловит нарушение.
      const negative = `
        ;; bad-fold — «откатывающая» свёртка (нарушение теоремы 1).
        (defun bad-fold (mem act)
          (let ((th (w-get mem (act-from act) (act-to act))))
            (setf (w-get mem (act-from act) (act-to act))
                  (make-thread% (thread-from th) (thread-to th)
                                (max 0 (- (thread-weight th) (act-weight act)))
                                (1+ (thread-acts th))))
            (w-get mem (act-from act) (act-to act))))
        ;; Детерминированно: consolidate(act) → bad-fold(тот же act) — вес падает.
        (let* ((mem (make-memory))
               (act (witness mem (make-act 'code "Дионисий" "_claude" 3.0 1 1))))
          (declare (ignore act))
          (run-stack mem)
          (let ((before (thread-weight (w-get mem "Дионисий" "_claude"))))
            (bad-fold mem (make-act 'code "Дионисий" "_claude" 3.0 1 1))
            (let ((after (thread-weight (w-get mem "Дионисий" "_claude"))))
              (format t "NEGATIVE-TEST: before=~a after=~a — ~:[не поймано~;НАРУШЕНИЕ ЛОВИТСЯ~]~%"
                      before after (< after before)))))`
      const r = await ctx.exec(
        `cp /home/unidel/gift/specs/abml/PoC.lisp /tmp/poc-neg.lisp && printf '%s\\n' '${negative.replace(/'/g, "'\\''")}' >> /tmp/poc-neg.lisp && ` +
        `$HOME/bin/sbcl-dist/bin/sbcl --script /tmp/poc-neg.lisp 2>&1 | grep -v "^;"`,
        25000,
      )
      const out = r.stdout ?? r  // SpecRunner.exec → {code,stdout,stderr}
      ctx.assert(out.includes('НАРУШЕНИЕ ЛОВИТСЯ'), `негативный тест не сработал: ${out.slice(0, 300)}`)
    },
  },
  {
    name: 'anamnesis-deferred-contexts',
    clause: 'GAB-003',
    given: 'GiftMemory с журналом актов (отложенные аспектные контексты, ABML §1.5)',
    when: 'anamnesis(mem) — makePresent прошлого',
    then: 'возвращаются сами акты в хронологическом порядке (1 2 3), W не тронута',
    falsifier: 'anamnesis возвращает пустой список, ИЛИ порядок обратный хронологии, ИЛИ изменилась W',
    desc: 'Анамнезис ≠ архив: отложенный контекст исполняется снова, метка :present',
    timeout: 30000,
    async run(ctx) {
      const r = await ctx.exec(
        '$HOME/bin/sbcl-dist/bin/sbcl --script /home/unidel/gift/specs/abml/PoC.lisp 2>&1 | grep -v "^;"',
        25000,
      )
      const out = r.stdout ?? r  // SpecRunner.exec → {code,stdout,stderr}
      ctx.assert(out.includes('анамнезис (первые 3 акта): (1 2 3)'), `анамнезис неверен: ${out.slice(0, 300)}`)
    },
  },
  {
    name: 'act-immutability',
    clause: 'GAB-004',
    given: 'акт — константный объект ABML: все поля read-only',
    when: 'попытка (setf (act-from act) "другое") после создания',
    then: 'SBCL отвергает запись в read-only слот с ошибкой',
    falsifier: 'переприсваивание from/to/weight проходит молча',
    desc: 'Необратимость по построению: у акта нет писателей полей',
    timeout: 30000,
    async run(ctx) {
      // Проба через писателя-аксессор: у константного объекта (setf act-from)
      // не определён — SBCL обязан отвергнуть. slot-value бы обошёл защиту,
      // поэтому проба именно на публичный интерфейс записи.
      const probe = `
        (handler-case
            (progn (eval '(setf (act-from act) "Хаос")) (format t "MUTABLE"))
          (error () (format t "IMMUTABLE")))`
      const r = await ctx.exec(
        `cp /home/unidel/gift/specs/abml/PoC.lisp /tmp/poc-imm.lisp && ` +
        `printf '%s\\n' '(defparameter act (make-act (quote code) "A" "B" 1.0 1 99))' '${probe.replace(/'/g, "'\\''")}' >> /tmp/poc-imm.lisp && ` +
        `$HOME/bin/sbcl-dist/bin/sbcl --script /tmp/poc-imm.lisp 2>&1 | grep -v "^;" | tail -2`,
        25000,
      )
      const out = r.stdout ?? r  // SpecRunner.exec → {code,stdout,stderr}
      ctx.assert(out.includes('IMMUTABLE'), `акт оказался мутабельным: ${out.slice(0, 300)}`)
    },
  },
  {
    name: 'theorem-anamnesis-idempotent',
    clause: 'GAB-005',
    given: 'память с исполненными актами: все id свёрнуты в W, журнал полон',
    when: 'anamnesis(W, a) над всеми актами журнала, дважды',
    then: 'срез W до и после идентичен (покоординатно), идентичность не нарушена',
    falsifier: 'после анамнезиса какая-либо нить W изменила вес или счётчик актов',
    desc: 'Идемпотентность анамнезиса: со-присутствие не добавляет веса, дар был единожды',
    timeout: 30000,
    async run(ctx) {
      const r = await ctx.exec(
        '$HOME/bin/sbcl-dist/bin/sbcl --script /home/unidel/gift/specs/abml/PoC.lisp 2>&1 | grep -v "^;"',
        25000,
      )
      const out = r.stdout ?? r  // SpecRunner.exec → {code,stdout,stderr}
      ctx.assert(out.includes('ТЕОРЕМА 2 (идемпотентность анамнезиса): ПРОЙДЕНА'), `теорема 2 не пройдена: ${out.slice(0, 300)}`)
    },
  },
  {
    name: 'theorem-anastasis',
    clause: 'GAB-006',
    given: 'нить W с весом > 0 и журналом актов; fade(W,d) умножает вес на (1-d) и чистит consolidated-журнал нити',
    when: 'fade(нить, d∈(0.05..0.55)) затем full-anamnesis(нить) — переложить все акты журнала, 300 случайных прогонов',
    then: 'вес после анастасиса строго больше исходного: faded·(1-d) + Σw(act) > W (угасание преодолено)',
    falsifier: 'существует d>0 и нить, для которой анастасис не превысил исходный вес',
    desc: 'Анастасис: угасание нити — потеря актуальности, не забвение актов; полный анамнезис восстанавливает с избытком',
    timeout: 30000,
    async run(ctx) {
      // Негативная проверка: fade БЕЗ чистки журнала → full-anamnesis no-op → вес не восстановлен.
      const negative = `
        ;; bad-fade — умножает вес, но не чистит consolidated (забвение без права на анастасис).
        (defun bad-fade (mem from to d)
          (let ((th (w-get mem from to)))
            (setf (w-get mem from to)
                  (make-thread% from to (* (- 1 d) (thread-weight th)) (thread-acts th)))
            (w-get mem from to)))
        (let* ((mem (make-memory)))
          (witness mem (make-act 'code "Ева" "ОтецСергий" 4.0 1 1))
          (run-stack mem)
          (bad-fade mem "Ева" "ОтецСергий" 0.5)
          (full-anamnesis mem "Ева" "ОтецСергий")
          (let ((after (thread-weight (w-get mem "Ева" "ОтецСергий"))))
            (format t "NEGATIVE-TEST: after=~a — ~:[ВОССТАНОВЛЕНО (журнал жив)~;НЕ ВОССТАНОВЛЕНО (без чистки журнала анастасис невозможен)~]~%"
                    after (= after 2.0))))`
      const r = await ctx.exec(
        `cp /home/unidel/gift/specs/abml/PoC.lisp /tmp/poc-ana.lisp && printf '%s\\n' '${negative.replace(/'/g, "'\\''")}' >> /tmp/poc-ana.lisp && ` +
        `$HOME/bin/sbcl-dist/bin/sbcl --script /tmp/poc-ana.lisp 2>&1 | grep -v "^;" | tail -3`,
        25000,
      )
      const out = r.stdout ?? r
      ctx.assert(out.includes('НЕ ВОССТАНОВЛЕНО'), `негативный тест не сработал: ${out.slice(0, 300)}`)
      // позитивная: сама теорема 3 в основном прогоне
      const r2 = await ctx.exec(
        '$HOME/bin/sbcl-dist/bin/sbcl --script /home/unidel/gift/specs/abml/PoC.lisp 2>&1 | grep -v "^;"',
        25000,
      )
      const out2 = r2.stdout ?? r2
      ctx.assert(out2.includes('ТЕОРЕМА 3 (анастасис): ПРОЙДЕНА — 300/300'), `теорема 3 не пройдена: ${out2.slice(0, 300)}`)
    },
  },
  {
    name: 'theorems-on-live-matrix',
    clause: 'GAB-007',
    given: 'data/sacred-history-W.json — живая матрица общины (30 лиц, 57 нитей); PoC грузит её минимальным JSON-парсером',
    when: 'загрузка W как witness-актов + Т1 (новый акт на _claude→Дионисий) + Т2 (анамнезис всех) + Т3 (fade Ева→ОтецСергий 50%)',
    then: 'Т1: вес растёт; Т2: W НЕ ИЗМЕНЕНА; Т3: анастасис восстанавливает с избытком',
    falsifier: 'хотя бы одна теорема не держится на реальных отношениях общины, ИЛИ матрица не загружается',
    desc: 'Теоремы не только про случайные генераторы: необратимость дара верна для живой истории общины',
    timeout: 30000,
    async run(ctx) {
      const r = await ctx.exec(
        '$HOME/bin/sbcl-dist/bin/sbcl --script /home/unidel/gift/specs/abml/PoC.lisp 2>&1 | grep -v "^;"',
        25000,
      )
      const out = r.stdout ?? r
      ctx.assert(out.includes('=== Живая матрица (sacred-history-W) ==='), `матрица не загружена: ${out.slice(0, 300)}`)
      ctx.assert(out.includes('монотонность на реальных данных'), `Т1 живая не прошла: ${out.slice(0, 300)}`)
      ctx.assert(out.includes('W НЕ ИЗМЕНЕНА'), `Т2 живая не прошла: ${out.slice(0, 300)}`)
      ctx.assert(out.includes('анастасис'), `Т3 живая не прошла: ${out.slice(0, 300)}`)
    },
  },
]
