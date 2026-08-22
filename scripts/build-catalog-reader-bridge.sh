#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CATALOG_READER_ROOT="$(cd "$ROOT_DIR/../CatalogReader" && pwd)"
OUTPUT="$ROOT_DIR/native/catalog-reader-electron-bridge"
BUILD_CACHE="$CATALOG_READER_ROOT/.build/spcboy-electron-bridge-cache"

[[ -f "$CATALOG_READER_ROOT/Package.swift" ]] || { echo "CatalogReader package is missing: $CATALOG_READER_ROOT" >&2; exit 1; }

mkdir -p "$BUILD_CACHE"
CLANG_MODULE_CACHE_PATH="$BUILD_CACHE/clang" \
SWIFTPM_MODULECACHE_OVERRIDE="$BUILD_CACHE/swiftpm" \
swift build \
  --package-path "$CATALOG_READER_ROOT" \
  --disable-sandbox \
  --configuration release \
  --product catalog-reader-electron-bridge

cp -X "$CATALOG_READER_ROOT/.build/release/catalog-reader-electron-bridge" "$OUTPUT"
chmod 755 "$OUTPUT"
echo "Built $OUTPUT"
