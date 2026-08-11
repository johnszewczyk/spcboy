# AGENTS

Read this file, then `ai/project-info.md`, then the narrow note named by the task.

## Documentation

- `ai/subsystem-human/` records sparse implemented user-facing behavior.
- `ai/subsystem-agent/` records current engineering constraints, ownership, invariants, and failure boundaries.
- Keep current state only; do not add changelogs, investigation stories, or planning notes to subsystem files.
- Put direct owning code links in each note's `Files` section.

## Engineering

- Keep renderer Node access off and native capability behind narrow preload APIs.
- Keep the Electron wrapper visually invisible; UI and routes remain in the local renderer bundle.
- Prefer simple vanilla changes and fail loudly when required corpus input is unavailable.
