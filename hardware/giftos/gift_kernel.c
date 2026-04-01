/**
 * gift_kernel.c — реализация ядра GiftOS для ESP32
 */

#include "gift_kernel.h"
#include <string.h>
#include <stdio.h>
#include <math.h>

// ── Утилиты ───────────────────────────────────────────────────────────────

static GiftProcess* _find_proc(GiftKernel* k, const char* name) {
  for (uint8_t i = 0; i < k->procCount; i++) {
    if (strcmp(k->procs[i].name, name) == 0) return &k->procs[i];
  }
  return NULL;
}

static float _surplus_score(GiftProcess* p) {
  // tanh нормировка: surplus/10 → [-1,1], потом [0,1]
  float s = (float)p->surplus / 10.0f;
  if (s > 3.0f) s = 3.0f;
  if (s < -3.0f) s = -3.0f;
  float tanh_s = (float)(1.0 - 2.0/(exp(2.0*s)+1.0)); // tanh
  float norm = (tanh_s + 1.0f) / 2.0f;                 // [0,1]
  float priority_norm = (float)p->priority / 10.0f;
  return 0.6f * norm + 0.4f * priority_norm;
}

// ── Инициализация ─────────────────────────────────────────────────────────

void gift_kernel_init(GiftKernel* k, const char* nodeName) {
  memset(k, 0, sizeof(GiftKernel));
  strncpy(k->nodeName, nodeName, GIFT_NAME_LEN - 1);
  k->tick    = 0;
  k->running = false;
}

// ── Лица ──────────────────────────────────────────────────────────────────

GiftProcess* gift_spawn(GiftKernel* k, const char* name, uint8_t priority,
                        void (*mission)(GiftProcess*, void*)) {
  if (k->procCount >= GIFT_MAX_PROCESSES) return NULL;
  if (_find_proc(k, name) != NULL) return NULL; // уже существует

  GiftProcess* p = &k->procs[k->procCount++];
  memset(p, 0, sizeof(GiftProcess));
  strncpy(p->name, name, GIFT_NAME_LEN - 1);
  p->state    = PROC_ALIVE;
  p->priority = priority;
  p->mission  = mission;
  p->role     = ROLE_SCOUT;
  return p;
}

void gift_glorify(GiftKernel* k, const char* name) {
  GiftProcess* p = _find_proc(k, name);
  if (p) p->state = PROC_GLORIFIED;
}

// ── IPC: дар ──────────────────────────────────────────────────────────────

void gift_give(GiftKernel* k, const char* from, const char* to, uint16_t weight) {
  GiftProcess* giver    = _find_proc(k, from);
  GiftProcess* receiver = _find_proc(k, to);

  if (giver) {
    giver->given   += weight;
    giver->surplus  = giver->given - giver->received;
  }
  if (receiver) {
    receiver->received += weight;
    receiver->surplus   = receiver->given - receiver->received;
  }

  // Обновить W-матрицу
  for (uint8_t i = 0; i < k->wCount; i++) {
    if (strcmp(k->wLinks[i].from, from) == 0 &&
        strcmp(k->wLinks[i].to,   to)   == 0) {
      k->wLinks[i].weight += weight;
      return;
    }
  }
  if (k->wCount < GIFT_MAX_PROCESSES * GIFT_MAX_PROCESSES) {
    WLink* lnk = &k->wLinks[k->wCount++];
    strncpy(lnk->from, from, GIFT_NAME_LEN - 1);
    strncpy(lnk->to,   to,   GIFT_NAME_LEN - 1);
    lnk->weight = weight;
  }
}

// ── Планировщик ───────────────────────────────────────────────────────────

uint16_t gift_schedule_ticks(GiftKernel* k, GiftProcess* proc) {
  if (proc->state != PROC_ALIVE && proc->state != PROC_KENOTIC) return 0;

  float totalScore = 0.0f;
  uint8_t aliveCount = 0;
  for (uint8_t i = 0; i < k->procCount; i++) {
    GiftProcess* p = &k->procs[i];
    if (p->state == PROC_ALIVE || p->state == PROC_KENOTIC) {
      totalScore += _surplus_score(p);
      aliveCount++;
    }
  }
  if (aliveCount == 0 || totalScore < 0.001f) return 100;

  float myScore   = _surplus_score(proc);
  float fraction  = myScore / totalScore;
  uint16_t ticks  = (uint16_t)(fraction * 1000.0f);

  // χάρις — минимальный квант для всех
  if (ticks < 50) ticks = 50;
  return ticks;
}

