# specs/bridges/ — Python-мосты к инженерным инструментам
# Каждый bridge: уровни точности (реальный инструмент → аналитика)
#
# kompas_bridge.py  — КОМПАС-3D / STEP / STL → масса, CG, момент инерции
# openfoam_bridge.py — OpenFOAM / PyFoam / аналитика → Cd, Cl
# kicad_bridge.py   — KiCad pcbnew / kicad-cli → BOM compliance, DRC
# gnuradio_bridge.py — GNU Radio / scipy / аналитика → BER, PER, SNR
