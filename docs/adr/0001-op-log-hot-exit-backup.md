# Hot-exit backup is the edit-op log, not a database image

Status: accepted

A database image snapshotted mid-transaction silently misses uncommitted
edits on both drivers (SQLite keeps dirty pages in the pager cache until
COMMIT), so the hot-exit backup is instead the serialized log of pending
edit ops from `EditSession`, replayed through the normal edit path on
restore. One mechanism works on both drivers, the restored document is
dirty and re-backupable, and the backup file is human-readable JSON.

## Considered options

- **SQLite session extension** (`createSession`/`applyChangeset` in
  `node:sqlite`): captures uncommitted changes natively, compact, with
  built-in conflict detection — but sql.js doesn't ship it, so the op-log
  would be needed anyway for the in-memory path; rejected to avoid two
  backup formats and restore paths.
- **`node:sqlite` `backup()` / `VACUUM INTO`**: fail or skip uncommitted
  state when the source connection holds an open write transaction.

## Consequences

- Restore replays logical ops by rowid; if the file changed externally
  between crash and restore, replay surfaces a visible error rather than
  resolving conflicts.
- **Revisit if a raw-SQL execution feature is added.** The op log only
  captures mutations made through `EditSession`'s structured ops; arbitrary
  SQL would mutate rows the log never sees, and the backup story breaks.
  The session extension records actual row changes regardless of origin
  and becomes the right tool at that point.
