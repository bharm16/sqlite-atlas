// Integration tests — run inside a real Extension Development Host via
// @vscode/test-cli. They cover the host side end to end: activation, the
// custom editor claiming .db files, every webview protocol message routed
// through the real handler, the document lifecycle (edit → dirty → save →
// disk → revert), and the hot-exit backup/restore round-trip. Webview DOM
// behavior is covered separately by the view-model unit tests.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ExtensionApi } from '../extension';
import { handleWebviewMessage, MessageDeps } from '../messages';
import { HostToWebview, WebviewToHost } from '../protocol';
import { ExportFormat } from '../export';
import { buildSampleBytes } from '../test/helpers';

const EXTENSION_ID = 'bryce-harmon.sqlite-atlas';
const VIEW_TYPE = 'sqliteAtlas.view';

let counter = 0;
async function makeTempDb(): Promise<vscode.Uri> {
  const file = path.join(os.tmpdir(), `atlas-itest-${process.pid}-${counter++}.db`);
  fs.writeFileSync(file, await buildSampleBytes());
  return vscode.Uri.file(file);
}

async function getApi(): Promise<ExtensionApi> {
  const ext = vscode.extensions.getExtension<ExtensionApi>(EXTENSION_ID);
  assert.ok(ext, `extension ${EXTENSION_ID} not found in dev host`);
  return await ext.activate();
}

/** Drive the real message handler the way resolveCustomEditor wires it. */
function makeHarness(doc: { uri: vscode.Uri; db: MessageDeps['db']; session: MessageDeps['session'] }) {
  const posted: HostToWebview[] = [];
  const edits: string[] = [];
  const copies: { text: string; format: ExportFormat }[] = [];
  const deps: MessageDeps = {
    fileName: path.basename(doc.uri.fsPath),
    db: doc.db,
    session: doc.session,
    post: (msg) => posted.push(msg),
    onEdit: (_op, label) => edits.push(label),
    onCopy: async (text, format) => {
      copies.push({ text, format });
      await vscode.env.clipboard.writeText(text);
    },
  };
  const send = (msg: WebviewToHost) => handleWebviewMessage(deps, msg);
  return { posted, edits, copies, send };
}

