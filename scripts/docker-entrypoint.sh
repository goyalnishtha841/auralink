#!/usr/bin/env bash
# Fetches the Kokoro TTS model files into data/tts/ on first start (they are not auto-downloaded
# by kokoro-onnx itself, see engine/tts.py) so Free Talk's voice output works, then hands off to
# the real command (uvicorn). data/ should be a mounted volume so this only happens once.
set -euo pipefail

TTS_DIR="/app/data/tts"
mkdir -p "$TTS_DIR"
BASE_URL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"

if [[ ! -f "$TTS_DIR/kokoro-v1.0.onnx" ]]; then
  echo "Downloading Kokoro TTS model (~326 MB, one time)..."
  curl -fL "$BASE_URL/kokoro-v1.0.onnx" -o "$TTS_DIR/kokoro-v1.0.onnx"
fi
if [[ ! -f "$TTS_DIR/voices-v1.0.bin" ]]; then
  echo "Downloading Kokoro voices file (~28 MB, one time)..."
  curl -fL "$BASE_URL/voices-v1.0.bin" -o "$TTS_DIR/voices-v1.0.bin"
fi

exec "$@"
