import * as vscode from 'vscode';
import { SqliteEditorProvider } from './sqliteEditor';

/** Exposed so integration tests can drive the provider directly. */
export interface ExtensionApi {
  provider: SqliteEditorProvider;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const provider = new SqliteEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      SqliteEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        // Edits broadcast to every panel showing the same document.
        supportsMultipleEditorsPerDocument: true,
      }
    )
  );
  return { provider };
}

export function deactivate(): void {}
