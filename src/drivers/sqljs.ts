import * as path from 'path';
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
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

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    // sql.js resolves to dist/sql-wasm.js; the .wasm binary sits next to it.
    sqlJsPromise = initSqlJs({
      locateFile: (file: string) =>
        path.join(path.dirname(require.resolve('sql.js')), file),
    });
  }
  return sqlJsPromise;
}

/**
 * In-memory driver backed by sql.js (SQLite compiled to WebAssembly).
 * Loads the whole file into memory; works on any platform.
 */
export class SqlJsDriver implements SqliteDriver {
  private constructor(private readonly db: SqlJsDatabase) {}

  static async open(bytes: Uint8Array): Promise<SqlJsDriver> {
    const SQL = await getSqlJs();
    return new SqlJsDriver(new SQL.Database(bytes));
  }

  listTables(): TableInfo[] {
    const result = this.db.exec(
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
       ORDER BY type, name`
    );
    if (result.length === 0) {
      return [];
    }
    return result[0].values.map(([name, type]) => ({
      name: String(name),
      type: type as 'table' | 'view',
      rowCount: this.countRows(String(name)),
    }));
  }

  getColumns(table: string): ColumnInfo[] {
    const result = this.db.exec(`PRAGMA table_info(${quoteIdent(table)})`);
    if (result.length === 0) {
      return [];
    }
    // PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
    return result[0].values.map((row) => ({
      name: String(row[1]),
      type: String(row[2] ?? ''),
      pk: Number(row[5]) > 0,
    }));
  }

  getTableData(req: TableDataRequest): TableData {
    const columns = this.getColumns(req.table);
    if (columns.length === 0) {
      return { columns: [], rows: [], totalRows: 0 };
    }

    const params: string[] = [];
    let where = '';
    if (req.filter) {
      const clauses = columns.map((c) => `CAST(${quoteIdent(c.name)} AS TEXT) LIKE ?`);
      where = ` WHERE ${clauses.join(' OR ')}`;
      const pattern = `%${req.filter}%`;
      params.push(...columns.map(() => pattern));
    }

    let orderBy = '';
    if (req.sortColumn && columns.some((c) => c.name === req.sortColumn)) {
      orderBy = ` ORDER BY ${quoteIdent(req.sortColumn)} ${req.sortDir === 'desc' ? 'DESC' : 'ASC'}`;
    }

    const base = `FROM ${quoteIdent(req.table)}${where}`;
    const totalRows = this.scalar(`SELECT COUNT(*) ${base}`, params);
    const tail = `${base}${orderBy} LIMIT ? OFFSET ?`;
    const bindings = [...params, req.pageSize, req.page * req.pageSize];

    // Views and WITHOUT ROWID tables have no rowid; fall back to plain rows.
    try {
      const { rows, rowIds } = this.fetchRows(`SELECT rowid AS __rid_, * ${tail}`, bindings, true);
      return { columns, rows, totalRows, rowIds };
    } catch {
      const { rows } = this.fetchRows(`SELECT * ${tail}`, bindings, false);
      return { columns, rows, totalRows };
    }
  }

  getSchema(): SchemaEntry[] {
    const result = this.db.exec(
      `SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid`
    );
    if (result.length === 0) {
      return [];
    }
    return result[0].values.map(([name, sql]) => ({
      name: String(name),
      sql: String(sql),
    }));
  }

  run(sql: string, params: unknown[] = []): RunResult {
    this.db.run(sql, params as never[]);
    const changes = this.db.getRowsModified();
    const lastRowid = this.scalar('SELECT last_insert_rowid()', []);
    return { changes, lastRowid };
  }

  queryRow(sql: string, params: unknown[] = []): unknown[] | undefined {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as never[]);
      return stmt.step() ? stmt.get() : undefined;
    } finally {
      stmt.free();
    }
  }

  serialize(): Uint8Array {
    return this.db.export();
  }

  close(): void {
    this.db.close();
  }

  private fetchRows(
    sql: string,
    bindings: unknown[],
    withRowIds: boolean
  ): { rows: unknown[][]; rowIds?: number[] } {
    const rows: unknown[][] = [];
    const rowIds: number[] = [];
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(bindings as never[]);
      while (stmt.step()) {
        const values = stmt.get();
        if (withRowIds) {
          rowIds.push(Number(values[0]));
          rows.push(values.slice(1).map(toDisplayValue));
        } else {
          rows.push(values.map(toDisplayValue));
        }
      }
    } finally {
      stmt.free();
    }
    return withRowIds ? { rows, rowIds } : { rows };
  }

  private countRows(table: string): number {
    try {
      return this.scalar(`SELECT COUNT(*) FROM ${quoteIdent(table)}`, []);
    } catch {
      // Views can reference missing tables; don't let that break the listing.
      return -1;
    }
  }

  private scalar(sql: string, params: unknown[]): number {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as never[]);
      stmt.step();
      return Number(stmt.get()[0]);
    } finally {
      stmt.free();
    }
  }
}
