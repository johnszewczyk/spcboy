#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/vendor/lazyusf2"
BUILD_DIR="$ROOT_DIR/.build/lazyusf"
OUTPUT_FILE="$ROOT_DIR/native/lazyusf-tool"
SCRIPT_FILE="$ROOT_DIR/scripts/build-lazyusf-helper.sh"

if [[ -x "$OUTPUT_FILE" && "${SPCBOY_FORCE_NATIVE_REBUILD:-0}" != "1" ]]; then
  newer_source=$(find "$SCRIPT_FILE" "$ROOT_DIR/native/lazyusf_tool.c" "$ROOT_DIR/native/lazyusf" "$ROOT_DIR/vendor/lazyusf2" "$ROOT_DIR/vendor/psflib" -type f -newer "$OUTPUT_FILE" -print -quit 2>/dev/null || true)
  if [[ -z "$newer_source" ]]; then exit 0; fi
fi

if [[ ! -d "$SOURCE_DIR" || ! -f "$ROOT_DIR/vendor/psflib/psflib.c" ]]; then
  echo "Missing vendored lazyusf2 or psflib sources" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"
make -B -C "$SOURCE_DIR" liblazyusf.a \
  CC="${CC:-cc}" \
  AR="${AR:-ar}" \
  CFLAGS="-c -O2 -fPIC -I. -I$ROOT_DIR/vendor/psflib -Wno-return-type -Wno-pointer-to-int-cast -Wno-pointer-sign -Wno-shift-negative-value -Wno-macro-redefined" \
  OPTS="" \
  ROPTS="-DARCH_MIN_ARM_NEON" \
  >/dev/null
cp "$SOURCE_DIR/liblazyusf.a" "$BUILD_DIR/liblazyusf.a"
make -C "$SOURCE_DIR" clean >/dev/null

cc -c -O2 -fPIC -I"$ROOT_DIR/vendor/psflib" "$ROOT_DIR/vendor/psflib/psflib.c" -o "$BUILD_DIR/psflib.o"
ar rcs "$BUILD_DIR/libpsflib.a" "$BUILD_DIR/psflib.o"

cc -O2 -std=c11 \
  -I"$ROOT_DIR/native/lazyusf" \
  -I"$ROOT_DIR/vendor/psflib" \
  -I"$ROOT_DIR/vendor/lazyusf2" \
  "$ROOT_DIR/native/lazyusf_tool.c" \
  "$ROOT_DIR/native/lazyusf/lazyusf_bridge.c" \
  "$BUILD_DIR/liblazyusf.a" \
  "$BUILD_DIR/libpsflib.a" \
  -lz -lm \
  -o "$OUTPUT_FILE"
