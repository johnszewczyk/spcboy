# Archive Repack Rescan: Scanner Improvement Report

## Scope

This report records a CocoaSpice archive-rescan failure and the scanner rule
SPCBoy should implement before relying on incremental archive metadata. It is
not a proposal for a whole-library content-reconciliation feature.

## Observed behavior

A preservation operation edited GD3 metadata in VGM/VGZ files and repacked
local Project2612 `.tar.zst` archives. The outer archive changed size and
modification date, so an incremental CocoaSpice scan correctly selected and
re-inspected it.

The Database nevertheless retained old metadata. For `Arch Rivals.tar.zst`,
the pre-repack rows used member identities such as:

```text
01 - Title Screen.vgz
```

The repacked TAR listed the same file as:

```text
./01 - Title Screen.vgz
```

The scanner inserted the newly inspected member rows but only deleted rows
whose member identity exactly matched. Both row sets remained, allowing an
old title/metadata record to continue appearing in the Database and playlist.

`Test Links` did not reveal the fault. Its contract is only to test whether a
stored source path still exists; it does not inspect archive contents,
fingerprints, checksums, member lists, or metadata.

## Root cause

Archive member paths are not stable enough to serve as the sole replacement
key across repacks. TAR writers may add or remove a harmless leading `./`,
change path prefixes, or omit members. Replacing one member at a time leaves
any old identity that is no longer emitted by the latest archive listing.

The correct durable identity boundary for refresh is the source archive:

```text
root ID + physical archive path
```

Member paths remain necessary to identify current playable leaves, but they
are not a safe cleanup boundary after the outer archive is known to have
changed. The database may contain many current members and subtracks for one
archive source, but it must never retain two historical metadata versions of
one logical member after a repack.

## Correct behavior

An incremental scan must remain cheap for unchanged archives. When the outer
archive fingerprint or native archive signature proves it changed, the scanner
must:

1. List and inspect the current archive members normally.
2. Before persisting the first current member batch, remove every prior live
   member track, member metadata, and member scan-inventory row owned by that
   archive source.
3. Persist only the newly listed member set in bounded batches.
4. Preserve the outer archive inventory row and update it only after the scan
   completes successfully, including its newest native signature.
5. Surface extraction or metadata failures as structured current-scan results;
   never continue presenting stale members as if they were current.

This rule also removes tracks for members genuinely deleted from the archive,
not merely members whose spelling changed. Normal incremental source
fingerprint detection is sufficient to select ordinary edited/repacked files;
no broad metadata rescan or database reset is required.

## CocoaSpice resolution

CocoaSpice now tracks archive sources refreshed during a scan. On the first
successful member batch for each source archive, it deletes all prior archive
member tracks and member scan inventory for that root/path, then persists the
current batch. The refresh marker is retained for the rest of the scan so
later bounded batches append normally rather than repeatedly clearing their
predecessors.

The regression case verifies that a prior member named
`01 - Title Screen.vgz` cannot coexist with the replacement
`./01 - Title Screen.vgz` after refresh.

## SPCBoy implementation requirements

SPCBoy should add this rule to the typed archive pipeline proposed in
`Docs/investigations/cocoaspice-scanner-parity-plan.md`.

- Treat `rootPath + sourceArchivePath` as the replacement scope for a changed
  archive.
- Do not rely on archive-entry string equality to prune old records.
- Keep archive refresh state in the scan job, not global renderer state, so
  concurrent or queued scans cannot clear one another's results.
- Perform source-wide cleanup once before the first persisted replacement
  batch. Do not make one giant archive-wide insert transaction solely to
  simplify cleanup.
- Keep source existence checking separate from content-change validation.
  A `Test Links`-style operation should report missing paths only; scan
  fingerprints/signatures own refresh decisions.
- Include a regression fixture where the same archive member changes only by
  a leading `./`, plus a fixture where a member disappears after repacking.

Do not treat a global content-reconciliation pass as the remedy for this bug.
The required invariant is source-scoped replacement whenever the normal
incremental scanner has already selected a changed archive.

## Acceptance checks

1. Scan an archive containing `01 - Title Screen.vgz` and record its metadata.
2. Repack it with the same payload listed as `./01 - Title Screen.vgz` and
   change its GD3 metadata.
3. Run a normal incremental scan, not a forced deep scan.
4. Verify exactly one current member row exists, its metadata matches the
   repacked file, and the old identity is absent from tracks and scan inventory.
5. Remove one archived member, repack, rescan, and verify its prior track and
   metadata rows are absent.
6. Run the link checker before and after: it should pass when the outer archive
   remains on disk, demonstrating that link validation and content refresh are
   deliberately different operations.
