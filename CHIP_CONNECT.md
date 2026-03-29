# Инструкция — Tang Nano 9K UART (решено 30.03.2026)

## Корень проблемы (решён)

`modprobe ftdi_sio` инициализирует Channel A → триггерит CRESET на FPGA через FT2232H ADBUS →
SRAM очищается → FPGA не конфигурирована → UART молчит.

**Решение: использовать pyftdi напрямую, без ftdi_sio вообще.**

## Рабочий цикл (Physical replug → attach → flash → тест)

### Шаг 1 (PowerShell):
```powershell
usbipd attach -i 0403:6010 --wsl
```

### Шаг 2 (Ubuntu — одна команда):
```bash
cd ~/gift && sudo rmmod ftdi_sio 2>/dev/null && \
  sudo openFPGALoader --board tangnano9k --freq 500000 ~/fpga/tang-nano-9k/tritgift/build/tritgift.fs
```

### Шаг 3 — тест (НЕ запускать modprobe!):
```bash
python3 utils/chip-oracle-uart.py ftdi://ftdi:2232h/2 1 0 1
```

Ожидаемый результат: `{"y": [1, 0, 1], "raw": "S:L A:000 B:00+ C:00+", "source": "chip"}`

### Демо:
```bash
node utils/chip-demo.mjs --port ftdi://ftdi:2232h/2
```

## Почему НЕ нужен modprobe ftdi_sio

pyftdi работает напрямую через libusb → Channel B (UART) без ядерного драйвера.
ftdi_sio для Channel A уничтожал SRAM через CRESET — обходим это полностью.

## Восстановление при USB/IP деградации (-104 / -110)

**НЕ нужен wsl --shutdown** (он убивает WSL2 сессию).
Достаточно физического реплага USB кабеля:
1. Вытащи USB
2. Вставь USB
3. `usbipd attach -i 0403:6010 --wsl` (PowerShell)
4. Шаг 2+3 выше

## Почему SPI flash (-f) не работает через USB/IP

SPI flash запись ~30с при 2MHz — USB/IP деградирует и получает bulk write failed.
SRAM загрузка ~3с при 500KHz — надёжно работает.
SRAM живёт пока USB кабель физически подключён.

## Диагностика

```bash
dmesg | grep "vhci_hcd\|urb->status" | tail -5
```
- `-104` ECONNRESET → физический реплаг кабеля
- UART молчит без ошибок → проверить что ftdi_sio НЕ загружен (`lsmod | grep ftdi`)

## Критические правила

1. **НЕ запускать modprobe ftdi_sio** после flash — убивает SRAM через CRESET
2. **НЕ запускать openFPGALoader дважды** — конфликт с ftdi_sio
3. **НЕ использовать -f флаг** (SPI flash) через USB/IP
4. Использовать `ftdi://ftdi:2232h/2` как port для chip-oracle-uart.py
