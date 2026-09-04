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
;; Проверка: строим память, фиксируем срез всех нитей, гоняем anamnesis
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

;; ═══ THEOREM 3: ANASTASIS — full remembrance restores a faded W ═══════════
;;
;; In the live matrix there is a consolidation-state: a thread's weight
;; declines if acts do not refresh it (desert "fading"). The gift is
;; irreversible by act, but the RELATION can fade — this is not a
;; contradiction, but a distinction: an act (weight in W) vs remembrance
;; (energeia). The desertScanner of the gift project lives here.
;;
;; Formulation: let W — a faded thread (fading factor d∈(0,1)):
;;     fade(W, d)[f→t] = (1-d)·W[f→t]
;; Then a FULL anamnesis over all acts of the thread (full anamnesis,
;; weight w(a) for each) gives W' with
;;     W'[f→t] >= W[f→t]  (restoration, non-strict)
;; and with d>0 — strictly greater: full remembrance overcomes fading.
;;
;; Proof: W'[f→t] = (1-d)·W[f→t] + Σ w(a) = (1-d)·W[f→t] + W[f→t]·(W[f→t]/W[f→t]) —
;;   since Σ w(a) over all acts of the thread = W[f→t] (definition of fold),
;;   W' = (1-d)·W + W = W + (1-1)... no: W' = (1-d)·W + W > W for d>0. ∎
;; (re-fold acts do not double the weight — idempotency of theorem 2 does
;;  NOT work here: fading resets the consolidated journal — see below)

