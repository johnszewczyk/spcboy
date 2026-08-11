# Scanner Fast-Path Investigation

SPCBoy now follows CocoaSpice's scanner rule for metadata shortcuts: read
format-owned metadata before starting a decoder core, and retain decoder
inspection as the compatibility fallback.

## Implemented

- SPC files with a valid ID666 header are read directly from the fixed header.
  The scanner gets title, game, artist, play length, and fade fields without
  starting `libgme`. Unusual SPC variants still fall back to the helper.
- VGM and VGZ files with a valid GD3 block are read directly. The scanner
  extracts the UTF-16 GD3 fields and VGM sample timing; `.vgz` payloads are
  decompressed in memory for this read only. Untagged or malformed files fall
  back to `libvgm-tool`.
- Valid SPC shortcut results are used by the multi-track scan path as one
  track, avoiding the previous unconditional `inspect-all` helper launch.
- Directory read failures and per-source attribute failures are recorded as
  scan errors and do not abort unrelated sources in the same library scan.

## Scope boundary

These shortcuts are metadata paths, not playback paths. They do not replace
decoder validation for files without safe container metadata, and they do not
claim a file is playable merely because its header parses.

## Evidence

- CocoaSpice: `ScanMetadataShortcuts.swift`, `ScanCoreHandlers.swift`,
  `SPCMetadataReader.swift`, and `VGMMetadataReader.swift`.
- SPCBoy implementation: `electron/scan-metadata-shortcuts.js` and
  `electron/main.js`.
- Regression coverage: `test/scan-metadata-shortcuts.test.js`.
