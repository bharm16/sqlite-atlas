# SQLite Viewer (clone)

A VS Code extension for quickly viewing SQLite database files, built from
scratch as an original-code clone of the popular
[SQLite Viewer](https://open-vsx.org/extension/qwtel/sqlite-viewer) extension.

## Features

- Click any `.sqlite`, `.sqlite3`, `.db`, `.db3`, `.s3db`, or `.sdb` file to
  open it in a read-only viewer
- Sidebar listing all tables and views with row counts
- Paginated data grid (100 rows per page)
- Click a column header to sort; click again to reverse
- Filter box that searches across every column of the current table
- Schema view showing all `CREATE` statements
- Matches your VS Code color theme; no native dependencies (SQLite runs as
  WebAssembly via [sql.js](https://github.com/sql-js/sql.js))

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
- `src/sqliteEditor.ts` — `CustomReadonlyEditorProvider` + webview HTML and
  message routing
- `src/database.ts` — pure (no `vscode` imports) wrapper around sql.js:
  table listing, paged/sorted/filtered queries, schema dump
- `media/` — webview UI (vanilla JS/CSS, themed with VS Code CSS variables)

The viewer is strictly read-only: the file is loaded into memory and never
written back.
