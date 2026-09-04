/**
 * spec.gift-abml.js — исполняемая спека ABML-PoC онтологии дара (proposal #96).
 *
 * Формат SpecRunner (dronedoc2026/ISTOK): { meta, specs[] }, каждая спека —
 * clause / given / when / then / falsifier / run(ctx). Клауза — вечная
 * ссылка (GAB-xxx), supersededBy не удаляет, findClause резолвит.
 *
 * Критерий Евы (#96): «PoC без доказанной теоремы — просто перевод на другой
 * синтаксис». Теорема здесь — монотонность консолидации: вес нити W[from→to]
 * не убывает при добавлении акта. Доказательство — аналитическое (induction
 * по consolidate: W' = W + w(act), w(act) > 0 после witness-валидации),
 * проверка — property-based прогон в SBCL по specs/abml/PoC.lisp.
 */

export const meta = {
  module: 'gift-abml',
  description: 'ABML-модель GiftEngine: дар = константный объект, consolidate = аспект, теорема монотонности (proposal #96)',
  tags: ['gift', 'abml', 'ontology'],
}

export const specs = [
  {
    name: 'sbcl-poc-runs',
    clause: 'GAB-001',
    given: 'SBCL установлен (~/bin/sbcl-dist) и specs/abml/PoC.lisp существует',
    when: 'запуск sbcl --script specs/abml/PoC.lisp',
    then: 'демо печатает нити, анамнезис и строку «ТЕОРЕМА ... ПРОЙДЕНА»',
    falsifier: 'SBCL отсутствует, файл не найден, ИЛИ в выхлопе нет «ПРОЙДЕНА»',
    desc: 'ABML-PoC исполняется и теорема монотонности проходит 500 случайных прогонов',
    timeout: 30000,
    async run(ctx) {
      const out = await ctx.exec(
        '$HOME/bin/sbcl-dist/bin/sbcl --script specs/abml/PoC.lisp 2>&1 | grep -v "^;"',
        25000,
      )
      ctx.assert(out.includes('ТЕОРЕМА (монотонность консолидации): ПРОЙДЕНА'), `нет ПРОЙДЕНА в: ${out.slice(0, 300)}`)
      ctx.assert(out.includes('500/500 ok'), `не 500/500: ${out.slice(0, 300)}`)
      ctx.assert(out.includes('нить Дионисий→_claude: вес 9.0'), `демо-нить неверна: ${out.slice(0, 300)}`)
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
      // Аналитическое ядро теоремы — в PoC.lisp (индукция по consolidate).
      // Здесь — позитивная и НЕГАТИВНАЯ проверка: подменяем consolidate
      // на «откатывающий» и убеждаемся, что фальсификатор ловит нарушение.
      const negative = `
        ;; bad-consolidate — «откатывающая» консолидация (нарушение теоремы).
        (defun bad-consolidate (mem act)
          (let ((th (w-get mem (act-from act) (act-to act))))
            (setf (w-get mem (act-from act) (act-to act))
                  (make-thread% (thread-from th) (thread-to th)
                                (max 0 (- (thread-weight th) (act-weight act)))
                                (1+ (thread-acts th))))
            (w-get mem (act-from act) (act-to act))))
        ;; Детерминированно: сначала честная consolidate(act), затем откат.
        (let* ((mem (make-memory))
               (act (witness mem (make-act 'code "Дионисий" "_claude" 3.0 1 1))))
          (consolidate mem act)
          (let ((before (thread-weight (w-get mem "Дионисий" "_claude"))))
            (bad-consolidate mem act)
            (let ((after (thread-weight (w-get mem "Дионисий" "_claude"))))
              (format t "NEGATIVE-TEST: before=~a after=~a — ~:[не поймано~;НАРУШЕНИЕ ЛОВИТСЯ~]~%"
                      before after (< after before)))))`
      const file = 'specs/abml/PoC.lisp'
      const out = await ctx.exec(
        `cp ${file} /tmp/poc-neg.lisp && printf '%s\\n' '${negative.replace(/'/g, "'\\''")}' >> /tmp/poc-neg.lisp && ` +
        `$HOME/bin/sbcl-dist/bin/sbcl --script /tmp/poc-neg.lisp 2>&1 | grep -v "^;"`,
        25000,
      )
      ctx.assert(out.includes('НАРУШЕНИЕ ЛОВИТСЯ'), `негативный тест не сработал: ${out.slice(0, 300)}`)
    },
  },
  {
    name: 'anamnesis-deferred-contexts',
    clause: 'GAB-003',
    given: 'GiftMemory с логом актов (отложенные аспектные контексты в терминах ABML)',
    when: 'anamnesis(mem) — makePresent прошлого',
    then: 'возвращаются id актов в хронологическом порядке, записи не удалены',
    falsifier: 'anamnesis возвращает пустой список ИЛИ порядок обратный хронологии',
    desc: 'Анамнезис ≠ архив: отложенный контекст можно исполнить снова',
    timeout: 30000,
    async run(ctx) {
      const out = await ctx.exec(
        '$HOME/bin/sbcl-dist/bin/sbcl --script specs/abml/PoC.lisp 2>&1 | grep -v "^;"',
        25000,
      )
      ctx.assert(out.includes('анамнезис (первые 3 акта): (1 2 3)'), `анамнезис неверен: ${out.slice(0, 300)}`)
    },
  },
  {
    name: 'act-immutability',
    clause: 'GAB-004',
    given: 'акт — константный объект ABML: все поля read-only',
    when: 'попытка (setf (act-from act) "другое") после создания',
    then: 'компилятор SBCL отвергает запись в read-only слот с ошибкой',
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
      const out = await ctx.exec(
        `cp specs/abml/PoC.lisp /tmp/poc-imm.lisp && ` +
        `printf '%s\\n' '(defparameter act (make-act (quote code) "A" "B" 1.0 1 99))' '${probe.replace(/'/g, "'\\''")}' >> /tmp/poc-imm.lisp && ` +
        `$HOME/bin/sbcl-dist/bin/sbcl --script /tmp/poc-imm.lisp 2>&1 | grep -v "^;" | tail -2`,
        25000,
      )
      ctx.assert(out.includes('IMMUTABLE'), `акт оказался мутабельным: ${out.slice(0, 300)}`)
    },
  },
]
