#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/vendor/play"
BUILD_DIR="$ROOT_DIR/.build/play-psf"
OUTPUT_FILE="$BUILD_DIR/libspcboy_play_psf.a"
SCRIPT_FILE="$ROOT_DIR/scripts/build-play-psf-helper.sh"

if [[ -f "$OUTPUT_FILE" && "${SPCBOY_FORCE_NATIVE_REBUILD:-0}" != "1" ]]; then
  newer_source=$(find "$SCRIPT_FILE" "$SOURCE_DIR" -type f -newer "$OUTPUT_FILE" -print -quit 2>/dev/null || true)
  if [[ -z "$newer_source" ]]; then exit 0; fi
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Missing vendored Play! source at $SOURCE_DIR" >&2
  exit 1
fi

cmake -S "$SOURCE_DIR" -B "$BUILD_DIR" \
  -DBUILD_PLAY=OFF \
  -DBUILD_PSFPLAYER=ON \
  -DBUILD_TESTS=OFF \
  -DBUILD_AOT_CACHE=OFF \
  -DUSE_AOT_CACHE=OFF \
  -DPSFCORE_ONLY=ON
cmake --build "$BUILD_DIR" --target PsfCore --parallel "${SPCBOY_BUILD_JOBS:-4}"

libtool -static -o "$BUILD_DIR/libspcboy_play_psf.a" \
  "$BUILD_DIR/tools/PsfPlayer/Source/libPsfCore.a" \
  "$BUILD_DIR/tools/NamcoSys147NANDTools/Source/libPlayCore.a" \
  "$BUILD_DIR/tools/NamcoSys147NANDTools/Source/CodeGen/libCodeGen.a" \
  "$BUILD_DIR/tools/NamcoSys147NANDTools/Source/Framework/libFramework.a" \
  "$BUILD_DIR/tools/NamcoSys147NANDTools/Source/FrameworkHttp/libFramework_Http.a" \
  "$BUILD_DIR/tools/NamcoSys147NANDTools/Source/FrameworkAmazon/libFramework_Amazon.a" \
  "$BUILD_DIR/tools/NamcoSys147NANDTools/Source/app_shared/libapp_shared.a" \
  "$BUILD_DIR/tools/PsfPlayer/Source/unrarsrc-5.2.5/libunrar.a" \
  "$BUILD_DIR/tools/NamcoSys147NANDTools/Source/libchdr/libchdr-static.a" \
  "$BUILD_DIR/tools/NamcoSys147NANDTools/Source/Framework/zstd_zlibwrapper/liblibzstd_zlibwrapper_static.a" \
  "$BUILD_DIR/tools/NamcoSys147NANDTools/Source/Framework/zstd_zlibwrapper/zstd/lib/libzstd.a" \
  "$BUILD_DIR/tools/NamcoSys147NANDTools/Source/libchdr/deps/lzma-24.05/liblzma.a" \
  "$BUILD_DIR/tools/NamcoSys147NANDTools/Source/xxHash/libxxhash.a"
