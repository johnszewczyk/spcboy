#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/vendor/mgba"
BUILD_DIR="$ROOT_DIR/.build/mgba"
OUTPUT_FILE="$BUILD_DIR/libmgba.a"
SCRIPT_FILE="$ROOT_DIR/scripts/build-mgba-helper.sh"

if [[ -f "$OUTPUT_FILE" && "${SPCBOY_FORCE_NATIVE_REBUILD:-0}" != "1" ]]; then
  newer_source=$(find "$SCRIPT_FILE" "$SOURCE_DIR" -type f -newer "$OUTPUT_FILE" -print -quit 2>/dev/null || true)
  if [[ -z "$newer_source" ]]; then exit 0; fi
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Missing vendored mGBA source at $SOURCE_DIR"
  echo "Clone it with: git clone --depth 1 https://github.com/mgba-emu/mgba.git vendor/mgba"
  exit 1
fi

if ! command -v cmake >/dev/null 2>&1; then
  echo "Missing cmake"
  echo "Install it with: brew install cmake"
  exit 1
fi

cmake -S "$SOURCE_DIR" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=26.0 \
  -DLIBMGBA_ONLY=ON \
  -DM_CORE_GBA=ON \
  -DM_CORE_GB=OFF \
  -DBUILD_STATIC=ON \
  -DBUILD_SHARED=OFF

cmake --build "$BUILD_DIR" --target mgba -j 4
