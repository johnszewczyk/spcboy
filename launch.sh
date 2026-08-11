#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_DIR="$DIST_DIR/SPCBoy.app"
LEGACY_BUNDLE_DIR="/tmp/SPCBoy-launch-bundle"
WORKSPACE_PARENT="$(cd "$ROOT_DIR/.." && pwd)"
if [[ -d "$WORKSPACE_PARENT/SPC/spcsets_extracted" ]]; then
  LIBRARY_ROOT_DEFAULT="$WORKSPACE_PARENT/SPC/spcsets_extracted"
elif [[ -d "$WORKSPACE_PARENT/spcsets_extracted" ]]; then
  LIBRARY_ROOT_DEFAULT="$WORKSPACE_PARENT/spcsets_extracted"
elif [[ -d "$WORKSPACE_PARENT/SPC/gymsets_extracted" ]]; then
  LIBRARY_ROOT_DEFAULT="$WORKSPACE_PARENT/SPC/gymsets_extracted"
else
  LIBRARY_ROOT_DEFAULT=""
fi

if [[ ! -f "$ROOT_DIR/package.json" ]]; then
  echo "Missing package.json in $ROOT_DIR"
  exit 1
fi

export SPCBOY_LIBRARY_ROOT="${SPCBOY_LIBRARY_ROOT:-$LIBRARY_ROOT_DEFAULT}"
export SPCBOY_PLAY_DATA_PATH="${SPCBOY_PLAY_DATA_PATH:-/tmp/SPCBoy-PlayData}"

if [[ ! -d "$ROOT_DIR/node_modules/electron" ]]; then
  echo "Installing Electron dependencies..."
  npm install --prefix "$ROOT_DIR"
fi

"$ROOT_DIR/scripts/build-lazyusf-helper.sh"
"$ROOT_DIR/scripts/build-mgba-helper.sh"
"$ROOT_DIR/scripts/build-libvgm-helper.sh"
bash "$ROOT_DIR/scripts/build-2sf-helper.sh"
bash "$ROOT_DIR/scripts/build-vgmstream-helper.sh"
bash "$ROOT_DIR/scripts/build-play-psf-helper.sh"
"$ROOT_DIR/scripts/build-libgme-helper.sh"

stop_runtime() {
  local runtime_path="$1"
  local runtime_pids
  runtime_pids="$(pgrep -f "$runtime_path" 2>/dev/null || true)"
  [[ -n "$runtime_pids" ]] || return 0

  echo "Stopping the previous SPCBoy runtime..."
  while IFS= read -r process_id; do
    [[ "$process_id" =~ ^[0-9]+$ ]] || continue
    kill -TERM "$process_id" 2>/dev/null || true
  done <<< "$runtime_pids"

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! pgrep -f "$runtime_path" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done

  echo "Previous SPCBoy runtime did not exit; leaving its application bundle intact. Quit SPCBoy, then launch again."
  exit 1
}

# Retire the old loose Electron invocation before building the actual app.
stop_runtime "$LEGACY_BUNDLE_DIR"
stop_runtime "$APP_DIR"

rm -rf "$APP_DIR"
mkdir -p "$DIST_DIR"
ditto "$ROOT_DIR/node_modules/electron/dist/Electron.app" "$APP_DIR"

APP_CONTENTS_DIR="$APP_DIR/Contents"
APP_RESOURCES_DIR="$APP_CONTENTS_DIR/Resources"
APP_SOURCE_DIR="$APP_RESOURCES_DIR/app"
rm -rf "$APP_SOURCE_DIR"
mkdir -p "$APP_SOURCE_DIR"

cp "$ROOT_DIR/package.json" "$APP_SOURCE_DIR/package.json"
ditto "$ROOT_DIR/electron" "$APP_SOURCE_DIR/electron"
ditto "$ROOT_DIR/web" "$APP_SOURCE_DIR/web"
ditto "$ROOT_DIR/native" "$APP_SOURCE_DIR/native"
cp "$ROOT_DIR/app-icon.png" "$APP_SOURCE_DIR/app-icon.png"

# Electron's ditto/cp staging deliberately preserves source timestamps, which
# made a newly built bundle look old in Finder and in diagnostics.  Stamp each
# assembly with a value produced only after every current renderer asset has
# been copied.  This is a build receipt, not an application cache.
BUILD_ID="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
printf '{\n  "buildId": "%s",\n  "source": "%s"\n}\n' "$BUILD_ID" "$ROOT_DIR" > "$APP_SOURCE_DIR/.spcboy-build.json"
touch "$APP_DIR"

# Make the macOS bundle identify itself as SPCBoy while retaining Electron's
# executable and frameworks intact.
mv "$APP_CONTENTS_DIR/MacOS/Electron" "$APP_CONTENTS_DIR/MacOS/SPCBoy"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName SPCBoy" "$APP_CONTENTS_DIR/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName SPCBoy" "$APP_CONTENTS_DIR/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable SPCBoy" "$APP_CONTENTS_DIR/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.john.spcboy.development" "$APP_CONTENTS_DIR/Info.plist"

# The copied Electron runtime is signed.  Adding our application source and
# changing its Info.plist invalidates that signature; macOS can then reject
# the bundle even though Contents/MacOS/Electron exists.  Re-sign the finished
# development bundle and verify it before reporting a successful build.  The
# copied runtime can retain Finder/provenance extended attributes that codesign
# refuses to seal, so clear them from this disposable build output first.
/usr/bin/xattr -cr "$APP_DIR"
# Ad-hoc signatures normally use the current code hash as their designated
# requirement. That makes macOS treat every rebuilt bundle as a new app for
# Files & Folders consent. Keep a stable development identity requirement so
# a user's permission decision survives ordinary local rebuilds.
codesign --force --deep --sign - "$APP_DIR"
codesign --force --sign - -r='designated => identifier "com.john.spcboy.development"' "$APP_DIR"
codesign --verify --deep --strict "$APP_DIR"

echo "Built SPCBoy.app ($BUILD_ID)"
echo "App: $APP_DIR"
echo "Renderer CSS: $(shasum -a 256 "$APP_SOURCE_DIR/web/styles.css" | awk '{print $1}')"
if [[ -n "$SPCBOY_LIBRARY_ROOT" ]]; then
  echo "Library root: $SPCBOY_LIBRARY_ROOT"
else
echo "Library root: configured Library Paths"
fi
# Rebuilding replaces the bundle in place. LaunchServices can hold an old
# Electron executable record for that bundle and report kLSNoExecutableErr
# despite the fresh signed executable being present. Launch the new bundle's
# executable directly so this script always runs exactly what it just built.
"$APP_CONTENTS_DIR/MacOS/SPCBoy" >/tmp/spcboy-launch.log 2>&1 &
