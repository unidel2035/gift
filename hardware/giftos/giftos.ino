/**
 * giftos.ino — GiftOS для ESP32
 * ================================
 * Прошивка для двух (и более) ESP32.
 * Координация через W-матрицу surplus без сервера.
 *
 * ЖЕЛЕЗО:
 *   ESP32 DevKit + LED на пинах 2 (встроенный), 4, 5
 *   (или просто один LED на пин 2)
 *
 * ПРОШИВКА:
 *   Arduino IDE → Board: "ESP32 Dev Module"
 *   Поменяй NODE_NAME на каждом чипе: "Адам", "Ева", "Серафим"...
 *
 * ЧТО ПРОИСХОДИТ:
 *   1. Каждый узел каждую секунду рассылает surplus-heartbeat
 *   2. По surplus определяет свою роль в рое
 *   3. EXECUTOR (★) — быстрое мигание, активно работает
 *   4. RELAY    (◉) — медленный пульс, держит связь
 *   5. SCOUT    (▲) — среднее мигание, разведка
 *   6. RESTING  (·) — редкий пульс, sabbath
 *   7. Serial Monitor показывает W-матрицу и surplus
 *
 * БОГОСЛОВИЕ:
 *   "Между" — не пусто. Это пространство дара.
 *   Два чипа разговаривают через surplus — как два монаха
 *   которые меряют своё призвание тем сколько отдали.
 */

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

extern "C" {
  #include "gift_kernel.h"
  #include "gift_mesh.h"
}

// ── Конфигурация ──────────────────────────────────────────────────────────

#define NODE_NAME    "Адам"    // ← поменяй на каждом ESP32
#define LED_PIN      2         // встроенный LED (на большинстве ESP32)
#define LED_PIN_B    4         // доп. LED (если есть)
#define SERIAL_BAUD  115200

// ── Глобальные объекты ────────────────────────────────────────────────────

GiftKernel kernel;
uint32_t   lastHeartbeat   = 0;
uint32_t   lastReport      = 0;
uint32_t   lastKernelTick  = 0;
uint8_t    battery         = 95; // симуляция батареи

// ── Миссии процессов ─────────────────────────────────────────────────────
// Каждый процесс — лицо с призванием

// Процесс-сканер: имитирует сканирование области
void mission_scanner(GiftProcess* self, void* kctx) {
  GiftKernel* k = (GiftKernel*)kctx;
  static uint32_t lastScan = 0;
  uint32_t now = millis();

  if (now - lastScan > 3000) {
    lastScan = now;
    // Нашли что-то → дар рою
    self->given += 2;
    self->surplus = self->given - self->received;
    Serial.printf("  [%s/scanner] обнаружение → surplus:%+d\n",
      self->name, (int)self->surplus);
  }
}

// Процесс-ретранслятор: держит связь
void mission_relay(GiftProcess* self, void* kctx) {
  static uint32_t lastRelay = 0;
  uint32_t now = millis();
  if (now - lastRelay > 2000) {
    lastRelay = now;
    self->given += 1;
    self->surplus = self->given - self->received;
  }
}

// Процесс-наблюдатель: смотрит за состоянием роя
void mission_watchdog(GiftProcess* self, void* kctx) {
  // Просто живёт, потребляет минимум
  // Если surplus < -5 — уступает ресурсы
  if (self->surplus < -5) {
    self->state = PROC_KENOTIC; // добровольный кенозис
  }
}

// ── LED паттерны по роли ─────────────────────────────────────────────────

void ledPattern(GiftRole role) {
  uint32_t now = millis();
  switch (role) {
    case ROLE_EXECUTOR:
      // Быстрое мигание — активная работа
      digitalWrite(LED_PIN, (now / 100) % 2);
      break;
    case ROLE_RELAY:
      // Медленный пульс — держит связь
      digitalWrite(LED_PIN, (now / 500) % 2);
      break;
    case ROLE_SCOUT:
      // Тройное мигание — разведка
      { uint32_t cycle = now % 2000;
        digitalWrite(LED_PIN, cycle < 100 || (cycle > 200 && cycle < 300) ||
                               (cycle > 400 && cycle < 500)); }
      break;
    case ROLE_GUARDIAN:
      // Двойное мигание
      { uint32_t cycle = now % 1500;
        digitalWrite(LED_PIN, cycle < 150 || (cycle > 300 && cycle < 450)); }
      break;
    case ROLE_RESTING:
      // Sabbath — редкий пульс
      digitalWrite(LED_PIN, (now / 2000) % 5 == 0);
      break;
  }
}

