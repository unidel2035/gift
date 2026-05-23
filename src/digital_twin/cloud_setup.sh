#!/bin/bash
# cloud_setup.sh — Развёртывание всего стека на облачном GPU (Immers.cloud RTX 4090)
# Запуск: bash cloud_setup.sh

set -e
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  DRONDOC CLOUD GPU SETUP — RTX 4090                    ║"
echo "╚══════════════════════════════════════════════════════════╝"

# 1. System update + CUDA tools
echo "[1/8] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq python3-pip python3-dev git unzip curl wget cmake build-essential 2>/dev/null

# 2. Verify GPU
echo "[2/8] Checking GPU..."
nvidia-smi
echo "CUDA version: $(nvcc --version 2>/dev/null | grep 'release' | awk '{print $6}' || echo 'check nvidia-smi')"

# 3. Python ML stack
echo "[3/8] Installing Python ML libraries..."
pip3 install --break-system-packages -q torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 2>/dev/null || \
pip3 install --break-system-packages -q torch torchvision torchaudio 2>/dev/null
pip3 install --break-system-packages -q ultralytics opencv-python-headless numpy pillow requests flask 2>/dev/null

# 4. Install Ollama for LLM
echo "[4/8] Installing Ollama..."
curl -fsSL https://ollama.com/install.sh | sh 2>/dev/null || true

# 5. Clone our repo
echo "[5/8] Cloning project..."
cd /root
if [ -d "gift" ]; then
    cd gift && git pull
else
    git clone https://github.com/unidel2035/gift.git 2>/dev/null || \
    echo "Repo clone failed — will upload manually"
fi

# 6. Download FPV dataset (from our Google Drive or local upload)
echo "[6/8] Dataset preparation..."
mkdir -p /root/datasets

# 7. Pull LLM model
echo "[7/8] Pulling Serafim model..."
ollama pull serafim-1.5b 2>/dev/null || echo "Ollama not ready yet"

# 8. Run benchmark
echo "[8/8] Running GPU benchmark..."
python3 -c "
import torch
print(f'PyTorch: {torch.__version__}')
print(f'CUDA available: {torch.cuda.is_available()}')
print(f'GPU: {torch.cuda.get_device_name(0)}')
print(f'Memory: {torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB')
# Quick benchmark
x = torch.randn(5000, 5000, device='cuda')
torch.mm(x, x)
print('GPU compute OK')
"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  SETUP COMPLETE                                        ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  cd /root/gift/src/digital_twin"
echo "  python3 unified_sim.py  # Launch simulation"
echo "  python3 adaptive_enemy.py  # Run evolutionary training"
