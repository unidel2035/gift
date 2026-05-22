/**
 * ground_sim.cpp — Симулятор наземных целей для демонстрации
 *
 * Генерирует сцену: дрон на высоте 300м видит поле боя.
 * Цели: опорник, блиндаж, станция РЭБ, техника, человек.
 *
 * Сборка: g++ -std=c++17 -O2 ground_sim.cpp -o ground_sim && ./ground_sim
 */

#include "ground_targets.h"
#include <cstdio>
#include <cmath>
#include <cstdlib>
#include <ctime>

using namespace ground_targets;

// Генерация синтетической цели
GroundFeatures make_target(GroundTarget type) {
    GroundFeatures f = {};
    float r = (float)rand() / RAND_MAX;

    switch (type) {
    case GroundTarget::STRONGPOINT:
        f.area_m2 = 80 + r * 120;           // 80-200 м²
        f.perimeter_m = 40 + r * 60;
        f.aspect_ratio = 1.5f + r * 2.0f;
        f.convexity = 0.6f + r * 0.3f;
        f.rectangularity = 0.7f + r * 0.3f;
        f.green_ratio = 0.3f + r * 0.3f;
        f.texture_variance = 0.3f + r * 0.3f;
        f.edge_density = 0.2f + r * 0.2f;
        f.temp_max = 20 + r * 10;
        f.temp_mean = 15 + r * 5;
        f.temp_variance = 2 + r * 3;
        f.hot_spots = 3 + (int)(r * 5);
        f.rf_power = 1 + r * 2;             // слабое RF (рации)
        f.rf_bandwidth = 1 + r * 3;
        f.rf_duty_cycle = 0.1f + r * 0.2f;
        f.rf_peaks = 1 + (int)(r * 2);
        f.dist_to_road_m = 10 + r * 50;
        f.dist_to_trench_m = 2 + r * 10;    // ТРАНШЕИ РЯДОМ
        f.nearby_objects = 4 + r * 6;       // много объектов
        f.speed_ms = 0;
        break;

    case GroundTarget::BUNKER:
        f.area_m2 = 8 + r * 20;             // 8-28 м²
        f.perimeter_m = 12 + r * 20;
        f.aspect_ratio = 1.0f + r * 1.5f;
        f.convexity = 0.8f + r * 0.2f;
        f.rectangularity = 0.8f + r * 0.2f; // очень прямоугольный
        f.green_ratio = 0.05f + r * 0.15f;  // НЕ зелёный (бетон)
        f.texture_variance = 0.05f + r * 0.1f; // гладкий
        f.edge_density = 0.1f + r * 0.1f;
        f.temp_max = 18 + r * 5;            // прохладный
        f.temp_mean = 14 + r * 4;
        f.rf_power = 0;                     // нет RF
        f.dist_to_road_m = 5 + r * 30;      // у дороги
        f.dist_to_trench_m = 5 + r * 30;
        f.nearby_objects = 1 + r * 2;
        f.speed_ms = 0;
        break;

    case GroundTarget::EW_STATION:
        f.area_m2 = 20 + r * 60;
        f.perimeter_m = 20 + r * 50;
        f.aspect_ratio = 1.2f + r * 1.5f;
        f.rectangularity = 0.4f + r * 0.3f;
        f.edge_density = 0.6f + r * 0.4f;   // МНОГО краёв (антенны!)
        f.green_ratio = 0.2f + r * 0.3f;
        f.texture_variance = 0.4f + r * 0.3f;
        f.temp_max = 35 + r * 20;           // горячий (генератор)
        f.temp_mean = 25 + r * 10;
        f.temp_variance = 5 + r * 10;       // большая дисперсия
        f.hot_spots = 2 + (int)(r * 3);
        f.rf_power = 15 + r * 15;           // МОЩНОЕ RF!
        f.rf_bandwidth = 20 + r * 80;
        f.rf_duty_cycle = 0.7f + r * 0.3f;  // почти непрерывно
        f.rf_peaks = 4 + (int)(r * 6);      // много пиков
        f.dist_to_road_m = 3 + r * 20;
        f.nearby_objects = 2 + r * 3;
        f.speed_ms = 0;
        break;

    case GroundTarget::VEHICLE:
        f.area_m2 = 15 + r * 30;
        f.perimeter_m = 20 + r * 30;
        f.aspect_ratio = 2.5f + r * 3.0f;   // ВЫТЯНУТЫЙ
        f.rectangularity = 0.5f + r * 0.3f;
        f.green_ratio = 0.2f + r * 0.3f;
        f.texture_variance = 0.4f + r * 0.4f; // текстура
        f.edge_density = 0.2f + r * 0.2f;
        f.temp_max = 50 + r * 30;           // ОЧЕНЬ горячий (ДВС)
        f.temp_mean = 35 + r * 20;
        f.temp_variance = 8 + r * 10;
        f.hot_spots = 1 + (int)(r * 3);
        f.rf_power = 2 + r * 3;
        f.rf_bandwidth = 0.5f + r * 2;
        f.dist_to_road_m = 2 + r * 15;      // НА дороге
        f.nearby_objects = 1 + r * 2;
        f.speed_ms = 5 + r * 25;            // ДВИЖЕТСЯ
        break;

    case GroundTarget::PERSON:
        f.area_m2 = 0.5f + r * 1.5f;        // 0.5-2 м²
        f.perimeter_m = 2 + r * 4;
        f.aspect_ratio = 1.0f + r * 2.0f;
        f.rectangularity = 0.1f + r * 0.3f;
        f.green_ratio = 0.3f + r * 0.3f;
        f.temp_max = 34 + r * 4;            // 34-38°C
        f.temp_mean = 30 + r * 4;
        f.hot_spots = 1;
        f.rf_power = 0;
        f.speed_ms = 0.5f + r * 3;         // медленно
        f.nearby_objects = 0;
        break;

    case GroundTarget::DECOY:
        // Похожа на технику геометрией, но холодная и без RF
        f.area_m2 = 15 + r * 25;
        f.aspect_ratio = 2.0f + r * 3.0f;
        f.rectangularity = 0.5f + r * 0.3f;
        f.green_ratio = 0.2f + r * 0.3f;
        f.texture_variance = 0.2f + r * 0.2f;
        f.temp_max = 15 + r * 5;            // ХОЛОДНАЯ
        f.temp_mean = 12 + r * 4;
        f.temp_variance = 0.5f + r * 1;     // низкая дисперсия
        f.hot_spots = 0;
        f.rf_power = 0;                     // НЕТ RF
        f.rf_bandwidth = 0;
        f.speed_ms = 0;
        f.dist_to_road_m = 5 + r * 30;
        break;

    default: break;
    }

    f.normalize();
    return f;
}

