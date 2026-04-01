# GiftOS — прошивка для ESP32

## Что это

GiftOS coordination layer для роя ESP32.
Два (и более) чипа координируются через W-матрицу surplus без сервера и без командира.

## Железо

- ESP32 DevKit (любой)
- LED встроенный (пин 2) или внешний
- Больше ничего не нужно

## Прошивка

1. Открыть `giftos.ino` в Arduino IDE
2. Board: **ESP32 Dev Module**
3. На первом чипе: `#define NODE_NAME "Адам"`
4. На втором чипе: `#define NODE_NAME "Ева"`
5. Flash → Open Serial Monitor (115200 baud)

## Что происходит

```
Адам:                           Ева:
surplus=+5 → EXECUTOR ★        surplus=-1 → SCOUT ▲
LED: быстрое мигание            LED: тройное мигание

[через 10 сек — Ева дала данные]

Адам:                           Ева:
surplus=+3 → RELAY ◉            surplus=+2 → EXECUTOR ★
LED: медленный пульс            LED: быстрое мигание
```

Роли меняются автоматически по surplus. Нет команды сверху.

## Serial Monitor

```
[GiftOS] узел:Адам тик:47 лиц:3
  scanner [ИСПОЛ] surplus:+8 given:16 recv:8
  relay   [ИСПОЛ] surplus:+3 given:5 recv:2
  watchdog[ИСПОЛ] surplus:+1 given:1 recv:0

  Соседи в рое:
    Ева surplus:+2 ◉РЕТР

  W-матрица:
    Адам→_koinon ×16
    Ева→Адам ×8
```

## Богословие

Два чипа. Между ними — пространство дара.
Каждый знает surplus другого. Тот кто дал больше — берёт сложную роль.
Это не альтруизм. Это другая онтология координации.
