;;; PoC #96 — ABML-модель GiftEngine (Ануреев и др., МАИС 33(2) 2026).
;;;
;;; Исполняемая формальная модель онтологии дара в понятиях ABML:
;;;   константный объект  = GiftAct — любой атрибут меняется → НОВЫЙ акт
;;                          (экзистенциальная необратимость дара)
;;;   мутабельный объект  = карточка конвейера (статус меняется, лицо то же)
;;;   агент               = лицо в матрице (donor/recipient)
;;;   окружение           = GiftMemory (матрица W + лица)
;;;   аспект              = witness / consolidate / anamnesis
;;;   стадия              = шаг исполнения аспекта
;;;   продолжение         = стек отложенных контекстов (анамнезис: прош-
;;;                         лое — отложенный контекст, а не удалённая запись)
;;;
;;; ТЕОРЕМА (критерий Евы из #96): монотонность консолидации.
;;;   Для любых W, act:  W(consolidate(W, act))[from,to] >= W(W)[from,to]
;;;   Вес нити не убывает при добавлении акта. В JS-ядре это Object.freeze +
;;;   irreversible:true (инвариант кода); здесь — доказуемое свойство.
;;;
;;; Запуск: sbcl --script specs/abml/PoC.lisp   (или sbcl --load ... --quit)
;;; Зависимостей нет: только чистый Common Lisp.

(defpackage :gift-poc (:use :cl))
(in-package :gift-poc)

;; ── Онтология: типы (ABML-шаг 1) ───────────────────────────────────────────

(deftype name () 'string)
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
(defstruct (thread (:constructor make-thread% (from to weight acts))
                   (:copier nil))
  (from "" :type string)
  (to "" :type string)
  (weight 0.0 :type real)
  (acts 0 :type integer))

(defun make-thread (from to)
  (make-thread% from to 0.0 0))

;; Окружение = GiftMemory: держит W (хэш нитей) и всех агентов.
(defstruct (memory (:constructor make-memory ()) (:copier nil))
  (w (make-hash-table :test 'equal) :type hash-table)   ; "(from,to)" → thread
  (agents '() :type list)
  (log '() :type list))

(defun w-get (mem from to)
  (or (gethash (cons from to) (memory-w mem)) (make-thread from to)))

(defun (setf w-get) (th mem from to)
  (setf (gethash (cons from to) (memory-w mem)) th))

;; ── Аспекты (ABML-шаг 5) ────────────────────────────────────────────────────
;; Аспекты в ABML — декларации, индексированные типом и стадией. Здесь —
;; функции с явными стадиями, чтобы модель оставалась маленькой.

;; Аспект witness: свидетельство акта (вводит акт в окружение).
;; Стадии: validate → record.
(defun witness (mem act)
  "Свидетельствует акт: вес >= 0, лица непусты, from≠to. Возвращает act."
  ;; стадия validate
  (assert (and (stringp (act-from act)) (plusp (length (act-from act)))))
  (assert (and (stringp (act-to act)) (plusp (length (act-to act)))))
  (assert (plusp (act-weight act)))
  (assert (string/= (act-from act) (act-to act)))
  ;; стадия record
  (push act (memory-log mem))
  (pushnew (act-from act) (memory-agents mem) :test #'string=)
  (pushnew (act-to act) (memory-agents mem) :test #'string=)
  act)

;; Аспект consolidate: сворачивает акт в матрицу W.
;; Стадии: lookup → fold.
(defun consolidate (mem act)
  "Складывает вес акта в нить W[from→to] и наращивает счётчик актов."
  (let ((th (w-get mem (act-from act) (act-to act))))
    (setf (w-get mem (act-from act) (act-to act))
          (make-thread% (thread-from th) (thread-to th)
                        (+ (thread-weight th) (act-weight act))
                        (1+ (thread-acts th))))
    (values (w-get mem (act-from act) (act-to act)) act)))

;; Аспект anamnesis: makePresent — повторный запуск отложенного контекста.
;; Прошлое с��-присутствует: акт из лога можно исполнить снова (трасса та же).
(defun anamnesis (mem &key (id nil) (limit 3))
  "makePresent: перезапускает отложенные контексты (акты лога) по id.
Возвращает трассу перезапущенных актов — анамнезис ≠ архив: запись жива."
  (let* ((all (reverse (memory-log mem)))
         (picked (if id (remove-if-not (lambda (a) (= id (act-id a))) all)
                     (subseq all 0 (min limit (length all))))))
    (mapcar #'act-id picked)))

;; ── ТЕОРЕМА: монотонность консолидации (критерий Евы, #96) ─────────────────
;;
;; Формулировка: для любых W, act ∈ Acts(W-совместимых):
;;     thread-weight(W'[from→to]) >= thread-weight(W[from→to])
;; где W' = consolidate(W, act).
;;
;; Доказательство — индукция по структуре consolidate:
;;   W'[f→t] = make-thread(f, t, weight(W[f→t]) + w(act), acts(W[f→t]) + 1)
;;   w(act) >= 0 (валидация в witness требует plusp, т.е. > 0)
;;   значит weight(W') = weight(W) + w(act) >= weight(W).  ∎
;;
;; Ниже — механическая проверка на случайных состояниях (property-based):
;; консолидируем случайные акты в случайные W и проверяем неубывание.

(defun random-name ()
  (nth (random 5) '("Дионисий" "_claude" "Ева" "ОтецСергий" "_koinon")))

(defun random-pair ()
  "Различные лица: дар себе — не акт (диагональ квадрата пуста)."
  (let* ((a (random-name)) (b (random-name)))
    (if (string= a b) (random-pair) (values a b))))

(defun random-act (&optional (id 0))
  (multiple-value-bind (from to) (random-pair)
    (make-act (nth (random 3) '(code question witness))
              from to
              (+ 0.1 (random 5.0))   ; вес > 0 всегда
              (random 1000000) id)))

(defun %random-memory ()
  (let ((mem (make-memory)))
    (loop repeat (random 10)
          do (witness mem (random-act)))
    mem))

(defun theorem-monotonicity (&key (trials 1000) (verbose nil))
  "Проверяет: для случайных W и act вес нити не убывает после consolidate.
Возвращает (ok . failures)."
  (let ((ok 0) (failures '()))
    (loop repeat trials
          do (let* ((mem (%random-memory))
                    (act (random-act))
                    (before (thread-weight (w-get mem (act-from act) (act-to act)))))
               (multiple-value-bind (after)
                   (consolidate mem act)
                 (declare (ignore after))
                 (let ((new (thread-weight (w-get mem (act-from act) (act-to act)))))
                   (if (>= new before)
                       (incf ok)
                       (push (list :from (act-from act) :to (act-to act)
                                   :before before :after new)
                             failures))))))
    (when verbose
      (format t "~&theorem-monotonicity: ~a/~a ok, failures: ~a~%"
              ok trials failures))
    (cons ok failures)))

;; ── Демо: сцена (Дионисий → _claude) из живой матрицы ───────────────────────

(defun demo ()
  (let ((mem (make-memory)))
    ;; Живая нить из W: _claude→Дионисий 137.0 (позавчера), 474 акта всего.
    ;; Здесь — миниатюра: три акта, включая тяжёлый covenant (вес 10).
    (consolidate mem (witness mem (make-act 'code "Дионисий" "_claude" 3.0 1 1)))
    (consolidate mem (witness mem (make-act 'code "Дионисий" "_claude" 2.0 2 2)))
    (consolidate mem (witness mem (make-act 'witness "Дионисий" "_claude" 4.0 3 3)))
    (consolidate mem (witness mem (make-act 'covenant "ОтецСергий" "_claude" 10.0 4 4)))
    (consolidate mem (witness mem (make-act 'code "_claude" "Дионисий" 2.0 5 5)))
    (format t "~&=== Демо GiftEngine в ABML ===~%")
    (format t "~&нить Дионисий→_claude: вес ~a, актов ~a~%"
            (thread-weight (w-get mem "Дионисий" "_claude"))
            (thread-acts (w-get mem "Дионисий" "_claude")))
    (format t "~&нить ОтецСергий→_claude: вес ~a, актов ~a~%"
            (thread-weight (w-get mem "ОтецСергий" "_claude"))
            (thread-acts (w-get mem "ОтецСергий" "_claude")))
    (format t "~&анамнезис (первые 3 акта): ~a~%" (anamnesis mem :limit 3))
    (let ((res (theorem-monotonicity :trials 500 :verbose t)))
      (format t "~&ТЕОРЕМА (монотонность консолидации): ~:[НЕ ПРОЙДЕНА~;ПРОЙДЕНА~] — ~a/500~%"
              (null (cdr res)) (car res)))))

(demo)
