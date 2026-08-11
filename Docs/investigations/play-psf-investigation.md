# Play! PSF / PSF2 Investigation

## Scope

This report covers PlayStation PSF and PlayStation 2 PSF2 intake, metadata inspection, native playback, seeking, and archive dependency handling in SPCBoy.

## CocoaSpice reference

CocoaSpice uses the Play! PSF core with `PSFCORE_ONLY=ON` and a C++ bridge around `CPsfVm`, `CPsfLoader`, `CPhysicalPsfStreamProvider`, and a buffered `CSoundHandler`. The bridge reads `[TAG]` metadata without starting the emulator, resolves `_lib` dependencies through Play!'s loader, captures stereo signed 16-bit PCM at 44.1 kHz, rebuilds the VM for seek, and applies declared `length`/`fade` timing at the playback boundary.

SPCBoy stages the Play! source under `vendor/play`, builds the PSF core as `.build/play-psf/libspcboy_play_psf.a`, and keeps the bridge and `NativeDecoder` adapter in SPCBoy-owned files.

## Scanner and archive contract

- Registered playable files: `.psf`, `.minipsf`, `.psf2`, and `.minipsf2`.
- Dependency-only members: `.psflib` and `.psf2lib`.
- PSF1 selections materialize the PSF1 family; PSF2 selections materialize the PSF2 family. The families are not mixed.
- Metadata inspection uses the PSF header/tag path and does not require dependency startup; playback uses the complete sibling set so `_lib` references remain resolvable.
- The Electron registry, archive resolver, native helper, and web-side registry all carry the same four playable extensions.

## Validation status

- Play! core build: passed.
- Unified native helper link with Play! PSF bridge: passed.
- Native decoder syntax/build: passed.
- Zophar source inventory: confirmed under `/Users/john/Downloads/audio/ZopharsDomain/PSF` and `PSF2`, with 40 PSF archives and 22 PSF2 archives at the top level. The local source contains many `.zophar.tar.zst` sets plus ZIP sets; the fixture extraction used below preserves the complete set directories. SPCBoy's archive resolver now handles ZIP, 7z, RSN, TZST, and TAR.ZST containers; the tar.zst source was initially inspected/extracted as a fixture before explicit TAR.ZST intake was added.
- PSF1 real-set metadata: passed against Resident Evil 2 `06 Prologue.psf`, with `system=PlayStation`, `game=Resident Evil 2`, `song=Prologue`, and the declared 79-second length/fade metadata.
- PSF1 real-set playback: passed with `buffered_frames=8192`, `nonzero_samples=10449`, and no decode error for a 2-second native playback load. A 500 ms seek also passed with `position_ms=500` and `nonzero_samples=16362`.
- PSF2 real-set metadata: passed against Devil May Cry `01 Curse of the Bloody Puppets.psf2`, with `system=PlayStation 2`, `game=Devil May Cry`, and the declared 215-second length/fade metadata.
- PSF2 real-set playback: passed with `buffered_frames=8192`, `nonzero_samples=6105`, and no decode error for a 2-second native playback load. A 500 ms seek also passed with `position_ms=500` and `nonzero_samples=16382`.
- Raw PCM/WAV path: passed for both real fixtures. Each 2-second decode produced 352,800 bytes of PCM and a valid 44.1 kHz, stereo, signed-16-bit WAV of 441,044 bytes.
- ZIP scanner/materialization: passed against `Parasite Eve (EMU).zophar.zip`; the resolver listed 38 `.psf` members and materialized the selected member through the PSF family path.
- ZIP extraction no longer requires Homebrew `7zz` on macOS: `/usr/bin/bsdtar` is preferred for exact member extraction, with the configured `7zz` binary retained as fallback. Both extraction paths were exercised against the real Parasite Eve ZIP.
- Concurrent archive scan: passed all 38 Parasite Eve PSF members concurrently, with 38 distinct materialized paths and a selected member that inspected and primed non-silent playback. The resolver now queues materialization per archive dependency family to prevent temporary-file rename races.
- Play! runtime data path: explicit `SPCBOY_PLAY_DATA_PATH` defaults to `/tmp/SPCBoy-PlayData`, avoiding the macOS Documents-directory assumption in the upstream PsfPlayer configuration.
- Registry and JavaScript checks: passed (`npm test` 5/5 and `npm run check`).
