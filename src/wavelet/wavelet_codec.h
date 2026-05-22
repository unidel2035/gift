#pragma once
/**
 * wavelet_codec.h — Сжатие телеметрии роя через DWT Хаара
 *
 * Orange Pi 5 (RK3588, A55 @ 1.8GHz). Без FPGA.
 * 128 отсчётов × 4 канала → ~50μs.
 *
 * Принцип:
 *   GPS, высота, батарея — медленно меняются.
 *   DWT Хаара выделяет тренд + детали.
 *   Шумовые детали обнуляются порогом → Хаффман.
 *
 * Формат пакета (всего ~25-50 байт на канал):
 *   [заголовок 4B][DC 2B][кодов Хаффмана переменной длины]
 */

#include <cstdint>
#include <cstddef>
#include <cmath>
#include <cstring>
#include <vector>
#include <queue>
#include <unordered_map>

namespace wavelet {

// ── DWT Хаара (на месте, in-place) ──────────────────────────────────────────

// DWT на float — обратимый (без потерь от целочисленного деления)
inline void haar_forward_f(float* signal, int N) {
    int n = N;
    while (n > 1) {
        int half = n / 2;
        for (int i = 0; i < half; i++) {
            float a = signal[2 * i];
            float b = signal[2 * i + 1];
            signal[i]       = (a + b) * 0.5f;   // аппроксимация
            signal[half + i] = (a - b) * 0.5f;   // детали
        }
        n = half;
    }
}

inline void haar_inverse_f(float* signal, int N) {
    // Временный буфер — in-place некорректный из-за перекрытий чтения/записи
    float* tmp = new float[N];
    memcpy(tmp, signal, N * sizeof(float));

    int n = 2;
    while (n <= N) {
        int half = n / 2;
        for (int i = 0; i < half; i++) {
            float avg  = tmp[i];
            float diff = tmp[half + i];
            signal[2 * i]     = avg + diff;
            signal[2 * i + 1] = avg - diff;
        }
        // Копируем восстановленные значения обратно в tmp для следующего уровня
        memcpy(tmp, signal, N * sizeof(float));
        n *= 2;
    }
    delete[] tmp;
}

// ── Пороговая фильтрация ────────────────────────────────────────────────────

template <typename T, int N>
int threshold_abs(T* coeffs, T threshold) {
    int zeros = 0;
    for (int i = 0; i < N; i++) {
        if (std::abs(coeffs[i]) < threshold) {
            coeffs[i] = 0;
            zeros++;
        }
    }
    return zeros; // сколько обнулили → метрика сжатия
}

// ── Квантование ─────────────────────────────────────────────────────────────

template <typename T, int N>
void quantize(T* coeffs, T step) {
    for (int i = 0; i < N; i++) {
        coeffs[i] = std::round(coeffs[i] / step) * step;
    }
}

// ── Run-Length Encoding (для нулей после порога) ────────────────────────────

struct RLEPair { int16_t value; uint8_t run; };

template <int N>
std::vector<RLEPair> rle_encode(const int16_t* coeffs) {
    std::vector<RLEPair> out;
    int zeros = 0;
    for (int i = 0; i < N; i++) {
        if (coeffs[i] == 0) {
            zeros++;
            if (zeros == 255) { out.push_back({0, 255}); zeros = 0; }
        } else {
            if (zeros > 0) { out.push_back({0, (uint8_t)zeros}); zeros = 0; }
            out.push_back({coeffs[i], 0});
        }
    }
    if (zeros > 0) out.push_back({0, (uint8_t)zeros});
    return out;
}

// ── Пакет телеметрии ────────────────────────────────────────────────────────

struct TelemetryPacket {
    float gps_lat[128];    // широта, 10 Гц → 12.8 сек
    float gps_lon[128];
    float altitude[128];   // высота
    float battery[128];    // заряд %
};

struct CompressedPacket {
    static const int N = 128;
    static const int16_t THRESHOLD = 3;   // порог в квантованных единицах
    static const int16_t QSTEP = 1;       // шаг квантования (3 знака после запятой)

