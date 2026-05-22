#pragma once
/**
 * fuzzy_classifier.h — Классификация целей БПЛА
 *
 * Синтез двух источников:
 *   Данцевич, гл.3.6: fuzzy-логика + wavelet-нейросеть + самоорганизация
 *   Филатов и др.: символьные процессоры для бортовой обработки изображений
 *
 * Архитектура:
 *   1. Признаки → DWT Добеши-4 → спектральные коэффициенты
 *   2. Коэффициенты → Fuzzy-классификатор (Гауссовы функции принадлежности)
 *   3. Классификатор → Самоорганизующаяся нейросеть (адаптация весов)
 *
 * Цели: оператор, препятствие, гражданский, техника, другой дрон, неизвестно
 *
 * Orange Pi 5 (A55 @ 1.8GHz). Вход: вектор признаков (8-16 float).
 * Время классификации: ~20μs.
 */

#include <cmath>
#include <cstring>
#include <cstdint>
#include <algorithm>

namespace fuzzy_classifier {

// ═══════════════════════════════════════════════════════════════════════════════
// Типы целей
// ═══════════════════════════════════════════════════════════════════════════════

enum class TargetClass : uint8_t {
    OPERATOR    = 0,  // свой оператор / союзный борт
    OBSTACLE    = 1,  // препятствие (здание, дерево, ЛЭП)
    CIVILIAN    = 2,  // гражданское лицо / транспорт
    VEHICLE     = 3,  // военная техника
    ENEMY_DRONE = 4,  // вражеский БПЛА
    UNKNOWN     = 5,  // не классифицировано
    COUNT       = 6
};

constexpr const char* TARGET_NAMES[6] = {
    "оператор", "препятствие", "гражданский",
    "техника", "вражеский дрон", "неизвестно"
};

// ═══════════════════════════════════════════════════════════════════════════════
// Признаки цели (feature vector)
// ═══════════════════════════════════════════════════════════════════════════════

struct TargetFeatures {
    float size_m;           // размер объекта [м]
    float speed_ms;         // скорость [м/с]
    float altitude_m;       // высота [м]
    float rcs_dbsm;         // RCS [dBsm] (радиолокационная заметность)
    float heat_signature;   // тепловая сигнатура [0..1]
    float aspect_ratio;     // соотношение сторон (ширина/высота)
    float trajectory_var;   // дисперсия траектории (манёвренность)
    float rf_emission;      // радиоизлучение [0..1] (наличие передатчика)

    // Нормализация в [0..1]
    void normalize() {
        size_m      = std::clamp(size_m / 20.0f, 0.0f, 1.0f);       // до 20м
        speed_ms    = std::clamp(speed_ms / 50.0f, 0.0f, 1.0f);     // до 50 м/с
        altitude_m  = std::clamp(altitude_m / 1000.0f, 0.0f, 1.0f);  // до 1000м
        rcs_dbsm    = std::clamp((rcs_dbsm + 40.0f) / 60.0f, 0.0f, 1.0f); // -40..+20 dBsm
        heat_signature = std::clamp(heat_signature, 0.0f, 1.0f);
        aspect_ratio   = std::clamp(aspect_ratio / 4.0f, 0.0f, 1.0f);       // до 4:1
        trajectory_var = std::clamp(trajectory_var, 0.0f, 1.0f);
        rf_emission    = std::clamp(rf_emission, 0.0f, 1.0f);
    }

