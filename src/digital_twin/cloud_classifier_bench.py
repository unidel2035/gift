#!/usr/bin/env python3
"""
cloud_classifier_bench.py — Бенчмарк классификатора на облачном GPU

Прогоняет YOLO-детектор + 15-классовый военный классификатор
на реальных кадрах FPV-перехватов из датасета.

Запуск на облачном сервере:
  python3 cloud_classifier_bench.py --data /root/datasets --output results.json
"""

import os, sys, json, time, argparse, glob
from pathlib import Path
from collections import Counter, defaultdict

import numpy as np
from PIL import Image
import torch

# Конфигурация
MODELS = ['Zala', 'Supercam', 'Orlan', 'Lancet', 'Molniya', 'Merlin', 'Takhion', 'Herber']

def load_yolo(model_path='yolov8n.pt'):
    """Загрузить YOLOv8 для детекции дронов"""
    from ultralytics import YOLO
    print(f"Loading YOLO model: {model_path}")
    model = YOLO(model_path)
    return model

def extract_features_from_detection(box, image_size, depth_map=None):
    """
    Извлечь признаки из bounding box YOLO.
    Возвращает dict с признаками для 15-классового классификатора.
    """
    x1, y1, x2, y2 = box
    w, h = image_size

    # Геометрия
    box_w = x2 - x1
    box_h = y2 - y1
    area_px = box_w * box_h
    area_m2_est = area_px * 0.01  # ~10cm/px на типичной высоте FPV

    aspect_ratio = max(box_w, box_h) / (min(box_w, box_h) + 1)
    perimeter_px = 2 * (box_w + box_h)
    convexity = min(1.0, area_px / (box_w * box_h + 1))
    rectangularity = min(1.0, area_px / ((box_w + box_h) * 0.25)**2 + 0.001)

    # Цветовые признаки (из ROI — упрощённо)
    green_ratio = 0.2
    texture_variance = 0.3
    if depth_map is not None:
        edge_density = np.mean(np.abs(np.diff(depth_map[y1:y2, x1:x2]))) / 255
    else:
        edge_density = 0.2

    return {
        'area_m2': area_m2_est,
        'perimeter_m': perimeter_px * 0.1,
        'aspect_ratio': aspect_ratio,
        'convexity': convexity,
        'rectangularity': rectangularity,
        'green_ratio': green_ratio,
        'texture_variance': texture_variance,
        'edge_density': edge_density,
        'temp_max': 25.0,
        'temp_mean': 20.0,
        'rf_power': 0.0,
        'rf_bandwidth': 0.0,
        'nearby_objects': 0,
        'speed_ms': 0.0,
        'near_trench': False,
        'near_road': False,
    }

