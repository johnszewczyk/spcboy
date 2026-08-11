#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/vendor/vgmstream"
BUILD_DIR="$ROOT_DIR/.build/vgmstream"
OUTPUT_FILE="$BUILD_DIR/src/libvgmstream.a"
SCRIPT_FILE="$ROOT_DIR/scripts/build-vgmstream-helper.sh"

if [[ -f "$OUTPUT_FILE" && "${SPCBOY_FORCE_NATIVE_REBUILD:-0}" != "1" ]]; then
  newer_source=$(find "$SCRIPT_FILE" "$SOURCE_DIR" -type f -newer "$OUTPUT_FILE" -print -quit 2>/dev/null || true)
  if [[ -z "$newer_source" ]]; then exit 0; fi
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Missing vendored vgmstream source at $SOURCE_DIR" >&2
  exit 1
fi

export PKG_CONFIG_PATH="/opt/homebrew/opt/ffmpeg/lib/pkgconfig:/opt/homebrew/opt/libvorbis/lib/pkgconfig:/opt/homebrew/opt/libogg/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
cmake -S "$SOURCE_DIR" -B "$BUILD_DIR" \
  -DBUILD_CLI=OFF \
  -DBUILD_STATIC=ON \
  -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_PREFIX_PATH=/opt/homebrew \
  -DUSE_FFMPEG=ON \
  -DUSE_MPEG=OFF \
  -DUSE_VORBIS=ON \
  -DVORBISFILE_ROOT=/opt/homebrew/opt/libvorbis \
  -DVORBIS_ROOT=/opt/homebrew/opt/libvorbis \
  -DOGG_ROOT=/opt/homebrew/opt/libogg \
  -DUSE_G7221=OFF \
  -DUSE_G719=OFF \
  -DUSE_ATRAC9=OFF \
  -DUSE_CELT=OFF \
  -DUSE_SPEEX=OFF
cmake --build "$BUILD_DIR" --target libvgmstream --parallel "${SPCBOY_BUILD_JOBS:-4}"
