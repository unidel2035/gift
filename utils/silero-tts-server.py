#!/usr/bin/env python3
"""
silero-tts-server — локальный HTTP-сервис для синтеза речи через Silero v4.

Модель скачивается один раз (~120МБ) в data/silero/ru_v4.pt и потом
используется офлайн.

Использование:
    python3 utils/silero-tts-server.py [--port 8091]

API:
    GET /tts?text=...&voice=baya[&rate=1.0]   -> audio/wav (24kHz, mono)
    GET /voices                                -> список голосов
    GET /healthz                               -> "ok"

В portal-server.mjs /api/tts?voice=silero:baya проксирует сюда.
"""
import argparse
import io
import os
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(ROOT, "data", "silero")
MODEL_PATH = os.path.join(MODEL_DIR, "ru_v4.pt")
SAMPLE_RATE = 24000  # для v4 ru. 48k тоже доступно, но 24k вдвое быстрее
DEFAULT_VOICE = "baya"

VOICES = ["aidar", "baya", "kseniya", "xenia", "eugene"]

_model = None
_model_lock = threading.Lock()


def ensure_model():
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        import torch
        os.makedirs(MODEL_DIR, exist_ok=True)
        if not os.path.exists(MODEL_PATH):
            print(f"[silero] скачиваю модель в {MODEL_PATH} (~120MB)…", flush=True)
            torch.hub.download_url_to_file(
                "https://models.silero.ai/models/tts/ru/v4_ru.pt",
                MODEL_PATH,
                progress=True,
            )
        device = torch.device("cpu")
        model = torch.package.PackageImporter(MODEL_PATH).load_pickle("tts_models", "model")
        model.to(device)
        _model = model
        print(f"[silero] модель загружена, голоса: {VOICES}", flush=True)
        return _model


def synthesize_wav(text: str, voice: str, rate: float = 1.0) -> bytes:
    if voice not in VOICES:
        voice = DEFAULT_VOICE
    text = text.strip()
    if not text:
        raise ValueError("empty text")
    # Silero не любит >1000 символов на раз — обрезаем мягко
    if len(text) > 1000:
        text = text[:1000].rsplit(" ", 1)[0]
    model = ensure_model()
    audio = model.apply_tts(
        text=text,
        speaker=voice,
        sample_rate=SAMPLE_RATE,
        put_accent=True,
        put_yo=True,
    )
    # audio — torch.Tensor float32 [-1, 1]; конвертим в int16 PCM
    import torch
    pcm = (audio.clamp(-1, 1) * 32767).to(torch.int16).cpu().numpy().tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm)
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, ctype, body):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        if u.path == "/healthz":
            return self._send(200, "text/plain", "ok")
        if u.path == "/voices":
            import json
            return self._send(200, "application/json",
                              json.dumps({"voices": VOICES, "default": DEFAULT_VOICE}))
        if u.path == "/tts":
            text = (qs.get("text") or [""])[0]
            voice = (qs.get("voice") or [DEFAULT_VOICE])[0]
            try:
                rate = float((qs.get("rate") or ["1.0"])[0])
            except ValueError:
                rate = 1.0
            try:
                wav = synthesize_wav(text, voice, rate)
                return self._send(200, "audio/wav", wav)
            except Exception as e:
                return self._send(500, "text/plain", f"silero error: {e}")
        return self._send(404, "text/plain", "not found")

    def log_message(self, fmt, *args):
        # Подавляем стандартный access-log, чтобы консоль была чистой
        pass


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=int(os.environ.get("SILERO_PORT", "8091")))
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--preload", action="store_true", help="загрузить модель сразу при старте")
    args = p.parse_args()
    if args.preload:
        ensure_model()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[silero] слушаю http://{args.host}:{args.port}", flush=True)
    print(f"         GET /tts?text=...&voice={'|'.join(VOICES)}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[silero] остановлен", flush=True)
        srv.shutdown()


if __name__ == "__main__":
    main()
