#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_FILES=(
  "$ROOT_DIR/native/libgme_tool.c"
  "$ROOT_DIR/native/ring_buffer.c"
  "$ROOT_DIR/native/audio_engine_macos.c"
  "$ROOT_DIR/native/lazyusf/lazyusf_bridge.c"
)
CPP_SOURCE_FILES=(
  "$ROOT_DIR/native/libvgm_decoder.cpp"
  "$ROOT_DIR/native/libvgm/libvgm_bridge.cpp"
  "$ROOT_DIR/native/highlycomplete_decoder.cpp"
  "$ROOT_DIR/native/highlycomplete_bridge.cpp"
  "$ROOT_DIR/native/twosf_decoder.cpp"
  "$ROOT_DIR/native/twosf_bridge.cpp"
  "$ROOT_DIR/native/vgmstream_decoder.cpp"
  "$ROOT_DIR/native/vgmstream_bridge.cpp"
  "$ROOT_DIR/native/play_psf_decoder.cpp"
  "$ROOT_DIR/native/play_psf_bridge.cpp"
)
OUTPUT_FILE="$ROOT_DIR/native/libgme-tool"
SCRIPT_FILE="$ROOT_DIR/scripts/build-libgme-helper.sh"
INCLUDE_DIR="/opt/homebrew/include"
LIB_DIR="/opt/homebrew/lib"
LIBVGM_SOURCE_DIR="$ROOT_DIR/vendor/libvgm"
LIBVGM_BUILD_DIR="$ROOT_DIR/.build/libvgm"
MGBA_BUILD_DIR="$ROOT_DIR/.build/mgba"
MGBA_SOURCE_DIR="$ROOT_DIR/vendor/mgba"
OBJECT_DIR="$ROOT_DIR/.build/libgme"
DEPENDENCY_OUTPUTS=(
  "$ROOT_DIR/.build/lazyusf/liblazyusf.a"
  "$ROOT_DIR/.build/lazyusf/libpsflib.a"
  "$LIBVGM_BUILD_DIR/bin/libvgm-player.a"
  "$LIBVGM_BUILD_DIR/bin/libvgm-emu.a"
  "$LIBVGM_BUILD_DIR/bin/libvgm-utils.a"
  "$MGBA_BUILD_DIR/libmgba.a"
  "$ROOT_DIR/.build/2sf/lib2sf.a"
  "$ROOT_DIR/.build/vgmstream/src/libvgmstream.a"
  "$ROOT_DIR/.build/play-psf/libspcboy_play_psf.a"
)

if [[ -x "$OUTPUT_FILE" && "${SPCBOY_FORCE_NATIVE_REBUILD:-0}" != "1" ]]; then
  dependency_change=""
  for dependency_output in "${DEPENDENCY_OUTPUTS[@]}"; do
    if [[ ! -f "$dependency_output" || "$dependency_output" -nt "$OUTPUT_FILE" ]]; then
      dependency_change="$dependency_output"
      break
    fi
  done
  if [[ -z "$dependency_change" ]]; then
    newer_source=$(find "$SCRIPT_FILE" "$ROOT_DIR/native/libgme_tool.c" "$ROOT_DIR/native/native_decoder.h" "$ROOT_DIR/native/libvgm_decoder.h" "$ROOT_DIR/native/libvgm_decoder.cpp" "$ROOT_DIR/native/highlycomplete_bridge.h" "$ROOT_DIR/native/highlycomplete_bridge.cpp" "$ROOT_DIR/native/highlycomplete_decoder.h" "$ROOT_DIR/native/highlycomplete_decoder.cpp" "$ROOT_DIR/native/twosf_bridge.h" "$ROOT_DIR/native/twosf_bridge.cpp" "$ROOT_DIR/native/twosf_decoder.h" "$ROOT_DIR/native/twosf_decoder.cpp" "$ROOT_DIR/native/vgmstream_bridge.h" "$ROOT_DIR/native/vgmstream_bridge.cpp" "$ROOT_DIR/native/vgmstream_decoder.h" "$ROOT_DIR/native/vgmstream_decoder.cpp" "$ROOT_DIR/native/play_psf_bridge.h" "$ROOT_DIR/native/play_psf_bridge.cpp" "$ROOT_DIR/native/play_psf_decoder.h" "$ROOT_DIR/native/play_psf_decoder.cpp" "$ROOT_DIR/native/libvgm" "$ROOT_DIR/native/ring_buffer.c" "$ROOT_DIR/native/audio_engine.h" "$ROOT_DIR/native/audio_engine_macos.c" "$ROOT_DIR/native/lazyusf" "$ROOT_DIR/vendor/lazyusf2" "$ROOT_DIR/vendor/psflib" "$ROOT_DIR/vendor/libvgm" "$ROOT_DIR/vendor/mgba" "$ROOT_DIR/vendor/2sf2wav" "$ROOT_DIR/vendor/vgmstream" "$ROOT_DIR/vendor/play" -type f -newer "$OUTPUT_FILE" -print -quit 2>/dev/null || true)
    if [[ -z "$newer_source" ]]; then exit 0; fi
  fi
