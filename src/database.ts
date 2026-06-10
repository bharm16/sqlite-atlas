import * as path from 'path';
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';

export interface TableInfo {
  name: string;
  type: 'table' | 'view';
  rowCount: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  pk: boolean;
}

export interface TableDataRequest {
  table: string;
  page: number;
  pageSize: number;
  sortColumn?: string;
  sortDir?: 'asc' | 'desc';
  filter?: string;
}

export interface TableData {
  columns: ColumnInfo[];
  rows: unknown[][];
  totalRows: number;
}

export interface SchemaEntry {
  name: string;
  sql: string;
}

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

/** Quote an identifier for safe interpolation into SQL. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Read-only wrapper around a sql.js database opened from a byte buffer.
 */
export class SqliteDb {
  private constructor(private readonly db: SqlJsDatabase) {}

  static async open(bytes: Uint8Array): Promise<SqliteDb> {
    const SQL = await getSqlJs();
    return new SqliteDb(new SQL.Database(bytes));
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

    const rows: unknown[][] = [];
    const stmt = this.db.prepare(
      `SELECT * ${base}${orderBy} LIMIT ? OFFSET ?`
    );
    try {
      stmt.bind([...params, req.pageSize, req.page * req.pageSize]);
      while (stmt.step()) {
        rows.push(stmt.get().map(toDisplayValue));
      }
    } finally {
      stmt.free();
    }

    return { columns, rows, totalRows };
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

  close(): void {
    this.db.close();
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

/** Convert sql.js cell values into something safe to postMessage and render. */
function toDisplayValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return `BLOB (${value.byteLength} bytes)`;
  }
  return value;
}
