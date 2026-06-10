# SQLite Viewer (clone)

A VS Code extension for quickly viewing SQLite database files, built from
scratch as an original-code clone of the popular
[SQLite Viewer](https://open-vsx.org/extension/qwtel/sqlite-viewer) extension.

## Features

- Click any `.sqlite`, `.sqlite3`, `.db`, `.db3`, `.s3db`, or `.sdb` file to
  open it in the viewer
- Sidebar listing all tables and views with row counts
- Paginated data grid (100 rows per page)
- Click a column header to sort; click again to reverse
- Filter box that searches across every column of the current table
- Schema view showing all `CREATE` statements
- **Editing**: double-click a cell to edit it (type `NULL` for NULL), insert
  rows via a column form, delete the selected row — all with full VS Code
  undo/redo, dirty state, save, and revert (views stay read-only)
- **Copy rows** to the clipboard as CSV, TSV, JSON, SQL inserts, Markdown,
  or HTML
- **Large-file support**: local files open with Node's built-in disk-backed
  SQLite driver when available — nothing is loaded into memory, so there is
  no practical size cap; other hosts fall back to in-memory
  [sql.js](https://github.com/sql-js/sql.js) (WebAssembly, no native
  dependencies)
- Matches your VS Code color theme

## Development

```bash
npm install
npm run compile     # type-check and build to out/
npm test            # run the database-layer unit tests
npm run sample      # generate sample/chinook-lite.db for manual testing
```

Press **F5** in VS Code to launch an Extension Development Host, then open the
generated sample database (or any SQLite file).

## Architecture

- `src/extension.ts` — activation; registers the custom editor
- `src/sqliteEditor.ts` — `CustomEditorProvider` + webview HTML, message
  routing, undo/redo/save/revert wiring
- `src/driver.ts` — `SqliteDriver` interface shared by both backends
- `src/drivers/sqljs.ts` — in-memory driver (sql.js / WebAssembly)
- `src/drivers/nodeSqlite.ts` — disk-backed driver (`node:sqlite`)
- `src/edits.ts` — `EditSession`: structured edit ops carrying their own
  inverses, applied write-through inside a transaction (save = `COMMIT`,
  revert = `ROLLBACK`, undo = apply inverse)
- `src/export.ts` — pure row formatters for the copy-as feature
- `media/` — webview UI (vanilla JS/CSS, themed with VS Code CSS variables)
