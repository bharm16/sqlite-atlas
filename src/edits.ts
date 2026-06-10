import { SqliteDriver, quoteIdent } from './driver';

export type SqlValue = string | number | bigint | Uint8Array | null;

export interface UpdateOp {
  kind: 'update';
  table: string;
  rowid: number;
  column: string;
  oldValue: SqlValue;
  newValue: SqlValue;
}

export interface InsertOp {
  kind: 'insert';
  table: string;
  rowid: number;
  columns: string[];
  values: SqlValue[];
}

export interface DeleteOp {
  kind: 'delete';
  table: string;
  rowid: number;
  columns: string[];
  values: SqlValue[];
}

export type EditOp = UpdateOp | InsertOp | DeleteOp;

/**
 * Serialize edit ops for the hot-exit backup file. Uint8Array values (BLOB
 * cells captured by delete ops) are encoded as tagged base64 objects since
 * JSON has no binary type.
 */
export function serializeOps(ops: EditOp[]): string {
  return JSON.stringify({ version: 1, ops }, (_key, value) =>
    value instanceof Uint8Array
      ? { __blob64: Buffer.from(value).toString('base64') }
      : value
  );
}

export function deserializeOps(json: string): EditOp[] {
  const parsed = JSON.parse(json, (_key, value) =>
    value && typeof value === 'object' && typeof value.__blob64 === 'string'
      ? new Uint8Array(Buffer.from(value.__blob64, 'base64'))
      : value
  );
  if (parsed.version !== 1 || !Array.isArray(parsed.ops)) {
    throw new Error('Unrecognized backup format');
  }
  return parsed.ops as EditOp[];
}

/**
 * Applies structured edits to a database through a driver. Each edit carries
 * enough information to invert itself, which is what backs undo/redo.
 */
export class EditSession {
  private inTxn = false;
  /** Ops applied since the last save/revert, in order — the hot-exit backup. */
  private pendingOps: EditOp[] = [];

  constructor(private readonly driver: SqliteDriver) {}

  getPendingOps(): EditOp[] {
    return [...this.pendingOps];
  }

  /**
   * Commit pending edits. Returns the database image to write back to the
   * file for in-memory drivers, or undefined when the driver already wrote
   * the changes to disk itself.
   */
  save(): Uint8Array | undefined {
    if (this.inTxn) {
      this.driver.run('COMMIT');
      this.inTxn = false;
    }
    this.pendingOps = [];
    return this.driver.serialize?.();
  }

  /** Discard all edits made since the last save. */
  revert(): void {
    if (this.inTxn) {
      this.driver.run('ROLLBACK');
      this.inTxn = false;
    }
    this.pendingOps = [];
  }

  /**
   * Re-apply ops restored from a hot-exit backup onto a freshly opened
   * database. The ops become pending again, so the document is dirty and
   * the next backup captures them too.
   */
  replay(ops: EditOp[]): void {
    for (const op of ops) {
      this.redo(op);
    }
  }

  /** Roll back anything uncommitted; call when the document closes dirty. */
  dispose(): void {
    this.revert();
  }

  private ensureTxn(): void {
    if (!this.inTxn) {
      this.driver.run('BEGIN');
      this.inTxn = true;
    }
  }

  updateCell(table: string, rowid: number, column: string, newValue: SqlValue): UpdateOp {
    this.ensureTxn();
    const old = this.driver.queryRow(
      `SELECT ${quoteIdent(column)} FROM ${quoteIdent(table)} WHERE rowid = ?`,
      [rowid]
    );
    if (!old) {
      throw new Error(`Row ${rowid} not found in ${table}`);
    }
    const op: UpdateOp = {
      kind: 'update',
      table,
      rowid,
      column,
      oldValue: old[0] as SqlValue,
      newValue,
    };
    this.driver.run(
      `UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)} = ? WHERE rowid = ?`,
      [newValue, rowid]
    );
    this.pendingOps.push(op);
    return op;
  }

