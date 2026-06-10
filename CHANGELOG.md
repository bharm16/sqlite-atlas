# Changelog

## 0.1.0

Initial release.

- Open `.sqlite`, `.sqlite3`, `.db`, `.db3`, `.s3db`, and `.sdb` files in a
  table viewer with pagination, sorting, and cross-column filtering
- Edit cells (double-click), insert and delete rows, with full VS Code
  undo/redo, save, and revert
- Unsaved edits survive window close (hot-exit backup and restore)
- Copy rows as CSV, TSV, JSON, SQL inserts, Markdown, or HTML
- Schema view with all `CREATE` statements
- Disk-backed driver for large files when the editor host provides
  `node:sqlite`; in-memory WebAssembly fallback (sql.js) everywhere else
