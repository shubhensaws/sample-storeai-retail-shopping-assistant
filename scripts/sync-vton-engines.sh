#!/usr/bin/env bash
# Single source of truth for the VTON prompt-engineering package.
# Canonical: components/shared/vton_engines/. This copies it into each consumer's
# build context (orchestrator Docker image + tryon-mcp Lambda bundle), since those
# are packaged separately and can't import across boundaries. Run before building/
# deploying either; the deploy CLI calls it automatically in `storeai up`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/components/shared/vton_engines"
DESTS=(
  "${ROOT}/components/orchestrator/app/vton_engines"
  "${ROOT}/components/mcp/tryon-mcp/vton_engines"
)
for d in "${DESTS[@]}"; do
  mkdir -p "$d"
  cp -f "${SRC}"/*.py "$d/"
  echo "  synced vton_engines -> ${d#$ROOT/}"
done
