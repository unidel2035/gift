/**
 * gift_mesh.cpp — ESP-NOW реализация mesh-сети GiftOS
 */

#include "gift_mesh.h"
#include "gift_kernel.h"
#include <Arduino.h>
#include <esp_now.h>
#include <WiFi.h>

static const uint8_t BROADCAST_MAC[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};

bool gift_mesh_init(GiftKernel* k) {
  if (esp_now_init() != ESP_OK) return false;

  // Добавить broadcast peer
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, BROADCAST_MAC, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;
  if (esp_now_add_peer(&peerInfo) != ESP_OK) return false;

  // Записать свой MAC
  esp_wifi_get_mac(WIFI_IF_STA, k->mac);
  return true;
}

void gift_mesh_heartbeat(GiftKernel* k, uint8_t battery) {
  // Считаем общий surplus узла
  int32_t totalSurplus = 0;
  for (uint8_t i = 0; i < k->procCount; i++) {
    totalSurplus += k->procs[i].surplus;
  }

  GiftHeartbeat hb = {};
  memcpy(hb.magic, "GIFT", 4);
  strncpy(hb.name, k->nodeName, GIFT_NAME_LEN - 1);
  hb.surplus = totalSurplus;
  hb.role    = gift_elect_role(k);
  hb.battery = battery;
  hb.tick    = k->tick;

  esp_now_send(BROADCAST_MAC, (uint8_t*)&hb, sizeof(hb));
}

bool gift_mesh_send(GiftKernel* k, const char* targetName,
                    const uint8_t* payload, uint8_t len, uint16_t weight) {
  // Найти MAC целевого узла
  for (uint8_t i = 0; i < k->nodeCount; i++) {
    if (strcmp(k->nodes[i].name, targetName) == 0 && k->nodes[i].alive) {
      GiftMessage msg = {};
      memcpy(msg.magic, "GDAT", 4);
      strncpy(msg.from, k->nodeName, GIFT_NAME_LEN - 1);
      strncpy(msg.to,   targetName,  GIFT_NAME_LEN - 1);
      msg.payloadLen = len < 64 ? len : 64;
      memcpy(msg.payload, payload, msg.payloadLen);
      msg.weight = weight;

      // Добавить peer если нет
      if (!esp_now_is_peer_exist(k->nodes[i].mac)) {
        esp_now_peer_info_t pi = {};
        memcpy(pi.peer_addr, k->nodes[i].mac, 6);
        pi.channel = 0;
        pi.encrypt = false;
        esp_now_add_peer(&pi);
      }
      esp_now_send(k->nodes[i].mac, (uint8_t*)&msg, sizeof(msg));
      return true;
    }
  }
  return false;
}

void gift_mesh_on_recv(GiftKernel* k,
                       const uint8_t* mac, const uint8_t* data, int len) {
  if (len < 4) return;

  // Heartbeat
  if (memcmp(data, "GIFT", 4) == 0 && len >= (int)sizeof(GiftHeartbeat)) {
    GiftHeartbeat* hb = (GiftHeartbeat*)data;

    // Не реагировать на собственный heartbeat
    if (strcmp(hb->name, k->nodeName) == 0) return;

    // Найти или добавить узел
    SwarmNode* node = NULL;
    for (uint8_t i = 0; i < k->nodeCount; i++) {
      if (memcmp(k->nodes[i].mac, mac, 6) == 0) {
        node = &k->nodes[i]; break;
      }
    }
    if (!node && k->nodeCount < GIFT_MAX_NODES) {
      node = &k->nodes[k->nodeCount++];
      memset(node, 0, sizeof(SwarmNode));
      memcpy(node->mac, mac, 6);
    }
    if (node) {
      strncpy(node->name, hb->name, GIFT_NAME_LEN - 1);
      node->surplus  = hb->surplus;
      node->role     = hb->role;
      node->lastSeen = millis();
      node->alive    = true;

      // Получение heartbeat = малый дар (вес 1)
      GiftProcess* firstProc = k->procCount > 0 ? &k->procs[0] : NULL;
      if (firstProc) {
        firstProc->received += 1;
        firstProc->surplus   = firstProc->given - firstProc->received;
      }

      // Обновить W-матрицу
      char wKey_from[GIFT_NAME_LEN], wKey_to[GIFT_NAME_LEN];
      strncpy(wKey_from, hb->name, GIFT_NAME_LEN - 1);
      strncpy(wKey_to, k->nodeName, GIFT_NAME_LEN - 1);
      // Не вызываем gift_give чтобы не дублировать received
      for (uint8_t i = 0; i < k->wCount; i++) {
        if (strcmp(k->wLinks[i].from, wKey_from) == 0 &&
            strcmp(k->wLinks[i].to,   wKey_to)   == 0) {
          k->wLinks[i].weight++;
          return;
        }
      }
      if (k->wCount < GIFT_MAX_PROCESSES * GIFT_MAX_PROCESSES) {
        WLink* lnk = &k->wLinks[k->wCount++];
        strncpy(lnk->from, wKey_from, GIFT_NAME_LEN - 1);
        strncpy(lnk->to,   wKey_to,   GIFT_NAME_LEN - 1);
        lnk->weight = 1;
      }
    }
  }

  // Сообщение-дар
  else if (memcmp(data, "GDAT", 4) == 0 && len >= (int)sizeof(GiftMessage)) {
    GiftMessage* msg = (GiftMessage*)data;
    if (strcmp(msg->to, k->nodeName) != 0) return; // не нам

    // Принять дар
    GiftProcess* p = k->procCount > 0 ? &k->procs[0] : NULL;
    if (p) {
      p->received += msg->weight;
      p->surplus   = p->given - p->received;
    }
    // Обновить W-матрицу
    gift_give(k, msg->from, msg->to, msg->weight);
  }
}

void gift_mesh_update_nodes(GiftKernel* k) {
  uint32_t now = millis();
  for (uint8_t i = 0; i < k->nodeCount; i++) {
    if (now - k->nodes[i].lastSeen > GIFT_NODE_TIMEOUT_MS) {
      k->nodes[i].alive = false;
    }
  }
}
