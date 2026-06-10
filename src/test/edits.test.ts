import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { SqliteDriver } from '../driver';
import { EditSession } from '../edits';
import { buildSampleBytes, driverFactories } from './helpers';

function titleOfRow(db: SqliteDriver, rowid: number): unknown {
  const data = db.getTableData({ table: 'albums', page: 0, pageSize: 100 });
  const i = data.rowIds!.indexOf(rowid);
  return i === -1 ? undefined : data.rows[i][2];
}

for (const { name, open } of driverFactories) {
  test(`${name}: editing behaviors`, async (t) => {
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
    // One session per open document, matching how the editor uses it.
    const session = new EditSession(db);

    await t.test('table data carries rowIds for tables but not for views', () => {
      const table = db.getTableData({ table: 'albums', page: 0, pageSize: 100 });
      assert.deepEqual(table.rowIds, [1, 2, 3]);
      const view = db.getTableData({ table: 'album_titles', page: 0, pageSize: 100 });
      assert.equal(view.rowIds, undefined);
      assert.equal(view.totalRows, 3);
    });

    await t.test('updating a cell changes the value and remembers the old one', () => {
      const op = session.updateCell('albums', 1, 'title', 'Pastel Blues (Live)');
      assert.equal(titleOfRow(db, 1), 'Pastel Blues (Live)');
      assert.equal(op.kind, 'update');
      assert.equal(op.oldValue, 'Pastel Blues');
    });

    await t.test('undo restores the old value; redo reapplies the new one', () => {
      const op = session.updateCell('albums', 2, 'title', 'Kinda Blue');
      session.undo(op);
      assert.equal(titleOfRow(db, 2), 'Kind of Blue');
      session.redo(op);
      assert.equal(titleOfRow(db, 2), 'Kinda Blue');
    });

    await t.test('insert adds a row; undo removes it; redo restores the same rowid', () => {
      const op = session.insertRow('artists', { name: 'John Coltrane' });
      const count = () =>
        db.getTableData({ table: 'artists', page: 0, pageSize: 100 }).totalRows;
      assert.equal(count(), 3);
      session.undo(op);
      assert.equal(count(), 2);
      session.redo(op);
      assert.equal(count(), 3);
      const data = db.getTableData({ table: 'artists', page: 0, pageSize: 100 });
      const i = data.rowIds!.indexOf(op.rowid);
      assert.notEqual(i, -1);
      assert.equal(data.rows[i][1], 'John Coltrane');
    });

    await t.test('delete removes a row; undo restores it with all values intact', () => {
      const op = session.deleteRow('albums', 1);
      assert.equal(titleOfRow(db, 1), undefined);
      session.undo(op);
      assert.equal(titleOfRow(db, 1), 'Pastel Blues (Live)');
      const data = db.getTableData({ table: 'albums', page: 0, pageSize: 100 });
      const i = data.rowIds!.indexOf(1);
      assert.equal(data.rows[i][4], 'BLOB (4 bytes)');
      session.redo(op);
      assert.equal(titleOfRow(db, 1), undefined);
      session.undo(op);
    });

    await t.test('save persists edits; revert discards edits made since save', async () => {
      session.updateCell('artists', 1, 'name', 'Nina S.');
      const bytes = session.save();
      if (bytes) {
        // In-memory driver: persisting means handing back the file image.
        const reopened = await driverFactories[0].open(bytes);
        const data = reopened.getTableData({ table: 'artists', page: 0, pageSize: 100 });
        assert.equal(data.rows[data.rowIds!.indexOf(1)][1], 'Nina S.');
        reopened.close();
      }
      session.updateCell('artists', 1, 'name', 'Temporary');
      session.revert();
      const after = db.getTableData({ table: 'artists', page: 0, pageSize: 100 });
      assert.equal(after.rows[after.rowIds!.indexOf(1)][1], 'Nina S.');
    });

    db.close();
  });
}