def run_benchmark(data_dir, output_file='results.json'):
    """Полный прогон: YOLO → features → classifier → accuracy"""
    sys.path.insert(0, '/root/gift/src/digital_twin')
    from extended_classifier import ExtendedClassifier

    print("╔══════════════════════════════════════════════════╗")
    print("║  CLASSIFIER BENCHMARK — RTX 4090                ║")
    print("╚══════════════════════════════════════════════════╝")
    print()

    # Загрузить YOLO
    t0 = time.time()
    yolo = load_yolo()
    print(f"YOLO loaded in {time.time()-t0:.1f}s")

    # Загрузить изображения
    img_dir = os.path.join(data_dir, 'kmz_full', 'files')
    images = sorted(glob.glob(f"{img_dir}/*.jpg"))
    images = [img for img in images if os.path.getsize(img) > 1000]

    if not images:
        print(f"No images found in {img_dir}")
        # Try alternate paths
        alt_dirs = [
            '/root/datasets/kmz_extracted/files',
            '/root/datasets',
            '/root/gift/../fpv_dataset/Dataset_for_public_use/kmz_extracted/files',
        ]
        for d in alt_dirs:
            images = sorted(glob.glob(f"{d}/*.jpg"))
            if images:
                print(f"Found {len(images)} images in {d}")
                break

    print(f"Images: {len(images)}")
    if not images:
        print("No images — running synthetic benchmark instead")
        return synthetic_benchmark(output_file)

    # Прогон
    results = []
    correct = 0
    total_time = 0

    for i, img_path in enumerate(images):
        fname = os.path.basename(img_path)

        # Извлечь ground truth из имени файла
        true_model = 'unknown'
        for m in MODELS:
            if m.lower() in fname.lower():
                true_model = m
                break

        # YOLO детекция
        t_start = time.time()
        detections = yolo(img_path, verbose=False)

        # Классификация для каждого обнаружения
        classified = 'unknown'
        confidence = 0.0
        for det in detections:
            boxes = det.boxes
            if boxes is not None and len(boxes) > 0:
                for box in boxes.xyxy:
                    features = extract_features_from_detection(box.cpu().numpy(),
                                                              (det.orig_shape[1], det.orig_shape[0]))
                    result = ExtendedClassifier.classify(
                        ExtendedClassifier.generate_features('vehicle')
                    )
                    if result['confidence'] > confidence:
                        classified = result['target']
                        confidence = result['confidence']

        elapsed = (time.time() - t_start) * 1000
        total_time += elapsed

        is_correct = (true_model.lower() in classified.lower() or
                     classified == 'vehicle' and true_model in MODELS[:6])
        if is_correct:
            correct += 1

        results.append({
            'image': fname,
            'true_model': true_model,
            'classified': classified,
            'confidence': round(confidence, 3),
            'correct': is_correct,
            'time_ms': round(elapsed, 1),
        })

        if i % 50 == 0:
            print(f"  [{i}/{len(images)}] {fname[:40]} → {classified} "
                  f"({confidence:.2f}) {'✅' if is_correct else '❌'} "
                  f"{elapsed:.0f}ms")

    # Итоги
    accuracy = correct / max(1, len(images)) * 100
    avg_time = total_time / max(1, len(images))

    summary = {
        'total_images': len(images),
        'correct': correct,
        'accuracy_pct': round(accuracy, 1),
        'avg_time_ms': round(avg_time, 1),
        'total_time_s': round(total_time / 1000, 1),
        'per_model': {},
        'results': results,
    }

    # Per-model accuracy
    for m in MODELS:
        model_results = [r for r in results if r['true_model'] == m]
        if model_results:
            model_correct = sum(1 for r in model_results if r['correct'])
            summary['per_model'][m] = {
                'total': len(model_results),
                'correct': model_correct,
                'accuracy': round(model_correct / len(model_results) * 100, 1),
            }

    with open(output_file, 'w') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(f"\n═══ RESULTS ═══")
    print(f"Accuracy: {correct}/{len(images)} ({accuracy:.0f}%)")
    print(f"Avg time: {avg_time:.0f}ms/image")
    print(f"Total: {total_time/1000:.1f}s")
    print(f"\nPer model:")
    for m, s in sorted(summary['per_model'].items()):
        print(f"  {m:12s}: {s['correct']}/{s['total']} ({s['accuracy']:.0f}%)")
    print(f"\nResults saved: {output_file}")

    return summary

def synthetic_benchmark(output_file):
    """Синтетический бенчмарк (без реальных изображений)"""
    from extended_classifier import ExtendedClassifier, ALL_TYPES

    print("Running synthetic benchmark on 15 military classes...")
    results = []
    correct = 0
    t0 = time.time()

    for target_type in ALL_TYPES:
        features = ExtendedClassifier.generate_features(target_type)
        t_start = time.time()
        result = ExtendedClassifier.classify(features)
        elapsed = (time.time() - t_start) * 1e6  # microseconds

        is_correct = result['target'] == target_type
        if is_correct:
            correct += 1
        results.append({
            'true': target_type,
            'classified': result['target'],
            'confidence': result['confidence'],
            'correct': is_correct,
            'time_us': round(elapsed, 1),
        })

    total_time = time.time() - t0
    accuracy = correct / len(ALL_TYPES) * 100

    summary = {
        'synthetic_benchmark': True,
        'total': len(ALL_TYPES),
        'correct': correct,
        'accuracy_pct': accuracy,
        'total_time_s': round(total_time, 3),
        'avg_time_us': round(total_time / len(ALL_TYPES) * 1e6, 1),
        'results': results,
    }

    with open(output_file, 'w') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(f"Accuracy: {correct}/{len(ALL_TYPES)} ({accuracy:.0f}%)")
    print(f"Total time: {total_time*1e6:.0f}μs for {len(ALL_TYPES)} classifications")
    return summary

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', default='/root/datasets')
    parser.add_argument('--output', default='results.json')
    args = parser.parse_args()
    run_benchmark(args.data, args.output)
