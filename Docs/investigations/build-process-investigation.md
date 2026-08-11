# SPCBoy Build Process Investigation

## Finding

The launcher was invoking every native dependency build script on every start. Several scripts had no freshness guard, including the mGBA helper, so an unchanged checkout repeatedly re-entered CMake and rebuilt dependency work that was already complete.

The launcher now uses output freshness checks for every native helper. Each helper compares its output with its own build script and vendored source tree. The final `libgme-tool` link additionally compares its output with the dependency archives it links, so a changed dependency causes the small application-facing helper to relink without forcing unrelated dependencies to rebuild.

`SPCBOY_FORCE_NATIVE_REBUILD=1` remains available for a deliberate clean native rebuild.

## Verification

After the guard changes, mGBA's first post-change build took about 5.3 seconds on this checkout. A second unchanged invocation completed in about 0.12 seconds without producing build output. The complete unchanged helper pass then reduced each dependency check to roughly 0.02–0.22 seconds; `libgme-tool` rebuilt once because its dependent archives had just been refreshed, as intended.

The launch bundle is still staged into `/tmp/SPCBoy-launch-bundle` on each start. That copies only the small Electron application surface and keeps runtime files isolated from the source tree; the expensive vendored native builds are no longer repeated.

## Files

- [launch.sh](/Users/john/Downloads/Code/SPCBoy/launch.sh)
- [ai/subsystem-agent/build-runtime-bundle.md](/Users/john/Downloads/Code/SPCBoy/ai/subsystem-agent/build-runtime-bundle.md)
- [scripts/build-mgba-helper.sh](/Users/john/Downloads/Code/SPCBoy/scripts/build-mgba-helper.sh)
- [scripts/build-libgme-helper.sh](/Users/john/Downloads/Code/SPCBoy/scripts/build-libgme-helper.sh)
