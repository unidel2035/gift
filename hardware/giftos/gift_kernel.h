#pragma once
/**
 * gift_kernel.h — GiftOS kernel для ESP32
 *
 * Процесс = лицо (πρόσωπον). Не PID — имя.
 * Планировщик = surplus. Кто дал больше — получает CPU.
 * Смерть = glorify. Не kill.
 */

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

// ── Константы ─────────────────────────────────────────────────────────────

#define GIFT_MAX_PROCESSES   8
#define GIFT_MAX_NODES       8     // максимум узлов в рое (ESP32)
#define GIFT_NAME_LEN        16
#define GIFT_TICK_MS         200   // квант времени (200ms)

// ── Состояния лица ────────────────────────────────────────────────────────

typedef enum {
  PROC_NASCENT   = 0,
  PROC_ALIVE     = 1,
  PROC_WAITING   = 2,
  PROC_KENOTIC   = 3,   // добровольно уступает
  PROC_DORMANT   = 4,   // sabbath
  PROC_GLORIFIED = 5,   // завершил миссию
} GiftProcState;

// ── Роли в рое ────────────────────────────────────────────────────────────

typedef enum {
  ROLE_EXECUTOR  = 0,   // высший surplus → исполняет задачу
  ROLE_RELAY     = 1,   // второй surplus → держит связь
  ROLE_SCOUT     = 2,   // разведка
  ROLE_GUARDIAN  = 3,   // охрана
  ROLE_RESTING   = 4,   // sabbath (низкий заряд или surplus)
} GiftRole;

// ── Процесс-лицо ─────────────────────────────────────────────────────────

typedef struct GiftProcess {
  char          name[GIFT_NAME_LEN];
  GiftProcState state;
  GiftRole      role;

  // Онтология дара
  int32_t  given;      // суммарно отдал ресурсов рою
  int32_t  received;   // суммарно получил от роя
  int32_t  surplus;    // given - received

  // CPU
  uint8_t  priority;   // 1–10
  uint32_t ticks;      // получено квантов

  // Миссия — функция-колбэк
  void (*mission)(struct GiftProcess* self, void* kernel_ctx);

  // Dormant
  uint32_t wakeAt;     // millis() когда проснуться
} GiftProcess;

// ── W-матрица узла (кто кому сколько дал) ────────────────────────────────

typedef struct {
  char     from[GIFT_NAME_LEN];
  char     to[GIFT_NAME_LEN];
  uint16_t weight;
} WLink;

// ── Сосед в рое ──────────────────────────────────────────────────────────

typedef struct {
  uint8_t  mac[6];
  char     name[GIFT_NAME_LEN];
  int32_t  surplus;
  GiftRole role;
  uint32_t lastSeen;   // millis()
  bool     alive;
} SwarmNode;

// ── Ядро ─────────────────────────────────────────────────────────────────

typedef struct {
  // Реестр лиц
  GiftProcess procs[GIFT_MAX_PROCESSES];
  uint8_t     procCount;

  // W-матрица ядра
  WLink       wLinks[GIFT_MAX_PROCESSES * GIFT_MAX_PROCESSES];
  uint8_t     wCount;

  // Рой
  SwarmNode   nodes[GIFT_MAX_NODES];
  uint8_t     nodeCount;

  // Состояние
  uint32_t    tick;
  bool        running;

  // Имя этого узла
  char        nodeName[GIFT_NAME_LEN];
  uint8_t     mac[6];
} GiftKernel;

// ── API ───────────────────────────────────────────────────────────────────

void gift_kernel_init(GiftKernel* k, const char* nodeName);
void gift_kernel_tick(GiftKernel* k);

GiftProcess* gift_spawn(GiftKernel* k, const char* name, uint8_t priority,
                        void (*mission)(GiftProcess*, void*));
void gift_glorify(GiftKernel* k, const char* name);
void gift_give(GiftKernel* k, const char* from, const char* to, uint16_t weight);

// Surplus-aware планировщик — возвращает сколько тиков дать процессу
uint16_t gift_schedule_ticks(GiftKernel* k, GiftProcess* proc);

// Роль этого узла в рое по surplus
GiftRole gift_elect_role(GiftKernel* k);

// Отчёт (для Serial.print)
void gift_report(GiftKernel* k, char* buf, size_t bufLen);

// Топ нитей W-матрицы
void gift_top_links(GiftKernel* k, uint8_t n, WLink* out);

#ifdef __cplusplus
}
#endif
