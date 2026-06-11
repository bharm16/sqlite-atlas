import { quoteIdent } from './driver';

export type ExportFormat = 'csv' | 'tsv' | 'json' | 'sql' | 'markdown' | 'html';

export interface ExportOptions {
  /** Target table name for SQL INSERT output. */
  table?: string;
}

export function formatRows(
  format: ExportFormat,
  columns: string[],
  rows: unknown[][],
  options: ExportOptions = {}
): string {
  switch (format) {
    case 'csv':
      return delimited(columns, rows, ',');
    case 'tsv':
      return delimited(columns, rows, '\t');
    case 'json':
      return JSON.stringify(
        rows.map((row) =>
          Object.fromEntries(columns.map((c, i) => [c, row[i] ?? null]))
        ),
        null,
        2
      );
    case 'sql': {
      const table = quoteIdent(options.table ?? 'table');
      const cols = columns.map(quoteIdent).join(', ');
      return rows
        .map(
          (row) =>
            `INSERT INTO ${table} (${cols}) VALUES (${row.map(sqlLiteral).join(', ')});\n`
        )
        .join('');
    }
    case 'markdown': {
      const line = (cells: string[]) => '| ' + cells.join(' | ') + ' |\n';
      return (
        line(columns.map(mdCell)) +
        line(columns.map(() => '---')) +
        rows.map((row) => line(row.map((v) => mdCell(v)))).join('')
      );
    }
    case 'html': {
      const cells = (row: unknown[], tag: 'th' | 'td') =>
        row.map((v) => `<${tag}>${htmlEscape(v)}</${tag}>`).join('');
      return (
        '<table>\n' +
        `<thead><tr>${cells(columns, 'th')}</tr></thead>\n` +
        '<tbody>\n' +
        rows.map((row) => `<tr>${cells(row, 'td')}</tr>\n`).join('') +
        '</tbody>\n' +
        '</table>\n'
      );
    }
    default:
      throw new Error(`Unknown export format: ${format}`);
  }
}

function mdCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function htmlEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function delimited(columns: string[], rows: unknown[][], sep: string): string {
  const lines = [columns, ...rows].map((row) =>
    row.map((v) => csvField(v, sep)).join(sep)
  );
  return lines.join('\n') + '\n';
}

function csvField(value: unknown, sep: string): string {
  if (value === null || value === undefined) {
    return '';
  }
  const s = String(value);
  if (s.includes(sep) || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
