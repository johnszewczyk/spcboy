# Scanner Overhaul Findings

The first concrete JoshW/Nintendo 64 failure was in archive dependency
classification, before decoder playback:

- N64 JoshW sets are TAR.ZST archives containing `.miniusf` tracks and a
  shared `.usflib`.
- `dependencyKindForExtension()` classified `.miniusf` as `vgmstream`.
- The dependency materializer consequently filtered out all USF-family
  members and reported the selected `.miniusf` as missing.
- USF-family members now route through the `usf` dependency set, and a real
  TAR.ZST regression fixture verifies that both the selected track and its
  `.usflib` are materialized.

The scanner also previously discarded the original inspection exception and
reported only `decoder could not inspect the file`. Inspection errors now
retain their actual message in the root scan log, which is required for
format-by-format repair work.

This is the first overhaul increment. The remaining work should inventory
failures by archive type, dependency family, discovery/listing, materializing,
routing, and decoder inspection instead of treating every failure as a generic
unsupported file.
