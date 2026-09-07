#!/usr/bin/env bash
# Build function zip and Lambda layer zip into artifacts/
# Usage: bash scripts/package.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS="${REPO_ROOT}/artifacts"

echo "==> Cleaning artifacts/"
rm -rf "${ARTIFACTS}"
mkdir -p "${ARTIFACTS}"

# -------------------------------------------------------------------
# 1. Build the Lambda function bundle (esbuild → dist/handler.js)
# -------------------------------------------------------------------
echo "==> Building function bundle"
cd "${REPO_ROOT}"
node esbuild.config.mjs

echo "==> Zipping function → artifacts/function.zip"
cd "${REPO_ROOT}/dist"
zip "${ARTIFACTS}/function.zip" handler.js
cd "${REPO_ROOT}"

# -------------------------------------------------------------------
# 2. Build the Lambda layer (zod → artifacts/layer/nodejs/node_modules)
#    Lambda requires deps under nodejs/node_modules/ for nodejs runtimes.
# -------------------------------------------------------------------
echo "==> Installing layer dependencies"
LAYER_DIR="${ARTIFACTS}/layer/nodejs"
mkdir -p "${LAYER_DIR}"

# Copy package.json so npm knows which deps to install; only production deps
cp "${REPO_ROOT}/package.json" "${LAYER_DIR}/package.json"
cd "${LAYER_DIR}"
npm install --omit=dev --ignore-scripts 2>&1

# Remove devDependencies that leaked in (vitest, esbuild, types, etc.)
# Keep only runtime deps. We do this by allowing only listed packages.
RUNTIME_DEPS=("zod")
cd "${LAYER_DIR}/node_modules"
for dir in */; do
  pkg="${dir%/}"
  keep=false
  for dep in "${RUNTIME_DEPS[@]}"; do
    if [[ "${pkg}" == "${dep}" || "${pkg}" == ".package-lock.json" ]]; then
      keep=true
      break
    fi
  done
  if [[ "${keep}" == "false" ]]; then
    rm -rf "${pkg}"
  fi
done
cd "${REPO_ROOT}"

echo "==> Zipping layer → artifacts/layer.zip"
cd "${ARTIFACTS}/layer"
zip -r "${ARTIFACTS}/layer.zip" nodejs/
cd "${REPO_ROOT}"

echo ""
echo "Done."
echo "  function.zip: $(du -sh "${ARTIFACTS}/function.zip" | cut -f1)"
echo "  layer.zip:    $(du -sh "${ARTIFACTS}/layer.zip" | cut -f1)"
