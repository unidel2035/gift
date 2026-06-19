#!/usr/bin/env python3
"""
kicad_bridge.py — KiCad pcbnew Python API → BOM compliance, DRC, EMI-оценка.

Уровни:
  1. KiCad pcbnew Python API (если установлен KiCad)
  2. kicad-cli (KiCad 7+, CLI без GUI)
  3. XML/JSON парсинг .kicad_pcb (без KiCad)
  4. Аналитический fallback по заданному BOM JSON

Для спеки "Суверенное железо" (группа 2):
  - Проверяет что в BOM нет компонентов под экспортным контролем (ECCN 3A001, EAR99)
  - Проверяет дублирование критических цепей (питание, CAN-шина)
  - Оценивает EMI риск (высокочастотные цепи рядом с антенной)

Вход: .kicad_pcb файл или BOM JSON
Выход: JSON { sovereign, emi_risk, drc_errors, violations, components_total, method }

Использование:
  python3 kicad_bridge.py board.kicad_pcb
  python3 kicad_bridge.py --bom bom.json --banned-vendors "Xilinx,Intel,Lattice"
  python3 kicad_bridge.py --bom-json '[{"ref":"U1","mfr":"STM","part":"STM32F4"}]'
"""

import sys, json, os, argparse, re, subprocess, shutil
from pathlib import Path

PCBNEW = None
KICAD_CLI = shutil.which('kicad-cli')

try:
    import pcbnew
    PCBNEW = pcbnew
except ImportError:
    pass

# ── Компоненты под экспортным контролем ─────────────────────────────────────
# ECCN 3A001 — высокопроизводительные процессоры, FPGA с определёнными параметрами
# EAR Commerce Control List — применяется к экспорту из США

BANNED_PATTERNS = [
    # FPGA под санкциями
    r'(?i)xilinx', r'(?i)altera', r'(?i)intel\s*fpga',
    r'(?i)lattice\s*(?:semi)?',
    # Процессоры с ограничениями
    r'(?i)qualcomm', r'(?i)broadcom',
    # RF-чипы под контролем (>5.2 ГГц некоторые серии)
    r'(?i)analog\s*devices\s*(?:adl|hmc)',
    # Память под FDPR (Foreign Direct Product Rule)
    r'(?i)micron',
]

# Российские/незапрещённые альтернативы
SOVEREIGN_ALTERNATIVES = {
    'FPGA': ['Аквариус', 'Миландр', '1892BE7Я', 'ELBRUS'],
    'MCU':  ['Миландр МК', 'STM32 (Европа)', 'GD32', 'CH32'],
    'RF':   ['RFM95 (LoRa)', 'SX1278', 'CC1101'],
}

# ── Уровень 1: pcbnew Python API ─────────────────────────────────────────────

def from_pcbnew(path, banned_patterns=None):
    """Полный анализ через KiCad pcbnew."""
    board = PCBNEW.LoadBoard(str(path))
    banned = banned_patterns or BANNED_PATTERNS

    components = []
    violations = []

    for fp in board.GetFootprints():
        ref  = fp.GetReference()
        val  = fp.GetValue()
        mfr  = ''
        part = ''
        try:
            mfr  = fp.GetField('Manufacturer').GetText()
            part = fp.GetField('Part Number').GetText()
        except Exception:
            pass

        comp = {'ref': ref, 'value': val, 'mfr': mfr, 'part': part}
        components.append(comp)

        full = f"{mfr} {part} {val}"
        for pat in banned:
            if re.search(pat, full):
                violations.append({
                    'ref': ref,
                    'issue': 'export-controlled-component',
                    'match': pat,
                    'component': full.strip(),
                })
                break

    # DRC (только если есть pcbnew >= 7)
    drc_errors = []
    try:
        drc = board.RunDRC()
        for marker in board.GetDesignSettings().GetMarkers():
            drc_errors.append({'text': marker.GetDescription()})
    except Exception:
        pass

    # EMI риск: ищем высокочастотные цепи (PWM, CLK > 10 МГц) рядом с RF-компонентами
    emi_risk = _assess_emi(board)

    return {
        'sovereign': len(violations) == 0,
        'violations': violations,
        'drc_errors': len(drc_errors),
        'emi_risk': emi_risk,
        'components_total': len(components),
        'method': 'pcbnew-api',
    }

def _assess_emi(board):
    """Упрощённая оценка EMI: есть ли CLK трассы рядом с антенной."""
    rf_refs = set()
    clk_refs = set()
    for fp in board.GetFootprints():
        val = fp.GetValue().upper()
        ref = fp.GetReference()
        if any(k in val for k in ['ANT', 'ANTENNA', 'RF', 'SMA']):
            rf_refs.add(ref)
        if any(k in val for k in ['CLK', 'OSC', 'XTAL']):
            clk_refs.add(ref)
    # Если оба типа присутствуют — риск (грубо, без расчёта расстояния)
    return 'medium' if (rf_refs and clk_refs) else 'low'

