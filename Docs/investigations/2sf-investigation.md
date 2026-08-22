# 2SF / mini2SF Investigation

## Scope

This report covers Nintendo DS 2SF and mini2SF intake, native playback, and dependency materialization in SPCBoy.

## Reference boundary

CocoaSpice formerly used a vendored `2sf2wav` implementation derived from DeSmuME and wrapped it with a C-compatible bridge. The current implementation and source garden are owned by VGMBoy; both CocoaSpice and SPCBoy call the VGMBoy playback core.

SPCBoy no longer stages or builds `2sf2wav` locally. Its playback path calls the VGMBoy Electron bridge.

## Scanner contract

- Registered files: `.2sf` and `.mini2sf`.
- Dependency-only archive members: `.2sflib`.
- Archive materialization copies the complete dependency set into one cache root before inspection or playback.
- Dependency traversal rejects absolute paths, drive-qualified paths, parent traversal, cycles, and chains deeper than 16 files.

## Build and validation status

The DeSmuME-derived static library builds as `.build/2sf/lib2sf.a`, and the unified `native/libgme-tool` links the new adapter successfully. JavaScript registry tests and syntax checks pass.

The local audio collection had no 2SF files, so a 3.6 MB original 2SF set was staged under `/private/tmp` from the [Zophar Nintendo DS 2SF catalog](https://www.zophar.net/music/nintendo-ds-2sf/simple-ds-series-vol-01-the-mahjong): Simple DS Series Vol. 01 - The Mahjong. The set contains 19 `.mini2sf` tracks and `NTR-AZMJ-JPN.2sflib`.

- Real metadata: passed for `01 BGM #01.mini2sf`, reporting Nintendo DS, the game title, song title, 156-second length, and 10-second fade.
- Real native playback: passed for three mini2SF tracks, including `01 BGM #01`, with 8,192-frame priming, nonzero PCM, and no decoder error.
- Real seek: passed at 500 ms with nonzero PCM and the expected reported position.
- Raw PCM: passed for a 1-second decode; the bridge intentionally consumes the 125 ms DS boot transient before supplying audio.
- `inspect-all`: now returns one track for 2SF-family files instead of incorrectly sending them to libgme.
- ZIP complete-set playback: passed with all 19 mini2SF members materialized concurrently alongside the `.2sflib`; the selected track inspected and played successfully from the extracted cache.
- Lifecycle fix: the native decoder now defers its first 2SF core load until timing configuration, avoiding a double DeSmuME initialization that segfaulted valid mini2SF tracks. One-shot `player-load` also joins its refill thread before process exit.
- Persistent-session transition: passed sequential `serve` loads from `01 BGM #01.mini2sf` to `10 Jingle #01.mini2sf`; the old DeSmuME core is destroyed before the replacement is constructed.

The 2SF backend is now build- and fixture-validated for metadata, archive dependency resolution, PCM, seeking, and native-session priming.
