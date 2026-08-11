# Scanner Scratch Space Leak Report

## Incident

On 2026-08-09, the Data volume had only 1.9 GiB free. The immediate source
was 12,178 abandoned directories named `spcboy-scan-scratch-*` under the
per-user macOS temporary root:

```text
/private/var/folders/v3/lm27tn5x1h1dv8lwcw0cx_5m0000gn/T/
```

They consumed 37 GiB. No SPCBoy worker held an open file in those directories
at the time of inspection. Removing only those exact scan scratch directories
returned free space from 1.9 GiB to 38 GiB.

This was not CocoaSpice, APFS snapshots, or the persistent CocoaSpice cache.

## Current implementation

`electron/archive-resolver.js` creates a `spcboy-scan-scratch-*` directory for
scan materialization. `electron/library-scan-service.js` shares one such
session per archive and calls `session.cleanup()` in the normal scan
`finally` block. Per-entry materializations also expose a `cleanup()` closure.

That contract cleans up after a scan reaches its normal JavaScript completion
path. It does not reclaim roots when the Electron process is terminated,
crashes, or otherwise exits before that `finally` block can execute. There is
also no startup recovery sweep for abandoned scan roots. The observed 12,178
unowned directories prove that relying on in-process cleanup alone is not a
durable disk-space policy.

## Required scanner contract

1. A scan scratch root is disposable and must never be treated as a playback
   cache or durable source.
2. Normal completion, cancellation, and materialization errors must continue
   to remove the root deterministically.
3. On startup, before a new scan starts, SPCBoy must remove abandoned
   `spcboy-scan-scratch-*` roots that are not owned by the current scan
   process. This is recovery from interrupted work, not a cache eviction
   policy.
4. A live scan must retain only its own roots. Its cancellation/quit path must
   await root cleanup before reporting the scan stopped where the process is
   still alive.
5. Scratch accounting must be visible in scanner diagnostics: active root
   count, active bytes, recovered-root count, and recovered bytes. A scan
   cannot silently consume the volume.
6. Materialization must enforce a fixed scratch-space budget before extracting
   another archive. If insufficient space remains, fail the current scan
   clearly, clean its root, and leave the database consistent.

## Implementation boundary

- Keep `electron/archive-resolver.js` responsible for creation and physical
  removal of materialization roots.
- Keep `electron/library-scan-service.js` responsible for job ownership,
  cancellation, budget checks, and reporting.
- Do not move scan roots into the durable archive playback cache.
- Do not use best-effort OS temp cleanup as the only recovery mechanism;
  macOS did not reclaim these 37 GiB during the incident.

## Acceptance checks

1. Start a large archive scan, forcibly terminate the Electron process, and
   relaunch SPCBoy. Before accepting another scan, the startup recovery pass
   removes the abandoned roots and reports reclaimed bytes.
2. Complete and cancel ordinary archive scans. Both leave zero owned scratch
   roots after the operation settles.
3. Run a large JoshW-style archive corpus. Scratch usage remains bounded by the
   active-job budget and returns to baseline after completion.
4. Simulate low disk space. The scanner fails before unsafe extraction,
   removes its active scratch root, and records a clear diagnostic.
5. Confirm archive playback cache size is unchanged by scratch recovery.

## Files

- [archive-resolver.js](/Users/john/Downloads/Code/SPCBoy/electron/archive-resolver.js)
- [library-scan-service.js](/Users/john/Downloads/Code/SPCBoy/electron/library-scan-service.js)