    // Получить как float[8]
    float* as_array(float* out) const {
        out[0]=size_m; out[1]=speed_ms; out[2]=altitude_m; out[3]=rcs_dbsm;
        out[4]=heat_signature; out[5]=aspect_ratio; out[6]=trajectory_var; out[7]=rf_emission;
        return out;
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DWT Добеши-4 для признаков (Данцевич, 3.6)
// ═══════════════════════════════════════════════════════════════════════════════

constexpr float D4_H[4] = {
     0.4829629131445341f,  0.8365163037378079f,
     0.2241438680420134f, -0.1294095225512604f
};

// Декомпозиция 8 признаков → 8 спектральных коэффициентов (1 уровень D4)
inline void wavelet_decompose(const float* features, float* coeffs) {
    for (int i = 0; i < 4; i++) {
        float s = 0, d = 0;
        for (int k = 0; k < 4; k++) {
            int idx = 2 * i + k;
            s += D4_H[k] * features[idx];
            // G_k = (-1)^k * H_(3-k)
            float g = (k % 2 ? -1.0f : 1.0f) * D4_H[3 - k];
            d += g * features[idx];
        }
        coeffs[i]     = s / 1.41421356f;  // аппроксимация
        coeffs[4 + i] = d / 1.41421356f;  // детали
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fuzzy-классификатор: Гауссовы функции принадлежности (Данцевич, 3.36)
// ═══════════════════════════════════════════════════════════════════════════════

struct FuzzyClass {
    float center;    // центр гауссианы
    float sigma;     // ширина
    float weight;    // вес класса (обучаемый)

    float membership(float x) const {
        float dx = (x - center) / sigma;
        return weight * std::exp(-0.5f * dx * dx);
    }
};

// Эталонные центры для 6 классов целей (8 признаков × 6 классов)
// [class][feature] — центр гауссианы
constexpr float CLASS_CENTERS[6][8] = {
    // OPERATOR: маленький, медленный, низко, слабый RCS, тёплый, ~1:1, плавный, есть RF
    {0.05f, 0.02f, 0.02f, 0.15f, 0.8f, 0.5f, 0.1f, 0.9f},
    // OBSTACLE: разный, нулевая скорость, разная высота, разный RCS, холодный, разный, нулевая, 0
    {0.3f,  0.0f,  0.3f,  0.5f,  0.1f, 0.5f, 0.0f, 0.0f},
    // CIVILIAN: средний, медленный, низко, слабый RCS, тёплый, ~1:1, плавный, может быть RF
    {0.1f,  0.1f,  0.1f,  0.2f,  0.7f, 0.6f, 0.2f, 0.3f},
    // VEHICLE: большой, средняя скорость, низко, сильный RCS, горячий, ~2:1, плавный, слабый RF
    {0.7f,  0.3f,  0.0f,  0.8f,  0.9f, 0.3f, 0.2f, 0.2f},
    // ENEMY_DRONE: маленький, быстрый, разная высота, средний RCS, средний, разный, манёвренный, сильный RF
    {0.08f, 0.6f,  0.3f,  0.4f,  0.5f, 0.5f, 0.9f, 0.8f},
    // UNKNOWN: всё по 0.5 (максимальная неопределённость)
    {0.5f,  0.5f,  0.5f,  0.5f,  0.5f, 0.5f, 0.5f, 0.5f},
};

constexpr float CLASS_SIGMAS[8] = {
    0.3f, 0.3f, 0.4f, 0.3f, 0.3f, 0.2f, 0.3f, 0.3f
};

// ═══════════════════════════════════════════════════════════════════════════════
// Самоорганизующийся нейроклассификатор (Данцевич, 3.6)
// ═══════════════════════════════════════════════════════════════════════════════

class NeuroFuzzyClassifier {
    FuzzyClass classes[6][8];       // 6 целей × 8 признаков
    float class_weights[6] = {1,1,1,1,1,1};   // априорные веса классов
    float learning_rate = 0.01f;
    int   samples_seen = 0;

public:
    NeuroFuzzyClassifier() {
        // Инициализация эталонными центрами
        for (int c = 0; c < 6; c++) {
            for (int f = 0; f < 8; f++) {
                classes[c][f] = {
                    CLASS_CENTERS[c][f],
                    CLASS_SIGMAS[f],
                    1.0f
                };
            }
        }
    }

    // ── Классификация ──────────────────────────────────────────────────

    TargetClass classify(const TargetFeatures& features) {
        float fvec[8];
        features.as_array(fvec);

        // Fuzzy-оценка по СЫРЫМ признакам (wavelet — только для обучения/анализа спектра)
        float scores[6] = {0};
        for (int c = 0; c < 6; c++) {
            for (int f = 0; f < 8; f++) {
                scores[c] += classes[c][f].membership(fvec[f]);
            }
            scores[c] *= class_weights[c];
        }

        int best = 0;
        for (int c = 1; c < 6; c++) {
            if (scores[c] > scores[best]) best = c;
        }

        if (scores[best] < 1.5f) return TargetClass::UNKNOWN;
        return static_cast<TargetClass>(best);
    }

    // ── Классификация с уверенностью ───────────────────────────────────

    struct ClassificationResult {
        TargetClass target;
        float confidence;       // [0..1]
        float scores[6];        // все оценки
        const char* name;
    };

    ClassificationResult classify_detailed(const TargetFeatures& features) {
        float fvec[8];
        features.as_array(fvec);

        float scores[6] = {0};
        float total = 0;
        for (int c = 0; c < 6; c++) {
            for (int f = 0; f < 8; f++) {
                scores[c] += classes[c][f].membership(fvec[f]);
            }
            scores[c] = std::max(0.0f, scores[c]);
            total += scores[c];
        }

        int best = 0;
        for (int c = 1; c < 6; c++) {
            if (scores[c] > scores[best]) best = c;
        }

        ClassificationResult r;
        r.target = static_cast<TargetClass>(best);
        r.confidence = total > 0 ? scores[best] / total : 0;
        memcpy(r.scores, scores, sizeof(scores));
        r.name = TARGET_NAMES[best];
        return r;
    }

    // ── Обучение (самоорганизация) ─────────────────────────────────────

    void learn(const TargetFeatures& features, TargetClass true_class, float rate = 0.0f) {
        float lr = rate > 0 ? rate : learning_rate;
        float fvec[8], coeffs[8];
        features.as_array(fvec);
        wavelet_decompose(fvec, coeffs);

        // Подтягиваем центры ИСТИННОГО класса к наблюдённым коэффициентам
        for (int f = 0; f < 8; f++) {
            float dx = coeffs[f] - classes[(int)true_class][f].center;
            classes[(int)true_class][f].center += lr * dx;
        }
        class_weights[(int)true_class] += lr * 0.1f;

        // Отталкиваем центры НЕВЕРНЫХ классов
        for (int c = 0; c < 6; c++) {
            if (c == (int)true_class) continue;
            for (int f = 0; f < 8; f++) {
                float dx = coeffs[f] - classes[c][f].center;
                classes[c][f].center -= lr * 0.1f * dx;
            }
        }

        samples_seen++;
        // Затухание learning rate
        if (samples_seen > 100) learning_rate = 0.01f / (1.0f + 0.01f * (samples_seen - 100));
    }

    // ── Дообучение на основе операторской коррекции ────────────────────

    void operator_correction(const TargetFeatures& features, TargetClass corrected) {
        learn(features, corrected, 0.05f);  // высокая скорость для ручной коррекции
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// Символьный признаковый процессор (Филатов и др.)
// ═══════════════════════════════════════════════════════════════════════════════

struct SymbolicProcessor {
    // Бортовое правило: «если РЛС-сигнатура > порога И скорость > порога → вражеский дрон»
    struct SymbolicRule {
        int feature_idx;
        float threshold;
        bool greater_than;      // true = > threshold, false = < threshold
        TargetClass conclusion;
    };

    static constexpr int MAX_RULES = 12;
    SymbolicRule rules[MAX_RULES];
    int rule_count = 0;

    SymbolicProcessor() {
        // Быстрые символьные правила (работают до нейросети)
        add_rule({3, 0.6f, true,  TargetClass::VEHICLE});        // RCS > 0.6 → техника
        add_rule({1, 0.4f, true,  TargetClass::ENEMY_DRONE});     // скорость > 0.4 → вражеский дрон
        add_rule({6, 0.7f, true,  TargetClass::ENEMY_DRONE});     // манёвренность > 0.7 → вражеский дрон
        add_rule({7, 0.5f, true,  TargetClass::OPERATOR});        // RF > 0.5 → свой (телеметрия)
        add_rule({0, 0.02f, false, TargetClass::OPERATOR});       // размер < 0.02 → свой (микро-дрон)
        add_rule({1, 0.01f, false, TargetClass::OBSTACLE});       // скорость ~0 → препятствие
        add_rule({4, 0.7f, true,  TargetClass::VEHICLE});         // тёплый > 0.7 → техника
        add_rule({5, 0.7f, true,  TargetClass::VEHICLE});         // вытянутый > 0.7 → техника
    }

    void add_rule(SymbolicRule r) {
        if (rule_count < MAX_RULES) rules[rule_count++] = r;
    }

    // Быстрая классификация — O(rules) вместо O(classes×features)
    TargetClass quick_classify(const TargetFeatures& f) {
        float fvec[8]; f.as_array(fvec);
        TargetClass result = TargetClass::UNKNOWN;
        float best_conf = 0;

        for (int i = 0; i < rule_count; i++) {
            auto& r = rules[i];
            float val = fvec[r.feature_idx];
            bool match = r.greater_than ? (val > r.threshold) : (val < r.threshold);
            if (match) {
                // Первое совпадение — возвращаем (быстрый путь)
                return r.conclusion;
            }
        }
        return TargetClass::UNKNOWN;
    }
};

} // namespace fuzzy_classifier
