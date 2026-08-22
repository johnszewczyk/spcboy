#!/bin/bash
set -euo pipefail

APP_DIR="${1:?usage: stage-vgmboy-bridge-runtime.sh /path/to/SPCBoy.app}"
BRIDGE="$APP_DIR/Contents/Resources/app/native/vgmboy-electron-bridge"
FRAMEWORKS_DIR="$APP_DIR/Contents/Frameworks"

if [[ ! -x "$BRIDGE" ]]; then
  echo "VGMBoy Electron bridge is missing from the staged app: $BRIDGE"
  exit 1
fi

mkdir -p "$FRAMEWORKS_DIR"
bundled_names=()
bundled_sources=()

has_bundled_name() {
  local candidate="$1"
  local existing
  for existing in "${bundled_names[@]:-}"; do
    [[ "$existing" == "$candidate" ]] && return 0
  done
  return 1
}

bundle_runtime_library() {
  local source="$1"
  local basename
  basename="$(otool -D "$source" | tail -n 1 | xargs basename)"
  if has_bundled_name "$basename"; then
    return
  fi
  bundled_names+=("$basename")
  bundled_sources+=("$source")
  cp -X "$source" "$FRAMEWORKS_DIR/$basename"
  # Homebrew dylibs are commonly mode 0444. The staging copy is ours to
  # rewrite and sign, so make it writable before install_name_tool/xattr.
  chmod u+w "$FRAMEWORKS_DIR/$basename"

  local dependency
  while IFS= read -r dependency; do
    if [[ "$dependency" == /opt/homebrew/* && -f "$dependency" ]]; then
      bundle_runtime_library "$dependency"
    fi
  done < <(otool -L "$source" | tail -n +2 | awk '{ print $1 }')
}

while IFS= read -r dependency; do
  if [[ "$dependency" == /opt/homebrew/* && -f "$dependency" ]]; then
    bundle_runtime_library "$dependency"
  fi
done < <(otool -L "$BRIDGE" | tail -n +2 | awk '{ print $1 }')

for runtime_index in "${!bundled_names[@]}"; do
  runtime_basename="${bundled_names[$runtime_index]}"
  runtime_source="${bundled_sources[$runtime_index]}"
  runtime_destination="$FRAMEWORKS_DIR/$runtime_basename"
  install_name_tool -id "@loader_path/$runtime_basename" "$runtime_destination"
  while IFS= read -r dependency; do
    dependency_basename="$(basename "$dependency")"
    if has_bundled_name "$dependency_basename"; then
      install_name_tool -change "$dependency" "@loader_path/$dependency_basename" "$runtime_destination"
    fi
  done < <(otool -L "$runtime_source" | tail -n +2 | awk '{ print $1 }')
done

while IFS= read -r dependency; do
  dependency_basename="$(basename "$dependency")"
  if has_bundled_name "$dependency_basename"; then
    install_name_tool -change "$dependency" "@loader_path/../../../Frameworks/$dependency_basename" "$BRIDGE"
  fi
done < <(otool -L "$BRIDGE" | tail -n +2 | awk '{ print $1 }')

if otool -L "$BRIDGE" | tail -n +2 | awk '{ print $1 }' | grep -q '^/opt/homebrew/'; then
  echo "VGMBoy bridge still has a Homebrew runtime edge after staging."
  exit 1
fi

echo "Staged VGMBoy bridge runtime in $FRAMEWORKS_DIR"
