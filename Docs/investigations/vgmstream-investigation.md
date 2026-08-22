# vgmstream Investigation

## Scope

This investigation covers CocoaSpice’s vgmstream-backed game-audio extensions and the boundary required to make them scanner-visible and playable in SPCBoy.

## CocoaSpice format inventory

CocoaSpice explicitly registers `aa3`, `adx`, `ads`, `aifc`, `at3`, `aus`, `bnk`, `fsb`, `genh`, `int`, `mib`, `msf`, `mtaf`, `ogg`, `rws`, `ss2`, `stream`, `svag`, `vag`, and `xa`, plus `hd`, `hbd`, `iecs`, and `txtp` dependency/container forms.

Its vgmstream bridge opens a streamfile, selects a 1-based subsong, exposes stream metadata, fills signed PCM, seeks by sample, and supports Long Play by reopening with loop flags.

## SPCBoy boundary

VGMBoy owns the vgmstream snapshot under its shared `vendor/vgmstream` garden and builds the static `libvgmstream` library with FFmpeg and Vorbis support. SPCBoy calls the VGMBoy Electron bridge; streamfile/decoder lifetime and the realtime-safe transport remain core responsibilities.

The scanner must keep dependency-backed forms (`hd`, `hbd`, `iecs`, `txtp`) separate from ordinary selected-entry extraction. A `.txtp` may reference sibling assets, so archive materialization cannot copy only the selected member.

## Current gate

The static library and native bridge are complete. SPCBoy now registers the listed vgmstream extensions, exposes native metadata inspection, and enumerates vgmstream subsongs through `inspect-all`.

The representative local XA file `BGM00_01006401_0000.xa` reports `Sony XA header`, `CD-ROM XA 4-bit ADPCM`, and 118.933 seconds. Native `player-load` primes 8,192 frames with nonzero PCM and no decoder stderr output. Additional real samples `music001.aifc` and `jendance6.stream` also inspect and prime non-silent playback. A real `.txtp` referencing a sibling XA file inspects and primes non-silent playback after ZIP materialization. Relative `.txtp` sibling paths are preserved, and resolver regression coverage now verifies the dependency-family behavior.
