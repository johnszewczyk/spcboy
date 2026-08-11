# Build Runtime Bundle

## Scope

- Electron startup path.
- Native helper build path.
- Local launch and syntax-check workflow.

## Current State

- The active desktop app is Electron.
- `electron/main.js` is the process entry point configured by `package.json`.
- `electron/native-audio-tools.js` owns native helper sessions, one-shot native/external inspection and PCM commands, and format-specific temporary aliases.
- `electron/native-helper-client.js` owns the framed long-lived native-helper protocol and coalesces concurrent native-state reads before they reach the helper process.
- `electron/preload.js` exposes the allowed IPC surface to the renderer.
- `web/` contains the renderer HTML, CSS, and JS.
- `native/libgme-tool` is the local helper built from native sources.
- `native/libvgm-tool` is a renderer-owned PCM helper; `native/lazyusf-tool` remains the metadata/raw-decoder utility while `native/libgme-tool` owns native libgme and lazyusf2 transport playback.
- OpenMPT and standard audio renderer-PCM paths use the launch-environment commands `openmpt123`, `ffprobe`, and `ffmpeg`; `SPCBOY_OPENMPT123`, `SPCBOY_FFPROBE`, and `SPCBOY_FFMPEG` override their command names.
- `./launch.sh` is the local launcher.
- The launch script validates `package.json`, sets a default `SPCBoy_LIBRARY_ROOT`, installs Electron dependencies if missing, incrementally builds the native helper graph, then builds `dist/SPCBoy.app` from Electron's macOS bundle.
- The built application contains the active `electron/`, `web/`, and `native/` runtime trees beneath `Contents/Resources/app`; it is not a loose renderer staging directory.
- Before replacing the generated app, launch stops only a runtime whose command line names the old loose bundle or the generated SPCBoy app path. It refuses to replace a runtime still in use, preventing partial asset replacement.
- Launch opens the generated macOS application with `open -n`.
- Development launches must create a new runtime rather than hand control to a pre-existing Electron instance. LaunchPad owns process/session management for its own launches.
- Launch staging copies the complete runtime JavaScript surface from `electron/`; adding a required Electron module must not require a second hand-maintained copy list.
- `electron/special-audio.js` is part of that complete runtime surface and must remain staged with the main process because scanner and playback routing import it.
- `npm start` runs Electron directly.
- The libgme helper is created lazily on the first metadata/native-playback request; raw folder browsing does not start it.
- `npm run check` syntax-checks the active JS entry points.
- Native helper scripts compare their output against the build script and vendored source tree, so unchanged mGBA, 2SF, vgmstream, Play!, libvgm, and lazyusf dependencies are skipped. The final `libgme-tool` link also checks the dependency archives it consumes. Set `SPCBOY_FORCE_NATIVE_REBUILD=1` to force every native helper to rebuild.
- The repository is GPLv3, while incorporated and invoked third-party software retains its own license terms. `THIRD_PARTY_LICENSES.md` is the source-and-notice inventory; the README provides a short public source map.

## Rules

- Keep Electron and playback-runtime notes together so agents do not assume an older JS-only backend.
- Keep helper build and launch staging aligned with the active playback architecture.
- If the helper build or staging flow changes, update playback and runtime docs together.

## Files

- [package.json](/Users/john/Downloads/Code/SPCBoy/package.json)
- [LICENSE](/Users/john/Downloads/Code/SPCBoy/LICENSE)
- [THIRD_PARTY_LICENSES.md](/Users/john/Downloads/Code/SPCBoy/THIRD_PARTY_LICENSES.md)
- [launch.sh](/Users/john/Downloads/Code/SPCBoy/launch.sh)
- [scripts/build-libgme-helper.sh](/Users/john/Downloads/Code/SPCBoy/scripts/build-libgme-helper.sh)
- [scripts/build-lazyusf-helper.sh](/Users/john/Downloads/Code/SPCBoy/scripts/build-lazyusf-helper.sh)
- [scripts/build-mgba-helper.sh](/Users/john/Downloads/Code/SPCBoy/scripts/build-mgba-helper.sh)
- [scripts/build-libvgm-helper.sh](/Users/john/Downloads/Code/SPCBoy/scripts/build-libvgm-helper.sh)
- [scripts/build-2sf-helper.sh](/Users/john/Downloads/Code/SPCBoy/scripts/build-2sf-helper.sh)
- [scripts/build-vgmstream-helper.sh](/Users/john/Downloads/Code/SPCBoy/scripts/build-vgmstream-helper.sh)
- [scripts/build-play-psf-helper.sh](/Users/john/Downloads/Code/SPCBoy/scripts/build-play-psf-helper.sh)
- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [electron/native-audio-tools.js](/Users/john/Downloads/Code/SPCBoy/electron/native-audio-tools.js)
- [electron/native-helper-client.js](/Users/john/Downloads/Code/SPCBoy/electron/native-helper-client.js)
- [electron/library-database.js](/Users/john/Downloads/Code/SPCBoy/electron/library-database.js)
- [electron/library-scan.js](/Users/john/Downloads/Code/SPCBoy/electron/library-scan.js)
- [electron/archive-resolver.js](/Users/john/Downloads/Code/SPCBoy/electron/archive-resolver.js)
- [electron/preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
- [electron/special-audio.js](/Users/john/Downloads/Code/SPCBoy/electron/special-audio.js)
