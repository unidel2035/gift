#!/usr/bin/env python3
"""
kompas_bridge.py — геометрия из КОМПАС-3D / STEP / STL → масса, CG, момент инерции.

Уровни точности (автоматически выбирается доступный):
  1. KOMPAS-3D Python API (Windows, kompas3d пакет)  — точно, от САПР
  2. pythonOCC / cadquery (STEP файл)                — точно, открытый
  3. numpy-stl (STL файл)                            — приблизительно, через объём
  4. Аналитический fallback (цилиндр/параллелепипед) — оценка по габаритам

Вход: путь к файлу (.c3d / .step / .stp / .stl) или JSON габаритов
Выход: JSON { mass_kg, cg_x, cg_y, cg_z, Ixx, Iyy, Izz, stl_path, method }

Использование:
  python3 kompas_bridge.py model.step --density 1600
  python3 kompas_bridge.py --bbox 0.3 0.3 0.08 --density 2700  # алюминиевая рама
"""

import sys, json, os, argparse, math, tempfile
from pathlib import Path

# ── Попытка подключить реальные инструменты ──────────────────────────────────

def try_import(name):
    try:
        return __import__(name)
    except ImportError:
        return None

OCC = try_import('OCC.Core.BRep')           # pythonOCC
CQ  = try_import('cadquery')                 # cadquery
STL = try_import('stl')                      # numpy-stl
KOMPAS = try_import('kompas3d')              # KOMPAS-3D Python API (Windows)

# ── Уровень 1: KOMPAS-3D API ────────────────────────────────────────────────

def from_kompas(path):
    """Читает .c3d через KOMPAS-3D Python API. Только Windows."""
    import kompas3d
    app = kompas3d.Application()
    doc = app.open(str(path))
    body = doc.get_body(0)
    props = body.get_mass_properties()
    stl = tempfile.mktemp(suffix='.stl')
    body.export_stl(stl, chord_deviation=0.1)
    doc.close()
    return {
        'mass_kg': props.mass,
        'cg_x': props.cx, 'cg_y': props.cy, 'cg_z': props.cz,
        'Ixx': props.Ixx, 'Iyy': props.Iyy, 'Izz': props.Izz,
        'stl_path': stl,
        'method': 'kompas3d-api',
    }

# ── Уровень 2: pythonOCC / STEP ─────────────────────────────────────────────

def from_step_occ(path, density_kg_m3):
    """Читает STEP через pythonOCC → mass props."""
    from OCC.Core.BRep import BRep_Builder
    from OCC.Core.BRepGProp import brepgprop_VolumeProperties
    from OCC.Core.GProp import GProp_GProps
    from OCC.Core.STEPControl import STEPControl_Reader
    from OCC.Core.StlAPI import StlAPI_Writer
    from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh

    reader = STEPControl_Reader()
    reader.ReadFile(str(path))
    reader.TransferRoots()
    shape = reader.OneShape()

    props = GProp_GProps()
    brepgprop_VolumeProperties(shape, props)
    volume_m3 = props.Mass()  # в OCC единицы мм³ → конвертируем
    if abs(volume_m3) > 1:  # скорее всего мм³
        volume_m3 /= 1e9
    mass = volume_m3 * density_kg_m3
    cg = props.CentreOfMass()
    scale = 0.001 if abs(cg.X()) > 10 else 1.0  # мм → м
    matrix = props.MatrixOfInertia()

    # Экспорт STL
    mesh = BRepMesh_IncrementalMesh(shape, 0.1)
    mesh.Perform()
    stl = tempfile.mktemp(suffix='.stl')
    writer = StlAPI_Writer()
    writer.Write(shape, stl)

    return {
        'mass_kg': round(mass, 4),
        'cg_x': round(cg.X() * scale, 4),
        'cg_y': round(cg.Y() * scale, 4),
        'cg_z': round(cg.Z() * scale, 4),
        'Ixx': round(matrix.Value(1,1) * density_kg_m3 * 1e-12, 6),
        'Iyy': round(matrix.Value(2,2) * density_kg_m3 * 1e-12, 6),
        'Izz': round(matrix.Value(3,3) * density_kg_m3 * 1e-12, 6),
        'stl_path': stl,
        'method': 'pythonocc-step',
    }

