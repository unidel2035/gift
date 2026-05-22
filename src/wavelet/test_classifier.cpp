/**
 * test_classifier.cpp — проверка нейро-fuzzy классификатора целей
 */
#include "fuzzy_classifier.h"
#include <cstdio>
using namespace fuzzy_classifier;

void test(const char* label, TargetFeatures f, TargetClass expected) {
    NeuroFuzzyClassifier nfc;
    SymbolicProcessor sp;

    auto r1 = nfc.classify_detailed(f);
    auto r2 = sp.quick_classify(f);

    const char* ok1 = r1.target == expected ? "✓" : "✗";
    const char* ok2 = r2 == expected ? "✓" : "✗";

    printf("%-30s | fuzzy: %-12s (%.2f) %s | sym: %-12s %s\n",
           label, r1.name, r1.confidence, ok1,
           TARGET_NAMES[(int)r2], ok2);
}

int main() {
    printf("=== КЛАССИФИКАТОР ЦЕЛЕЙ БПЛА ===\n");
    printf("%-30s | %-20s | %-15s\n", "Сценарий", "Fuzzy (Данцевич)", "Символьный (Филатов)");
    printf("-------------------------------|----------------------|----------------\n");

    // Свой оператор с пультом (маленький, тёплый, RF активен)
    test("Оператор с пультом", {
        0.3f, 0.1f, 1.5f, -30.0f, 0.8f, 0.6f, 0.1f, 0.9f
    }, TargetClass::OPERATOR);

    // Препятствие — ЛЭП (высокое, нулевая скорость, холодное)
    test("ЛЭП (препятствие)", {
        0.1f, 0.0f, 15.0f, -10.0f, 0.0f, 0.1f, 0.0f, 0.0f
    }, TargetClass::OBSTACLE);

    // Гражданский автомобиль (средний, медленный, низко)
    test("Гражданский автомобиль", {
        4.0f, 8.0f, 0.0f, -5.0f, 0.7f, 0.4f, 0.1f, 0.2f
    }, TargetClass::CIVILIAN);

    // Танк (большой, медленный, горячий, сильный RCS)
    test("Танк", {
        7.0f, 10.0f, 0.0f, 15.0f, 0.95f, 0.25f, 0.2f, 0.3f
    }, TargetClass::VEHICLE);

    // Вражеский FPV-дрон (маленький, быстрый, манёвренный, RF)
    test("Вражеский FPV-дрон", {
        0.2f, 25.0f, 50.0f, -20.0f, 0.4f, 0.5f, 0.95f, 0.85f
    }, TargetClass::ENEMY_DRONE);

    // Свой разведчик (маленький, средняя скорость, RF)
    test("Свой разведчик", {
        0.5f, 15.0f, 100.0f, -25.0f, 0.5f, 0.6f, 0.3f, 0.95f
    }, TargetClass::OPERATOR);

    // Вражеский разведчик (такой же но без своего RF-маяка)
    test("Чужой разведчик", {
        0.4f, 14.0f, 80.0f, -22.0f, 0.5f, 0.6f, 0.7f, 0.8f
    }, TargetClass::ENEMY_DRONE);

    // Неизвестный объект (все признаки ~0.5)
    test("Неизвестный объект", {
        10.0f, 15.0f, 200.0f, 0.0f, 0.5f, 0.5f, 0.5f, 0.5f
    }, TargetClass::UNKNOWN);

    printf("\n=== ОБУЧЕНИЕ ===\n");

    // Создаём классификатор и обучаем
    NeuroFuzzyClassifier nfc;
    printf("До обучения:\n");

    TargetFeatures tf = {0.3f, 22.0f, 60.0f, -18.0f, 0.45f, 0.5f, 0.9f, 0.8f};
    auto r = nfc.classify_detailed(tf);
    printf("  Вражеский дрон: %s (%.2f)\n", r.name, r.confidence);

    // Обучаем на 10 примерах вражеских дронов
    for (int i = 0; i < 10; i++) {
        nfc.learn(tf, TargetClass::ENEMY_DRONE);
    }

    printf("После 10 примеров обучения:\n");
    r = nfc.classify_detailed(tf);
    printf("  Вражеский дрон: %s (%.2f)\n", r.name, r.confidence);

    // Покажем все оценки
    printf("  Оценки: ");
    for (int c = 0; c < 6; c++) {
        printf("%s=%.2f ", TARGET_NAMES[c], r.scores[c]);
    }
    printf("\n");

    return 0;
}
