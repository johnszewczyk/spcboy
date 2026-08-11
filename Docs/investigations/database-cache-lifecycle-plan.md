# Database retention and archive-cache lifecycle plan

Status: CocoaSpice research complete; SPCBoy Phases A-C implemented, Phase D in progress  
Scope: SPCBoy only. CocoaSpice is reference-only.

## Research findings

CocoaSpice uses three separate concepts:

1. **Scan inventory** — completed file/member scan state, fingerprints, route, and failure details.
2. **Playable track records** — metadata and track rows used by the library UI.
3. **Link state** — whether a physical source is currently present.

When a source disappears, CocoaSpice does not erase the scan or track records. Its integrity check only marks the physical source as dead. A later scan restores that source automatically when it reappears. Database maintenance then provides explicit destructive actions for clearing dead sources or purging the database.

Its incremental identity combines source path, file size, modification time, and—where supported—an archive/tool signature. This allows a timestamp- or move-aware scan to reuse completed work while preserving the records for temporarily unavailable media.

Archive extraction has two distinct lifecycles:

- scan scratch materialization is temporary and removed after inspection;
- playback archive cache is durable and keyed by archive identity plus modification time.

CocoaSpice exposes cache file count and byte size in Options and provides an explicit Clear Cache action. It treats the cache as managed application data, not invisible temporary storage.

## SPCBoy gaps

| Area | Current SPCBoy behavior | Required behavior |
|---|---|---|
| Test Links | `trimMissingLibrary()` deletes missing tracks immediately | Mark distinct physical sources missing; retain tracks and metadata |
| Restore | A later scan has no dead-source state to restore | Rediscovery clears dead state without re-inspection when fingerprints still match |
| Purge | No separate purge-unlinked database operation | Add explicit purge for dead sources and retain Clear Database separately |
| Incremental archive identity | Archive signature exists on member rows | Store/use source-level archive signatures before member expansion |
| Durable archive cache | `/tmp/spcboy-archive-cache` is used without status or clearing | Managed cache root, summary, clear action, safe stale cleanup, visible status |
| Cache safety | Cache keys use path/mtime; temporary files can accumulate | Atomic completion markers, bounded cleanup, cache accounting, no silent black hole |
| UI/API | Test Links is wired to destructive trim | Test Links and Purge Unlinked must be separate actions and labels |

## Execution plan

### Phase A — retained link state

- Add `dead_sources(root_id, path, marked_at)` with a unique source key.
- Make Test Links check only physical source existence and mark missing sources.
- Restore dead state automatically when discovery rediscovers the source.
- Exclude dead tracks from database browsing/counts while retaining their rows.
- Ensure a successful scan restores sources before reuse planning.

Implemented: `dead_sources`, automatic undiscovered-source marking during scan, rediscovery restoration, and live-only database queries.

### Phase B — explicit database maintenance

- Add `purgeUnlinkedDatabaseSources()` to delete only dead-source tracks, scan inventory, and markers.
- Keep `Clear Database` as the broader database reset action.
- Add counts for indexed tracks, retained unlinked tracks, and dead sources.
- Expose separate preload/IPC methods and Options actions.

Implemented: Test Links, Purge Unlinked, Clear Database, and separate renderer actions/status messages.

### Phase C — archive cache ownership

- Move durable cache under the application cache directory, not an untracked temporary directory.
- Use archive path + file size + modification time + archive signature when available for cache identity.
- Use staging directories and `.complete` markers; never treat partial extraction as valid cache content.
- Keep scan scratch separate and always disposable.
- Add cache summary: files, bytes, root path, and stale/partial entries.
- Add explicit Clear Cache, blocked while scanning or playing cached material.
- Add bounded stale/partial cleanup and report cleanup failures.

Implemented: managed cache root, source size/mtime cache identity, completion markers for dependency sets, cache summary, cache clearing, and cache UI status. Scan scratch remains separate and disposable. The previous `/tmp/spcboy-archive-cache` location is included in accounting and explicit clearing as a legacy cache. Stale cleanup reporting beyond partial-file counting remains a follow-up.

### Phase D — incremental source planning

- Discover physical files and archives first.
- Compare source fingerprint/signature before expanding archive members.
- Reuse complete successful member rows when the parent archive identity matches.
- Expand/materialize only new, changed, incomplete, or failed members.
- Preserve failed and unsupported inventory states for diagnostics.

Implemented: complete archive member rows are grouped by parent source and reused before archive listing when the parent archive size/mtime, a fast sampled content signature, and row completeness remain unchanged. The stored archive listing signature still protects member-level reuse after a changed parent enters the listing pipeline. The fast signature is deliberately bounded to the archive header/tail sample rather than a full payload hash.

## Acceptance criteria

- Removing a library folder from disk and running Test Links leaves its tracks and scan metadata retained but visibly unlinked.
- Restoring the folder and rescanning clears the unlinked state and reuses unchanged completed records.
- Clear Unlinked removes only marked missing sources; Clear Database remains broader.
- Archive cache size and file count are visible in Options and increase only for durable playback materialization.
- Scan scratch cleanup leaves no scan scratch directory after a completed or failed scan.
- Cache clear removes only SPCBoy’s managed cache and reports failures.
- Archive reuse tests prove unchanged archives skip member extraction and changed archives invalidate cache safely.