fi

for source_file in "${SOURCE_FILES[@]}"; do
  if [[ ! -f "$source_file" ]]; then
    echo "Missing source file: $source_file" >&2
    exit 1
  fi
done

if [[ ! -f "$INCLUDE_DIR/gme/gme.h" ]]; then
  echo "Missing libgme headers at $INCLUDE_DIR/gme/gme.h" >&2
  exit 1
fi

if [[ ! -f "$LIB_DIR/libgme.0.dylib" ]]; then
  echo "Missing libgme dylib at $LIB_DIR/libgme.0.dylib" >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/.build/lazyusf/liblazyusf.a" || ! -f "$ROOT_DIR/.build/lazyusf/libpsflib.a" ]]; then
  echo "Missing lazyusf build archives; run scripts/build-lazyusf-helper.sh first" >&2
  exit 1
fi
if [[ ! -f "$LIBVGM_BUILD_DIR/bin/libvgm-player.a" || ! -f "$LIBVGM_BUILD_DIR/bin/libvgm-emu.a" || ! -f "$LIBVGM_BUILD_DIR/bin/libvgm-utils.a" ]]; then
  echo "Missing libvgm build archives; run scripts/build-libvgm-helper.sh first" >&2
  exit 1
fi
if [[ ! -f "$MGBA_BUILD_DIR/libmgba.a" ]]; then
  echo "Missing mGBA build archive; run scripts/build-mgba-helper.sh first" >&2
  exit 1
fi
if [[ ! -f "$ROOT_DIR/.build/2sf/lib2sf.a" ]]; then
  echo "Missing 2SF build archive; run scripts/build-2sf-helper.sh first" >&2
  exit 1
fi
if [[ ! -f "$ROOT_DIR/.build/vgmstream/src/libvgmstream.a" ]]; then
  echo "Missing vgmstream build archive; run scripts/build-vgmstream-helper.sh first" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_FILE")" "$OBJECT_DIR"

