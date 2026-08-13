#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCANNER_ROOT="${SPCBOY_MEDIA_SCANNER_SOURCE:-$(cd "$ROOT_DIR/../MediaScanner" && pwd)}"
OUTPUT_FILE="$ROOT_DIR/native/media-scan"

if [[ ! -f "$SCANNER_ROOT/Package.swift" ]]; then
  echo "Missing shared MediaScanner package at $SCANNER_ROOT" >&2
  exit 1
fi

if [[ -x "$OUTPUT_FILE" && "${SPCBOY_FORCE_NATIVE_REBUILD:-0}" != "1" ]]; then
  newer_source="$(find "$SCANNER_ROOT/Package.swift" "$SCANNER_ROOT/Sources" -type f -newer "$OUTPUT_FILE" -print -quit 2>/dev/null || true)"
  if [[ -z "$newer_source" ]]; then
    exit 0
  fi
fi

export CLANG_MODULE_CACHE_PATH="$ROOT_DIR/.build/media-scanner-clang-cache"
export SWIFT_MODULECACHE_PATH="$ROOT_DIR/.build/media-scanner-swift-cache"
swift build \
  --package-path "$SCANNER_ROOT" \
  --scratch-path "$ROOT_DIR/.build/media-scanner" \
  --disable-sandbox \
  --configuration release \
  --product media-scan

cp "$ROOT_DIR/.build/media-scanner/arm64-apple-macosx/release/media-scan" "$OUTPUT_FILE"
chmod +x "$OUTPUT_FILE"
