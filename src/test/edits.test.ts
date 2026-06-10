import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { SqliteDriver } from '../driver';
import { deserializeOps, EditOp, EditSession, serializeOps } from '../edits';
import { buildSampleBytes, driverFactories } from './helpers';

test('edit ops survive a serialization round-trip, including BLOBs', () => {
  const ops: EditOp[] = [
    { kind: 'update', table: 'albums', rowid: 1, column: 'title', oldValue: 'Old', newValue: 'New' },
    {
      kind: 'delete',
      table: 'albums',
      rowid: 2,
      columns: ['id', 'title', 'cover'],
      values: [2, null, new Uint8Array([0xde, 0xad, 0xbe, 0xef])],
    },
  ];
  const restored = deserializeOps(serializeOps(ops));
  assert.deepEqual(restored, ops);
  const blob = (restored[1] as Extract<EditOp, { kind: 'delete' }>).values[2];
  assert.ok(blob instanceof Uint8Array, 'BLOB round-trips as Uint8Array');
});

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

    await t.test('tracks pending ops for hot-exit backup until save or revert', () => {
      assert.equal(session.getPendingOps().length, 0, 'clean after previous save/revert');
      const op1 = session.updateCell('artists', 1, 'name', 'Nina Backup');
      const op2 = session.insertRow('artists', { name: 'Backup Artist' });
      assert.equal(session.getPendingOps().length, 2);
      session.undo(op2);
      assert.equal(session.getPendingOps().length, 1);
      session.redo(op2);
      assert.deepEqual(session.getPendingOps(), [op1, op2]);
      session.revert();
      assert.equal(session.getPendingOps().length, 0);
    });

    await t.test('pending ops replay onto a fresh connection (hot-exit restore)', async () => {
      const bytes = await buildSampleBytes();
      const crashed = await open(bytes);
      const s1 = new EditSession(crashed);
      s1.updateCell('artists', 1, 'name', 'Recovered Nina');
      s1.deleteRow('albums', 2);
      const backup = serializeOps(s1.getPendingOps());
      crashed.close(); // window dies — nothing was committed

      const fresh = await open(bytes);
      const s2 = new EditSession(fresh);
      s2.replay(deserializeOps(backup));
      const artists = fresh.getTableData({ table: 'artists', page: 0, pageSize: 100 });
      assert.equal(artists.rows[artists.rowIds!.indexOf(1)][1], 'Recovered Nina');
      assert.equal(
        fresh.getTableData({ table: 'albums', page: 0, pageSize: 100 }).totalRows,
        2
      );
      // The restored document is dirty again: the replayed ops are pending,
      // so the next hot exit can back them up too.
      assert.equal(s2.getPendingOps().length, 2);
      fresh.close();
    });

    db.close();
  });
}
