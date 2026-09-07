(*
  swarm_byzantine.tla — византийский лидер в рое дронов: АТАКА.

  swarm_consensus.tla предполагал честного лидера: решает один раз,
  не передумывает. Здесь лидер — византиец:
    - ByzBroadcast:  вещает ЛЮБУЮ цель, даже никем не предложенную
                     (ложь сенсора / подмена);
    - ByzReBroadcast: передумывает ПОСЛЕ того, как узлы уже приняли.

  TLC должен НАЙТИ нарушение Agreement — это экспонат атаки.
  Контрпример: последовательность шагов, на которой рой раскалывается.
*)
--------------------------- MODULE swarm_byzantine ---------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANT N,               \* число узлов роя
         Goals            \* множество допустимых целей

Nodes == 1..N

VARIABLES role,           \* "leader" | "follower" | "crashed"
         proposal,        \* [node |-> цель или NoProp]
         decided,         \* [node |-> цель или Undecided]
         broadcast        \* цель в эфире (или None)

NoProp == "нет предложения"
Undecided == "не решено"
None == "нет вещания"

Vars == << role, proposal, decided, broadcast >>

Init ==
    /\ role = [n \in Nodes |-> IF n = 1 THEN "leader" ELSE "follower"]
    /\ proposal = [n \in Nodes |-> NoProp]
    /\ decided  = [n \in Nodes |-> Undecided]
    /\ broadcast = None

Sense(n, g) ==
    /\ role[n] = "follower"
    /\ g \in Goals
    /\ proposal' = [proposal EXCEPT ![n] = g]
    /\ UNCHANGED << role, decided, broadcast >>

\* Византийское вещание: цель любая — принадлежность к предложениям
\* НЕ проверяется. Лидер лжёт о том, что видел рой.
ByzBroadcast(g) ==
    /\ role[1] = "leader"
    /\ broadcast = None
    /\ g \in Goals
    /\ broadcast' = g
    /\ UNCHANGED << role, proposal, decided >>

\* Византийское передумывание: менять вещание можно и после решений.
ByzReBroadcast(g) ==
    /\ role[1] = "leader"
    /\ g \in Goals
    /\ g # broadcast
    /\ broadcast' = g
    /\ UNCHANGED << role, proposal, decided >>

\* Узлы наивны: принимают всё, что в эфире.
Accept(n) ==
    /\ broadcast # None
    /\ role[n] # "crashed"
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
        \/ (n = 1 /\ ByzReBroadcast(g))
        \/ Accept(n)
        \/ Crash(n)

(* ═══════════════ ИНВАРИАНТЫ ═══════════════ *)

\* СОГЛАСИЕ: все решившие держат одну цель.
\* ОЖИДАНИЕ: НАРУШЕНО — византийский лидер раскалывает рой.
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

(* Ограничение перебора: не больше двух решивших узлов —
   раскол виден уже на паре. *)
decidedCount == Cardinality({n \in Nodes : decided[n] # Undecided}) <= 2

=============================================================================
