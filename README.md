# SQLite Atlas

Browse and edit SQLite databases without leaving VS Code. Click any
`.sqlite`, `.sqlite3`, `.db`, `.db3`, `.s3db`, or `.sdb` file and it opens in
a fast table viewer — no setup, no native dependencies.

## Browse

- Sidebar lists every table and view with live row counts
- Paginated grid (100 rows per page) that keeps huge tables responsive
- Click a column header to sort; click again to reverse
- Filter box searches across every column of the current table
- Schema view shows the full `CREATE` statements for the database

## Edit

- Double-click a cell to change it (type `NULL` for NULL); changes integrate
  with VS Code's native undo/redo, dirty indicator, save, and revert
- Insert rows through a column form; delete the selected row with one click
- Unsaved edits survive closing the window — they restore when you reopen
- Views are automatically read-only

## Export

Copy the visible page or the selected row to your clipboard as CSV, TSV,
JSON, SQL `INSERT` statements, Markdown, or HTML — ready to paste into a
spreadsheet, script, or doc.

## Large files

On desktop VS Code, databases open through a disk-backed SQLite driver:
the file is never loaded into memory, so multi-gigabyte databases open
instantly. Environments without that driver fall back to an in-memory
WebAssembly engine automatically.

## How saving works

Edits are applied inside a SQLite transaction. Saving commits the
transaction; reverting rolls it back. Until you save, the file on disk is
untouched.

---

## Development

```bash
npm install
npm run compile     # type-check and build to out/
npm test            # run the test suite (both database drivers)
npm run sample      # generate sample/chinook-lite.db for manual testing
```

Press **F5** in VS Code to launch an Extension Development Host.

### Architecture

- `src/extension.ts` — activation; registers the custom editor
- `src/sqliteEditor.ts` — `CustomEditorProvider` + webview HTML, message
  routing, undo/redo/save/revert wiring
- `src/driver.ts` — `SqliteDriver` interface shared by both backends
- `src/drivers/sqljs.ts` — in-memory driver (sql.js / WebAssembly)
- `src/drivers/nodeSqlite.ts` — disk-backed driver (`node:sqlite`)
- `src/edits.ts` — `EditSession`: structured edit ops carrying their own
  inverses, applied write-through inside a transaction (save = `COMMIT`,
  revert = `ROLLBACK`, undo = apply inverse); the pending-op log doubles
  as the hot-exit backup
- `src/export.ts` — pure row formatters for the copy-as feature
- `media/` — webview UI (vanilla JS/CSS, themed with VS Code CSS variables)

## License

[MIT](LICENSE)
