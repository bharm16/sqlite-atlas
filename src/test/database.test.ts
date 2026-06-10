import * as assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import * as path from 'path';
import { SqliteDb } from '../database';

async function buildSampleBytes(): Promise<Uint8Array> {
  const SQL = await initSqlJs({
    locateFile: (file: string) =>
      path.join(path.dirname(require.resolve('sql.js')), file),
  });
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE artists (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE albums (
      id INTEGER PRIMARY KEY,
      artist_id INTEGER REFERENCES artists(id),
      title TEXT NOT NULL,
      year INTEGER,
      cover BLOB
    );
    CREATE VIEW album_titles AS SELECT title FROM albums;
  `);
  db.run(`INSERT INTO artists (id, name) VALUES (1, 'Nina Simone'), (2, 'Miles Davis')`);
  db.run(
    `INSERT INTO albums (id, artist_id, title, year, cover) VALUES
     (1, 1, 'Pastel Blues', 1965, x'DEADBEEF'),
     (2, 2, 'Kind of Blue', 1959, NULL),
     (3, 2, 'Sketches of Spain', 1960, NULL)`
  );
  const bytes = db.export();
  db.close();
  return bytes;
}

async function main(): Promise<void> {
  const db = await SqliteDb.open(await buildSampleBytes());

  // listTables: 2 tables + 1 view, with row counts
  const tables = db.listTables();
  assert.deepEqual(
    tables.map((t) => [t.name, t.type, t.rowCount]),
    [
      ['albums', 'table', 3],
      ['artists', 'table', 2],
      ['album_titles', 'view', 3],
    ]
  );

  // getColumns: names, types, pk flag
  const cols = db.getColumns('albums');
  assert.deepEqual(cols.map((c) => c.name), ['id', 'artist_id', 'title', 'year', 'cover']);
  assert.equal(cols[0].pk, true);
  assert.equal(cols[2].pk, false);

  // basic page
  const page = db.getTableData({ table: 'albums', page: 0, pageSize: 100 });
  assert.equal(page.totalRows, 3);
  assert.equal(page.rows.length, 3);

  // BLOB rendered as placeholder, NULL passed through
  assert.equal(page.rows[0][4], 'BLOB (4 bytes)');
  assert.equal(page.rows[1][4], null);

  // sorting
  const sorted = db.getTableData({
    table: 'albums', page: 0, pageSize: 100, sortColumn: 'year', sortDir: 'desc',
  });
  assert.deepEqual(sorted.rows.map((r) => r[3]), [1965, 1960, 1959]);

  // bogus sort column is ignored, not an injection vector
  const bogusSort = db.getTableData({
    table: 'albums', page: 0, pageSize: 100, sortColumn: 'id; DROP TABLE albums', sortDir: 'asc',
  });
  assert.equal(bogusSort.totalRows, 3);

  // filtering matches across columns, case-insensitive LIKE
  const filtered = db.getTableData({ table: 'albums', page: 0, pageSize: 100, filter: 'blue' });
  assert.equal(filtered.totalRows, 2);

  // filter with LIKE metacharacters doesn't blow up
  const weird = db.getTableData({ table: 'albums', page: 0, pageSize: 100, filter: "100%' OR '1'='1" });
  assert.equal(weird.totalRows, 0);

  // pagination
  const page2 = db.getTableData({
    table: 'albums', page: 1, pageSize: 2, sortColumn: 'id', sortDir: 'asc',
  });
  assert.equal(page2.totalRows, 3);
  assert.deepEqual(page2.rows.map((r) => r[0]), [3]);

  // schema includes all CREATE statements
  const schema = db.getSchema();
  assert.deepEqual(schema.map((s) => s.name), ['artists', 'albums', 'album_titles']);
  assert.ok(schema[0].sql.startsWith('CREATE TABLE artists'));

  db.close();
  console.log('All database tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
