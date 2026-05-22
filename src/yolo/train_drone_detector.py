#!/usr/bin/env python3
"""
train_drone_detector.py — YOLOv8 для обнаружения дронов и целей

Обучается на открытых данных VisDrone/DOTA/UAVDT.
Экспорт в ONNX → RKNN для Orange Pi 5 NPU (6 TOPS, 30 FPS).

Использование:
  python train_drone_detector.py           # полное обучение
  python train_drone_detector.py --test    # только тест
  python train_drone_detector.py --export  # экспорт для Orange Pi 5

Требования:
  pip install ultralytics opencv-python
  Данные скачиваются автоматически.
"""

import os, sys, argparse, subprocess
from pathlib import Path

# ── Конфигурация ──────────────────────────────────────────────────────────────

DATASETS = {
    "visdrone": {
        "url": "https://github.com/ultralytics/assets/releases/download/v0.0.0/VisDrone.yaml",
        "desc": "VisDrone — 10K изображений с дронов, 10 классов",
        "classes": ["pedestrian","people","bicycle","car","van","truck","tricycle","awning-tricycle","bus","motor"],
    },
}

MODEL_CONFIG = {
    "nano":  {"model": "yolov8n.pt", "size": 640, "params": "3.2M",  "fps_opi5": 30},
    "small": {"model": "yolov8s.pt", "size": 640, "params": "11.2M", "fps_opi5": 15},
    "medium":{"model": "yolov8m.pt", "size": 640, "params": "25.9M", "fps_opi5": 8},
}

OUT_DIR = Path("/home/unidel/gift/data/yolo")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── Обучение ──────────────────────────────────────────────────────────────────

def train(model_size="nano", epochs=50, batch=8):
    """Обучить YOLOv8 на VisDrone"""
    from ultralytics import YOLO

    cfg = MODEL_CONFIG[model_size]
    print(f"\n{'='*60}")
    print(f" YOLOv8 {model_size} — {cfg['params']} параметров")
    print(f" Целевое железо: Orange Pi 5 NPU ({cfg['fps_opi5']} FPS)")
    print(f"{'='*60}\n")

    # Загружаем предобученную модель
    model = YOLO(cfg["model"])

    # Обучаем
    results = model.train(
        data="VisDrone.yaml",
        epochs=epochs,
        imgsz=cfg["size"],
        batch=batch,
        device="cuda",      # GPU
        workers=4,
        project=str(OUT_DIR / "runs"),
        name=f"drone-det-{model_size}",
        exist_ok=True,
        # Аугментация для дроновых данных
        hsv_h=0.015,
        hsv_s=0.7,
        hsv_v=0.4,
        degrees=10.0,       # небольшой поворот
        translate=0.1,
        scale=0.5,
        shear=0.0,
        perspective=0.0,
        flipud=0.0,
        fliplr=0.5,         # горизонтальный флип
        mosaic=1.0,         # мозаичная аугментация
        mixup=0.1,
    )

    # Сохраняем лучшую модель
    best_path = OUT_DIR / f"drone-det-{model_size}.pt"
    import shutil
    src = Path(results.save_dir) / "weights" / "best.pt"
    if src.exists():
        shutil.copy(src, best_path)
        print(f"\n✓ Модель сохранена: {best_path}")

    return model, results


# ── Экспорт для Orange Pi 5 ───────────────────────────────────────────────────