// ── Роль в рое ────────────────────────────────────────────────────────────

GiftRole gift_elect_role(GiftKernel* k) {
  // Собрать surplus всех живых узлов роя + своих процессов
  int32_t mySurplus = 0;
  for (uint8_t i = 0; i < k->procCount; i++) {
    mySurplus += k->procs[i].surplus;
  }

  // Считаем сколько узлов роя имеют surplus выше моего
  uint8_t rank = 0;
  uint8_t aliveNodes = 0;
  for (uint8_t i = 0; i < k->nodeCount; i++) {
    SwarmNode* n = &k->nodes[i];
    if (!n->alive) continue;
    aliveNodes++;
    if (n->surplus > mySurplus) rank++;
  }

  if (rank == 0)               return ROLE_EXECUTOR;
  if (rank == 1 && aliveNodes > 2) return ROLE_RELAY;
  if (rank == aliveNodes - 1)  return ROLE_RESTING;
  return ROLE_SCOUT;
}

// ── Главный цикл ──────────────────────────────────────────────────────────

void gift_kernel_tick(GiftKernel* k) {
  k->tick++;

  for (uint8_t i = 0; i < k->procCount; i++) {
    GiftProcess* p = &k->procs[i];

    // Dormant — проверить время пробуждения
    if (p->state == PROC_DORMANT) {
      // wakeAt сравнивается с millis() в Arduino-слое
      continue;
    }

    if (p->state != PROC_ALIVE && p->state != PROC_KENOTIC) continue;

    // Выдать кванты
    uint16_t ticks = gift_schedule_ticks(k, p);
    p->ticks += ticks;

    // Запустить миссию
    if (p->mission) {
      p->mission(p, (void*)k);
    }

    // Убрать Kenotic флаг
    if (p->state == PROC_KENOTIC) p->state = PROC_ALIVE;
  }

  // Убрать прославленных
  uint8_t alive = 0;
  for (uint8_t i = 0; i < k->procCount; i++) {
    if (k->procs[i].state != PROC_GLORIFIED) {
      if (alive != i) k->procs[alive] = k->procs[i];
      alive++;
    }
  }
  k->procCount = alive;
}

// ── Отчёт ─────────────────────────────────────────────────────────────────

void gift_report(GiftKernel* k, char* buf, size_t bufLen) {
  int pos = 0;
  pos += snprintf(buf + pos, bufLen - pos,
    "[GiftOS] узел:%s тик:%lu лиц:%d\n",
    k->nodeName, (unsigned long)k->tick, k->procCount);

  for (uint8_t i = 0; i < k->procCount && pos < (int)bufLen - 60; i++) {
    GiftProcess* p = &k->procs[i];
    const char* roleStr[] = {"ИСПОЛ","РЕТР","РАЗВ","ОХРН","SABBAT"};
    pos += snprintf(buf + pos, bufLen - pos,
      "  %s [%s] surplus:%+d given:%d recv:%d\n",
      p->name,
      roleStr[p->role < 5 ? p->role : 4],
      (int)p->surplus, (int)p->given, (int)p->received);
  }
}

// ── Топ нитей ─────────────────────────────────────────────────────────────

void gift_top_links(GiftKernel* k, uint8_t n, WLink* out) {
  // Простая сортировка вставками (n мало)
  for (uint8_t i = 0; i < k->wCount && i < n; i++) {
    out[i] = k->wLinks[i];
  }
  // Найти топ-n по весу
  for (uint8_t i = 0; i < k->wCount; i++) {
    for (uint8_t j = 0; j < n; j++) {
      if (k->wLinks[i].weight > out[j].weight) {
        out[j] = k->wLinks[i];
        break;
      }
    }
  }
}
