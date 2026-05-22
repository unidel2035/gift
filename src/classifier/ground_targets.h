#pragma once
/**
 * ground_targets.h — Классификатор НАЗЕМНЫХ целей с борта БПЛА
 *
 * Цели: опорник, блиндаж, станция РЭБ, техника, человек, ложная цель
 *
 * Сенсоры (3 платы):
 *   Orange Pi 5 — камера (RGB) + тепловизор (опционально)
 *   Tang Nano 9K (FPGA) — быстрый детектор геометрии (L1, <1ms)
 *   Cube Orange+ — телеметрия (GPS, высота, курс)
 *
 * Признаки наземной цели:
 *   1. Геометрия (размер, форма, пропорции) — FPGA L1
 *   2. Текстура/цвет (камуфляж, земля, бетон) — YOLO/CNN на Orange Pi
 *   3. Тепло (занят/пуст) — тепловизор
 *   4. RF-излучение (РЭБ, связь) — SDR
 *   5. Контекст (траншеи, дороги, позиции) — карта/GIS
 */

#include <cstdint>
#include <cmath>
#include <cstring>
#include <algorithm>

namespace ground_targets {

// ═══════════════════════════════════════════════════════════════════════════════
// Типы наземных целей
// ═══════════════════════════════════════════════════════════════════════════════

enum class GroundTarget : uint8_t {
    STRONGPOINT  = 0,   // опорный пункт (траншеи, огневые точки)
    BUNKER       = 1,   // блиндаж / ДОТ (бетон, амбразура)
    EW_STATION   = 2,   // станция РЭБ (антенны, фургон, генератор)
    VEHICLE      = 3,   // техника (танк, БМП, грузовик)
    PERSON       = 4,   // человек / группа
    DECOY        = 5,   // ложная цель (макет, тепловая ловушка)
    UNKNOWN      = 6,
    COUNT        = 7,
};

constexpr const char* GT_NAMES[7] = {
    "опорник", "блиндаж", "РЭБ", "техника", "человек", "ложная цель", "неизвестно"
};

// ═══════════════════════════════════════════════════════════════════════════════
// Признаки наземной цели (с борта БПЛА, вид сверху)
// ═══════════════════════════════════════════════════════════════════════════════

struct GroundFeatures {
    // ── Геометрия (FPGA, Tang Nano 9K) ────────────────────────────────
    float area_m2;           // площадь [м²]
    float perimeter_m;       // периметр [м]
    float aspect_ratio;      // длина/ширина
    float convexity;         // выпуклость (0..1, 1=идеальный прямоугольник)
    float rectangularity;    // степень прямоугольности (0..1)

    // ── Текстура/цвет (Orange Pi 5, CNN) ──────────────────────────────
    float green_ratio;       // доля зелёного (камуфляж vs бетон)
    float texture_variance;  // дисперсия текстуры (земля vs техника)
    float edge_density;      // плотность границ (антенны РЭБ = много краёв)

    // ── Тепловой профиль (тепловизор) ────────────────────────────────
    float temp_max;          // макс температура [°C]
    float temp_mean;         // средняя
    float temp_variance;     // дисперсия (работающий двигатель = горячие пятна)
    int   hot_spots;         // число горячих пятен (>2σ)

    // ── RF-профиль (SDR) ──────────────────────────────────────────────
    float rf_power;          // мощность излучения [dBm] (норм.)
    float rf_bandwidth;      // ширина спектра [MHz]
    float rf_duty_cycle;     // скважность (РЭБ = почти непрерывно)
    int   rf_peaks;          // число пиков в спектре

    // ── Контекст (Cube Orange+ GPS + карта) ───────────────────────────
    float dist_to_road_m;     // расстояние до дороги [м]
    float dist_to_trench_m;   // расстояние до траншеи
    float nearby_objects;     // число объектов в радиусе 50м
    float elevation_m;        // высота над уровнем моря

    // ── Динамика (трекер, несколько кадров) ──────────────────────────
    float speed_ms;           // скорость [м/с] (0 = статика)
    float heading_change;     // изменение курса [°/с]

