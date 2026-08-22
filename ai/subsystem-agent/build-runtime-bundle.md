# Build Runtime Bundle

## Scope

- Electron startup path.
- Native helper build path.
- Local launch and syntax-check workflow.

## Ownership and Lifecycle

- The active desktop app is Electron.
- `electron/main.js` is the process entry point configured by `package.json`.
- `electron/main.js` acquires Electron's single-instance lock before initializing the library database or archive cache. A second launch focuses the existing main or Options window and exits.
- `electron/native-audio-tools.js` owns the framed VGMBoy playback command client. It does not
  inspect decoder headers, decode PCM, or create format aliases.
- `electron/native-helper-client.js` owns the framed long-lived native-helper protocol and coalesces concurrent native-state reads before they reach the helper process.
- `electron/catalog-reader-client.js` owns only framed access to the bundled
  Swift CatalogReader bridge; it has no SQLite worker, catalog SQL, or fallback reader.
- `electron/preload.js` exposes the allowed IPC surface to the renderer.
- `web/` contains the renderer HTML, CSS, and JS.
- `native/vgmboy-electron-bridge` is the required macOS app-bundled playback helper, built from
  VGMBoy during SPCBoy assembly. No environment switch selects a legacy player.
- `native/catalog-reader-electron-bridge` is the required app-bundled read-only
  catalog helper, built from the shared CatalogReader package during assembly.
- `./launch.sh` is the local launcher.
- The launch script validates `package.json`, honors `SPCBOY_LIBRARY_ROOT` when set, installs
  Electron dependencies if missing, builds both Swift bridges, then builds `dist/SPCBoy.app`.
- The built application contains the active `electron/`, `web/`, and `native/` runtime trees beneath `Contents/Resources/app`; it is not a loose renderer staging directory.
- Assembly stages the bridge's complete Homebrew dylib closure in `Contents/Frameworks` and rewrites
  its install names to the bundle. The bridge must have no `/opt/homebrew` runtime edge in its final
  `otool -L` output.
- Before replacing the generated app, launch stops only a runtime whose command line names the old loose bundle or the generated SPCBoy app path. It refuses to replace a runtime still in use, preventing partial asset replacement.
- Launch starts the generated bundle's executable directly after stopping the prior generated runtime. This avoids stale LaunchServices executable records while ensuring the newly assembled runtime is the process that starts.
- Local builds use an ad-hoc signature with a stable designated requirement for `com.john.spcboy.development`; rebuilding must not turn SPCBoy into a different Files & Folders client and re-prompt for an already approved library location. A public release should replace that development signature with a stable Developer ID signature.
- Development launches must create a new runtime rather than hand control to a pre-existing Electron instance. LaunchPad owns process/session management for its own launches.
- Launch staging copies the complete runtime JavaScript surface from `electron/`; adding a required Electron module must not require a second hand-maintained copy list.
- `npm start` runs Electron directly.
- The VGMBoy bridge is created lazily on the first playback request; raw folder browsing does not start it.
- `npm run check` syntax-checks the active JS entry points.
- `build-vgmboy-bridge.sh` compares its bridge receipt with VGMBoy's package build. SPCBoy no
  longer builds, packages, or links its former native decoder tree.
- SPCBoy does not package ScanSong inspection plugins. Its only native playback artifact is the
  VGMBoy Electron bridge; ScanSong receives its separate vgmstream and Highly Complete resources
  from VGMBoy's scanner-plugin build boundary.
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
- [scripts/build-vgmboy-bridge.sh](/Users/john/Downloads/Code/SPCBoy/scripts/build-vgmboy-bridge.sh)
- [scripts/build-catalog-reader-bridge.sh](/Users/john/Downloads/Code/SPCBoy/scripts/build-catalog-reader-bridge.sh)
- [scripts/stage-vgmboy-bridge-runtime.sh](/Users/john/Downloads/Code/SPCBoy/scripts/stage-vgmboy-bridge-runtime.sh)
- [electron/main.js](/Users/john/Downloads/Code/SPCBoy/electron/main.js)
- [electron/native-audio-tools.js](/Users/john/Downloads/Code/SPCBoy/electron/native-audio-tools.js)
- [electron/native-helper-client.js](/Users/john/Downloads/Code/SPCBoy/electron/native-helper-client.js)
- [electron/catalog-reader-client.js](/Users/john/Downloads/Code/SPCBoy/electron/catalog-reader-client.js)
- [electron/archive-resolver.js](/Users/john/Downloads/Code/SPCBoy/electron/archive-resolver.js)
- [electron/preload.js](/Users/john/Downloads/Code/SPCBoy/electron/preload.js)