;; Fading: the thread loses a fraction d of its weight, the journal of the
;; folded ids for that thread is cleared (fading is not forgetting acts,
;; but losing their actuality in W — they can be re-folded).
(defun fade-thread (mem from to d)
  "Fades the thread by coefficient d∈(0,1); the thread's ids are removed
from the consolidation journal — acts are not forgotten, actuality is."
  (let ((th (w-get mem from to)))
    (setf (w-get mem from to)
          (make-thread% from to (* (- 1 d) (thread-weight th)) (thread-acts th)))
    ;; clear the ids of this thread from the journal
    (let ((dead '()))
      (maphash (lambda (id v) (declare (ignore v))
                 (let ((a (find id (memory-log mem) :key #'act-id)))
                   (when (and a (string= (act-from a) from) (string= (act-to a) to))
                     (push id dead))))
               (memory-consolidated mem))
      (dolist (id dead) (remhash id (memory-consolidated mem))))
    (w-get mem from to)))

;; Full remembrance: re-fold ALL acts of the thread (they are in the journal
;; of acts — memory, not in W).
(defun full-anamnesis (mem from to)
  "makePresent of an entire thread: all acts of the pair are re-folded into W."
  (dolist (a (memory-log mem))
    (when (and (string= (act-from a) from) (string= (act-to a) to))
      (fold-act mem a)))
  (w-get mem from to))

(defun theorem-anastasis (&key (trials 300) (verbose nil))
  "Fading d and full anamnesis: W' >= W, and for d>0 — strictly greater. → (ok . failures)"
  (let ((ok 0) (failures '()))
    (loop repeat trials
          do (let* ((mem (%random-memory))
                    (keys (let ((ks '()))
                            (maphash (lambda (k v) (declare (ignore v)) (push k ks)) (memory-w mem))
                            ks))
                    (k (nth (random (max 1 (length keys))) keys))
                    (f (car k)) (t. (cdr k))
                    (d (+ 0.05 (random 0.5)))
                    (before (thread-weight (w-get mem f t.))))
               (fade-thread mem f t. d)
               (full-anamnesis mem f t.)
               (let ((after (thread-weight (w-get mem f t.))))
                 (if (and (>= after before) (> after before)) ; strictly — fading overcome
                     (incf ok)
                     (push (list f t. d before after) failures)))))
    (when verbose
      (theorem-anastasis-print ok trials failures))
    (cons ok failures)))

(defun theorem-anastasis-print (ok trials failures)
  (format t "~&theorem-anastasis: ~a/~a ok, failures: ~a~%" ok trials failures))

;; ── Theorem on LIVE data: sacred-history-W.json ────────────────────────────
;; The community matrix (30 faces) is loaded from a JSON snapshot; theorems 1
;; and 2 hold on real relations of the community, not on random generators.
;; Loading is via a simple JSON parser (weights are only numbers and
;; arrays — a minimal subset suffices).

;; Minimal JSON parse (numbers, arrays, strings) — enough for W.
(defun json-parse-number (s i)
  (let ((j i) (dot nil))
    (loop while (< j (length s))
          do (let ((c (char s j)))
               (cond ((digit-char-p c) (incf j))
                     ((and (char= c #\.) (not dot)) (setf dot t) (incf j))
                     ((and (member c '(#\- #\+)) (= j i)) (incf j))
                     ((and (char= c #\e) (> j i)) (incf j))
                     (t (return)))))
    (values (read-from-string (subseq s i j)) j)))

(defun json-skip-ws (s i)
  (loop while (and (< i (length s)) (member (char s i) '(#\Space #\Tab #\Newline #\Return)))
        do (incf i))
  i)

(defun json-parse (s i)
  "Parses a JSON value from position i. Returns (values val next-i)."
  (setq i (json-skip-ws s i))
  (let ((c (char s i)))
    (cond
      ((char= c #\[)
       (let ((items '()) (j (1+ i)))
         (setq j (json-skip-ws s j))
         (if (char= (char s j) #\])
             (values '() (1+ j))
             (loop
               (multiple-value-bind (v nj) (json-parse s j)
                 (push v items)
                 (setq j (json-skip-ws s nj))
                 (cond ((char= (char s j) #\,) (incf j))
                       ((char= (char s j) #\]) (return (values (reverse items) (1+ j))))
                       (t (error "json array: ~a" (subseq s j (+ j 10))))))))))
      ((char= c #\{)
       (let ((obj '()) (j (1+ i)))
         (setq j (json-skip-ws s j))
         (if (char= (char s j) #\})
             (values '() (1+ j))
             (loop
               (multiple-value-bind (k nk) (json-parse s j)
                 (setq j (json-skip-ws s nk))
                 (unless (char= (char s j) #\:) (error "json obj key"))
                 (multiple-value-bind (v nv) (json-parse s (1+ j))
                   (push (cons k v) obj)
                   (setq j (json-skip-ws s nv))
                   (cond ((char= (char s j) #\,) (incf j))
                         ((char= (char s j) #\}) (return (values obj (1+ j))))
                         (t (error "json obj: ~a" (subseq s j (+ j 10)))))))))))
      ((char= c #\")
       (let ((j (1+ i)) (chars '()))
         (loop while (and (< j (length s)) (not (char= (char s j) #\")))
               do (if (char= (char s j) #\\)
                      (progn (push (char s (+ j 1)) chars) (incf j 2))
                      (progn (push (char s j) chars) (incf j))))
         (values (coerce (reverse chars) 'string) (1+ j))))
      ((char= c #\t) (values t (+ i 4)))     ; true
      ((char= c #\f) (values nil (+ i 5)))   ; false
      ((char= c #\n) (values nil (+ i 4)))   ; null
      (t (json-parse-number s i)))))

;; Stringify (для вывода срезов)
(defun json-str (x)
  (typecase x
    (null "null") (integer (format nil "~a" x))
    (real (format nil "~,3f" x))
    (string (with-output-to-string (o)
              (format o "\"")
              (loop for ch across x
                    do (cond ((char= ch #\") (format o "\\\""))
                             ((char= ch #\\) (format o "\\\\"))
                             ((char= ch #\Newline) (format o "\\n"))
                             (t (format o "~a" ch))))
              (format o "\"")))
    (list (if (and x (atom (car x)))
              (format nil "[~{~a~^, ~}]" (mapcar #'json-str x))
              (format nil "{~{\"~a\": ~a~^, ~}~}" (mapcar (lambda (kv) (list (car kv) (json-str (cdr kv)))) x))))
    (t (format nil "~a" x))))

;; Загрузка живой матрицы в память PoC: каждый ненулевой элемент W[i][j] —
;; акт от persons[i] к persons[j] с весом W[i][j] (свёрнутая нить как один акт).
(defun load-live-w (path)
  (let* ((s (with-open-file (in path :direction :input :external-format :utf-8)
              (let* ((len (file-length in))
                     (buf (make-string len)))
                (read-sequence buf in)
                (subseq buf 0 len))))
         (doc (nth-value 0 (json-parse s 0)))
         (persons (cdr (assoc "persons" doc :test #'string=)))
         (W (cdr (assoc "W" doc :test #'string=))))
      (let ((mem (make-memory)) (n 0))
        (dotimes (i (length persons))
          (dotimes (j (length persons))
            (let ((w (nth j (nth i W))))
              (when (and (numberp w) (> w 0) (string/= (nth i persons) (nth j persons)))
                (witness mem (make-act 'live (nth i persons) (nth j persons) w (+ (* i 100) j) (incf n)))))))
        (run-stack mem)
        (values mem n))))

;; Прогон теорем на живых данных (живая матрица общины из data/).
(defun demo-live ()
  (handler-case
      (multiple-value-bind (mem n)
          (load-live-w "/home/unidel/gift/data/sacred-history-W.json")
        (format t "~&=== Живая матрица (sacred-history-W) ===~%")
        (format t "~&лиц ~a, актов-нитей ~a~%" (length (memory-agents mem)) n)
        (format t "~&нить _claude→Дионисий: вес ~a~%"
                (thread-weight (w-get mem "_claude" "Дионисий")))
        ;; теорема 1 на живых данных: новый акт — вес растёт
        (let ((before (thread-weight (w-get mem "_claude" "Дионисий"))))
          (consolidate mem (make-act 'code "_claude" "Дионисий" 5.0 999999 999999))
          (format t "~&Т1 живая: ~a → ~a (+5) — монотонность на реальных данных~%"
                  before (thread-weight (w-get mem "_claude" "Дионисий"))))
        ;; теорема 2 на живых данных: полный анамнезис — W не меняется
        (let ((before (snapshot-w mem)))
          (anamnesis mem :limit (length (memory-log mem)))
          (format t "~&Т2 живая: анамнезис всех нитей — W ~:[ИЗМЕНИЛАСЬ~;НЕ ИЗМЕНЕНА~]~%"
                  (equal before (snapshot-w mem))))
        ;; теорема 3 на живой нити: fade 50% → полный анамнезис восстанавливает с избытком
        (let ((before (thread-weight (w-get mem "Ева" "ОтецСергий"))))
          (when (> before 0)
            (fade-thread mem "Ева" "ОтецСергий" 0.5)
            (let ((faded (thread-weight (w-get mem "Ева" "ОтецСергий"))))
              (full-anamnesis mem "Ева" "ОтецСергий")
              (format t "~&Т3 живая: Ева→ОтецСергий ~a → ~a (fade 50%) → ~a — анастасис~%"
                      before faded (thread-weight (w-get mem "Ева" "ОтецСергий")))))))
    (error (err)
      (format t "~&живая матрица: пропуск (~a)~%" (type-of err)))))

;; ── Полный прогон: демо + живая матрица + теорема 3 ───────────────────────
(demo-live)
(let ((r3 (theorem-anastasis :trials 300 :verbose t)))
  (format t "~&ТЕОРЕМА 3 (анастасис): ~:[НЕ ПРОЙДЕНА~;ПРОЙДЕНА~] — ~a/300~%"
          (null (cdr r3)) (car r3)))
