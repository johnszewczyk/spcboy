#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VGMBoy_ROOT="$(cd "$ROOT_DIR/../VGMBoy" && pwd)"
OUTPUT="$ROOT_DIR/native/vgmboy-electron-bridge"
BUILD_CACHE="$VGMBoy_ROOT/.build/spcboy-electron-bridge-cache"

if [[ ! -f "$VGMBoy_ROOT/Package.swift" ]]; then
  echo "VGMBoy package is missing: $VGMBoy_ROOT"
  exit 1
fi

mkdir -p "$BUILD_CACHE"
"$VGMBoy_ROOT/scripts/build-dependencies.sh"
CLANG_MODULE_CACHE_PATH="$BUILD_CACHE/clang" \
SWIFTPM_MODULECACHE_OVERRIDE="$BUILD_CACHE/swiftpm" \
swift build \
  --package-path "$VGMBoy_ROOT" \
  --disable-sandbox \
  --configuration release \
  --product vgmboy-electron-bridge

cp -X "$VGMBoy_ROOT/.build/release/vgmboy-electron-bridge" "$OUTPUT"
chmod 755 "$OUTPUT"
echo "Built $OUTPUT"
