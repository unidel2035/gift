#!/usr/bin/env bash
# fpga-attach.sh — Автоматический проброс Tang Nano 9K из Windows в WSL2
#
# Использование:
#   bash utils/fpga-attach.sh          # только attach
#   bash utils/fpga-attach.sh flash    # attach + прошивка tritgift.fs
#   bash utils/fpga-attach.sh run      # attach + запуск моста
#   bash utils/fpga-attach.sh all      # attach + прошивка + запуск моста

set -e
BUSID="2-1"                    # BUSID Tang Nano 9K (0403:6010 FT2232H)
VID_PID="0403:6010"
BITSTREAM="/home/unidel/fpga/tang-nano-9k/tritgift/build/tritgift.fs"
UART_PORT="/dev/ttyUSB1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

echo "✦ fpga-attach — Скиния Дара"

# ── Шаг 1: найти BUSID по VID:PID (если 2-1 изменился) ──────────────────────
FOUND_BUSID=$(powershell.exe "usbipd list" 2>/dev/null | grep -i "$VID_PID" | awk '{print $1}' | head -1 | tr -d '\r')
if [ -n "$FOUND_BUSID" ]; then
  BUSID="$FOUND_BUSID"
fi
echo "  BUSID: $BUSID (VID:PID $VID_PID)"

# ── Шаг 2: attach через PowerShell interop ───────────────────────────────────
echo "  Подключаю к WSL2..."
powershell.exe "usbipd attach --wsl --busid $BUSID" 2>/dev/null || true
sleep 1.5

# ── Шаг 3: проверить что /dev/ttyUSB* появился ───────────────────────────────
if ls /dev/ttyUSB* >/dev/null 2>&1; then
  echo "  OK: $(ls /dev/ttyUSB*)"
else
  echo "  WARN: /dev/ttyUSB* не найден — возможно ftdi_sio не загружен"
  sudo modprobe ftdi_sio 2>/dev/null || true
  sleep 0.5
  ls /dev/ttyUSB* 2>/dev/null && echo "  OK: $(ls /dev/ttyUSB*)" || echo "  ERR: устройство не появилось"
fi

# ── Шаги по флагам ───────────────────────────────────────────────────────────
MODE="${1:-attach}"

if [[ "$MODE" == "flash" || "$MODE" == "all" ]]; then
  echo "  Прошиваю $BITSTREAM..."
  sudo rmmod ftdi_sio 2>/dev/null; sudo rmmod usbserial 2>/dev/null; sleep 0.3
  sudo openFPGALoader --freq 500000 --cable ft2232 "$BITSTREAM"
  sudo modprobe ftdi_sio; sleep 0.5
  echo "  ✓ Прошито"
fi

if [[ "$MODE" == "run" || "$MODE" == "all" ]]; then
  echo "  Запускаю мост (порт $UART_PORT, WS :3701)..."
  exec node "$ROOT/utils/fpga-gift-bridge.mjs" --port "$UART_PORT" --ws
fi

echo "  Готово. Запусти: npm run fpga:chip"
