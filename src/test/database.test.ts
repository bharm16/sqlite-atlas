import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { SqliteDriver } from '../driver';
import { buildSampleBytes, driverFactories } from './helpers';

for (const { name, open } of driverFactories) {
  test(`${name}: read behaviors`, async (t) => {
    let db: SqliteDriver;
    try {
      db = await open(await buildSampleBytes());
    } catch (err) {
      if (err instanceof Error && err.message === 'driver unavailable') {
        t.skip('driver unavailable on this Node');
        return;
      }
      throw err;
    }

    await t.test('lists tables and views with row counts', () => {
      assert.deepEqual(
        db.listTables().map((x) => [x.name, x.type, x.rowCount]),
        [
          ['albums', 'table', 3],
          ['artists', 'table', 2],
          ['album_titles', 'view', 3],
        ]
      );
    });

    await t.test('reports columns with types and pk flag', () => {
      const cols = db.getColumns('albums');
      assert.deepEqual(cols.map((c) => c.name), ['id', 'artist_id', 'title', 'year', 'cover']);
      assert.equal(cols[0].pk, true);
      assert.equal(cols[2].pk, false);
    });

    await t.test('returns a page of rows with BLOB placeholder and NULL', () => {
      const page = db.getTableData({ table: 'albums', page: 0, pageSize: 100 });
      assert.equal(page.totalRows, 3);
      assert.equal(page.rows.length, 3);
      assert.equal(page.rows[0][4], 'BLOB (4 bytes)');
      assert.equal(page.rows[1][4], null);
    });

    await t.test('sorts by a column', () => {
      const sorted = db.getTableData({
        table: 'albums', page: 0, pageSize: 100, sortColumn: 'year', sortDir: 'desc',
      });
      assert.deepEqual(sorted.rows.map((r) => r[3]), [1965, 1960, 1959]);
    });

    await t.test('ignores a bogus sort column', () => {
      const bogus = db.getTableData({
        table: 'albums', page: 0, pageSize: 100,
        sortColumn: 'id; DROP TABLE albums', sortDir: 'asc',
      });
      assert.equal(bogus.totalRows, 3);
    });

    await t.test('filters across all columns', () => {
      const filtered = db.getTableData({ table: 'albums', page: 0, pageSize: 100, filter: 'blue' });
      assert.equal(filtered.totalRows, 2);
    });

    await t.test('treats LIKE metacharacters in filters literally enough', () => {
      const weird = db.getTableData({
        table: 'albums', page: 0, pageSize: 100, filter: "100%' OR '1'='1",
      });
      assert.equal(weird.totalRows, 0);
    });

    await t.test('paginates', () => {
      const page2 = db.getTableData({
        table: 'albums', page: 1, pageSize: 2, sortColumn: 'id', sortDir: 'asc',
      });
      assert.equal(page2.totalRows, 3);
      assert.deepEqual(page2.rows.map((r) => r[0]), [3]);
    });

    await t.test('dumps schema CREATE statements', () => {
      const schema = db.getSchema();
      assert.deepEqual(schema.map((s) => s.name), ['artists', 'albums', 'album_titles']);
      assert.ok(schema[0].sql.startsWith('CREATE TABLE artists'));
    });

    db.close();
  });
}
