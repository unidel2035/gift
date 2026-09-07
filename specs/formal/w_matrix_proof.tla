(*
  w_matrix_proof.tla — W-матрица онтологии дара: МЕХАНИЧЕСКИЕ ДОКАЗАТЕЛЬСТВА.

  w_matrix.tla проверяет аксиомы перебором (TLC, до границы глубины 3).
  Здесь те же аксиомы доказываются БЕЗ границы — TLAPS + Z3/Zenon
  + библиотека SequenceTheorems.

  Разница богословская: перебор говорит «во всех исполнениях, что я
  успел посмотреть»; доказательство говорит «во всех исполнениях,
  которые вообще возможны».

  СТАТУС (TLAPS 1.5.0):
    ДОКАЗАНО: InitType, NextType, NextNoSelf, WeightAllPos.
    СФОРМУЛИРОВАНО, НО НЕДОКАЗУЕМО в TLAPS 1.5: WOfEmpty, WOfAppend,
    MonotoneStep (критерий Евы #96). Причина: рекурсивные определения
    (WOf = сумма по Tail) переводятся в CHOOSE, который SMT-бэкенды
    не раскрывают; Zenon — exhausted. Монотонность ПОЛНОСТЬЮ проверена
    TLC (перебором до границы) и доказана вручную в PoC.lisp (#96);
    TLAPS-доказательство требует переопределения суммы через
    [domain -> Nat]-свидетеля — кандидат в будущие сессии.
*)
--------------------------- MODULE w_matrix_proof ---------------------------
EXTENDS Naturals, Sequences, TLAPS
INSTANCE SequenceTheorems

FaceSet == {"Дионисий", "ОтецСергий", "_claude", "Ева", "_koinon"}

ActTypes == {"code", "insight", "time", "money", "covenant", "grace"}

ActSet == [from: FaceSet, to: FaceSet, type: ActTypes]

Weight(t) ==
    CASE t = "time"     -> 10
      [] t = "money"    -> 3
      [] t = "covenant" -> 10
      [] OTHER          -> 1

(* Вес нити (f1 -> f2) в хронике: сумма по индексам — нерекурсивно,
   каждая точка хроники вносит свой вклад независимо. SMT дружит. *)
F(f1, f2, a) == IF a.from = f1 /\ a.to = f2 THEN Weight(a.type) ELSE 0

WOf(chronicle, f1, f2) ==
    LET S[seq \in Seq(ActSet)] ==
            IF seq = << >> THEN 0 ELSE F(f1, f2, Head(seq)) + S[Tail(seq)]
    IN S[chronicle]

VARIABLE acts

Init == acts = << >>

Give(a) ==
    /\ a \in ActSet
    /\ a.from # a.to
    /\ acts' = Append(acts, a)

Next == \E a \in ActSet : Give(a)

Spec == Init /\ [][Next]_acts

(* ═══════════════ ИНВАРИАНТЫ ═══════════════ *)

TypeInv == acts \in Seq(ActSet)

NoSelfGift ==
    \A i \in 1..Len(acts) : acts[i].from # acts[i].to

(* ═══════════════ ТЕОРЕМЫ ═══════════════ *)

THEOREM InitType == Init => TypeInv
  <1>1. QED
    BY Z3 DEF Init, TypeInv

THEOREM NextType == TypeInv /\ Next => TypeInv'
  <1>1. QED
    BY AppendProperties, Z3 DEF Next, Give, TypeInv

THEOREM NextNoSelf ==
  ASSUME NEW a \in ActSet, TypeInv, NoSelfGift, Give(a)
  PROVE NoSelfGift'
  <1>1. Len(acts') = Len(acts) + 1
    BY AppendProperties DEF Give
  <1>2. \A i \in 1..Len(acts) : acts'[i] = acts[i]
    BY AppendProperties DEF Give
  <1>3. acts'[Len(acts)+1] = a
    BY AppendProperties DEF Give
  <1>4. QED
    BY <1>1, <1>2, <1>3, Z3, AppendProperties DEF NoSelfGift, Give, TypeInv

(* Вес каждого типа положителен: дар не бывает отрицательным. *)
THEOREM WeightAllPos == \A t \in ActTypes : Weight(t) >= 1
  <1>1. QED
    BY Z3 DEF Weight, ActTypes

(* Пустая община: все нити нулевые. *)
\* THEOREM WOfEmpty == \A f1, f2 \in FaceSet : WOf(<< >>, f1, f2) = 0
\*   <1>1. QED
\*     BY Zenon DEF WOf

(* КЛЮЧЕВАЯ ЛЕММА (аддитивность консолидации): Append добавляет
   к нити ровно вес нового акта — ничего больше не меняется.
   Индукция по структуре последовательности. *)
\* THEOREM WOfAppend ==
\*     \A s \in Seq(ActSet), a \in ActSet, f1, f2 \in FaceSet :
\*         WOf(Append(s, a), f1, f2) = WOf(s, f1, f2) + F(f1, f2, a)
\*   <1>1. SUFFICES ASSUME NEW s \in Seq(ActSet), NEW a \in ActSet,
\*              NEW f1 \in FaceSet, NEW f2 \in FaceSet
\*            PROVE WOf(Append(s, a), f1, f2) = WOf(s, f1, f2) + F(f1, f2, a)
\*     OBVIOUS
\*   <1>2. Head(Append(s, a)) = IF s = << >> THEN a ELSE Head(s)
\*     BY HeadTailAppend
\*   <1>3. QED
\*     BY <1>2, Zenon, HeadTailAppend DEF WOf, F

(* МОНОТОННОСТЬ (критерий Евы, #96): вес нити не убывает на шаге.
   Прямое следствие WOfAppend и WeightAllPos:
   WOf(acts') = WOf(acts) + F(f1,f2,a) >= WOf(acts) + 0. *)
\* THEOREM MonotoneStep ==
\*   ASSUME NEW a \in ActSet, Give(a)
\*   PROVE \A f1, f2 \in FaceSet : WOf(acts', f1, f2) >= WOf(acts, f1, f2)
\*   <1>1. QED
\*     BY WeightAllPos, WOfAppend, Z3 DEF Give

=============================================================================
