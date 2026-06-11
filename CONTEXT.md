# Domain glossary

Terms used by the code, tests, and ADRs. Use these names; don't coin
synonyms.

- **Driver** — a connection to a SQLite database behind the
  `SqliteDriver` interface (`src/driver.ts`). Two adapters: node:sqlite
  (disk-backed, large files) and sql.js (in-memory, works everywhere).
- **Table query** — the composed SQL for one page of table data
  (filter, sort, pagination), built by `composeTableQuery`
  (`src/query.ts`). Drivers execute it; they don't compose it.
- **Edit op** — one structured mutation (update/insert/delete) carrying
  enough information to invert itself (`src/edits.ts`). The pending op
  log is the hot-exit backup (ADR-0001).
- **Edit session** — applies edit ops through a driver inside a single
  transaction; owns save/revert/replay (`EditSession`, `src/edits.ts`).
  Deliberately not wrapped further (ADR-0002).
- **Protocol** — the webview↔extension message types, defined once in
  `src/protocol.ts`: `WebviewToHost` and `HostToWebview`. Both ends are
  compile-checked against it (extension via `src/messages.ts`, webview
  via `media/tsconfig.json` checkJs).
- **Message handlers** — the extension-side handling of webview
  messages (`handleWebviewMessage`, `src/messages.ts`). All effects go
  through injected deps, so they test without VS Code.
- **View-model** — the webview's UI decisions (paging, sorting,
  selection, editability, message payloads) in `media/viewModel.js`,
  free of DOM and message port. `media/main.js` only renders the DOM
  and forwards events.
