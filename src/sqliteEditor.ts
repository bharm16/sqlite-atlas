import * as path from 'path';
import * as vscode from 'vscode';
import { SqliteDriver, TableDataRequest } from './driver';
import { NodeSqliteDriver } from './drivers/nodeSqlite';
import { SqlJsDriver } from './drivers/sqljs';
import {
  deserializeOps,
  EditOp,
  EditSession,
  serializeOps,
  SqlValue,
} from './edits';
import { ExportFormat, formatRows } from './export';

class SqliteDocument implements vscode.CustomDocument {
  readonly session: EditSession;

  constructor(
    readonly uri: vscode.Uri,
    readonly db: SqliteDriver,
    readonly diskBacked: boolean
  ) {
    this.session = new EditSession(db);
  }

  dispose(): void {
    // Roll back anything uncommitted, then release the connection.
    this.session.dispose();
    this.db.close();
  }
}

export class SqliteEditorProvider
  implements vscode.CustomEditorProvider<SqliteDocument>
{
  static readonly viewType = 'sqliteAtlas.view';

  private readonly changeEmitter =
    new vscode.EventEmitter<vscode.CustomDocumentEditEvent<SqliteDocument>>();
  readonly onDidChangeCustomDocument = this.changeEmitter.event;

  private readonly panels = new Map<SqliteDocument, Set<vscode.WebviewPanel>>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext
  ): Promise<SqliteDocument> {
    // Prefer the disk-backed driver: it never loads the file into memory,
    // so large databases open instantly. Fall back to sql.js (in-memory)
    // when node:sqlite is missing or the file isn't on local disk.
    let document: SqliteDocument;
    if (uri.scheme === 'file' && NodeSqliteDriver.isAvailable()) {
      document = new SqliteDocument(uri, NodeSqliteDriver.open(uri.fsPath), true);
    } else {
      const bytes = await vscode.workspace.fs.readFile(uri);
      document = new SqliteDocument(uri, await SqlJsDriver.open(bytes), false);
    }

    // Hot-exit restore: the backup is the log of unsaved edit ops; replay
    // them so the document reopens dirty with the edits in place.
    if (openContext.backupId) {
      const json = Buffer.from(
        await vscode.workspace.fs.readFile(vscode.Uri.parse(openContext.backupId))
      ).toString('utf8');
      document.session.replay(deserializeOps(json));
    }
    return document;
  }

  async resolveCustomEditor(
    document: SqliteDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    let set = this.panels.get(document);
    if (!set) {
      set = new Set();
      this.panels.set(document, set);
    }
    set.add(webviewPanel);
    webviewPanel.onDidDispose(() => {
      set!.delete(webviewPanel);
      if (set!.size === 0) {
        this.panels.delete(document);
      }
    });

    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };
    webview.html = this.getHtml(webview);

    webview.onDidReceiveMessage(async (message) => {
      try {
        await this.handleMessage(document, webview, message);
      } catch (err) {
        webview.postMessage({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  private async handleMessage(
    document: SqliteDocument,
    webview: vscode.Webview,
    message: { type: string } & Record<string, unknown>
  ): Promise<void> {
    switch (message.type) {
      case 'ready':
        webview.postMessage({
          type: 'init',
          fileName: path.basename(document.uri.fsPath),
          tables: document.db.listTables(),
        });
        break;
      case 'getTableData': {
        const req = message.request as TableDataRequest;
        webview.postMessage({
          type: 'tableData',
          table: req.table,
          data: document.db.getTableData(req),
        });
        break;
      }
      case 'getSchema':
        webview.postMessage({
          type: 'schema',
          entries: document.db.getSchema(),
        });
        break;
      case 'updateCell': {
        const op = document.session.updateCell(
          message.table as string,
          message.rowid as number,
          message.column as string,
          message.value as SqlValue
        );
        this.pushEdit(document, op, `Edit ${op.column}`);
        break;
      }
      case 'insertRow': {
        const op = document.session.insertRow(
          message.table as string,
          message.values as Record<string, SqlValue>
        );
        this.pushEdit(document, op, 'Insert row');
        break;
      }
      case 'deleteRow': {
        const op = document.session.deleteRow(
          message.table as string,
          message.rowid as number
        );
        this.pushEdit(document, op, 'Delete row');
        break;
      }
      case 'copyRows': {
        const format = message.format as ExportFormat;
        const text = formatRows(
          format,
          message.columns as string[],
          message.rows as unknown[][],
          { table: message.table as string }
        );
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage(
          `Copied ${(message.rows as unknown[]).length} row(s) as ${format.toUpperCase()}`
        );
        break;
      }
    }
  }

  private pushEdit(document: SqliteDocument, op: EditOp, label: string): void {
    this.changeEmitter.fire({
      document,
      label,
      undo: () => {
        document.session.undo(op);
        this.refresh(document);
      },
      redo: () => {
        document.session.redo(op);
        this.refresh(document);
      },
    });
    this.refresh(document);
  }

  /** Tell every panel showing this document to re-query what it displays. */
  private refresh(document: SqliteDocument): void {
    const tables = document.db.listTables();
    for (const panel of this.panels.get(document) ?? []) {
      panel.webview.postMessage({ type: 'dataChanged', tables });
    }
  }

  async saveCustomDocument(document: SqliteDocument): Promise<void> {
    const bytes = document.session.save();
    if (bytes) {
      // In-memory driver: write the committed image back to the file.
      await vscode.workspace.fs.writeFile(document.uri, bytes);
    }
    // Disk-backed driver: COMMIT already persisted in place.
  }

  async saveCustomDocumentAs(
    document: SqliteDocument,
    destination: vscode.Uri
  ): Promise<void> {
    const bytes = document.session.save();
    if (bytes) {
      await vscode.workspace.fs.writeFile(destination, bytes);
    } else {
      await vscode.workspace.fs.copy(document.uri, destination, {
        overwrite: true,
      });
    }
  }

  async revertCustomDocument(document: SqliteDocument): Promise<void> {
    document.session.revert();
    this.refresh(document);
  }

  async backupCustomDocument(
    document: SqliteDocument,
    context: vscode.CustomDocumentBackupContext
  ): Promise<vscode.CustomDocumentBackup> {
    // Back up the log of unsaved edit ops, not a database image: an image
    // taken mid-transaction would miss the uncommitted edits on both
    // drivers (SQLite keeps dirty pages in the pager cache until COMMIT).
    const json = serializeOps(document.session.getPendingOps());
    await vscode.workspace.fs.writeFile(
      context.destination,
      Buffer.from(json, 'utf8')
    );
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(context.destination);
        } catch {
          // Already gone.
        }
      },
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css')
    );
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>SQLite Viewer</title>
</head>
<body>
  <div id="app">
    <aside id="sidebar">
      <div id="file-name"></div>
      <ul id="table-list"></ul>
      <button id="schema-btn">Schema</button>
    </aside>
    <main id="content">
      <div id="toolbar">
        <input id="search" type="text" placeholder="Filter rows…" />
        <button id="add-row" title="Insert a new row" disabled>+ Row</button>
        <button id="delete-row" title="Delete the selected row" disabled>Delete</button>
        <select id="copy-format" title="Copy visible rows to the clipboard">
          <option value="" selected>Copy as…</option>
          <option value="csv">CSV</option>
          <option value="tsv">TSV</option>
          <option value="json">JSON</option>
          <option value="sql">SQL</option>
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
        </select>
        <div id="pager">
          <button id="prev" title="Previous page">‹</button>
          <span id="page-info"></span>
          <button id="next" title="Next page">›</button>
        </div>
      </div>
      <div id="grid-container"></div>
      <div id="status-bar"></div>
    </main>
  </div>
  <div id="insert-overlay" class="hidden">
    <div id="insert-form">
      <h3 id="insert-title"></h3>
      <div id="insert-fields"></div>
      <div id="insert-actions">
        <button id="insert-cancel">Cancel</button>
        <button id="insert-ok">Insert</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
