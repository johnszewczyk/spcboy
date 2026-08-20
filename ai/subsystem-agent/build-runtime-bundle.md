# Build Runtime Bundle

## Scope

- Electron startup path.
- Native helper build path.
- Local launch and syntax-check workflow.

## Ownership and Lifecycle

- The active desktop app is Electron.
- `electron/main.js` is the process entry point configured by `package.json`.
- `electron/main.js` acquires Electron's single-instance lock before initializing the library database or archive cache. A second launch focuses the existing main or Options window and exits.
- `electron/native-audio-tools.js` owns native helper sessions, one-shot native/external inspection and PCM commands, and format-specific temporary aliases.
- `electron/native-helper-client.js` owns the framed long-lived native-helper protocol and coalesces concurrent native-state reads before they reach the helper process.
- `electron/media-scanner-client.js` owns the versioned JSONL boundary to the shared Swift scanner executable. Scanner events are rejected unless their contract name and version match exactly.
- `electron/preload.js` exposes the allowed IPC surface to the renderer.
- `web/` contains the renderer HTML, CSS, and JS.
- `native/libgme-tool` is the local helper built from native sources.
- `native/libvgm-tool` is a renderer-owned PCM helper; `native/lazyusf-tool` remains the metadata/raw-decoder utility while `native/libgme-tool` owns native libgme and lazyusf2 transport playback.
- OpenMPT and standard audio renderer-PCM paths use the launch-environment commands `openmpt123`, `ffprobe`, and `ffmpeg`; `SPCBOY_OPENMPT123`, `SPCBOY_FFPROBE`, and `SPCBOY_FFMPEG` override their command names.
- `./launch.sh` is the local launcher.
- `scripts/build-media-scanner.sh` builds the sibling `MediaScanner` Swift package and stages its `media-scan` executable under `native/`. The shared package owns catalog creation, scanning, resumable staging, atomic publication, archive/metadata adapters, and validation. Options invokes `media-scan catalog validate` before persisting a path; SPCBoy opens the validated catalog read-only. `SPCBOY_SKIP_MEDIA_SCANNER_BUILD=1` is valid only when that staged executable already exists; it keeps an SPCBoy-only build from invoking the separate MediaScanner project.
- The launch script validates `package.json`, honors `SPCBOY_LIBRARY_ROOT` when set, installs Electron dependencies if missing, incrementally builds the native helper graph, then builds `dist/SPCBoy.app` from Electron's macOS bundle.
- The built application contains the active `electron/`, `web/`, and `native/` runtime trees beneath `Contents/Resources/app`; it is not a loose renderer staging directory.
- Before replacing the generated app, launch stops only a runtime whose command line names the old loose bundle or the generated SPCBoy app path. It refuses to replace a runtime still in use, preventing partial asset replacement.
- Launch starts the generated bundle's executable directly after stopping the prior generated runtime. This avoids stale LaunchServices executable records while ensuring the newly assembled runtime is the process that starts.
- Local builds use an ad-hoc signature with a stable designated requirement for `com.john.spcboy.development`; rebuilding must not turn SPCBoy into a different Files & Folders client and re-prompt for an already approved library location. A public release should replace that development signature with a stable Developer ID signature.
- Development launches must create a new runtime rather than hand control to a pre-existing Electron instance. LaunchPad owns process/session management for its own launches.
- Launch staging copies the complete runtime JavaScript surface from `electron/`; adding a required Electron module must not require a second hand-maintained copy list.
- `electron/special-audio.js` is part of that complete runtime surface and must remain staged with the main process because playlist intake and playback routing import it.
- `npm start` runs Electron directly.
- The libgme helper is created lazily on the first metadata/native-playback request; raw folder browsing does not start it.
- `npm run check` syntax-checks the active JS entry points.
- Native helper scripts compare their output against the build script and vendored source tree, so unchanged mGBA, 2SF, vgmstream, Play!, libvgm, and lazyusf dependencies are skipped. The final `libgme-tool` link also checks the dependency archives it consumes. Set `SPCBOY_FORCE_NATIVE_REBUILD=1` to force every native helper to rebuild.
- `patches/play-psfcore-only.patch` and `patches/vgmstream-system-ffmpeg.patch` are the tracked, minimal build adaptations applied by their focused helper scripts. They avoid an unrecorded fork while keeping a clean checkout capable of building the same static PSF core and system-FFmpeg vgmstream archive.
- The repository is GPLv3, while incorporated and invoked third-party software retains its own license terms. `THIRD_PARTY_LICENSES.md` is the source-and-notice inventory; the README provides a short public source map.

## Critical Engineering Notes

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
- [native/sidplay_bridge.cpp](/Users/john/Downloads/Code/SPCBoy/native/sidplay_bridge.cpp)
- [native/sidplay_bridge.h](/Users/john/Downloads/Code/SPCBoy/native/sidplay_bridge.h)
- [native/sidplay_decoder.cpp](/Users/john/Downloads/Code/SPCBoy/native/sidplay_decoder.cpp)
- [native/sidplay_decoder.h](/Users/john/Downloads/Code/SPCBoy/native/sidplay_decoder.h)
- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [electron/native-audio-tools.js](/Users/john/Downloads/Code/SPCBoy/electron/native-audio-tools.js)
- [electron/native-helper-client.js](/Users/john/Downloads/Code/SPCBoy/electron/native-helper-client.js)
- [scripts/build-media-scanner.sh](/Users/john/Downloads/Code/SPCBoy/scripts/build-media-scanner.sh)
- [electron/media-scanner-client.js](/Users/john/Downloads/Code/SPCBoy/electron/media-scanner-client.js)
- [electron/archive-resolver.js](/Users/john/Downloads/Code/SPCBoy/electron/archive-resolver.js)
- [electron/preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
- [electron/special-audio.js](/Users/john/Downloads/Code/SPCBoy/electron/special-audio.js)
