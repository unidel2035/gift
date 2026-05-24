# Unity + Serafim — фотореалистичная 3D-визуализация

Serafim шлёт MAVLink → Unity принимает → дрон летит в 3D-мире.

## Быстрый старт (15 минут)

### 1. Установить Unity Hub
https://unity.com/download
→ Install Unity 2022.3 LTS (или новее)

### 2. Создать проект
Unity Hub → New Project → 3D (Built-in Render Pipeline) → Create

### 3. Скопировать скрипт
Скопировать `Assets/Scripts/MavlinkReceiver.cs` в папку Assets/Scripts проекта.

### 4. Добавить drone
- GameObject → 3D Object → Capsule (временный дрон)
- Rename → "Drone"
- Add Component → MavlinkReceiver

### 5. Добавить ландшафт
- GameObject → 3D Object → Terrain
- Terrain Tools → Paint Texture (выбрать текстуру травы)
- Добавить деревья через Paint Trees

### 6. Нажать Play
Дрон появится и начнёт двигаться по MAVLink-данным от Serafim.

## Бесплатные ассеты для реализма
- **Terrain Sample Asset Pack** (Unity) — фотореалистичный ландшафт
- **Standard Assets** (Unity) — вода, небо, частицы
- **Drone 3D Model** (Asset Store) — реалистичная модель дрона
- **Military Vehicles** (Asset Store) — танки, РЭБ, ПВО

## Архитектура
Serafim (WSL) → MAVLink UDP :14550 → MavlinkReceiver.cs → Unity GameObject