# ── Уровень 3: numpy-stl ─────────────────────────────────────────────────────

def from_stl(path, density_kg_m3):
    """Приблизительная масса из STL через signed volume."""
    from stl import mesh as stl_mesh
    import numpy as np

    m = stl_mesh.Mesh.from_file(str(path))
    # Signed volume по теореме дивергенции (для замкнутого mesh)
    v0, v1, v2 = m.v0, m.v1, m.v2
    cross = np.cross(v1 - v0, v2 - v0)
    volume_mm3 = abs(np.sum(v0 * cross) / 6.0)
    volume_m3 = volume_mm3 / 1e9 if volume_mm3 > 1 else volume_mm3

    mass = volume_m3 * density_kg_m3
    # CG — центроид треугольников (грубо)
    centroids = (v0 + v1 + v2) / 3
    weights = np.linalg.norm(cross, axis=1)
    cg = np.average(centroids, axis=0, weights=weights + 1e-12)
    scale = 0.001 if abs(cg[0]) > 10 else 1.0

    # Момент инерции: приблизительно через AABB (для оценки)
    bbox = m.max_ - m.min_
    b = bbox * scale
    Ixx = mass / 12 * (b[1]**2 + b[2]**2)
    Iyy = mass / 12 * (b[0]**2 + b[2]**2)
    Izz = mass / 12 * (b[0]**2 + b[1]**2)

    return {
        'mass_kg': round(mass, 4),
        'cg_x': round(float(cg[0]) * scale, 4),
        'cg_y': round(float(cg[1]) * scale, 4),
        'cg_z': round(float(cg[2]) * scale, 4),
        'Ixx': round(Ixx, 6), 'Iyy': round(Iyy, 6), 'Izz': round(Izz, 6),
        'stl_path': str(path),
        'method': 'numpy-stl',
    }

# ── Уровень 4: аналитический fallback ───────────────────────────────────────

def from_bbox(lx, ly, lz, density_kg_m3):
    """Параллелепипед lx×ly×lz (метры). Для предварительной оценки."""
    vol = lx * ly * lz
    mass = vol * density_kg_m3
    Ixx = mass / 12 * (ly**2 + lz**2)
    Iyy = mass / 12 * (lx**2 + lz**2)
    Izz = mass / 12 * (lx**2 + ly**2)
    return {
        'mass_kg': round(mass, 4),
        'cg_x': round(lx / 2, 4), 'cg_y': round(ly / 2, 4), 'cg_z': round(lz / 2, 4),
        'Ixx': round(Ixx, 6), 'Iyy': round(Iyy, 6), 'Izz': round(Izz, 6),
        'stl_path': None,
        'method': 'analytical-bbox',
    }

# ── Главная функция ──────────────────────────────────────────────────────────

def get_geometry(file_path=None, density=1600, bbox=None):
    if bbox:
        return from_bbox(*bbox, density)

    path = Path(file_path)
    ext = path.suffix.lower()

    if ext == '.c3d' and KOMPAS:
        return from_kompas(path)

    if ext in ('.step', '.stp') and OCC:
        return from_step_occ(path, density)

    if ext == '.stl' and STL:
        return from_stl(path, density)

    # Fallback: пробуем heuristic по имени файла или bbox
    raise RuntimeError(
        f"Не удалось прочитать {path.name}: нет подходящего инструмента. "
        f"Установите: pythonOCC (pip install pythonocc-core) или numpy-stl (pip install numpy-stl). "
        f"Или передайте --bbox Lx Ly Lz для аналитической оценки."
    )


def main():
    p = argparse.ArgumentParser(description='Геометрия → масса, CG, момент инерции')
    p.add_argument('file', nargs='?', help='Путь к .c3d / .step / .stl файлу')
    p.add_argument('--density', type=float, default=1600,
                   help='Плотность материала кг/м³ (default 1600 — углепластик)')
    p.add_argument('--bbox', nargs=3, type=float, metavar=('Lx','Ly','Lz'),
                   help='Аналитическая оценка: габариты в метрах')
    args = p.parse_args()

    try:
        result = get_geometry(args.file, args.density, args.bbox)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error': str(e), 'method': 'failed'}), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
