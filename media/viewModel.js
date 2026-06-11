// View-model for the webview: every UI decision (paging, sorting,
// selection, edit/copy payloads) lives here, free of the DOM and the
// message port, so it runs under node:test. main.js renders from it.
// Plain UMD because the webview loads scripts without a module loader.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SqliteViewModel = factory();
  }
})(/** @type {any} */ (globalThis), function () {
  'use strict';

  /** @typedef {import('../src/protocol').WebviewToHost} WebviewToHost */

  const PAGE_SIZE = 100;

  /** Interpret what the user typed: the literal NULL means SQL NULL. */
  function parseEntry(text) {
    return text.toUpperCase() === 'NULL' ? null : text;
  }

  class ViewModel {
    constructor() {
      this.tables = [];
      this.currentTable = null;
      this.page = 0;
      this.sortColumn = null;
      this.sortDir = /** @type {'asc' | 'desc'} */ ('asc');
      this.filter = '';
      this.totalRows = 0;
      this.showingSchema = false;
      // Last received page of data, used for editing and copying.
      this.columns = [];
      this.rows = [];
      this.rowIds = null;
      this.selectedRow = -1;
    }

    applyInit(tables) {
      this.tables = tables;
    }

    selectTable(name) {
      this.currentTable = name;
      this.page = 0;
      this.sortColumn = null;
      this.sortDir = 'asc';
      this.showingSchema = false;
    }

    /**
     * Apply a tableData response. Returns false (no re-render) when the
     * response is stale: for another table, or schema view took over.
     */
    receiveTableData(table, data) {
      if (table !== this.currentTable || this.showingSchema) {
        return false;
      }
      this.totalRows = data.totalRows;
      this.columns = data.columns;
      this.rows = data.rows;
      this.rowIds = data.rowIds || null;
      this.selectedRow = -1;
      return true;
    }

    sortBy(column) {
      if (this.sortColumn === column) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortColumn = column;
        this.sortDir = 'asc';
      }
      this.page = 0;
    }

    showSchema() {
      this.showingSchema = true;
    }

    selectRow(rowIndex) {
      this.selectedRow = rowIndex;
    }

    editButtons() {
      const editable = !this.showingSchema && !!this.rowIds;
      const editableTable =
        !this.showingSchema &&
        this.tables.some(
          (t) => t.name === this.currentTable && t.type === 'table'
        );
      return {
        addRowDisabled: !editableTable,
        deleteRowDisabled: !editable || this.selectedRow === -1,
      };
    }

    /**
     * The deleteRow message for the selected row, or null if none.
     * @returns {WebviewToHost | null}
     */
    deleteMessage() {
      if (this.selectedRow === -1 || !this.rowIds) {
        return null;
      }
      return {
        type: 'deleteRow',
        table: this.currentTable,
        rowid: this.rowIds[this.selectedRow],
      };
    }

    /**
     * The updateCell message for an edited cell, or null when the entry
     * leaves the value unchanged. The literal NULL (any case) means SQL
     * NULL, which is also how NULL cells render back into the editor.
     * @returns {Extract<WebviewToHost, { type: 'updateCell' }> | null}
     */
    cellEditMessage(rowIndex, colIndex, text) {
      const original = this.rows[rowIndex][colIndex];
      if (text === (original === null ? '' : String(original))) {
        return null;
      }
      return {
        type: 'updateCell',
        table: this.currentTable,
        rowid: this.rowIds[rowIndex],
        column: this.columns[colIndex].name,
        value: parseEntry(text),
      };
    }

    setFilter(text) {
      this.filter = text;
      this.page = 0;
    }

    /**
     * The copyRows message: the selected row if there is one, otherwise
     * the visible page. Null when there is nothing copyable.
     * @param {import('../src/protocol').ExportFormat | ''} format
     * @returns {WebviewToHost | null}
     */
    copyMessage(format) {
      if (!format || this.showingSchema || this.rows.length === 0) {
        return null;
      }
      return {
        type: 'copyRows',
        format,
        table: this.currentTable,
        columns: this.columns.map((c) => c.name),
        rows:
          this.selectedRow === -1 ? this.rows : [this.rows[this.selectedRow]],
      };
    }

    /**
     * The insertRow message from form entries; blank fields are omitted
     * so the database fills defaults / NULL.
     * @param {{ column: string, text: string }[]} entries
     * @returns {WebviewToHost}
     */
    insertMessage(entries) {
      /** @type {Record<string, import('../src/protocol').SqlValue>} */
      const values = {};
      for (const entry of entries) {
        if (entry.text !== '') {
          values[entry.column] = parseEntry(entry.text);
        }
      }
      return { type: 'insertRow', table: this.currentTable, values };
    }

    /**
     * An edit, undo, redo, or revert happened (possibly in another
     * panel). Returns whether the visible table must be re-queried.
     */
    receiveDataChanged(tables) {
      this.tables = tables;
      return !!this.currentTable && !this.showingSchema;
    }

    statusText() {
      const first = this.totalRows === 0 ? 0 : this.page * PAGE_SIZE + 1;
      const last = Math.min((this.page + 1) * PAGE_SIZE, this.totalRows);
      return (
        this.currentTable + ': rows ' + first + '–' + last + ' of ' + this.totalRows +
        (this.filter ? ' (filtered)' : '') +
        (this.rowIds ? '' : ' (read-only)')
      );
    }

    totalPages() {
      return Math.max(1, Math.ceil(this.totalRows / PAGE_SIZE));
    }

    /** Move one page back; returns whether the page changed. */
    prevPage() {
      if (this.page === 0) {
        return false;
      }
      this.page--;
      return true;
    }

    /** Move one page forward; returns whether the page changed. */
    nextPage() {
      if (this.page + 1 >= this.totalPages()) {
        return false;
      }
      this.page++;
      return true;
    }

    pager() {
      return {
        label: 'Page ' + (this.page + 1) + ' / ' + this.totalPages(),
        prevDisabled: this.page === 0,
        nextDisabled: this.page + 1 >= this.totalPages(),
      };
    }

    /** The getTableData request for what should be on screen. */
    dataRequest() {
      return {
        table: this.currentTable,
        page: this.page,
        pageSize: PAGE_SIZE,
        sortColumn: this.sortColumn,
        sortDir: this.sortDir,
        filter: this.filter,
      };
    }
  }

  return { ViewModel, PAGE_SIZE, parseEntry };
});
