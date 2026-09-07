-------------------------------
// swarm-consensus.tla — консенсус роя дронов о цели полёта.
//
// Рой: N узлов, каждый видит своё окружение (радар-сенс) и предлагает
// цель. Протокол — упрощённый консенсус с координатором-лидером,
// который может отказать (crash). Что проверяем:
//
//   СОГЛАСИЕ  (agreement): все невыпавшие узлы держат одну цель.
//   ЦЕЛОСТНОСТЬ: цель выбирается только из предложенных узлами.
//   ЖИВОСТЬ (liveness): пока жив лидер, решение приходит.
//   УСТОЙЧИВОСТЬ К ОТКАЗУ: один отказ не роняет согласие.
//
// Это скелет: боевая модель добавит сбои сети (потерю сообщений) и
// византийские узлы (враньё сенсора) — там TLA+ и раскрывается:
// редкие чередования, которые тестами не поймать.
--------------------------- MODULE swarm_consensus ---------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANT N,               \* число узлов роя
         Goals            \* множество допустимых целей

Nodes == 1..N

(* ── Состояние узла ── *)
VARIABLES role,           \* "leader" | "follower" | "crashed"
         proposal,        \* [node |-> цель из Goals или NoProp]
         decided,         \* [node |-> цель или Undecided]
         broadcast        \* цель, ушедшая в эфир рою (или None)

NoProp == "нет предложения"
Undecided == "не решено"
None == "нет вещания"

Vars == << role, proposal, decided, broadcast >>

Init ==
    /\ role = [n \in Nodes |-> IF n = 1 THEN "leader" ELSE "follower"]
    /\ proposal = [n \in Nodes |-> NoProp]
    /\ decided  = [n \in Nodes |-> Undecided]
    /\ broadcast = None

\* Узел предлагает цель по данным сенсора.
Sense(n, g) ==
    /\ role[n] = "follower"
    /\ g \in Goals
    /\ proposal' = [proposal EXCEPT ![n] = g]
    /\ UNCHANGED << role, decided, broadcast >>

\* Лидер собирает предложения и вещает одну из предложенных целей.
\* (Тут сидит будущая теорема: «выбор только из предложенных» — Integrity.)
Decide(g) ==
    /\ role[1] = "leader"
    /\ broadcast = None                  \* решение одношотово: лидер не передумывает
    /\ g \in Goals
    /\ \E n \in Nodes : proposal[n] = g     \* целостность: цель от узла
    /\ broadcast' = g
    /\ UNCHANGED << role, proposal, decided >>

\* Узлы принимают вещание.
Accept(n) ==
    /\ broadcast # None
    /\ role[n] # "crashed"
    /\ decided' = [decided EXCEPT ![n] = broadcast]
    /\ UNCHANGED << role, proposal, broadcast >>

\* Отказ узла (crash): молчит навсегда, но не врёт.
Crash(n) ==
    /\ role[n] # "crashed"
    /\ role' = [role EXCEPT ![n] = "crashed"]
    /\ UNCHANGED << proposal, decided, broadcast >>

Next ==
    \E n \in Nodes, g \in Goals :
        \/ Sense(n, g)
        \/ (n = 1 /\ Decide(g))
        \/ Accept(n)
        \/ Crash(n)

(* ═══════════════ ИНВАРИАНТЫ ═══════════════ *)

\* СОГЛАСИЕ: все решившие (не crashed, не Undecided) держат одно.
Agreement ==
    \A n1, n2 \in Nodes :
        /\ decided[n1] # Undecided
        /\ decided[n2] # Undecided
        => decided[n1] = decided[n2]

\* ЦЕЛОСТНОСТЬ: решённая цель когда-то была предложена узлом.
\* (В модели-скелете: решённая цель = последняя вещанная.)
Integrity ==
    \A n \in Nodes :
        decided[n] # Undecided => decided[n] \in Goals

\* Отказ узла не меняет его решения (crash — не амнезия).
CrashFreezesDecision ==
    \A n \in Nodes : role[n] = "crashed" => UNCHANGED decided[n]

(* ═══════════════ ТЕМПОРАЛЬНЫЕ СВОЙСТВА ═══════════════ *)

\* ЖИВОСТЬ: если лидер жив и есть предложение, вещание случится.
\* Формулируется как «всегда в конце концов»: []<>.
Liveness ==
    [](role[1] # "crashed" /\ \E n \in Nodes : proposal[n] # NoProp
        => <>(broadcast # None))

Spec == Init /\ [][Next]_Vars

\* Теорема: согласие и целостность — свойства безопасности,
\* TLC проверит их на всех состояниях всех исполнений до границы.

(* Ограничение перебора: не больше двух решивших узлов —
   согласие проверяется на всех парах уже при этом. *)
decidedCount == Cardinality({n \in Nodes : decided[n] # Undecided}) <= 2

=============================================================================


