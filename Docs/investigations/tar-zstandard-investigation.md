# TAR+Zstandard archive intake

## Scope

CocoaSpice accepts both `.tzst` and compound `.tar.zst` archive names. SPCBoy
previously accepted only ZIP, 7z, and RSN containers, which left the Zophar,
SNESMusic, and JoshW Zstandard collections outside normal scanner intake.

## Implementation

The archive resolver now recognizes `.tzst` and `.tar.zst` as one `tzst` type.
Listing and selected-member extraction explicitly run:

```text
zstd -d -q -c archive.tar.zst -> temporary raw TAR
bsdtar -tf/-xOf temporary raw TAR
```

The decompressed TAR is kept only for the duration of listing or extraction
and is removed in a `finally` path. Scanner admission and dropped-file
handling use the resolver's archive-type predicate, so compound `.tar.zst`
names are accepted even though their final path extension is `.zst`.

## Validation

The Node regression suite creates a real TAR archive, compresses it with the
host `zstd` binary, lists `.xm` and `.flac` members, and concurrently
materializes both selected entries. It also checks `.tzst` and `.tar.zst`
classification. The generated fixture contains no source-collection data and
is removed after the test.

A real local archive, `/Users/john/Downloads/audio/VGM RIPS/Sagaia.tar.zst`,
also passed the full path: 20 members listed, 17 `.vgm` members admitted, and
the selected member materialized and decoded by `libvgm-tool` with 176,400
bytes of one-second PCM and 69,385 nonzero samples.
