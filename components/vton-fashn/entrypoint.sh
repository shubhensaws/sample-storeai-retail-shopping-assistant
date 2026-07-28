#!/usr/bin/env bash
# Download the FASHN VTON v1.5 weights from the canonical HuggingFace source
# (fashn-ai/fashn-vton-1.5) into WEIGHTS_DIR on first start, then serve. Keeping
# the download here (vs baking a ~2GB layer) keeps the recipe reproducible from
# the upstream weights. Use a PVC-backed WEIGHTS_DIR to cache across restarts.
set -euo pipefail

WEIGHTS_DIR="${WEIGHTS_DIR:-/weights}"
mkdir -p "$WEIGHTS_DIR"

if [ ! -f "${WEIGHTS_DIR}/model.safetensors" ]; then
  echo "[entrypoint] Downloading FASHN VTON v1.5 weights → ${WEIGHTS_DIR} ..."
  ( cd /app/fashn && python scripts/download_weights.py --weights-dir "${WEIGHTS_DIR}" )
else
  echo "[entrypoint] Weights already present in ${WEIGHTS_DIR}"
fi

echo "[entrypoint] Starting FASHN VTON server on :8081"
cd /app
exec uvicorn server:app --host 0.0.0.0 --port 8081 --workers 1
