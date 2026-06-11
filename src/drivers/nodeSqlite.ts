import {
  ColumnInfo,
  RunResult,
  SchemaEntry,
  SqliteDriver,
  TableData,
  TableDataRequest,
  TableInfo,
  quoteIdent,
  toDisplayValue,
} from '../driver';
import { composeTableQuery } from '../query';

// node:sqlite ships with the extension host's Node on recent VS Code builds;
// older hosts (and VS Code for Web) fall back to the sql.js driver.
type NodeSqliteModule = typeof import('node:sqlite');

function loadNodeSqlite(): NodeSqliteModule | undefined {
  try {
    return require('node:sqlite');
  } catch {
    return undefined;
  }
}

export class NodeSqliteDriver implements SqliteDriver {
  private constructor(
    private readonly db: import('node:sqlite').DatabaseSync
  ) {}

  static isAvailable(): boolean {
    return loadNodeSqlite() !== undefined;
  }

  /** Open a database file in place — the file is never loaded into memory. */
  static open(filePath: string): NodeSqliteDriver {
    const mod = loadNodeSqlite();
    if (!mod) {
      throw new Error('driver unavailable');
    }
    return new NodeSqliteDriver(new mod.DatabaseSync(filePath));
  }

  listTables(): TableInfo[] {
    const rows = this.db
      .prepare(
        `SELECT name, type FROM sqlite_master
         WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
         ORDER BY type, name`
      )
      .all() as { name: string; type: 'table' | 'view' }[];
    return rows.map((r) => ({
      name: r.name,
      type: r.type,
      rowCount: this.countRows(r.name),
    }));
  }

  getColumns(table: string): ColumnInfo[] {
    const rows = this.db
      .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
      .all() as { name: string; type: string | null; pk: number }[];
    return rows.map((r) => ({
      name: r.name,
      type: String(r.type ?? ''),
      pk: Number(r.pk) > 0,
    }));
  }

  getTableData(req: TableDataRequest): TableData {
    const columns = this.getColumns(req.table);
    if (columns.length === 0) {
      return { columns: [], rows: [], totalRows: 0 };
    }

    const query = composeTableQuery(req, columns);
    const totalRows = Number(
      (this.db
        .prepare(query.count.sql)
        .get(...(query.count.params as never[])) as { n: number }).n
    );

    // Views and WITHOUT ROWID tables have no rowid; fall back to plain rows.
    try {
      const raw = this.db
        .prepare(query.rows.sql)
        .all(...(query.rows.params as never[])) as Record<string, unknown>[];
      return {
        columns,
        totalRows,
        rowIds: raw.map((r) => Number(r.__rid_)),
        rows: raw.map((r) => columns.map((c) => toDisplayValue(r[c.name]))),
      };
    } catch {
      const raw = this.db
        .prepare(query.rowsNoRowid.sql)
        .all(...(query.rowsNoRowid.params as never[])) as Record<string, unknown>[];
      return {
        columns,
        totalRows,
        rows: raw.map((r) => columns.map((c) => toDisplayValue(r[c.name]))),
      };
    }
  }

  getSchema(): SchemaEntry[] {
    const rows = this.db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid`)
      .all() as { name: string; sql: string }[];
    return rows.map((r) => ({ name: r.name, sql: r.sql }));
  }

  run(sql: string, params: unknown[] = []): RunResult {
    const result = this.db.prepare(sql).run(...(params as never[]));
    return {
      changes: Number(result.changes),
      lastRowid: Number(result.lastInsertRowid),
    };
  }

  queryRow(sql: string, params: unknown[] = []): unknown[] | undefined {
    const row = this.db.prepare(sql).get(...(params as never[])) as
      | Record<string, unknown>
      | undefined;
    return row === undefined ? undefined : Object.values(row);
  }

  close(): void {
    this.db.close();
  }

  private countRows(table: string): number {
    try {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`)
        .get() as { n: number };
      return Number(row.n);
    } catch {
      // Views can reference missing tables; don't let that break the listing.
      return -1;
    }
  }
}
