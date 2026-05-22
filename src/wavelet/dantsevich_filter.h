#pragma once
/**
 * dantsevich_filter.h — Адаптивный wavelet-фильтр по методологии Данцевича (гл. 7)
 *
 * Реализует:
 *   1. DWT Добеши-4 (D4) — лучшее частотное разделение чем Хаар
 *   2. Адаптивный трешолдинг по уровню шума (7.42-7.47)
 *   3. Градиентный адаптивный фильтр (7.56-7.59)
 *   4. Синтез сигнала управления по спектральным оценкам (7.91)
 *
 * Orange Pi 5 (A55 @ 1.8GHz). Зависимости: <cmath>, <cstring>
 */

#include <cmath>
#include <cstring>
#include <cstdint>
#include <algorithm>

namespace dantsevich {

// ═══════════════════════════════════════════════════════════════════════════════
// Добеши-4 (D4) — коэффициенты
// ═══════════════════════════════════════════════════════════════════════════════

// Daubechies-4 scaling (H) and wavelet (G) coefficients
// G_k = (-1)^k * H_(3-k)  — quadrature mirror filter
constexpr float D4_H[4] = {
     0.4829629131445341f,  0.8365163037378079f,
     0.2241438680420134f, -0.1294095225512604f
};
constexpr float D4_G[4] = {
    -0.1294095225512604f, -0.2241438680420134f,
     0.8365163037378079f, -0.4829629131445341f
};

// ═══════════════════════════════════════════════════════════════════════════════
// DWT Добеши-4 — свёртка + децимация (классический алгоритм Малла)
// ═══════════════════════════════════════════════════════════════════════════════

// Прямое D4: сигнал → свёртка с H/G → децимация
template <int N>
void db4_forward(float* signal) {
    float tmp[N];
    int n = N;

    while (n >= 4) {
        int half = n / 2;
        memcpy(tmp, signal, n * sizeof(float));

        for (int i = 0; i < half; i++) {
            float s = 0, d = 0;
            for (int k = 0; k < 4; k++) {
                int idx = (2 * i + k) % n;  // периодическое расширение
                s += D4_H[k] * tmp[idx];
                d += D4_G[k] * tmp[idx];
            }
            signal[i]       = s / 1.41421356f;  // нормировка √2
            signal[half + i] = d / 1.41421356f;
        }
        n = half;
    }
}

// Обратное D4
template <int N>
void db4_inverse(float* signal) {
    float src[N], dst[N];
    memcpy(src, signal, N * sizeof(float));

    int n = 4;
    while (n < N) {
        int half = n / 2;
        memset(dst, 0, N * sizeof(float));

        for (int i = 0; i < half; i++) {
            float a = src[i] * 1.41421356f;
            float d = src[half + i] * 1.41421356f;
            for (int k = 0; k < 4; k++) {
                int idx = (2 * i + k) % (n * 2);  // индекс в реконструируемом сигнале
                dst[idx] += D4_H[3 - k] * a + D4_G[3 - k] * d;
            }
        }
        memcpy(src, dst, n * 2 * sizeof(float));
        n *= 2;
    }
    memcpy(signal, dst, N * sizeof(float));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Адаптивный трешолдинг по уровню шума (7.42-7.47)
// ═══════════════════════════════════════════════════════════════════════════════

template <int N>
float estimate_noise_level(const float* coeffs) {
    // Медианная оценка шума по деталям верхнего уровня (MAD)
    float det[N/2];
    memcpy(det, coeffs + N/2, (N/2) * sizeof(float));
    std::nth_element(det, det + N/4, det + N/2);
    float median = std::abs(det[N/4]);
    return median / 0.6745f;  // нормализация для гауссова шума
}

template <int N>
float adaptive_threshold(float noise_level, int level, int current_size) {
    // VisuShrink: универсальный порог с поправкой на уровень
    float sigma = noise_level * std::sqrt(2.0f * std::log(current_size));
    return 3.0f * sigma;
}

template <int N>
void soft_threshold(float* coeffs, float threshold) {
    for (int i = 0; i < N; i++) {
        if (std::abs(coeffs[i]) < threshold) {
            coeffs[i] = 0;
        } else if (coeffs[i] > 0) {
            coeffs[i] -= threshold;
        } else {
            coeffs[i] += threshold;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Градиентный адаптивный фильтр (7.56-7.59)
// ═══════════════════════════════════════════════════════════════════════════════

struct AdaptiveFilter {
    static const int TAPS = 4;
    float weights[TAPS] = {0.25f, 0.25f, 0.25f, 0.25f};  // начальные
    float mu = 0.01f;   // шаг адаптации
    float buffer[TAPS] = {0};

    // LMS-фильтрация одного отсчёта
    float filter(float input) {
        // Сдвиг буфера
        for (int i = TAPS - 1; i > 0; i--) buffer[i] = buffer[i - 1];
        buffer[0] = input;

        // Свёртка
        float y = 0;
        for (int i = 0; i < TAPS; i++) y += weights[i] * buffer[i];
        return y;
    }

    // Адаптация весов (градиентный спуск)
    void adapt(float error) {
        for (int i = 0; i < TAPS; i++) {
            weights[i] += mu * error * buffer[i];
        }
    }

    // Полный цикл: фильтр + адаптация
    float process(float input, float desired) {
        float output = filter(input);
        float error = desired - output;
        adapt(error);
        return output;
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// Синтез сигнала управления по спектральным оценкам (7.91)
// ═══════════════════════════════════════════════════════════════════════════════

struct SpectralController {
    AdaptiveFilter af;
    static const int N = 128;
    float coeffs[N];
    float noise_level = 1.0f;

    // Обработка телеметрии: DWT → трешолдинг → синтез
    void process_telemetry(float* signal, int len) {
        // 1. DWT Добеши-4
        db4_forward<N>(signal);

        // 2. Оценка шума по деталям верхнего уровня
        noise_level = 0.9f * noise_level + 0.1f * estimate_noise_level<N>(signal);

        // 3. Адаптивный трешолдинг по уровням (только детали)
        int n = N;
        int level = 1;
        while (n >= 4) {
            int half = n / 2;
            float thresh = adaptive_threshold<N>(noise_level, level++, n);
            soft_threshold<N>(signal + half, thresh);  // детали = signal[half..n-1]
            n = half;
        }

        // 4. Обратный DWT
        db4_inverse<N>(signal);

        // 5. Адаптивная фильтрация
        for (int i = 0; i < len; i++) {
            signal[i] = af.filter(signal[i]);
        }
    }

    // Оценка качества управления по спектру (7.91)
    float control_quality(const float* filtered, const float* original, int len) {
        float energy_signal = 0, energy_noise = 0;
        for (int i = 0; i < len; i++) {
            energy_signal += filtered[i] * filtered[i];
            float diff = filtered[i] - original[i];
            energy_noise += diff * diff;
        }
        return 10.0f * std::log10(energy_signal / (energy_noise + 1e-10f));
    }
};

} // namespace dantsevich
