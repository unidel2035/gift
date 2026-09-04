;;; PoC #96 — ABML-модель GiftEngine (Ануреев и др., МАИС 33(2) 2026).
;;;
;;; Исполняемая формальная модель онтологии дара в понятиях ABML:
;;;   константный объект  = GiftAct — любой атрибут меняется → НОВЫЙ акт
;;;                          (экзистенциальная необратимость дара)
;;;   мутабельный объект  = карточка конвейера (статус меняется, лицо то же)
;;;   агент               = лицо в матрице (donor/recipient)
;;;   окружение           = GiftMemory (матрица W + лица + стек контекстов)
;;;   аспект              = witness / consolidate / anamnesis
;;;   стадия              = шаг исполнения аспекта
;;;   продолжение         = acontext-next + стек отложенных контекстов (ABML §1.4–1.5)
;;;
;;; ТЕОРЕМА 1 (кriterium Евы из #96): монотонность консолидации.
;;;   Для любых W, act: W(consolidate(W, act))[from,to] >= W(W)[from,to]
;;;   Вес нити не убывает при добавлении акта. В JS-ядре это Object.freeze +
;;;   irreversible:true (инвариант кода); здесь — доказуемое свойство.
;;;
;;; ТЕОРЕМА 2: идемпотентность анамнезиса.
;;;   anamnesis(W, a) = W для уже исполненного акта a. Повторное предъявление
;;;   дара не добавляет веса: дар был единожды. Формальная грань между
;;;   анамнезисом (со-присутствие) и новым даром (weight строго растёт).
;;;
;;; Запуск: sbcl --script specs/abml/PoC.lisp
;;; Зависимостей нет: только чистый Common Lisp.

(defpackage :gift-poc (:use :cl))
(in-package :gift-poc)

;; ── Онтология: типы (ABML-шаг 1) ───────────────────────────────────────────

(deftype weight () '(satisfies nonneg-p))
(defun nonneg-p (x) (and (realp x) (>= x 0)))

;; Константный объект ABML: атрибуты read-only, изменение = новый объект.
;; Дар необратим по построению: нет писателей полей, кроме конструктора.
(defstruct (act (:constructor make-act (type from to weight timestamp id))
                (:predicate actp) (:copier nil))
  (type 'code :type symbol :read-only t)   ; code|question|covenant|witness...
  (from "" :type string :read-only t)
  (to   "" :type string :read-only t)
  (weight 1.0 :type real :read-only t)
  (timestamp 0 :type integer :read-only t)
  (id 0 :type integer :read-only t))

;; Мутабельный объект: статус меняется, идентичность сохраняется.
(defstruct (card (:constructor make-card (name status)) (:copier nil))
  (name "" :type string)
  (status 'open :type symbol))

;; Нить: мутабельный агрегат весов константных актов.
(defstruct (thread (:constructor make-thread% (from to weight acts)) (:copier nil))
  (from "" :type string)
  (to "" :type string)
  (weight 0.0 :type real)
  (acts 0 :type integer))

(defun make-thread (from to)
  (make-thread% from to 0.0 0))

;; Окружение = GiftMemory: W (хэш нитей), агенты, журнал актов, стек
;; отложенных аспектных контекстов, журнал консолидации (id → T).
(defstruct (memory (:constructor make-memory ()) (:copier nil))
  (w (make-hash-table :test 'equal) :type hash-table)   ; (from . to) → thread
  (agents '() :type list)
  (log '() :type list)                                  ; хронология: новейшие в голове
  (stack '() :type list)                                ; отложенные acontext'ы (ABML §1.5)
  (consolidated (make-hash-table) :type hash-table))    ; id актов, свёрнутых в W

(defun w-get (mem from to)
  (or (gethash (cons from to) (memory-w mem)) (make-thread from to)))

(defun (setf w-get) (th mem from to)
  (setf (gethash (cons from to) (memory-w mem)) th))

;; ── Продолжения: аспектные контексты (ABML §1.4–1.5) ────────────────────────
;;
;; Окружение держит стек отложенных аспектных контекстов (acontexts);
;; eval-acontext запускает контекст, acontext-next задаёт продолжение.
;; Анамнезис = повторный запуск отложенного контекста: прошлое — не
;; удалённая запись, а контекст, который можно исполнить снова.

;; Аспектный контекст — константный объект: aspect / stage / act (instance).
(defstruct (acontext (:constructor make-acontext (aspect stage act)) (:copier nil))
  (aspect 'witness :type symbol :read-only t)  ; witness | anamnesis
  (stage 'nil :read-only t)                    ; nil | record | consolidate | present
  (act nil :read-only t))

;; Продолжение (acontext-next): nil → record → consolidate → stop.
(defun acontext-next (ac)
  (case (acontext-stage ac)
    ((nil) (make-acontext (acontext-aspect ac) 'record (acontext-act ac)))
    (record (make-acontext (acontext-aspect ac) 'consolidate (acontext-act ac)))
    (otherwise 'stop)))

;; Свёртка акта в W — идемпотентна по id: дар был единожды, повторный
;; запуск (анамнезис) матрицу не раздувает (теорема 2).
(defun fold-act (mem act)
  (let ((th (w-get mem (act-from act) (act-to act))))
    (unless (gethash (act-id act) (memory-consolidated mem))
      (setf (w-get mem (act-from act) (act-to act))
            (make-thread% (thread-from th) (thread-to th)
                          (+ (thread-weight th) (act-weight act))
                          (1+ (thread-acts th)))
            (gethash (act-id act) (memory-consolidated mem)) t)
      (pushnew (act-from act) (memory-agents mem) :test #'string=)
      (pushnew (act-to act) (memory-agents mem) :test #'string=))
    (w-get mem (act-from act) (act-to act))))

;; Запуск аспектного контекста (eval-acontext): тело стадии + продолжение.
(defun eval-acontext (ac mem)
  (ecase (acontext-aspect ac)
    (witness
     (ecase (acontext-stage ac)
       ((nil) (eval-acontext (acontext-next ac) mem))
       (record (push (acontext-act ac) (memory-log mem))
               (eval-acontext (acontext-next ac) mem))
       (consolidate (fold-act mem (acontext-act ac)))))
    (anamnesis
     (ecase (acontext-stage ac)
       ((nil) (eval-acontext (make-acontext 'anamnesis 'present (acontext-act ac)) mem))
       (present (values (acontext-act ac) :present))))))

;; ── Аспекты (ABML-шаг 5) ────────────────────────────────────────────────────

;; Аспект witness: валидирует акт и ОТКЛАДЫВАЕТ его контекст в стек
;; окружения. Исполнение — отдельный запуск (eval-acontext), как в ABML.
;; Стадии: validate → record → consolidate.
(defun witness (mem act)
  "Свидетельствует акт: лица непусты, вес > 0, from≠to. Контекст откладывается."
  (assert (plusp (length (act-from act))))
  (assert (plusp (length (act-to act))))
  (assert (plusp (act-weight act)))
  (assert (string/= (act-from act) (act-to act)))
  (push (make-acontext 'witness nil act) (memory-stack mem))
  act)

;; Исполнить все отложенные контексты (дренаж стека).
(defun run-stack (mem)
  "Дренаж стека в порядке свидетельствования (FIFO): журнал = хронология."
  (loop for ac in (reverse (memory-stack mem))
        do (eval-acontext ac mem))
  (setf (memory-stack mem) '())
  mem)

;; Аспект consolidate (драйвер): прямой запуск стадии consolidate.
(defun consolidate (mem act)
  "Складывает вес акта в нить W[from→to]; повтор по тому же id — no-op."
  (fold-act mem act))

;; Аспект anamnesis: makePresent — повторный запуск отложенного контекста.
;; Возвращает (values ids acts): акты снова настоящие, W не тронута.
(defun anamnesis (mem &key (limit 3))
  "makePresent: перезапускает отложенные контексты (акты журнала).
Возвращает (ids acts). Анамнезис ≠ архив: запись жива, контекст исполняем."
  (let* ((chrono (reverse (memory-log mem)))
         (picked (subseq chrono 0 (min limit (length chrono)))))
    (values (mapcar #'act-id picked)
            (mapcar (lambda (a) (eval-acontext (make-acontext 'anamnesis nil a) mem))
                    picked))))

;; ── ТЕОРЕМА 1: монотонность консолидации (критерий Евы, #96) ───────────────
;;
;; Формулировка: для любых W и act (валидного по witness):
;;     thread-weight(W'[f→t]) >= thread-weight(W[f→t]),  W' = consolidate(W, act)
;; Доказательство — структурная индукция по fold-act:
;;   W'[f→t] = make-thread(f, t, weight(W[f→t]) + w(act), acts(W[f→t]) + 1)
;;   w(act) > 0 (валидация в witness: plusp)
;;   значит weight(W') = weight(W) + w(act) > weight(W).  ∎
;;
;; Механическая проверка — property-based, случайные W и акты.

(defun random-name ()
  (nth (random 5) '("Дионисий" "_claude" "Ева" "ОтецСергий" "_koinon")))

(defun random-pair ()
  "Различные лица: дар себе — не акт (диагональ квадрата пуста)."
  (let* ((a (random-name)) (b (random-name)))
    (if (string= a b) (random-pair) (values a b))))

(defparameter *act-id* 0)

(defun random-act (&optional id)
  (multiple-value-bind (from to) (random-pair)
    (make-act (nth (random 3) '(code question witness))
              from to
              (+ 0.1 (random 5.0))   ; вес > 0 всегда
              (random 1000000)
              (or id (incf *act-id*)))))   ; id уникальны — идемпотентность честная

(defun %random-memory ()
  "Случайная память: witness'ы исполнены (стек дренажен, W построена)."
  (let ((mem (make-memory)))
    (loop repeat (1+ (random 10))
          do (witness mem (random-act)))
    (run-stack mem)))

(defun theorem-monotonicity (&key (trials 1000) (verbose nil))
  "Случайные W и act: вес нити не убывает после consolidate. → (ok . failures)"
  (let ((ok 0) (failures '()))
    (loop repeat trials
          do (let* ((mem (%random-memory))
                    (act (random-act))
                    (f (act-from act)) (t. (act-to act))
                    (before (thread-weight (w-get mem f t.))))
               (consolidate mem act)
               (let ((after (thread-weight (w-get mem f t.))))
                 (if (>= after before)
                     (incf ok)
                     (push (list f t. before after) failures)))))
    (when verbose
      (format t "~&theorem-monotonicity: ~a/~a ok, failures: ~a~%" ok trials failures))
    (cons ok failures)))

;; ── ТЕОРЕМА 2: идемпотентность анамнезиса ──────────────────────────────────
;;
;; Формулировка: для любой памяти W и исполненного акта a ∈ log(W):
;;     W(anamnesis(W, a)) = W  (покоординатно: все нити неизменны).
;; Доказательство: anamnesis запускает контекст аспекта anamnesis, чьи
;; стадии (nil → present) не пишут ни в W, ни в consolidated (см.
;; eval-acontext: ветка anamnesis не вызывает fold-act).  ∎
;;
;; П��оверка: строим память, фиксируем срез всех нитей, гоняем anamnesis
;; над всеми актами журнала, сравниваем срезы.

(defun snapshot-w (mem)
  "Срез матрицы: список (from to weight acts) для всех нитей."
  (let ((rows '()))
    (maphash (lambda (k th)
               (push (list (car k) (cdr k) (thread-weight th) (thread-acts th)) rows))
             (memory-w mem))
    (sort rows #'string< :key #'car)))

(defun theorem-anamnesis-idempotent (&key (trials 200) (verbose nil))
  "Случайные памяти: anamnesis над всеми актами не меняет W. → (ok . failures)"
  (let ((ok 0) (failures '()))
    (loop repeat trials
          do (let* ((mem (%random-memory))
                    (before (snapshot-w mem)))
               (anamnesis mem :limit (length (memory-log mem)))
               ;; и повторно, для полноты: два анамнезиса подряд
               (anamnesis mem :limit (length (memory-log mem)))
               (let ((after (snapshot-w mem)))
                 (if (equal before after)
                     (incf ok)
                     (push (list :before before :after after) failures)))))
    (when verbose
      (format t "~&theorem-anamnesis-idempotent: ~a/~a ok, failures: ~a~%"
              ok trials failures))
    (cons ok failures)))

;; ── Демо: сцена (Дионисий → _claude) из живой матрицы ───────────────────────

(defun demo ()
  (let ((mem (make-memory)))
    ;; Живая нить из W: _claude→Дионисий 137.0 (на 04.09), 474 акта всего.
    ;; Здесь — миниатюра: пять актов, включая тяжёлый covenant (вес 10).
    (witness mem (make-act 'code "Дионисий" "_claude" 3.0 1 1))
    (witness mem (make-act 'code "Дионисий" "_claude" 2.0 2 2))
    (witness mem (make-act 'witness "Дионисий" "_claude" 4.0 3 3))
    (witness mem (make-act 'covenant "ОтецСергий" "_claude" 10.0 4 4))
    (witness mem (make-act 'code "_claude" "Дионисий" 2.0 5 5))
    (run-stack mem)
    (format t "~&=== Демо GiftEngine в ABML ===~%")
    (format t "~&нить Дионисий→_claude: вес ~a, актов ~a~%"
            (thread-weight (w-get mem "Дионисий" "_claude"))
            (thread-acts (w-get mem "Дионисий" "_claude")))
    (format t "~&нить ОтецСергий→_claude: вес ~a, актов ~a~%"
            (thread-weight (w-get mem "ОтецСергий" "_claude"))
            (thread-acts (w-get mem "ОтецСергий" "_claude")))
    ;; идемпотентность: тот же акт ещё раз в consolidate — вес не растёт
    (let ((th (w-get mem "Дионисий" "_claude")))
      (consolidate mem (make-act 'code "Дионисий" "_claude" 99.0 6 1)) ; id=1 повторно
      (format t "~&повторный consolidate (id=1, вес 99): вес ~a (не ~a) — идемпотентно~%"
              (thread-weight (w-get mem "Дионисий" "_claude")) 99.0))
    ;; анамнезис: возвращает сами акты, W не тронута
    (multiple-value-bind (ids acts)
        (anamnesis mem :limit 3)
      (declare (ignore acts))
      (format t "~&анамнезис (первые 3 акта): ~a — контексты снова настоящие~%" ids))
    (let ((res1 (theorem-monotonicity :trials 500 :verbose t))
          (res2 (theorem-anamnesis-idempotent :trials 200 :verbose t)))
      (format t "~&ТЕОРЕМА 1 (монотонность консолидации): ~:[НЕ ПРОЙДЕНА~;ПРОЙДЕНА~] — ~a/500~%"
              (null (cdr res1)) (car res1))
      (format t "~&ТЕОРЕМА 2 (идемпотентность анамнезиса): ~:[НЕ ПРОЙДЕНА~;ПРОЙДЕНА~] — ~a/200~%"
              (null (cdr res2)) (car res2)))))

(demo)
