import {
  SchemaEntry,
  TableData,
  TableDataRequest,
  TableInfo,
} from './driver';
import { SqlValue } from './edits';
import { ExportFormat } from './export';

// Re-exported so the webview reaches every protocol type via one import.
export type { SqlValue } from './edits';
export type { ExportFormat } from './export';

/**
 * The webview message protocol, defined once. Both ends consume these
 * types: the extension host through src/messages.ts, the webview through
 * JSDoc imports in media/main.js (checked by media/tsconfig.json).
 */

/** Messages the webview posts to the extension host. */
export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'getTableData'; request: TableDataRequest }
  | { type: 'getSchema' }
  | {
      type: 'updateCell';
      table: string;
      rowid: number;
      column: string;
      value: SqlValue;
    }
  | { type: 'insertRow'; table: string; values: Record<string, SqlValue> }
  | { type: 'deleteRow'; table: string; rowid: number }
  | {
      type: 'copyRows';
      format: ExportFormat;
      table: string;
      columns: string[];
      rows: unknown[][];
    };

/** Messages the extension host posts to the webview. */
export type HostToWebview =
  | { type: 'init'; fileName: string; tables: TableInfo[] }
  | { type: 'tableData'; table: string; data: TableData }
  | { type: 'dataChanged'; tables: TableInfo[] }
  | { type: 'schema'; entries: SchemaEntry[] }
  | { type: 'error'; message: string };
