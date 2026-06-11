import { ColumnInfo, TableDataRequest, quoteIdent } from './driver';

export interface SqlQuery {
  sql: string;
  params: unknown[];
}

export interface TableQuery {
  /** Counts the rows matching the filter. */
  count: SqlQuery;
  /** Fetches the page with rowid first, aliased __rid_, for editing. */
  rows: SqlQuery;
  /** Fallback for views and WITHOUT ROWID tables, which have no rowid. */
  rowsNoRowid: SqlQuery;
}

/**
 * Compose the SQL for one page of table data: text filter across all
 * columns, sort (ignored unless the column actually exists), and
 * offset pagination. Pure — drivers only execute what comes out.
 */
export function composeTableQuery(
  req: TableDataRequest,
  columns: ColumnInfo[]
): TableQuery {
  const filterParams: string[] = [];
  let where = '';
  if (req.filter) {
    const clauses = columns.map(
      (c) => `CAST(${quoteIdent(c.name)} AS TEXT) LIKE ?`
    );
    where = ` WHERE ${clauses.join(' OR ')}`;
    const pattern = `%${req.filter}%`;
    filterParams.push(...columns.map(() => pattern));
  }

  let orderBy = '';
  if (req.sortColumn && columns.some((c) => c.name === req.sortColumn)) {
    orderBy = ` ORDER BY ${quoteIdent(req.sortColumn)} ${req.sortDir === 'desc' ? 'DESC' : 'ASC'}`;
  }

  const base = `FROM ${quoteIdent(req.table)}${where}`;
  // Select columns explicitly so result keys and positions are unambiguous.
  const colList = columns.map((c) => quoteIdent(c.name)).join(', ');
  const tail = `${base}${orderBy} LIMIT ? OFFSET ?`;
  const pageParams = [...filterParams, req.pageSize, req.page * req.pageSize];

  return {
    count: { sql: `SELECT COUNT(*) AS n ${base}`, params: [...filterParams] },
    rows: { sql: `SELECT rowid AS __rid_, ${colList} ${tail}`, params: pageParams },
    rowsNoRowid: { sql: `SELECT ${colList} ${tail}`, params: pageParams },
  };
}
