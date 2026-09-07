(*
  swarm_bft.tla — защита роя от византийского лидера.

  Атака (swarm_byzantine.tla): лидер лжёт и передумывает — наивные
  узлы раскалываются. Знаменитый ответ: одному вещанию не верят.

  Три столпа защиты:
    1. КВОРУМ: узел принимает цель g из эфира только если
       QUORUM других узлов ПРЕДЛОЖИЛИ ту же g (свидетельство).
       Ложь лидера — одно голос, кворум её не пропустит.
    2. ПРИКЛЕЕННОСТЬ СЛОВА: узел предлагает цель один раз —
       proposal[n] не меняется после Sense. Кворум не может
       «перетечь» от одной цели к другой.
    3. ПРИКЛЕЕННОСТЬ РЕШЕНИЯ: решил — не передумывает.
       Как акт дара: irreversibility.

  N = 4: лидер + 3 честных узла, QUORUM = 2.
  Это мини-версия классического 3f+1: чтобы пережить f=1 византийца,
  нужно 3f+1 = 4 участника. При N=3 кворум=2 требует единогласия
  честных — безопасность ценой живости (проверить, выставив N=3).

  Что проверяем: Agreement и Integrity при живом византийце,
  который лжёт и передумывает без ограничений.
*)
----------------------------- MODULE swarm_bft -----------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANT N,               \* число узлов роя (узел 1 — лидер)
         Goals,           \* множество допустимых целей
         QUORUM           \* сколько предложений узлов нужно для принятия

Nodes == 1..N

VARIABLES role,           \* "leader" | "follower" | "crashed"
         proposal,        \* [node |-> цель или NoProp]; первое слово навсегда
         decided,         \* [node |-> цель или Undecided]; решение навсегда
         broadcast        \* цель в эфире (или None) — лидер может лгать

NoProp == "нет предложения"
Undecided == "не решено"
None == "нет вещания"

Vars == << role, proposal, decided, broadcast >>

Init ==
    /\ role = [n \in Nodes |-> IF n = 1 THEN "leader" ELSE "follower"]
    /\ proposal = [n \in Nodes |-> NoProp]
    /\ decided  = [n \in Nodes |-> Undecided]
    /\ broadcast = None

\* Сенсор честного узла: первое слово — единственное слово.
Sense(n, g) ==
    /\ role[n] = "follower"
    /\ g \in Goals
    /\ proposal[n] = NoProp              \* приклеенность слова
    /\ proposal' = [proposal EXCEPT ![n] = g]
    /\ UNCHANGED << role, decided, broadcast >>

\* Византийский лидер: вещает что угодно, когда угодно, сколько угодно.
ByzBroadcast(g) ==
    /\ role[1] = "leader"
    /\ g \in Goals
    /\ g # broadcast
    /\ broadcast' = g
    /\ UNCHANGED << role, proposal, decided >>

\* Принятие: эфир + свидетельство кворума честных узлов.
\* Ложь лидера бессильна: QUORUM предложений её не поддержит.
Accept(n) ==
    /\ broadcast # None
    /\ role[n] # "crashed"
    /\ decided[n] = Undecided            \* приклеенность решения
    /\ Cardinality({m \in Nodes : proposal[m] = broadcast}) >= QUORUM
    /\ decided' = [decided EXCEPT ![n] = broadcast]
    /\ UNCHANGED << role, proposal, broadcast >>

Crash(n) ==
    /\ role[n] # "crashed"
    /\ role' = [role EXCEPT ![n] = "crashed"]
    /\ UNCHANGED << proposal, decided, broadcast >>

Next ==
    \E n \in Nodes, g \in Goals :
        \/ Sense(n, g)
        \/ (n = 1 /\ ByzBroadcast(g))
        \/ Accept(n)
        \/ Crash(n)

(* ═══════════════ ИНВАРИАНТЫ ═══════════════ *)

\* СОГЛАСИЕ: все решившие держат одну цель — даже при лгущем лидере.
Agreement ==
    \A n1, n2 \in Nodes :
        /\ decided[n1] # Undecided
        /\ decided[n2] # Undecided
        => decided[n1] = decided[n2]

\* ЦЕЛОСТНОСТЬ: решённая цель — из допустимых.
Integrity ==
    \A n \in Nodes :
        decided[n] # Undecided => decided[n] \in Goals

Spec == Init /\ [][Next]_Vars

(* Ограничение перебора: не больше трёх решивших узлов —
   раскол виден на любой паре. *)
decidedCount == Cardinality({n \in Nodes : decided[n] # Undecided}) <= 3

=============================================================================