int main() {
    srand(time(0));

    printf("╔══════════════════════════════════════════════════════════╗\n");
    printf("║  СИМУЛЯТОР НАЗЕМНЫХ ЦЕЛЕЙ — БОРТ БПЛА                  ║\n");
    printf("║  Высота 300м, обзор поля боя                           ║\n");
    printf("╚══════════════════════════════════════════════════════════╝\n\n");

    OnboardPipeline pipeline;

    // Генерируем все 6 типов целей
    GroundTarget types[] = {
        GroundTarget::STRONGPOINT,
        GroundTarget::BUNKER,
        GroundTarget::EW_STATION,
        GroundTarget::VEHICLE,
        GroundTarget::PERSON,
        GroundTarget::DECOY,
    };

    int correct_L1 = 0, correct_L2 = 0, total = 0;
    int attack_recommended = 0;

    for (int run = 0; run < 3; run++) {
        printf("─── Запуск %d ───\n", run + 1);
        printf("%-14s | %-10s | %-10s | %-6s | %s\n",
               "Истина", "FPGA L1", "L2 (все)", "Атака?", "Действие");
        printf("────────────────|────────────|────────────|────────|──────────\n");

        for (auto type : types) {
            auto f = make_target(type);
            auto r = pipeline.process(f);

            total++;
            if (r.fpga_L1 == type) correct_L1++;
            if (r.L2_result.target == type) correct_L2++;
            if (r.attack_recommended) attack_recommended++;

            const char* icon = r.L2_result.target == type ? "✓" : "✗";
            printf("%-14s | %-10s | %-10s %s| %-6s | %s\n",
                   GT_NAMES[(int)type],
                   GT_NAMES[(int)r.fpga_L1],
                   r.L2_result.name, icon,
                   r.attack_recommended ? "ДА" : "НЕТ",
                   r.action);
        }
        printf("\n");
    }

    printf("═══════════════════════════════════════════\n");
    printf("ИТОГИ (18 целей):\n");
    printf("  FPGA L1: %d/%d (%.0f%%)\n", correct_L1, total, 100.0f*correct_L1/total);
    printf("  L2 полн: %d/%d (%.0f%%)\n", correct_L2, total, 100.0f*correct_L2/total);
    printf("  Рекомендовано атак: %d\n", attack_recommended);
    printf("═══════════════════════════════════════════\n");

    return 0;
}
