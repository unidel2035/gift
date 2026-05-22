/**
 * test_dantsevich.cpp — сравнение wavelet-кодеков на зашумлённой телеметрии
 * Хаар vs Добеши-4 + адаптивный фильтр Данцевича
 */
#include "dantsevich_filter.h"
#include "wavelet_codec.h"
#include <cstdio>
#include <cmath>
#include <cstdlib>

using namespace dantsevich;
using namespace wavelet;

int main() {
    const int N = 128;

    // ── Генерируем телеметрию дрона с шумом ───────────────────────────────
    printf("=== СРАВНЕНИЕ КОДЕКОВ ТЕЛЕМЕТРИИ ===\n\n");

    float clean[N], noisy[N], haar[N], db4[N], adaptive[N];
    float gps_lat_base = 55.75f;

    for (int i = 0; i < N; i++) {
        clean[i] = gps_lat_base + 0.001f * i + 0.0001f * sin(0.1f * i);
        // Реалистичный шум LoRa: SNR ~20 dB (атмосферные помехи + многолучёвость)
        float noise = 0.0003f * ((rand() % 1000) / 500.0f - 1.0f)  // белый шум
                     + 0.0005f * sin(0.7f * i)                      // гармоническая помеха
                     + 0.0002f * ((rand() % 100) > 95 ? 10.0f : 0); // импульсная помеха
        noisy[i] = clean[i] + noise;
        haar[i] = noisy[i];
        db4[i] = noisy[i];
        adaptive[i] = noisy[i];
    }

    float snr_in = 10.0f * std::log10(
        [&]{ float s=0,n=0; for(int i=0;i<N;i++){s+=clean[i]*clean[i];float d=noisy[i]-clean[i];n+=d*d;} return s/n; }()
    );
    printf("SNR входной: %.1f dB\n", snr_in);

    // ── 1. Хаар DWT + порог 3 ────────────────────────────────────────────
    haar_forward_f(haar, N);
    int16_t ibuf[N];
    for (int i = 0; i < N; i++) ibuf[i] = (int16_t)std::round(haar[i] * 100.0f);
    threshold_abs<int16_t, N>(ibuf, 3);
    for (int i = 0; i < N; i++) haar[i] = ibuf[i] / 100.0f;
    haar_inverse_f(haar, N);

    float haar_err = 0;
    for (int i = 0; i < N; i++) {
        float e = clean[i] - haar[i];
        haar_err += e * e;
    }
    float haar_snr = 10.0f * std::log10(
        [&]{ float s=0; for(int i=0;i<N;i++) s+=clean[i]*clean[i]; return s / (haar_err + 1e-10f); }()
    );
    printf("Хаар + порог 3:  SNR выход %.1f dB | ошибка RMS %.4f\n", haar_snr, std::sqrt(haar_err/N));

    // ── 2. Добеши-4 DWT + адаптивный порог ───────────────────────────────
    db4_forward<N>(db4);
    float nl = estimate_noise_level<N>(db4);
    printf("  Шум (MAD): %.6f\n", nl);

    // Трешолдинг всего спектра (DC выживет, мелкие детали обнулятся)
    float thresh = adaptive_threshold<N>(nl, 1, N);
    soft_threshold<N>(db4, thresh);
    db4_inverse<N>(db4);

    float db4_err = 0;
    for (int i = 0; i < N; i++) {
        float e = clean[i] - db4[i];
        db4_err += e * e;
    }
    float db4_snr = 10.0f * std::log10(
        [&]{ float s=0; for(int i=0;i<N;i++) s+=clean[i]*clean[i]; return s / (db4_err + 1e-10f); }()
    );
    printf("Добеши-4 + адапт: SNR выход %.1f dB | ошибка RMS %.4f\n", db4_snr, std::sqrt(db4_err/N));

    // ── 3. Добеши-4 + адаптивный фильтр (полный контур Данцевича) ────────
    SpectralController sc;
    sc.process_telemetry(adaptive, N);

    float ad_err = 0;
    for (int i = 0; i < N; i++) {
        float e = clean[i] - adaptive[i];
        ad_err += e * e;
    }
    float ad_snr = 10.0f * std::log10(
        [&]{ float s=0; for(int i=0;i<N;i++) s+=clean[i]*clean[i]; return s / (ad_err + 1e-10f); }()
    );
    printf("D4+адапт+фильтр:  SNR выход %.1f dB | ошибка RMS %.4f\n", ad_snr, std::sqrt(ad_err/N));

    // ── Сравнение ────────────────────────────────────────────────────────
    printf("\n=== ИТОГ ===\n");
    printf("Улучшение SNR: D4 vs Хаар: %+.1f dB | D4+фильтр vs Хаар: %+.1f dB\n",
           db4_snr - haar_snr, ad_snr - haar_snr);
    printf("Улучшение RMS: D4 vs Хаар: ×%.1f | D4+фильтр vs Хаар: ×%.1f\n",
           std::sqrt(haar_err/(N*db4_err/N)),
           std::sqrt(haar_err/(N*ad_err/N)));

    // ── Проверка на реальных данных из кодека ────────────────────────────
    printf("\n=== ТЕСТ СО СЖАТИЕМ ===\n");
    float* ch[4];
    for (int c = 0; c < 4; c++) ch[c] = new float[N];
    for (int i = 0; i < N; i++) {
        ch[0][i] = 55.75f + 0.001f * i;
        ch[1][i] = 37.62f + 0.001f * i;
        ch[2][i] = 100.0f + 20.0f * sin(0.05f * i);
        ch[3][i] = 85.0f - 0.05f * i;
    }

    auto comp = Codec::compress(ch, N);
    printf("Codec сжатие: %zu байт (×%.1f)\n", comp.size(), (float)(N*4*4)/comp.size());

    for (int c = 0; c < 4; c++) delete[] ch[c];

    return 0;
}