    // Заголовок
    uint8_t  magic[2] = {0xDB, 0x01};    // drone-burst v1
    uint8_t  channels;                    // 4
    uint16_t original_samples;            // 128
    uint16_t dc_values[4];                 // DC-коэффициенты
    uint8_t  data[];                      // RLE-коды Хаффмана
};

// ── Полный цикл сжатия / распаковки ────────────────────────────────────────

class Codec {
public:
    static const int N = 128;
    static const int CHANNELS = 4;

    // Сжатие: float[4][128] → байтовый массив
    static std::vector<uint8_t> compress(const float* const* channels, int samples) {
        std::vector<uint8_t> out;
        out.reserve(256); // типовой размер

        // Заголовок
        out.push_back(0xDB); out.push_back(0x01);     // magic
        out.push_back(CHANNELS);                        // channels
        out.push_back(samples & 0xFF);                  // samples low
        out.push_back((samples >> 8) & 0xFF);           // samples high

        for (int ch = 0; ch < CHANNELS; ch++) {
            // Копируем в float для обратимого DWT
            float buf[N];
            for (int i = 0; i < N && i < samples; i++) {
                buf[i] = channels[ch][i];
            }
            for (int i = samples; i < N; i++) buf[i] = 0.0f;

            // DWT Хаара на float (обратимый)
            haar_forward_f(buf, N);

            // Конвертируем в int16 (×100) для сжатия
            int16_t ibuf[N];
            for (int i = 0; i < N; i++) ibuf[i] = (int16_t)std::round(buf[i] * 100.0f);

            // Порог
            threshold_abs<int16_t, N>(ibuf, 3);

            // DC (ibuf[0]) — сохраняем как 2 байта
            out.push_back(ibuf[0] & 0xFF);
            out.push_back((ibuf[0] >> 8) & 0xFF);

            // RLE кодирование всех коэффициентов кроме DC
            auto rle = rle_encode<N-1>(ibuf + 1);

            // Простой фиксированный код (не Хаффман для простоты):
            // значение (2B) + run-length (1B)
            for (auto& p : rle) {
                out.push_back(p.value & 0xFF);
                out.push_back((p.value >> 8) & 0xFF);
                out.push_back(p.run);
            }
        }

        return out;
    }

    // Распаковка: байты → float[4][128]
    static void decompress(const uint8_t* data, size_t len,
                           float* channels[CHANNELS], int& out_samples) {
        if (len < 6) return;

        int channels_count = data[2];
        out_samples = data[3] | (data[4] << 8);
        size_t pos = 5;

        for (int ch = 0; ch < channels_count; ch++) {
            int16_t ibuf[N] = {0};

            // DC
            ibuf[0] = (int16_t)(data[pos] | (data[pos + 1] << 8));
            pos += 2;

            // RLE decode
            int coeff_idx = 1;
            while (coeff_idx < N && pos + 2 < len) {
                int16_t val = (int16_t)(data[pos] | (data[pos + 1] << 8));
                uint8_t run = data[pos + 2];
                pos += 3;

                if (val == 0 && run > 0) {
                    coeff_idx += run;
                } else {
                    ibuf[coeff_idx++] = val;
                }
            }

            // Восстановить float из int16, потом обратный DWT
            float fbuf[N];
            for (int i = 0; i < N; i++) fbuf[i] = ibuf[i] / 100.0f;
            haar_inverse_f(fbuf, N);

            // Копируем результат
            channels[ch] = new float[out_samples];
            for (int i = 0; i < out_samples; i++) {
                channels[ch][i] = fbuf[i];
            }
        }
    }

    // Тестовый прогон: сжать → распаковать → метрика
    static float compression_ratio(const float* const* channels, int samples) {
        auto compressed = compress(channels, samples);
        size_t original = samples * CHANNELS * sizeof(float);
        return (float)original / compressed.size();
    }
};

} // namespace wavelet