COMMON_CFLAGS=(
  -O2 -Wall -Wextra -std=c11
  -I"$INCLUDE_DIR"
  -I"$ROOT_DIR/native/lazyusf"
  -I"$ROOT_DIR/vendor/lazyusf2"
  -I"$ROOT_DIR/vendor/psflib"
  -I"$ROOT_DIR/vendor/2sf2wav"
  -I"$ROOT_DIR/vendor/2sf2wav/sseqplayer"
  -I"$ROOT_DIR/vendor/2sf2wav/desmume"
  -I"$ROOT_DIR/vendor/vgmstream/src"
  -I"$ROOT_DIR/native"
  -I"$MGBA_SOURCE_DIR/include"
  -I"$MGBA_SOURCE_DIR/src"
  -I"$ROOT_DIR/vendor/psflib"
  -I"$ROOT_DIR/vendor/2sf2wav"
  -I"$ROOT_DIR/vendor/2sf2wav/sseqplayer"
  -I"$ROOT_DIR/vendor/2sf2wav/desmume"
  -I"$ROOT_DIR/vendor/vgmstream/src"
  -I"$ROOT_DIR/vendor/play/tools/PsfPlayer/Source"
  -I"$ROOT_DIR/vendor/play/Source"
  -I"$ROOT_DIR/vendor/play/Source/app_shared"
  -I"$ROOT_DIR/vendor/play/deps/Framework/include"
  -I"$ROOT_DIR/vendor/play/deps/CodeGen/include"
  -I"$ROOT_DIR/vendor/play/deps/Dependencies/ghc_filesystem/include"
)
for source_file in "${SOURCE_FILES[@]}"; do
  object_file="$OBJECT_DIR/$(basename "${source_file%.*}").o"
  clang "${COMMON_CFLAGS[@]}" -c "$source_file" -o "$object_file"
done

COMMON_CXXFLAGS=(
  -O2 -Wall -Wextra -std=c++17
  -DM_CORE_GBA -DENABLE_VFS -DENABLE_DIRECTORIES
  -I"$LIBVGM_SOURCE_DIR"
  -I"$ROOT_DIR/native"
  -I"$MGBA_BUILD_DIR/include"
  -I"$MGBA_SOURCE_DIR/include"
  -I"$MGBA_SOURCE_DIR/src"
  -I"$ROOT_DIR/vendor/psflib"
  -I"$ROOT_DIR/vendor/2sf2wav"
  -I"$ROOT_DIR/vendor/2sf2wav/sseqplayer"
  -I"$ROOT_DIR/vendor/2sf2wav/desmume"
  -I"$ROOT_DIR/vendor/vgmstream/src"
  -I"$ROOT_DIR/vendor/play/tools/PsfPlayer/Source"
  -I"$ROOT_DIR/vendor/play/Source"
  -I"$ROOT_DIR/vendor/play/Source/app_shared"
  -I"$ROOT_DIR/vendor/play/deps/Framework/include"
  -I"$ROOT_DIR/vendor/play/deps/CodeGen/include"
  -I"$ROOT_DIR/vendor/play/deps/Dependencies/ghc_filesystem/include"
)
for source_file in "${CPP_SOURCE_FILES[@]}"; do
  object_file="$OBJECT_DIR/$(basename "${source_file%.*}").o"
  clang++ "${COMMON_CXXFLAGS[@]}" -c "$source_file" -o "$object_file"
done

clang++ \
  "${OBJECT_DIR}"/*.o \
  "$ROOT_DIR/.build/lazyusf/liblazyusf.a" \
  "$ROOT_DIR/.build/lazyusf/libpsflib.a" \
  "$ROOT_DIR/.build/2sf/lib2sf.a" \
  "$ROOT_DIR/.build/vgmstream/src/libvgmstream.a" \
  "$ROOT_DIR/.build/play-psf/libspcboy_play_psf.a" \
  -L"$LIBVGM_BUILD_DIR/bin" \
  -Wl,-force_load,"$LIBVGM_BUILD_DIR/bin/libvgm-player.a" \
  -Wl,-force_load,"$LIBVGM_BUILD_DIR/bin/libvgm-emu.a" \
  -Wl,-force_load,"$LIBVGM_BUILD_DIR/bin/libvgm-utils.a" \
  $(pkg-config --libs libavcodec libavformat libavdevice libavutil libavfilter libswscale libswresample vorbisfile vorbis ogg) \
  -L"$MGBA_BUILD_DIR" \
  -lmgba \
  -L"$LIB_DIR" \
  -lgme \
  -lz \
  -lm \
  -liconv \
  -framework AudioToolbox \
  -framework AudioUnit \
  -framework CoreAudio \
  -framework CoreFoundation \
  -framework Foundation \
  -framework IOKit \
  -Wl,-rpath,"$LIB_DIR" \
  -o "$OUTPUT_FILE"