def export_to_rknn(model_path, model_size="nano"):
    """Экспорт YOLO → ONNX → RKNN (NPU Orange Pi 5)"""

    from ultralytics import YOLO

    print(f"\n{'='*60}")
    print(f" Экспорт для Orange Pi 5 NPU (RK3588)")
    print(f"{'='*60}\n")

    model = YOLO(model_path)

    # 1. Экспорт в ONNX
    onnx_path = OUT_DIR / f"drone-det-{model_size}.onnx"
    model.export(format="onnx", imgsz=640, simplify=True)
    print(f"✓ ONNX: {onnx_path}")

    # 2. Конвертация ONNX → RKNN (требуется rknn-toolkit2 на хосте)
    rknn_path = OUT_DIR / f"drone-det-{model_size}.rknn"
    print(f"\nДля конвертации в RKNN выполни на Orange Pi 5:")
    print(f"  python3 -m rknn.api.rknn_convert {onnx_path} {rknn_path}")

    # 3. Инструкция по деплою
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║  ДЕПЛОЙ НА ORANGE PI 5                                      ║
╠══════════════════════════════════════════════════════════════╣
║  1. Скопируй .rknn на Orange Pi 5:                          ║
║     scp {rknn_path} orangepi@192.168.1.X:/home/orangepi/    ║
║                                                              ║
║  2. Запусти инференс:                                        ║
║     cd /home/orangepi && python3 detect_rknn.py              ║
║                                                              ║
║  3. FPS на NPU (6 TOPS):                                     ║
║     YOLOv8n: 30 FPS | YOLOv8s: 15 FPS | YOLOv8m: 8 FPS     ║
╚══════════════════════════════════════════════════════════════╝
""")


# ── Тестирование ──────────────────────────────────────────────────────────────

def test(model_path, image_source="0"):
    """Тест детектора на видео/камере"""
    from ultralytics import YOLO
    import cv2

    model = YOLO(model_path)
    print(f"\nТест: {model_path}")
    print("Нажми Q для выхода\n")

    if image_source == "0":
        cap = cv2.VideoCapture(0)
    else:
        cap = cv2.VideoCapture(image_source)

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break

        results = model(frame, imgsz=640, conf=0.25, iou=0.45)
        annotated = results[0].plot()

        cv2.imshow("Drone Detector (Orange Pi 5)", annotated)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()


# ── Классификатор на основе детекции ─────────────────────────────────────────

def detect_and_classify(model_path, image_path):
    """Детекция YOLO → признаки → классификатор целей (Серафим)"""
    from ultralytics import YOLO
    import cv2, sys

    # Импортируем наш C++ классификатор через ctypes
    sys.path.insert(0, str(Path(__file__).parent.parent / "wavelet"))
    # (в реальности — вызов скомпилированного .so)

    model = YOLO(model_path)
    img = cv2.imread(image_path)
    results = model(img, imgsz=640, conf=0.25)

    print(f"\nОбнаружено объектов: {len(results[0].boxes)}")
    for i, box in enumerate(results[0].boxes):
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        cls = int(box.cls[0])
        conf = float(box.conf[0])
        w, h = x2 - x1, y2 - y1
        print(f"  [{i}] класс={cls} conf={conf:.2f} size={w:.0f}×{h:.0f}px")
        print(f"       → классификатор: (требуется fuzzy_classifier.h)")

    return results


# ── CLI ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="YOLOv8 Drone Detector")
    parser.add_argument("--train", action="store_true", help="Обучить модель")
    parser.add_argument("--size", default="nano", choices=["nano","small","medium"])
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--export", action="store_true", help="Экспорт в ONNX/RKNN")
    parser.add_argument("--test", type=str, default=None, help="Путь к изображению или 0 для камеры")
    parser.add_argument("--classify", type=str, help="Детекция + классификация")
    args = parser.parse_args()

    model_path = OUT_DIR / f"drone-det-{args.size}.pt"

    if args.train:
        train(args.size, args.epochs)
        export_to_rknn(str(model_path), args.size)
    elif args.export:
        export_to_rknn(str(model_path), args.size)
    elif args.test is not None:
        test(str(model_path) if model_path.exists() else args.size + ".pt", args.test)
    elif args.classify:
        detect_and_classify(str(model_path), args.classify)
    else:
        parser.print_help()
        print("\nПример: python train_drone_detector.py --train --size nano --epochs 50")
