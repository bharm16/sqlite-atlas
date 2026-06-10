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

/**
 * A connection to a SQLite database. Implementations: sql.js (in-memory,
 * works everywhere) and node:sqlite (disk-backed, handles large files).
 */
export interface SqliteDriver {
  listTables(): TableInfo[];
  getColumns(table: string): ColumnInfo[];
  getTableData(req: TableDataRequest): TableData;
  getSchema(): SchemaEntry[];
  close(): void;
}

/** Quote an identifier for safe interpolation into SQL. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Convert driver cell values into something safe to postMessage and render. */
export function toDisplayValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return `BLOB (${value.byteLength} bytes)`;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return value;
}
