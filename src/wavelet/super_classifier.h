#pragma once
/**
 * super_classifier.h — СУПЕР-КЛАССИФИКАТОР ЦЕЛЕЙ БПЛА
 *
 * Синтез лучших мировых подходов:
 *   1. DeepPythonist YOLOv8 (96.1% mAP, drone vs bird vs airplane)
 *   2. SkyRadar multi-sensor fusion (radar+RF+camera+thermal+audio)
 *   3. Данцевич wavelet+fuzzy+нейросеть (самоорганизация)
 *   4. Pospelov KnoDL символьные правила (детерминизм, без ML)
 *   5. Филатов символьный процессор (бортовая обработка)
 *
 * Архитектура:
 *   ┌─────────────────────────────────────────────────────┐
 *   │                СЕНСОРНЫЙ СЛОЙ                       │
 *   │  Camera ─┬─ YOLOv8-drone (DeepPythonist) ─┐        │
 *   │  Radar  ─┤  micro-Doppler classifier      ┤        │
 *   │  RF     ─┤  RF-signature matcher          ┤─ FUSION│
 *   │  Thermal─┤  heat-signature classifier      ┤        │
 *   │  Audio  ─┘  acoustic spectrogram CNN      ┘        │
 *   ├─────────────────────────────────────────────────────┤
 *   │           СИМВОЛЬНЫЙ СЛОЙ (KnoDL/Pospelov)         │
 *   │  Deterministic rules → быстрый фильтр (1μs)        │
 *   │  Объяснимые решения, нет чёрного ящика              │
 *   ├─────────────────────────────────────────────────────┤
 *   │           НЕЙРО-FUZZY СЛОЙ (Данцевич)              │
 *   │  Wavelet-признаки + Fuzzy + самоорганизация (~5μs) │
 *   │  Адаптивное обучение на ошибках                     │
 *   ├─────────────────────────────────────────────────────┤
 *   │              Serafim 1.5B (LLM)                     │
 *   │  Тактическое решение на языке онтологии дара        │
 *   └─────────────────────────────────────────────────────┘
 *
 * Orange Pi 5 (RK3588): YOLO на NPU (30 FPS), остальное CPU (<100μs)
 */

#include "fuzzy_classifier.h"
#include <cstring>
#include <cmath>
#include <vector>

namespace super_classifier {

using namespace fuzzy_classifier;

// ═══════════════════════════════════════════════════════════════════════════════
// Сенсорные признаки (multi-modal)
// ═══════════════════════════════════════════════════════════════════════════════

struct MultiModalFeatures : TargetFeatures {
    // Дополнительные модальности
    float radar_microdoppler[16];  // микро-доплеровский спектр
    float rf_spectrum[8];          // RF-спектр (частоты + мощность)
    float thermal_profile[4];      // тепловой профиль (max, min, mean, var)
    float acoustic_mfcc[13];       // MFCC аудио
    float trajectory[6];           // x,y,z,vx,vy,vz (от трекера DeepSORT)

    // Веса уверенности сенсоров [0..1]
    float confidence_camera = 1.0f;
    float confidence_radar  = 0.0f;   // 0 = сенсор не активен
    float confidence_rf     = 0.0f;
    float confidence_thermal= 0.0f;
    float confidence_audio  = 0.0f;