    // Нормализация
    void normalize() {
        area_m2        = std::clamp(area_m2 / 500.0f, 0.0f, 1.0f);
        perimeter_m    = std::clamp(perimeter_m / 200.0f, 0.0f, 1.0f);
        aspect_ratio   = std::clamp(aspect_ratio / 5.0f, 0.0f, 1.0f);
        convexity      = std::clamp(convexity, 0.0f, 1.0f);
        rectangularity = std::clamp(rectangularity, 0.0f, 1.0f);
        green_ratio    = std::clamp(green_ratio, 0.0f, 1.0f);
        texture_variance = std::clamp(texture_variance, 0.0f, 1.0f);
        edge_density   = std::clamp(edge_density, 0.0f, 1.0f);
        temp_max       = std::clamp(temp_max / 80.0f, 0.0f, 1.0f);
        temp_mean      = std::clamp(temp_mean / 60.0f, 0.0f, 1.0f);
        rf_power       = std::clamp(rf_power / 30.0f, 0.0f, 1.0f);
        rf_bandwidth   = std::clamp(rf_bandwidth / 100.0f, 0.0f, 1.0f);
    }

    float to_array(float* out) const {
        out[0]=area_m2; out[1]=perimeter_m; out[2]=aspect_ratio;
        out[3]=convexity; out[4]=rectangularity; out[5]=green_ratio;
        out[6]=texture_variance; out[7]=edge_density; out[8]=temp_max;
        out[9]=temp_mean; out[10]=temp_variance; out[11]=(float)hot_spots/10.0f;
        out[12]=rf_power; out[13]=rf_bandwidth; out[14]=rf_duty_cycle;
        out[15]=(float)rf_peaks/10.0f; out[16]=dist_to_road_m/100.0f;
        out[17]=dist_to_trench_m/50.0f; out[18]=nearby_objects/10.0f;
        out[19]=speed_ms/30.0f;
        return 20;
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// L1: FPGA-классификатор (Tang Nano 9K, <1ms)
// ═══════════════════════════════════════════════════════════════════════════════

namespace fpga_L1 {

// Быстрые геометрические правила (реализуются на FPGA lookup-таблицей)
inline GroundTarget classify(const GroundFeatures& f) {
    // Правило 1: Прямоугольник + большая площадь + траншеи рядом → опорник
    if (f.rectangularity > 0.7f && f.area_m2 > 50.0f && f.dist_to_trench_m < 20.0f)
        return GroundTarget::STRONGPOINT;

    // Правило 2: Маленький + бетон (серый) + низкая текстура → блиндаж
    if (f.area_m2 < 30.0f && f.area_m2 > 5.0f && f.green_ratio < 0.2f && f.texture_variance < 0.3f)
        return GroundTarget::BUNKER;

    // Правило 3: Вытянутый (aspect > 3) + скорость > 0 → техника
    if (f.aspect_ratio > 2.5f && f.speed_ms > 0.5f)
        return GroundTarget::VEHICLE;

    // Правило 4: Высокая плотность краёв + RF → РЭБ
    if (f.edge_density > 0.6f && f.rf_power > 5.0f)
        return GroundTarget::EW_STATION;

    // Правило 5: Маленький + двигается медленно → человек
    if (f.area_m2 < 3.0f && f.speed_ms > 0.1f && f.speed_ms < 5.0f)
        return GroundTarget::PERSON;

    return GroundTarget::UNKNOWN;
}

} // namespace fpga_L1

// ═══════════════════════════════════════════════════════════════════════════════
// L2: ПОЛНЫЙ КЛАССИФИКАТОР (Orange Pi 5, ~10μs)
// ═══════════════════════════════════════════════════════════════════════════════

struct GroundClassifier {
    static constexpr int NF = 20;
    float class_weights[7][NF] = {0};  // зарезервировано для нейросетевого обучения

    GroundClassifier() {}

    struct Result {
        GroundTarget target;
        float confidence;
        const char* name;
        float scores[7];
        const char* reasoning;
    };

    Result classify(const GroundFeatures& f_raw) {
        // Используем НЕнормированные признаки для сравнения с физическими порогами
        const GroundFeatures& f = f_raw;

        float scores[7] = {0};
        float total = 0;

        // ── Дерево решений: проверяем КЛЮЧЕВЫЕ признаки ────────────────

        // РЭБ: мощное RF (>10 dBm) + много краёв + горячий генератор
        if (f.rf_power > 10.0f && f.edge_density > 0.4f && f.temp_max > 30.0f) {
            scores[(int)GroundTarget::EW_STATION] += 3.0f;
            total += 3.0f;
        }

        // Опорник: прямоугольный + траншеи рядом + много объектов вокруг
        if (f.rectangularity > 0.6f && f.dist_to_trench_m < 25.0f && f.nearby_objects > 3) {
            scores[(int)GroundTarget::STRONGPOINT] += 3.0f;
            total += 3.0f;
        }

        // Блиндаж: маленький (5-30м²) + очень прямоугольный + НЕ зелёный
        if (f.area_m2 > 5.0f && f.area_m2 < 30.0f && f.rectangularity > 0.7f
            && f.green_ratio < 0.3f) {
            scores[(int)GroundTarget::BUNKER] += 3.0f;
            total += 3.0f;
        }

        // Техника: вытянутая + горячая + (движется ИЛИ у дороги)
        if (f.aspect_ratio > 2.0f && f.temp_max > 35.0f) {
            if (f.speed_ms > 1.0f || f.dist_to_road_m < 20.0f) {
                scores[(int)GroundTarget::VEHICLE] += 3.0f;
                total += 3.0f;
            }
        }

        // Человек: очень маленький + тёплый
        if (f.area_m2 < 3.0f && f.temp_max > 28.0f && f.temp_max < 40.0f) {
            scores[(int)GroundTarget::PERSON] += 3.0f;
            total += 3.0f;
        }

        // Ложная цель: геометрия как у цели НО холодная И без RF И без движения
        if ((f.aspect_ratio > 1.8f || f.rectangularity > 0.5f)
            && f.temp_max < 22.0f && f.rf_power < 2.0f && f.speed_ms < 0.5f) {
            scores[(int)GroundTarget::DECOY] += 3.0f;
            total += 3.0f;
        }

        // ── Аргмакс ────────────────────────────────────────────────────
        int best = (int)GroundTarget::UNKNOWN;
        for (int c = 0; c < 6; c++) {
            if (scores[c] > scores[best]) best = c;
        }

        Result r;
        r.target = static_cast<GroundTarget>(best);
        r.name = GT_NAMES[best];
        r.confidence = total > 0 ? scores[best] / (total + 0.001f) : 0;
        memcpy(r.scores, scores, sizeof(scores));
        r.reasoning = GT_NAMES[best];
        return r;
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// КОНВЕЙЕР: 3 платы
// ═══════════════════════════════════════════════════════════════════════════════

struct OnboardPipeline {
    GroundClassifier L2;

    struct PipelineResult {
        GroundTarget fpga_L1;      // Tang Nano 9K (<1ms)
        GroundClassifier::Result L2_result;  // Orange Pi 5 (~10μs)
        GroundTarget final_target;
        bool attack_recommended;
        const char* action;
    };

    PipelineResult process(const GroundFeatures& f) {
        PipelineResult r;

        // ── Этап 1: FPGA L1 — быстрый геометрический фильтр ──────────
        r.fpga_L1 = fpga_L1::classify(f);

        // ── Этап 2: Orange Pi L2 — полный классификатор ───────────────
        r.L2_result = L2.classify(f);

        // ── Этап 3: Fusion L1 + L2 ─────────────────────────────────────
        if (r.fpga_L1 == r.L2_result.target || r.fpga_L1 == GroundTarget::UNKNOWN) {
            r.final_target = r.L2_result.target;
        } else {
            // Конфликт: L1 говорит X, L2 говорит Y → верим L2 (больше признаков)
            r.final_target = r.L2_result.target;
        }

        // ── Этап 4: Рекомендация атаки (для собора агентов) ───────────
        switch (r.final_target) {
            case GroundTarget::STRONGPOINT:
                r.attack_recommended = true;
                r.action = "ЦЕЛЬ: опорник. Рекомендация: атака FPV-дроном. Приоритет: высокий.";
                break;
            case GroundTarget::EW_STATION:
                r.attack_recommended = true;
                r.action = "ЦЕЛЬ: РЭБ. Рекомендация: атака FPV. Приоритет: КРИТИЧЕСКИЙ (ослепляет рои).";
                break;
            case GroundTarget::VEHICLE:
                r.attack_recommended = true;
                r.action = "ЦЕЛЬ: техника. Рекомендация: атака FPV. Приоритет: высокий (подвижная).";
                break;
            case GroundTarget::BUNKER:
                r.attack_recommended = true;
                r.action = "ЦЕЛЬ: блиндаж. Рекомендация: атака FPV. Приоритет: средний (статичен).";
                break;
            case GroundTarget::PERSON:
                r.attack_recommended = false;
                r.action = "ЦЕЛЬ: человек. Рекомендация: НАБЛЮДАТЬ. Передать собору — возможно гражданский.";
                break;
            case GroundTarget::DECOY:
                r.attack_recommended = false;
                r.action = "ЦЕЛЬ: ложная. Рекомендация: ИГНОРИРОВАТЬ. Не тратить боекомплект.";
                break;
            default:
                r.attack_recommended = false;
                r.action = "ЦЕЛЬ: не определена. Рекомендация: запрос разведчику или оператору.";
        }

        return r;
    }
};

} // namespace ground_targets
