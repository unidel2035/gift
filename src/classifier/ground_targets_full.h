#pragma once
/**
 * ground_targets_full.h — ПОЛНЫЙ классификатор: 15 классов военных целей
 * Для Orange Pi 5 (A55, 1.8GHz), ~20μs на классификацию
 */
#include <cmath>
#include <cstring>
#include <cstdint>
#include <algorithm>

namespace military {

enum Target : uint8_t {
    STRONGPOINT=0,BUNKER=1,EW_STATION=2,VEHICLE=3,PERSON=4,DECOY=5,
    ARTILLERY=6,MLRS=7,SAM=8,COMMAND_POST=9,AMMO_DUMP=10,
    TRENCH=11,BRIDGE=12,MINEFIELD=13,DRONE_SWARM=14,
    UNKNOWN=15,COUNT=16
};

constexpr const char* NAMES[16] = {
    "опорник","блиндаж","РЭБ","техника","человек","ложная",
    "артиллерия","РСЗО","ПВО","командный пункт","склад БК",
    "траншея","мост","минное поле","рой дронов","неизвестно"
};

struct Features {
    float area_m2, perimeter_m, aspect_ratio, convexity, rectangularity;
    float green_ratio, texture_var, edge_density;
    float temp_max, temp_mean, temp_var; int hot_spots;
    float rf_power, rf_bandwidth, rf_duty; int rf_peaks;
    float dist_road, dist_trench; int nearby_objects;
    float speed_ms;
    // Новые контекстные признаки
    bool has_barrel;        // ствол (артиллерия/танк)
    bool has_antenna;       // антенны (РЭБ/КП/ПВО)
    bool has_tubes;         // трубы (РСЗО)
    bool has_sandbags;      // мешки с песком (опорник)
    bool near_water;        // рядом вода (мост)
    float texture_periodic; // периодичность текстуры (минное поле)
    int vehicles_nearby;    // машин рядом
};

// Быстрый L1 (FPGA): геометрия → класс
inline Target classify_L1(const Features& f) {
    if (f.near_water && f.aspect_ratio > 3.0f) return BRIDGE;
    if (f.texture_periodic > 0.6f) return MINEFIELD;
    if (f.has_barrel && f.aspect_ratio > 2.0f) return f.speed_ms > 1.0f ? VEHICLE : ARTILLERY;
    if (f.has_tubes && f.area_m2 > 30.0f) return MLRS;
    if (f.has_antenna) {
        if (f.rf_power > 15.0f) return EW_STATION;
        if (f.vehicles_nearby > 2) return COMMAND_POST;
        return SAM;
    }
    if (f.rectangularity > 0.7f) {
        if (f.area_m2 > 50.0f && f.has_sandbags) return STRONGPOINT;
        if (f.area_m2 < 30.0f && f.green_ratio < 0.3f) return BUNKER;
        if (f.vehicles_nearby == 0 && f.green_ratio > 0.4f) return AMMO_DUMP;
    }
    if (f.aspect_ratio > 2.0f && f.speed_ms > 1.0f) return VEHICLE;
    if (f.aspect_ratio > 2.0f && f.temp_max > 30.0f) return VEHICLE;
    if (f.area_m2 < 3.0f && f.temp_max > 28.0f) return PERSON;
    if (f.aspect_ratio > 1.5f && f.temp_max < 20.0f && f.rf_power < 1.0f) return DECOY;
    return UNKNOWN;
}

// Полный L2 (Orange Pi 5): все признаки → confidence
struct Result { Target target; float conf; const char* name; bool attack; };

inline Result classify_L2(const Features& f) {
    float s[16]={0}; float total=0;
    auto add = [&](Target t, float v){ s[t]+=v; total+=v; };

    // Ключевые дифференцирующие правила
    if (f.rf_power>15.0f && f.has_antenna) add(EW_STATION, 4.0f);
    if (f.has_tubes && f.area_m2>25.0f) add(MLRS, 4.0f);
    if (f.has_antenna && f.rf_power<5.0f && f.vehicles_nearby>2) add(COMMAND_POST, 4.0f);
    if (f.has_antenna && f.rf_power<10.0f && f.rf_power>2.0f) add(SAM, 3.0f);
    if (f.has_barrel && f.aspect_ratio>2.5f) add(f.speed_ms>1.0f ? VEHICLE : ARTILLERY, 4.0f);
    if (f.rectangularity>0.7f && f.has_sandbags) add(STRONGPOINT, 3.0f);
    if (f.rectangularity>0.7f && f.area_m2<25.0f && f.green_ratio<0.3f) add(BUNKER, 3.0f);
    if (f.rectangularity>0.6f && f.green_ratio>0.4f && f.vehicles_nearby==0) add(AMMO_DUMP, 3.0f);
    if (f.near_water && f.aspect_ratio>3.0f) add(BRIDGE, 4.0f);
    if (f.texture_periodic>0.6f) add(MINEFIELD, 4.0f);
    if (f.aspect_ratio>2.0f && f.temp_max>30.0f) add(VEHICLE, 3.0f);
    if (f.area_m2<3.0f && f.temp_max>28.0f && f.temp_max<40.0f) add(PERSON, 3.0f);
    if (f.aspect_ratio>1.5f && f.temp_max<20.0f && f.rf_power<1.0f) add(DECOY, 3.0f);
    if (f.area_m2<5.0f && f.speed_ms>15.0f) add(DRONE_SWARM, 3.0f);

    // Fallback: geometry-based
    if (total<1.0f) {
        if (f.area_m2>50.0f) add(STRONGPOINT, 1.0f);
        else if (f.area_m2>15.0f && f.aspect_ratio>2.0f) add(VEHICLE, 1.0f);
        else if (f.area_m2<10.0f) add(BUNKER, 1.0f);
        else add(UNKNOWN, 1.0f);
    }

    int best=0; for(int i=1;i<16;i++) if(s[i]>s[best]) best=i;
    Result r; r.target=(Target)best; r.name=NAMES[best];
    r.conf=total>0?s[best]/total:0;
    r.attack=!(best==PERSON||best==DECOY||best==UNKNOWN||best==BRIDGE);
    return r;
}

} // namespace military
