"""Fine-tune YOLOv8 on KIIT-MiTA military drone dataset via Modal"""
import modal, os
from pathlib import Path

image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "ultralytics", "torch", "torchvision", "opencv-python-headless", "kagglehub"
)

app = modal.App("military-yolo", image=image)

@app.function(gpu="T4", timeout=3600, memory=16384)
def train():
    import torch, kagglehub, shutil, yaml
    from ultralytics import YOLO

    print(f"GPU: {torch.cuda.get_device_name(0)}")
    
    # Download dataset
    print("Downloading KIIT-MiTA dataset...")
    path = kagglehub.dataset_download("sudipchakrabarty/kiit-mita")
    print(f"Dataset at: {path}")
    
    # Find data.yaml or create one
    yaml_path = None
    for root, dirs, files in os.walk(path):
        for f in files:
            if f.endswith('.yaml') or f.endswith('.yml'):
                yaml_path = os.path.join(root, f)
                break
    
    if not yaml_path:
        # Create YAML for the dataset
        yaml_path = "/tmp/military.yaml"
        with open(yaml_path, 'w') as f:
            f.write("""
path: {path}
train: images/train
val: images/val
names:
  0: artillery
  1: missile
  2: radar
  3: rocket_launcher
  4: soldier
  5: tank
  6: vehicle
nc: 7
""")
    
    print(f"Training with: {yaml_path}")
    
    # Train
    model = YOLO("yolov8n.pt")
    results = model.train(
        data=yaml_path, epochs=30, imgsz=640, batch=16,
        device=0, workers=2, name="military-drone",
        exist_ok=True, project="/tmp/runs",
        hsv_h=0.015, hsv_s=0.7, hsv_v=0.4,
        degrees=10.0, translate=0.1, scale=0.5,
        fliplr=0.5, mosaic=1.0, mixup=0.1,
        lr0=0.001, lrf=0.01, cos_lr=True,
    )
    
    metrics = model.val()
    print(f"mAP50: {metrics.box.map50:.3f}, mAP50-95: {metrics.box.map:.3f}")
    
    # Export ONNX
    onnx_path = "/tmp/military-drone-nano.onnx"
    model.export(format="onnx", imgsz=640, simplify=True)
    
    # Save best model
    best_path = "/tmp/military-drone-nano.pt"
    import shutil
    src = Path("/tmp/runs/military-drone/weights/best.pt")
    if src.exists(): shutil.copy(src, best_path)
    
    print(f"Model: {best_path} ({os.path.getsize(best_path)/1e6:.0f}MB)")
    return {"mAP50": float(metrics.box.map50), "model_mb": os.path.getsize(best_path)/1e6}

@app.local_entrypoint()
def main():
    result = train.remote()
    print(f"Done: {result}")

if __name__ == "__main__":
    main()
