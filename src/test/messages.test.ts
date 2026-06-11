import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { EditSession } from '../edits';
import { handleWebviewMessage, MessageDeps } from '../messages';
import { HostToWebview } from '../protocol';
import { SqlJsDriver } from '../drivers/sqljs';
import { buildSampleBytes } from './helpers';

/** A real driver and session with all outgoing effects captured. */
async function openHarness() {
  const db = await SqlJsDriver.open(await buildSampleBytes());
  const session = new EditSession(db);
  const posted: HostToWebview[] = [];
  const edits: { label: string }[] = [];
  const copies: { text: string; format: string; rowCount: number }[] = [];
  const deps: MessageDeps = {
    fileName: 'sample.db',
    db,
    session,
    post: (msg) => posted.push(msg),
    onEdit: (op, label) => {
      edits.push({ label });
    },
    onCopy: (text, format, rowCount) => {
      copies.push({ text, format, rowCount });
    },
  };
  return { db, session, posted, edits, copies, deps };
}

test('webview message handling', async (t) => {
  await t.test('ready is answered with init: file name and tables', async () => {
    const h = await openHarness();
    await handleWebviewMessage(h.deps, { type: 'ready' });
    assert.equal(h.posted.length, 1);
    const msg = h.posted[0];
    assert.equal(msg.type, 'init');
    if (msg.type === 'init') {
      assert.equal(msg.fileName, 'sample.db');
      assert.deepEqual(
        msg.tables.map((x) => x.name),
        ['albums', 'artists', 'album_titles']
      );
    }
    h.db.close();
  });

  await t.test('getTableData is answered with the requested page', async () => {
    const h = await openHarness();
    await handleWebviewMessage(h.deps, {
      type: 'getTableData',
      request: { table: 'albums', page: 0, pageSize: 2, sortColumn: 'id', sortDir: 'asc' },
    });
    const msg = h.posted[0];
    assert.equal(msg.type, 'tableData');
    if (msg.type === 'tableData') {
      assert.equal(msg.table, 'albums');
      assert.equal(msg.data.totalRows, 3);
      assert.equal(msg.data.rows.length, 2);
    }
    h.db.close();
  });

  await t.test('getSchema is answered with CREATE statements', async () => {
    const h = await openHarness();
    await handleWebviewMessage(h.deps, { type: 'getSchema' });
    const msg = h.posted[0];
    assert.equal(msg.type, 'schema');
    if (msg.type === 'schema') {
      assert.deepEqual(
        msg.entries.map((e) => e.name),
        ['artists', 'albums', 'album_titles']
      );
    }
    h.db.close();
  });

  await t.test('updateCell applies the edit and reports it with a label', async () => {
    const h = await openHarness();
    await handleWebviewMessage(h.deps, {
      type: 'updateCell',
      table: 'albums',
      rowid: 2,
      column: 'title',
      value: 'Kinda Blue',
    });
    assert.deepEqual(
      h.db.queryRow('SELECT title FROM albums WHERE rowid = ?', [2]),
      ['Kinda Blue']
    );
    assert.deepEqual(h.edits, [{ label: 'Edit title' }]);
    h.db.close();
  });

  await t.test('insertRow adds the row and reports the edit', async () => {
    const h = await openHarness();
    await handleWebviewMessage(h.deps, {
      type: 'insertRow',
      table: 'artists',
      values: { name: 'Alice Coltrane' },
    });
    assert.deepEqual(
      h.db.queryRow('SELECT COUNT(*) FROM artists WHERE name = ?', ['Alice Coltrane']),
      [1]
    );
    assert.deepEqual(h.edits, [{ label: 'Insert row' }]);
    h.db.close();
  });

  await t.test('deleteRow removes the row and reports the edit', async () => {
    const h = await openHarness();
    await handleWebviewMessage(h.deps, {
      type: 'deleteRow',
      table: 'artists',
      rowid: 1,
    });
    assert.deepEqual(h.db.queryRow('SELECT COUNT(*) FROM artists', []), [1]);
    assert.deepEqual(h.edits, [{ label: 'Delete row' }]);
    h.db.close();
  });

  await t.test('copyRows hands formatted text to the clipboard callback', async () => {
    const h = await openHarness();
    await handleWebviewMessage(h.deps, {
      type: 'copyRows',
      format: 'csv',
      table: 'artists',
      columns: ['id', 'name'],
      rows: [[1, 'Nina Simone']],
    });
    assert.deepEqual(h.copies, [
      { text: 'id,name\n1,Nina Simone\n', format: 'csv', rowCount: 1 },
    ]);
    h.db.close();
  });

  await t.test('an unknown message type is ignored', async () => {
    const h = await openHarness();
    await handleWebviewMessage(
      h.deps,
      { type: 'nonsense' } as unknown as Parameters<typeof handleWebviewMessage>[1]
    );
    assert.equal(h.posted.length, 0);
    assert.equal(h.edits.length, 0);
    h.db.close();
  });
});