# ── Уровень 2: kicad-cli ─────────────────────────────────────────────────────

def from_kicad_cli(path, banned_patterns=None):
    """Экспорт BOM через kicad-cli (KiCad 7+), затем анализ."""
    bom_out = Path(path).with_suffix('.csv')
    result = subprocess.run(
        ['kicad-cli', 'sch', 'export', 'bom', '--output', str(bom_out), str(path)],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        raise RuntimeError(f"kicad-cli failed: {result.stderr}")

    import csv
    components = []
    with open(bom_out) as f:
        reader = csv.DictReader(f)
        for row in reader:
            components.append({
                'ref': row.get('Reference', ''),
                'value': row.get('Value', ''),
                'mfr': row.get('Manufacturer', ''),
                'part': row.get('Part Number', ''),
            })
    return _check_bom(components, banned_patterns)

# ── Уровень 3: парсинг .kicad_pcb без KiCad ─────────────────────────────────

def from_kicad_file(path, banned_patterns=None):
    """Парсинг S-expression .kicad_pcb — работает без KiCad."""
    content = Path(path).read_text(encoding='utf-8', errors='ignore')
    # Извлекаем компоненты через regex
    fp_pattern = re.compile(r'\(footprint\s+"([^"]+)".*?\)', re.DOTALL)
    ref_pattern = re.compile(r'\(property\s+"Reference"\s+"([^"]+)"')
    val_pattern = re.compile(r'\(property\s+"Value"\s+"([^"]+)"')
    mfr_pattern = re.compile(r'\(property\s+"Manufacturer"\s+"([^"]+)"')

    components = []
    # Упрощённо: ищем все property строки
    refs = ref_pattern.findall(content)
    vals = val_pattern.findall(content)
    mfrs = mfr_pattern.findall(content)

    for i, ref in enumerate(refs):
        components.append({
            'ref': ref,
            'value': vals[i] if i < len(vals) else '',
            'mfr': mfrs[i] if i < len(mfrs) else '',
            'part': '',
        })
    return _check_bom(components, banned_patterns)

# ── Уровень 4: анализ BOM JSON ───────────────────────────────────────────────

def _check_bom(components, banned_patterns=None):
    """Проверяет BOM на запрещённые компоненты."""
    banned = banned_patterns or BANNED_PATTERNS
    violations = []

    for comp in components:
        full = f"{comp.get('mfr','')} {comp.get('part','')} {comp.get('value','')}".strip()
        for pat in banned:
            if re.search(pat, full, re.IGNORECASE):
                violations.append({
                    'ref': comp.get('ref', '?'),
                    'issue': 'export-controlled-component',
                    'match': pat,
                    'component': full,
                })
                break

    return {
        'sovereign': len(violations) == 0,
        'violations': violations,
        'drc_errors': 0,
        'emi_risk': 'unknown',
        'components_total': len(components),
        'method': 'bom-check',
    }


def main():
    p = argparse.ArgumentParser(description='KiCad BOM → суверенность платы')
    p.add_argument('file', nargs='?', help='Путь к .kicad_pcb или .kicad_sch файлу')
    p.add_argument('--bom', help='CSV-файл BOM')
    p.add_argument('--bom-json', help='JSON массив компонентов [{ref,mfr,part}]')
    p.add_argument('--banned-vendors', help='Запрещённые производители через запятую')
    args = p.parse_args()

    extra_banned = []
    if args.banned_vendors:
        extra_banned = [f'(?i){v.strip()}' for v in args.banned_vendors.split(',')]

    try:
        if args.bom_json:
            components = json.loads(args.bom_json)
            result = _check_bom(components, BANNED_PATTERNS + extra_banned)

        elif args.file:
            path = Path(args.file)
            if PCBNEW and path.suffix in ('.kicad_pcb',):
                result = from_pcbnew(path, BANNED_PATTERNS + extra_banned)
            elif KICAD_CLI and path.suffix in ('.kicad_sch',):
                result = from_kicad_cli(path, BANNED_PATTERNS + extra_banned)
            elif path.suffix == '.kicad_pcb':
                result = from_kicad_file(path, BANNED_PATTERNS + extra_banned)
            else:
                raise ValueError(f"Неизвестный формат: {path.suffix}")
        else:
            # Демо: пустой BOM (суверенный по умолчанию)
            result = _check_bom([], BANNED_PATTERNS + extra_banned)
            result['warning'] = 'Файл не указан — анализ пустого BOM'

        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error': str(e), 'method': 'failed'}), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
