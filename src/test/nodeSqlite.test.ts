import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { EditSession } from '../edits';
import { NodeSqliteDriver } from '../drivers/nodeSqlite';
import { buildSampleBytes, writeTempDb } from './helpers';

test('node-sqlite: save commits edits to the file on disk', { skip: !NodeSqliteDriver.isAvailable() }, async () => {
  const file = writeTempDb(await buildSampleBytes());

  const db = NodeSqliteDriver.open(file);
  const session = new EditSession(db);
  session.updateCell('artists', 1, 'name', 'Nina S.');

  // Uncommitted edits must not be visible to a second connection.
  const before = NodeSqliteDriver.open(file);
  assert.equal(before.queryRow('SELECT name FROM artists WHERE id = 1')![0], 'Nina Simone');
  before.close();

  const bytes = session.save();
  assert.equal(bytes, undefined, 'disk-backed driver persists in place');
  db.close();

  const after = NodeSqliteDriver.open(file);
  assert.equal(after.queryRow('SELECT name FROM artists WHERE id = 1')![0], 'Nina S.');
  after.close();
});