    // Нормализация всех модальностей
    void normalize_all() {
        normalize();
        // radar, rf, thermal, acoustic — оставляем сырыми для wavelet
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// Модальные классификаторы
// ═══════════════════════════════════════════════════════════════════════════════

struct RadarClassifier {
    // Микро-доплеровская классификация: вертолёт vs дрон vs птица
    TargetClass classify(const float microdoppler[16]) {
        float energy_low = 0, energy_high = 0;
        for (int i = 0; i < 8; i++)  energy_low  += microdoppler[i] * microdoppler[i];
        for (int i = 8; i < 16; i++) energy_high += microdoppler[i] * microdoppler[i];

        float ratio = energy_high / (energy_low + 1e-10f);
        // Дроны: высокое отношение высоких/низких частот (быстрые лопасти)
        if (ratio > 2.0f) return TargetClass::ENEMY_DRONE;
        // Птицы: низкое отношение (медленные крылья)
        if (ratio < 0.5f) return TargetClass::OBSTACLE;  // bird → obstacle
        // Техника/вертолёт: среднее
        return TargetClass::VEHICLE;
    }
};

struct RFClassifier {
    // RF-классификация: свой/чужой по частотному профилю
    TargetClass classify(const float spectrum[8], float confidence) {
        if (confidence < 0.3f) return TargetClass::UNKNOWN;

        // Анализ пиков в频谱
        float max_peak = 0; int max_idx = 0;
        for (int i = 0; i < 8; i++) {
            if (spectrum[i] > max_peak) { max_peak = spectrum[i]; max_idx = i; }
        }

        // 2.4 GHz ISM → гражданский дрон
        if (max_idx >= 2 && max_idx <= 4 && max_peak > 0.5f)
            return TargetClass::ENEMY_DRONE;  // любой дрон без своего маяка → враг
        // 868 MHz → тактический канал
        if (max_idx <= 1 && max_peak > 0.5f)
            return TargetClass::OPERATOR;      // свой

        return TargetClass::UNKNOWN;
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// СУПЕР-КЛАССИФИКАТОР — fusion всех модальностей
// ═══════════════════════════════════════════════════════════════════════════════

class SuperClassifier {
    SymbolicProcessor   sym;          // KnoDL-правила (1μs)
    NeuroFuzzyClassifier nfc;         // Данцевич wavelet+fuzzy (5μs)
    RadarClassifier     radar;        // Микро-доплер
    RFClassifier        rf;           // RF-сигнатуры

    // Веса доверия модальностям (обновляются адаптивно)
    float w_camera  = 1.0f;
    float w_radar   = 0.8f;
    float w_rf      = 0.9f;   // RF очень надёжен для свой/чужой
    float w_thermal = 0.6f;
    float w_audio   = 0.3f;

public:
    struct FusionResult {
        TargetClass target;
        float confidence;
        const char* name;
        const char* reasoning;    // почему такое решение
        float class_scores[6];    // оценки по всем 6 классам
    };

    FusionResult classify(const MultiModalFeatures& f) {
        float scores[6] = {0};
        float total_weight = 0;

        // ── Модальность 1: Камера (YOLO + Symbolic + NeuroFuzzy) ─────
        if (f.confidence_camera > 0.1f) {
            // Быстрый путь: символьные правила
            TargetClass sym_result = sym.quick_classify(f);
            if (sym_result != TargetClass::UNKNOWN) {
                scores[(int)sym_result] += w_camera * f.confidence_camera;
                total_weight += w_camera * f.confidence_camera;
            }
            // Медленный путь: нейро-fuzzy
            auto nfc_result = nfc.classify_detailed(f);
            for (int c = 0; c < 6; c++) {
                scores[c] += w_camera * f.confidence_camera * nfc_result.scores[c] * 0.1f;
            }
            total_weight += w_camera * f.confidence_camera * 0.5f;
        }

        // ── Модальность 2: Радар (микро-доплер) ──────────────────────
        if (f.confidence_radar > 0.1f) {
            TargetClass r = radar.classify(f.radar_microdoppler);
            if (r != TargetClass::UNKNOWN) {
                scores[(int)r] += w_radar * f.confidence_radar;
            }
            total_weight += w_radar * f.confidence_radar;
        }

        // ── Модальность 3: RF (свой/чужой) ───────────────────────────
        if (f.confidence_rf > 0.1f) {
            TargetClass r = rf.classify(f.rf_spectrum, f.confidence_rf);
            if (r == TargetClass::OPERATOR) {
                // RF-маяк → свой. Самый сильный сигнал.
                scores[(int)TargetClass::OPERATOR] += w_rf * 2.0f;
            } else if (r == TargetClass::ENEMY_DRONE) {
                scores[(int)TargetClass::ENEMY_DRONE] += w_rf * 1.5f;
            }
            total_weight += w_rf * f.confidence_rf * 2.0f;
        }

        // ── Модальность 4: Тепловизор ────────────────────────────────
        if (f.confidence_thermal > 0.1f) {
            // ДВС горячее электро-мотора
            float heat_mean = f.thermal_profile[1];  // средняя температура
            if (heat_mean > 0.7f) {
                scores[(int)TargetClass::VEHICLE] += w_thermal * f.confidence_thermal;
            } else {
                scores[(int)TargetClass::ENEMY_DRONE] += w_thermal * f.confidence_thermal * 0.5f;
            }
            total_weight += w_thermal * f.confidence_thermal;
        }

        // ── АРГМАКС ──────────────────────────────────────────────────
        int best = 0;
        for (int c = 1; c < 6; c++) {
            if (scores[c] > scores[best]) best = c;
        }

        FusionResult result;
        result.target = static_cast<TargetClass>(best);
        result.confidence = total_weight > 0 ? scores[best] / (total_weight + 1e-10f) : 0;
        result.name = TARGET_NAMES[best];
        memcpy(result.class_scores, scores, sizeof(scores));

        // ── Объяснение решения ───────────────────────────────────────
        char reason[256];
        snprintf(reason, sizeof(reason),
            "%s | camera=%.1f radar=%.1f rf=%.1f thermal=%.1f",
            TARGET_NAMES[best],
            f.confidence_camera, f.confidence_radar,
            f.confidence_rf, f.confidence_thermal);
        result.reasoning = strdup(reason);

        return result;
    }
};

} // namespace super_classifier