describe('SQLite Atlas in the Extension Development Host', () => {
  it('activates and exposes the provider', async () => {
    const api = await getApi();
    assert.ok(api.provider, 'activate() returns the provider');
  });

  it('claims .db files: openWith creates a custom editor tab', async () => {
    const uri = await makeTempDb();
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(tab, 'a tab is active');
    const input = tab.input as vscode.TabInputCustom;
    assert.equal(input.viewType, VIEW_TYPE);
    assert.equal(input.uri.toString(), uri.toString());
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  it('answers every read message in the protocol', async () => {
    const api = await getApi();
    const doc = await api.provider.openCustomDocument(await makeTempDb(), {
      backupId: undefined,
      untitledDocumentData: undefined,
    });
    const h = makeHarness(doc);

    await h.send({ type: 'ready' });
    const init = h.posted.shift();
    assert.equal(init?.type, 'init');
    if (init?.type === 'init') {
      assert.deepEqual(
        init.tables.map((t) => t.name),
        ['albums', 'artists', 'album_titles']
      );
    }

    await h.send({
      type: 'getTableData',
      request: { table: 'albums', page: 0, pageSize: 100 },
    });
    const data = h.posted.shift();
    assert.equal(data?.type, 'tableData');
    if (data?.type === 'tableData') {
      assert.equal(data.data.totalRows, 3);
      assert.deepEqual(data.data.rowIds, [1, 2, 3]);
    }

    await h.send({ type: 'getSchema' });
    const schema = h.posted.shift();
    assert.equal(schema?.type, 'schema');
    if (schema?.type === 'schema') {
      assert.ok(schema.entries[0].sql.startsWith('CREATE TABLE artists'));
    }

    doc.dispose();
  });

  it('routes edit messages, fires undo entries, and saves to disk', async () => {
    const api = await getApi();
    const uri = await makeTempDb();
    const doc = await api.provider.openCustomDocument(uri, {
      backupId: undefined,
      untitledDocumentData: undefined,
    });
    const h = makeHarness(doc);

    await h.send({
      type: 'updateCell',
      table: 'artists',
      rowid: 1,
      column: 'name',
      value: 'Nina Integration',
    });
    await h.send({ type: 'insertRow', table: 'artists', values: { name: 'New Artist' } });
    await h.send({ type: 'deleteRow', table: 'albums', rowid: 3 });
    assert.deepEqual(h.edits, ['Edit name', 'Insert row', 'Delete row']);
    assert.equal(doc.session.getPendingOps().length, 3);

    await api.provider.saveCustomDocument(doc);
    assert.equal(doc.session.getPendingOps().length, 0, 'save clears pending ops');
    doc.dispose();

    // A brand-new document over the same file sees the committed edits.
    const reopened = await api.provider.openCustomDocument(uri, {
      backupId: undefined,
      untitledDocumentData: undefined,
    });
    const h2 = makeHarness(reopened);
    await h2.send({
      type: 'getTableData',
      request: { table: 'artists', page: 0, pageSize: 100 },
    });
    const data = h2.posted.shift();
    if (data?.type === 'tableData') {
      const names = data.data.rows.map((r) => r[1]);
      assert.ok(names.includes('Nina Integration'), 'updated cell persisted');
      assert.ok(names.includes('New Artist'), 'inserted row persisted');
      assert.equal(data.data.totalRows, 3);
    } else {
      assert.fail('expected tableData');
    }
    reopened.dispose();
  });

  it('revert discards pending edits', async () => {
    const api = await getApi();
    const doc = await api.provider.openCustomDocument(await makeTempDb(), {
      backupId: undefined,
      untitledDocumentData: undefined,
    });
    const h = makeHarness(doc);
    await h.send({
      type: 'updateCell',
      table: 'artists',
      rowid: 1,
      column: 'name',
      value: 'Temporary',
    });
    await api.provider.revertCustomDocument(doc);
    assert.equal(doc.session.getPendingOps().length, 0);

    await h.send({
      type: 'getTableData',
      request: { table: 'artists', page: 0, pageSize: 100 },
    });
    const data = h.posted.pop();
    if (data?.type === 'tableData') {
      assert.equal(data.data.rows[0][1], 'Nina Simone');
    } else {
      assert.fail('expected tableData');
    }
    doc.dispose();
  });

  it('hot-exit: backup writes the op log and restore replays it', async () => {
    const api = await getApi();
    const uri = await makeTempDb();
    const doc = await api.provider.openCustomDocument(uri, {
      backupId: undefined,
      untitledDocumentData: undefined,
    });
    const h = makeHarness(doc);
    await h.send({
      type: 'updateCell',
      table: 'artists',
      rowid: 2,
      column: 'name',
      value: 'Miles Restored',
    });

    const dest = vscode.Uri.file(
      path.join(os.tmpdir(), `atlas-itest-backup-${process.pid}-${counter++}.json`)
    );
    const backup = await api.provider.backupCustomDocument(doc, {
      destination: dest,
    } as vscode.CustomDocumentBackupContext);
    doc.dispose(); // window dies; nothing committed

    const restored = await api.provider.openCustomDocument(uri, {
      backupId: backup.id,
      untitledDocumentData: undefined,
    });
    assert.equal(restored.session.getPendingOps().length, 1, 'restored dirty');
    const h2 = makeHarness(restored);
    await h2.send({
      type: 'getTableData',
      request: { table: 'artists', page: 0, pageSize: 100 },
    });
    const data = h2.posted.pop();
    if (data?.type === 'tableData') {
      const row = data.data.rows[data.data.rowIds!.indexOf(2)];
      assert.equal(row[1], 'Miles Restored');
    } else {
      assert.fail('expected tableData');
    }
    await backup.delete();
    restored.dispose();
  });

  it('copyRows formats and reaches the real clipboard', async () => {
    const api = await getApi();
    const doc = await api.provider.openCustomDocument(await makeTempDb(), {
      backupId: undefined,
      untitledDocumentData: undefined,
    });
    const h = makeHarness(doc);
    await h.send({
      type: 'copyRows',
      format: 'csv',
      table: 'artists',
      columns: ['id', 'name'],
      rows: [[1, 'Nina Simone']],
    });
    assert.equal(h.copies[0].format, 'csv');
    assert.equal(await vscode.env.clipboard.readText(), 'id,name\n1,Nina Simone\n');
    doc.dispose();
  });

  it('save-as copies the committed database to the destination', async () => {
    const api = await getApi();
    const uri = await makeTempDb();
    const doc = await api.provider.openCustomDocument(uri, {
      backupId: undefined,
      untitledDocumentData: undefined,
    });
    const h = makeHarness(doc);
    await h.send({
      type: 'updateCell',
      table: 'artists',
      rowid: 1,
      column: 'name',
      value: 'Saved As',
    });
    const dest = vscode.Uri.file(
      path.join(os.tmpdir(), `atlas-itest-saveas-${process.pid}-${counter++}.db`)
    );
    await api.provider.saveCustomDocumentAs(doc, dest);
    doc.dispose();

    const copy = await api.provider.openCustomDocument(dest, {
      backupId: undefined,
      untitledDocumentData: undefined,
    });
    const h2 = makeHarness(copy);
    await h2.send({
      type: 'getTableData',
      request: { table: 'artists', page: 0, pageSize: 100 },
    });
    const data = h2.posted.pop();
    if (data?.type === 'tableData') {
      assert.equal(data.data.rows[0][1], 'Saved As');
    } else {
      assert.fail('expected tableData');
    }
    copy.dispose();
  });

  it('driver/session errors surface instead of being swallowed', async () => {
    const api = await getApi();
    const doc = await api.provider.openCustomDocument(await makeTempDb(), {
      backupId: undefined,
      untitledDocumentData: undefined,
    });
    const h = makeHarness(doc);
    await assert.rejects(
      h.send({
        type: 'updateCell',
        table: 'artists',
        rowid: 999,
        column: 'name',
        value: 'x',
      }),
      /not found/
    );
    doc.dispose();
  });
});
