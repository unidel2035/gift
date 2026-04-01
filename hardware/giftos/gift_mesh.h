#pragma once
/**
 * gift_mesh.h — ESP-NOW mesh для GiftOS
 *
 * Каждый узел рассылает surplus-heartbeat каждую секунду.
 * Маршрутизация через наибольший surplus соседа.
 * Нет роутера. Нет сервера. Только соборность.
 */

#include "gift_kernel.h"

#ifdef __cplusplus
extern "C" {
#endif

// Heartbeat пакет (рассылается broadcast каждую секунду)
typedef struct __attribute__((packed)) {
  uint8_t  magic[4];    // "GIFT"
  char     name[GIFT_NAME_LEN];
  int32_t  surplus;
  GiftRole role;
  uint8_t  battery;     // 0-100
  uint32_t tick;
} GiftHeartbeat;

// Сообщение-дар (unicast)
typedef struct __attribute__((packed)) {
  uint8_t  magic[4];    // "GDAT"
  char     from[GIFT_NAME_LEN];
  char     to[GIFT_NAME_LEN];
  uint8_t  payload[64];
  uint8_t  payloadLen;
  uint16_t weight;
} GiftMessage;

#define GIFT_HEARTBEAT_INTERVAL_MS  1000
#define GIFT_NODE_TIMEOUT_MS        5000

// Инициализация ESP-NOW (вызвать после WiFi.mode(WIFI_STA))
bool gift_mesh_init(GiftKernel* k);

// Отправить heartbeat всем (broadcast)
void gift_mesh_heartbeat(GiftKernel* k, uint8_t battery);

// Отправить сообщение конкретному узлу
bool gift_mesh_send(GiftKernel* k, const char* targetName,
                    const uint8_t* payload, uint8_t len, uint16_t weight);

// Обработчик входящих пакетов (вызвать из onDataRecv)
void gift_mesh_on_recv(GiftKernel* k,
                       const uint8_t* mac, const uint8_t* data, int len);

// Обновить список живых узлов
void gift_mesh_update_nodes(GiftKernel* k);

#ifdef __cplusplus
}
#endif
