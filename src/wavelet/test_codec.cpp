/**
 * test_codec.cpp — тест wavelet-кодека на симулированной телеметрии
 *
 * Сборка: g++ -std=c++17 -O2 test_codec.cpp -o test_codec && ./test_codec
 */

#include "wavelet_codec.h"
#include <cstdio>
#include <cstdlib>
#include <cmath>

using namespace wavelet;

int main() {
    const int N = 128;
    const int CH = 4;

    // Симулируем телеметрию: дрон летит по синусоиде + шум
    float* channels[CH];
    for (int c = 0; c < CH; c++) channels[c] = new float[N];

    for (int i = 0; i < N; i++) {
        channels[0][i] = 55.75f + 0.001f * i + 0.0001f * sin(0.1f * i);   // GPS lat
        channels[1][i] = 37.62f + 0.001f * i + 0.0001f * cos(0.1f * i);   // GPS lon
        channels[2][i] = 100.0f + 20.0f * sin(0.05f * i) + (rand()%5-2);   // alt
        channels[3][i] = 85.0f - 0.05f * i + (rand()%3-1);                 // battery
    }

    // Сжимаем
    auto compressed = Codec::compress(channels, N);
    printf("Исходный: %zu байт (%d отсчётов × %d каналов × 4B)\n",
           N * CH * sizeof(float), N, CH);
    printf("Сжатый:   %zu байт\n", compressed.size());
    printf("Экономия: ×%.1f\n", Codec::compression_ratio(channels, N));

    // Распаковываем
    float* recovered[CH];
    int recovered_samples = 0;
    Codec::decompress(compressed.data(), compressed.size(), recovered, recovered_samples);

    // Проверка
    double max_err = 0;
    for (int c = 0; c < CH; c++) {
        for (int i = 0; i < N; i++) {
            double err = std::abs(channels[c][i] - recovered[c][i]);
            if (err > max_err) max_err = err;
        }
    }

    printf("Макс. ошибка восстановления: %.3f\n", max_err);
    printf("Тест: %s\n", max_err < 0.1 ? "✓ ПРОЙДЕН" : "✗ ОШИБКА");

    // Очистка
    for (int c = 0; c < CH; c++) { delete[] channels[c]; delete[] recovered[c]; }

    return 0;
}
