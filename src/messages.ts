import { SqliteDriver } from './driver';
import { EditOp, EditSession } from './edits';
import { ExportFormat, formatRows } from './export';
import { HostToWebview, WebviewToHost } from './protocol';

/**
 * Everything a webview message handler may touch. All effects flow out
 * through these, so the handlers run under tests without VS Code.
 */
export interface MessageDeps {
  fileName: string;
  db: SqliteDriver;
  session: EditSession;
  /** Post a message back to the webview that sent the request. */
  post(msg: HostToWebview): void;
  /** An edit was applied; label is the human-readable undo entry. */
  onEdit(op: EditOp, label: string): void;
  /** Formatted rows are ready for the clipboard. */
  onCopy(
    text: string,
    format: ExportFormat,
    rowCount: number
  ): void | Promise<void>;
}

/** Handle one message from the webview. Throws on driver/session errors. */
export async function handleWebviewMessage(
  deps: MessageDeps,
  msg: WebviewToHost
): Promise<void> {
  switch (msg.type) {
    case 'ready':
      deps.post({
        type: 'init',
        fileName: deps.fileName,
        tables: deps.db.listTables(),
      });
      break;
    case 'getTableData':
      deps.post({
        type: 'tableData',
        table: msg.request.table,
        data: deps.db.getTableData(msg.request),
      });
      break;
    case 'getSchema':
      deps.post({ type: 'schema', entries: deps.db.getSchema() });
      break;
    case 'updateCell': {
      const op = deps.session.updateCell(
        msg.table,
        msg.rowid,
        msg.column,
        msg.value
      );
      deps.onEdit(op, `Edit ${op.column}`);
      break;
    }
    case 'insertRow': {
      const op = deps.session.insertRow(msg.table, msg.values);
      deps.onEdit(op, 'Insert row');
      break;
    }
    case 'deleteRow': {
      const op = deps.session.deleteRow(msg.table, msg.rowid);
      deps.onEdit(op, 'Delete row');
      break;
    }
    case 'copyRows': {
      const text = formatRows(msg.format, msg.columns, msg.rows, {
        table: msg.table,
      });
      await deps.onCopy(text, msg.format, msg.rows.length);
      break;
    }
    default: {
      // Compile-time exhaustiveness; unknown runtime messages are ignored.
      const unhandled: never = msg;
      void unhandled;
    }
  }
}
