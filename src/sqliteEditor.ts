import * as path from 'path';
import * as vscode from 'vscode';
import { SqliteDb, TableDataRequest } from './database';

class SqliteDocument implements vscode.CustomDocument {
  constructor(
    readonly uri: vscode.Uri,
    readonly db: SqliteDb
  ) {}

  dispose(): void {
    this.db.close();
  }
}

export class SqliteEditorProvider
  implements vscode.CustomReadonlyEditorProvider<SqliteDocument>
{
  static readonly viewType = 'sqliteViewer.view';

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(uri: vscode.Uri): Promise<SqliteDocument> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const db = await SqliteDb.open(bytes);
    return new SqliteDocument(uri, db);
  }

  async resolveCustomEditor(
    document: SqliteDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
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
        }
      } catch (err) {
        webview.postMessage({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
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
