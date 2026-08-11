#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/vendor/libvgm"
BUILD_DIR="$ROOT_DIR/.build/libvgm"
OUTPUT_FILE="$ROOT_DIR/native/libvgm-tool"
SCRIPT_FILE="$ROOT_DIR/scripts/build-libvgm-helper.sh"

if [[ -x "$OUTPUT_FILE" && "${SPCBOY_FORCE_NATIVE_REBUILD:-0}" != "1" ]]; then
  newer_source=$(find "$SCRIPT_FILE" "$ROOT_DIR/native/libvgm_tool.cpp" "$ROOT_DIR/native/libvgm" "$ROOT_DIR/vendor/libvgm" -type f -newer "$OUTPUT_FILE" -print -quit 2>/dev/null || true)
  if [[ -z "$newer_source" ]]; then exit 0; fi
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Missing vendored libvgm source at $SOURCE_DIR"
  echo "Clone it with: git clone --depth 1 https://github.com/ValleyBell/libvgm.git vendor/libvgm"
  exit 1
fi

if ! command -v cmake >/dev/null 2>&1; then
  echo "Missing cmake"
  echo "Install it with: brew install cmake"
  exit 1
fi

cmake -S "$SOURCE_DIR" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_LIBAUDIO=NO \
  -DBUILD_PLAYER=NO \
  -DBUILD_VGM2WAV=NO \
  -DBUILD_TESTS=NO \
  -DLIBRARY_TYPE=STATIC \
  -DUSE_SANITIZERS=OFF

cmake --build "$BUILD_DIR" --target vgm-utils vgm-emu vgm-player -j 4

clang++ \
  -O2 \
  -std=c++17 \
  -I"$SOURCE_DIR" \
  -I"$ROOT_DIR/native/libvgm" \
  "$ROOT_DIR/native/libvgm_tool.cpp" \
  "$ROOT_DIR/native/libvgm/libvgm_bridge.cpp" \
  -L"$BUILD_DIR/bin" \
  -Wl,-force_load,"$BUILD_DIR/bin/libvgm-player.a" \
  -Wl,-force_load,"$BUILD_DIR/bin/libvgm-emu.a" \
  -Wl,-force_load,"$BUILD_DIR/bin/libvgm-utils.a" \
  -lz \
  -liconv \
  -o "$ROOT_DIR/native/libvgm-tool"