  insertRow(table: string, values: Record<string, SqlValue>): InsertOp {
    this.ensureTxn();
    const columns = Object.keys(values);
    const colList = columns.map(quoteIdent).join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    const sql =
      columns.length === 0
        ? `INSERT INTO ${quoteIdent(table)} DEFAULT VALUES`
        : `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${placeholders})`;
    const { lastRowid } = this.driver.run(sql, columns.map((c) => values[c]));
    const op: InsertOp = {
      kind: 'insert',
      table,
      rowid: lastRowid,
      columns,
      values: columns.map((c) => values[c]),
    };
    this.pendingOps.push(op);
    return op;
  }

  deleteRow(table: string, rowid: number): DeleteOp {
    this.ensureTxn();
    const columns = this.driver.getColumns(table).map((c) => c.name);
    const row = this.driver.queryRow(
      `SELECT ${columns.map(quoteIdent).join(', ')} FROM ${quoteIdent(table)} WHERE rowid = ?`,
      [rowid]
    );
    if (!row) {
      throw new Error(`Row ${rowid} not found in ${table}`);
    }
    this.deleteByRowid(table, rowid);
    const op: DeleteOp = { kind: 'delete', table, rowid, columns, values: row as SqlValue[] };
    this.pendingOps.push(op);
    return op;
  }

  undo(op: EditOp): void {
    this.ensureTxn();
    // VS Code's undo stack is linear: the op being undone is the last applied.
    if (this.pendingOps[this.pendingOps.length - 1] === op) {
      this.pendingOps.pop();
    }
    switch (op.kind) {
      case 'update':
        this.setCell(op.table, op.rowid, op.column, op.oldValue);
        break;
      case 'insert':
        this.deleteByRowid(op.table, op.rowid);
        break;
      case 'delete':
        this.insertWithRowid(op.table, op.rowid, op.columns, op.values);
        break;
    }
  }

  redo(op: EditOp): void {
    this.ensureTxn();
    this.pendingOps.push(op);
    switch (op.kind) {
      case 'update':
        this.setCell(op.table, op.rowid, op.column, op.newValue);
        break;
      case 'insert':
        this.insertWithRowid(op.table, op.rowid, op.columns, op.values);
        break;
      case 'delete':
        this.deleteByRowid(op.table, op.rowid);
        break;
    }
  }

  private deleteByRowid(table: string, rowid: number): void {
    this.driver.run(`DELETE FROM ${quoteIdent(table)} WHERE rowid = ?`, [rowid]);
  }

  /**
   * Re-insert a row at a specific rowid. When the table has an INTEGER
   * PRIMARY KEY column, that column IS the rowid and naming both would
   * conflict, so the explicit rowid column is skipped in that case.
   */
  private insertWithRowid(
    table: string,
    rowid: number,
    columns: string[],
    values: SqlValue[]
  ): void {
    const pkAlias = this.integerPkAlias(table);
    const cols = pkAlias !== undefined && columns.includes(pkAlias)
      ? [...columns]
      : ['rowid', ...columns];
    const vals = cols[0] === 'rowid' ? [rowid, ...values] : [...values];
    this.driver.run(
      `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')})
       VALUES (${cols.map(() => '?').join(', ')})`,
      vals
    );
  }

  /** The column name that aliases rowid (single INTEGER PRIMARY KEY), if any. */
  private integerPkAlias(table: string): string | undefined {
    const pks = this.driver.getColumns(table).filter((c) => c.pk);
    if (pks.length === 1 && pks[0].type.toUpperCase() === 'INTEGER') {
      return pks[0].name;
    }
    return undefined;
  }

  private setCell(table: string, rowid: number, column: string, value: SqlValue): void {
    this.driver.run(
      `UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)} = ? WHERE rowid = ?`,
      [value, rowid]
    );
  }
}
