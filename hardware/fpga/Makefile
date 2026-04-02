# Makefile — tritgift.v → Tang Nano 9K (GW1NR-9C)
#
# Инструменты (открытые):
#   yosys          — синтез Verilog → netlist
#   nextpnr-gowin  — place & route для Gowin FPGA
#   gowin_pack     — упаковка в .fs (из apicula/gowin-pack)
#   openFPGALoader — прошивка через USB
#
# Установка (Ubuntu/Debian):
#   apt install yosys
#   pip install apycula          # даёт gowin_pack + gowin_unpack
#   # nextpnr-gowin собирается из исходников:
#   #   https://github.com/YosysHQ/nextpnr
#   # openFPGALoader:
#   #   https://github.com/trabucayre/openFPGALoader

TOP    := tritgift
DEVICE := GW1NR-LV9QN88PC6/I5   # Tang Nano 9K
FAMILY := GW1NR-9C
PART   := GW1NR-9

SRC    := $(TOP).v
CST    := $(TOP).cst

JSON   := $(TOP).json
PNRJSON:= $(TOP)_pnr.json
FS     := $(TOP).fs

# ─────────────────────────────────────────────────────────────────────────────
# Правило по умолчанию
# ─────────────────────────────────────────────────────────────────────────────

.PHONY: all flash clean

all: $(FS)

# ─────────────────────────────────────────────────────────────────────────────
# Синтез: Verilog → JSON netlist
# ─────────────────────────────────────────────────────────────────────────────

$(JSON): $(SRC)
	yosys \
	  -p "read_verilog -sv $(SRC)" \
	  -p "synth_gowin -top $(TOP) -json $(JSON)"

# ─────────────────────────────────────────────────────────────────────────────
# Place & Route: JSON → placed+routed JSON
# ─────────────────────────────────────────────────────────────────────────────

$(PNRJSON): $(JSON) $(CST)
	nextpnr-gowin \
	  --json $(JSON) \
	  --write $(PNRJSON) \
	  --device $(DEVICE) \
	  --family $(FAMILY) \
	  --cst $(CST)

# ─────────────────────────────────────────────────────────────────────────────
# Упаковка: JSON → .fs (битстрим)
# ─────────────────────────────────────────────────────────────────────────────

$(FS): $(PNRJSON)
	gowin_pack \
	  -d $(PART) \
	  -o $(FS) \
	  $(PNRJSON)

# ─────────────────────────────────────────────────────────────────────────────
# Прошивка через USB
# ─────────────────────────────────────────────────────────────────────────────

flash: $(FS)
	openFPGALoader -b tangnano9k $(FS)

# ─────────────────────────────────────────────────────────────────────────────
# Очистка
# ─────────────────────────────────────────────────────────────────────────────

clean:
	rm -f $(JSON) $(PNRJSON) $(FS) *.log *.txt nextpnr*.json