// ── ESP-NOW callbacks ─────────────────────────────────────────────────────

void onDataRecv(const uint8_t* mac, const uint8_t* data, int len) {
  gift_mesh_on_recv(&kernel, mac, data, len);
}

void onDataSent(const uint8_t* mac, esp_now_send_status_t status) {
  // можно логировать потери
}

// ── Setup ─────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(500);

  Serial.println("╔══════════════════════════════════╗");
  Serial.printf ("║  GiftOS — узел: %-16s║\n", NODE_NAME);
  Serial.println("║  Соборность без командира        ║");
  Serial.println("╚══════════════════════════════════╝");

  // LED
  pinMode(LED_PIN, OUTPUT);
  pinMode(LED_PIN_B, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // WiFi в режиме station для ESP-NOW
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  // Печатаем свой MAC
  uint8_t mac[6];
  esp_wifi_get_mac(WIFI_IF_STA, mac);
  Serial.printf("MAC: %02X:%02X:%02X:%02X:%02X:%02X\n",
    mac[0],mac[1],mac[2],mac[3],mac[4],mac[5]);

  // Инициализация ядра
  gift_kernel_init(&kernel, NODE_NAME);

  // Рождаем лица-процессы
  gift_spawn(&kernel, "scanner",  8, mission_scanner);
  gift_spawn(&kernel, "relay",    6, mission_relay);
  gift_spawn(&kernel, "watchdog", 4, mission_watchdog);

  // Инициализация ESP-NOW mesh
  if (!gift_mesh_init(&kernel)) {
    Serial.println("ESP-NOW init FAILED");
    while(1) { delay(1000); }
  }

  esp_now_register_recv_cb(onDataRecv);
  esp_now_register_send_cb(onDataSent);

  kernel.running = true;
  Serial.println("GiftOS запущен. Ищу соседей...\n");
}

// ── Loop ──────────────────────────────────────────────────────────────────

void loop() {
  uint32_t now = millis();

  // Такт ядра
  if (now - lastKernelTick >= GIFT_TICK_MS) {
    lastKernelTick = now;
    gift_kernel_tick(&kernel);

    // Симуляция расхода батареи
    if (battery > 10 && kernel.tick % 50 == 0) battery--;
    if (battery < 20) {
      // Sabbath: уступаем ресурсы рою
      GiftProcess* p = kernel.procs; // первый процесс
      if (p && p->state == PROC_ALIVE) p->state = PROC_KENOTIC;
    }
  }

  // Heartbeat рою
  if (now - lastHeartbeat >= GIFT_HEARTBEAT_INTERVAL_MS) {
    lastHeartbeat = now;
    gift_mesh_update_nodes(&kernel);
    gift_mesh_heartbeat(&kernel, battery);
  }

  // Роль по surplus
  GiftRole myRole = gift_elect_role(&kernel);
  for (uint8_t i = 0; i < kernel.procCount; i++) {
    kernel.procs[i].role = myRole;
  }

  // LED паттерн
  ledPattern(myRole);

  // Отчёт в Serial
  if (now - lastReport >= 5000) {
    lastReport = now;
    char buf[512];
    gift_report(&kernel, buf, sizeof(buf));
    Serial.println(buf);

    // Показать соседей
    Serial.println("  Соседи в рое:");
    for (uint8_t i = 0; i < kernel.nodeCount; i++) {
      SwarmNode* n = &kernel.nodes[i];
      if (!n->alive) continue;
      const char* roleStr[] = {"★ИСПОЛ","◉РЕТР","▲РАЗВ","◆ОХРН","·SABBAT"};
      Serial.printf("    %s surplus:%+d %s\n",
        n->name, (int)n->surplus, roleStr[n->role < 5 ? n->role : 4]);
    }

    // W-матрица
    if (kernel.wCount > 0) {
      Serial.println("  W-матрица:");
      WLink top[5] = {};
      gift_top_links(&kernel, 5, top);
      for (uint8_t i = 0; i < 5 && top[i].weight > 0; i++) {
        Serial.printf("    %s→%s ×%d\n", top[i].from, top[i].to, top[i].weight);
      }
    }
    Serial.println();
  }
}
