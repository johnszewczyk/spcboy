#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/vendor/2sf2wav"
BUILD_DIR="$ROOT_DIR/.build/2sf"
OUTPUT_FILE="$BUILD_DIR/lib2sf.a"
SCRIPT_FILE="$ROOT_DIR/scripts/build-2sf-helper.sh"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Missing vendored 2sf2wav source at $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"
if [[ -f "$OUTPUT_FILE" && "${SPCBOY_FORCE_NATIVE_REBUILD:-0}" != "1" ]]; then
  newer_source=$(find "$SCRIPT_FILE" "$SOURCE_DIR" -type f -newer "$OUTPUT_FILE" -print -quit 2>/dev/null || true)
  if [[ -z "$newer_source" ]]; then exit 0; fi
fi

make -B -C "$SOURCE_DIR" lib2sf.a \
  CXX="${CXX:-clang++}" \
  CXXFLAGS="-std=gnu++14 -O2 -fPIC -I. -Idesmume -Isseqplayer -fpermissive -I/opt/homebrew/include" \
  >/dev/null
cp "$SOURCE_DIR/lib2sf.a" "$BUILD_DIR/lib2sf.a"
make -C "$SOURCE_DIR" clean >/dev/null
