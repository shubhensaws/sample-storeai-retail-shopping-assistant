#!/bin/bash
# Setup script for Whisper live transcription on g6.xlarge (Deep Learning OSS AMI)
set -e

echo "=== Installing faster-whisper and dependencies ==="
pip install faster-whisper websockets numpy

echo "=== Downloading Whisper large-v3 model (first run caches it) ==="
python3 -c "
from faster_whisper import WhisperModel
print('Downloading model...')
model = WhisperModel('large-v3', device='cuda', compute_type='float16')
print('Model ready!')
"

echo "=== Setup complete! ==="
echo "Run: python3 whisper_server.py"
