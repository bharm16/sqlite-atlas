// Webview front-end for the SQLite viewer custom editor.
// Communicates with the extension host exclusively via postMessage.
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const PAGE_SIZE = 100;

  const state = {
    tables: [],
    currentTable: null,
    page: 0,
    sortColumn: null,
    sortDir: 'asc',
    filter: '',
    totalRows: 0,
    showingSchema: false,
    // Last received page of data, used for editing and copying.
    columns: [],
    rows: [],
    rowIds: null,
    selectedRow: -1,
  };

  const el = {
    fileName: document.getElementById('file-name'),
    tableList: document.getElementById('table-list'),
    schemaBtn: document.getElementById('schema-btn'),
    search: document.getElementById('search'),
    addRow: document.getElementById('add-row'),
    deleteRow: document.getElementById('delete-row'),
    copyFormat: document.getElementById('copy-format'),
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    pageInfo: document.getElementById('page-info'),
    grid: document.getElementById('grid-container'),
    statusBar: document.getElementById('status-bar'),
    insertOverlay: document.getElementById('insert-overlay'),
    insertTitle: document.getElementById('insert-title'),
    insertFields: document.getElementById('insert-fields'),
    insertOk: document.getElementById('insert-ok'),
    insertCancel: document.getElementById('insert-cancel'),
  };

  // ---- Messaging ----

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        el.fileName.textContent = msg.fileName;
        el.fileName.title = msg.fileName;
        state.tables = msg.tables;
        renderTableList();
        if (state.tables.length > 0) {
          selectTable(state.tables[0].name);
        } else {
          el.grid.textContent = '';
          el.grid.appendChild(div('empty', 'No tables in this database.'));
        }
        break;
      case 'tableData':
        if (msg.table === state.currentTable && !state.showingSchema) {
          state.totalRows = msg.data.totalRows;
          state.columns = msg.data.columns;
          state.rows = msg.data.rows;
          state.rowIds = msg.data.rowIds || null;
          state.selectedRow = -1;
          renderGrid(msg.data);
          renderPager();
          updateEditButtons();
        }
        break;
      case 'dataChanged':
        // An edit, undo, redo, or revert happened (possibly in another
        // panel). Update sidebar counts and re-query what we display.
        state.tables = msg.tables;
        renderTableList();
        markActiveTable();
        if (state.currentTable && !state.showingSchema) {
          requestData();
        }
        break;
      case 'schema':
        renderSchema(msg.entries);
        break;
      case 'error':
        setStatus('Error: ' + msg.message, true);
        break;
    }
  });

  function requestData() {
    vscode.postMessage({
      type: 'getTableData',
      request: {
        table: state.currentTable,
        page: state.page,
        pageSize: PAGE_SIZE,
        sortColumn: state.sortColumn,
        sortDir: state.sortDir,
        filter: state.filter,
      },
    });
  }

  // ---- Sidebar ----

  function renderTableList() {
    el.tableList.textContent = '';
    for (const table of state.tables) {
      const li = document.createElement('li');
      li.dataset.name = table.name;

      const name = document.createElement('span');
      name.textContent = table.name;
      name.title = table.name;
      li.appendChild(name);

      const meta = document.createElement('span');
      if (table.type === 'view') {
        meta.className = 'view-tag';
        meta.textContent = 'view';
      } else {
        meta.className = 'row-count';
        meta.textContent = table.rowCount >= 0 ? String(table.rowCount) : '?';
      }
      li.appendChild(meta);

      li.addEventListener('click', () => selectTable(table.name));
      el.tableList.appendChild(li);
    }
  }

  function markActiveTable() {
    for (const li of el.tableList.children) {
      li.classList.toggle(
        'active',
        !state.showingSchema && li.dataset.name === state.currentTable
      );
    }
  }

  function selectTable(name) {
    state.currentTable = name;
    state.page = 0;
    state.sortColumn = null;
    state.sortDir = 'asc';
    state.showingSchema = false;
    markActiveTable();
    requestData();
  }

  // ---- Data grid ----

  function renderGrid(data) {
    el.grid.textContent = '';
    if (data.rows.length === 0) {
      el.grid.appendChild(
        div('empty', state.filter ? 'No rows match the filter.' : 'Table is empty.')
      );
      updateStatus();
      return;
    }

    const table = document.createElement('table');
    table.className = 'grid';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const col of data.columns) {
      const th = document.createElement('th');
      th.textContent = col.name + (col.pk ? ' 🔑' : '');
      if (state.sortColumn === col.name) {
        th.textContent += state.sortDir === 'asc' ? ' ▲' : ' ▼';
      }
      const type = document.createElement('span');
      type.className = 'col-type';
      type.textContent = col.type;
      th.appendChild(type);
      th.addEventListener('click', () => sortBy(col.name));
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    data.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      row.forEach((value, colIndex) => {
        const td = document.createElement('td');
        renderCell(td, value);
        td.addEventListener('click', () => selectRow(rowIndex));
        if (state.rowIds) {
          td.addEventListener('dblclick', () =>
            beginCellEdit(td, rowIndex, colIndex)
          );
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    el.grid.appendChild(table);
    updateStatus();
  }

  function renderCell(td, value) {
    if (value === null) {
      td.className = 'null';
      td.textContent = 'NULL';
    } else {
      td.className = '';
      td.textContent = String(value);
      td.title = String(value);
    }
  }

  function selectRow(rowIndex) {
    state.selectedRow = rowIndex;
    const tbody = el.grid.querySelector('tbody');
    if (tbody) {
      Array.from(tbody.children).forEach((tr, i) => {
        tr.classList.toggle('selected', i === rowIndex);
      });
    }
    updateEditButtons();
  }

  function sortBy(column) {
    if (state.sortColumn === column) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortColumn = column;
      state.sortDir = 'asc';
    }
    state.page = 0;
    requestData();
  }

  // ---- Cell editing ----

  function beginCellEdit(td, rowIndex, colIndex) {
    if (td.querySelector('input')) {
      return;
    }
    const original = state.rows[rowIndex][colIndex];
    const input = document.createElement('input');
    input.className = 'cell-editor';
    input.value = original === null ? '' : String(original);
    input.title = 'Enter commits, Esc cancels. Type NULL for NULL.';
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = (commit) => {
      if (finished) {
        return;
      }
      finished = true;
      if (commit && input.value !== (original === null ? '' : String(original))) {
        vscode.postMessage({
          type: 'updateCell',
          table: state.currentTable,
          rowid: state.rowIds[rowIndex],
          column: state.columns[colIndex].name,
          value: parseEntry(input.value),
        });
        // The grid refreshes via dataChanged; show the value optimistically.
        renderCell(td, parseEntry(input.value));
      } else {
        renderCell(td, original);
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        finish(true);
      } else if (e.key === 'Escape') {
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  /** Interpret what the user typed: the literal NULL means SQL NULL. */
  function parseEntry(text) {
    return text.toUpperCase() === 'NULL' ? null : text;
  }

  // ---- Insert / delete rows ----

  el.addRow.addEventListener('click', () => {
    if (!state.rowIds && state.rows.length > 0) {
      return;
    }
    el.insertTitle.textContent = 'Insert into ' + state.currentTable;
    el.insertFields.textContent = '';
    for (const col of state.columns) {
      const label = document.createElement('label');
      const caption = document.createElement('span');
      caption.textContent = col.name + (col.type ? ' (' + col.type + ')' : '');
      const input = document.createElement('input');
      input.dataset.column = col.name;
      input.placeholder = 'leave blank for default / NULL';
      label.appendChild(caption);
      label.appendChild(input);
      el.insertFields.appendChild(label);
    }
    el.insertOverlay.classList.remove('hidden');
    const first = el.insertFields.querySelector('input');
    if (first) {
      first.focus();
    }
  });

  el.insertCancel.addEventListener('click', closeInsertForm);

  el.insertOk.addEventListener('click', () => {
    const values = {};
    for (const input of el.insertFields.querySelectorAll('input')) {
      if (input.value !== '') {
        values[input.dataset.column] = parseEntry(input.value);
      }
    }
    vscode.postMessage({ type: 'insertRow', table: state.currentTable, values });
    closeInsertForm();
  });

  el.insertOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeInsertForm();
    } else if (e.key === 'Enter') {
      el.insertOk.click();
    }
  });

  function closeInsertForm() {
    el.insertOverlay.classList.add('hidden');
  }

  el.deleteRow.addEventListener('click', () => {
    if (state.selectedRow === -1 || !state.rowIds) {
      return;
    }
    vscode.postMessage({
      type: 'deleteRow',
      table: state.currentTable,
      rowid: state.rowIds[state.selectedRow],
    });
  });

  function updateEditButtons() {
    const editable = !state.showingSchema && !!state.rowIds;
    const editableTable =
      !state.showingSchema &&
      state.tables.some(
        (t) => t.name === state.currentTable && t.type === 'table'
      );
    el.addRow.disabled = !editableTable;
    el.deleteRow.disabled = !editable || state.selectedRow === -1;
  }

  // ---- Copy / export ----

  el.copyFormat.addEventListener('change', () => {
    const format = el.copyFormat.value;
    el.copyFormat.value = '';
    if (!format || state.showingSchema || state.rows.length === 0) {
      return;
    }
    // Copy the selected row if there is one, otherwise the visible page.
    const rows =
      state.selectedRow === -1 ? state.rows : [state.rows[state.selectedRow]];
    vscode.postMessage({
      type: 'copyRows',
      format,
      table: state.currentTable,
      columns: state.columns.map((c) => c.name),
      rows,
    });
  });

  // ---- Schema ----

  el.schemaBtn.addEventListener('click', () => {
    state.showingSchema = true;
    markActiveTable();
    updateEditButtons();
    vscode.postMessage({ type: 'getSchema' });
  });

  function renderSchema(entries) {
    el.grid.textContent = '';
    const pre = document.createElement('pre');
    pre.className = 'schema';
    pre.textContent = entries.map((e) => e.sql + ';').join('\n\n');
    el.grid.appendChild(pre);
    el.pageInfo.textContent = '';
    el.prev.disabled = true;
    el.next.disabled = true;
    setStatus(entries.length + ' schema objects');
  }

  // ---- Paging, filtering, status ----

  el.prev.addEventListener('click', () => {
    if (state.page > 0) {
      state.page--;
      requestData();
    }
  });

  el.next.addEventListener('click', () => {
    if ((state.page + 1) * PAGE_SIZE < state.totalRows) {
      state.page++;
      requestData();
    }
  });

  let filterTimer;
  el.search.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      state.filter = el.search.value;
      state.page = 0;
      if (state.currentTable && !state.showingSchema) {
        requestData();
      }
    }, 250);
  });

  function renderPager() {
    const totalPages = Math.max(1, Math.ceil(state.totalRows / PAGE_SIZE));
    el.pageInfo.textContent = 'Page ' + (state.page + 1) + ' / ' + totalPages;
    el.prev.disabled = state.page === 0;
    el.next.disabled = state.page + 1 >= totalPages;
  }

  function updateStatus() {
    const first = state.totalRows === 0 ? 0 : state.page * PAGE_SIZE + 1;
    const last = Math.min((state.page + 1) * PAGE_SIZE, state.totalRows);
    setStatus(
      state.currentTable + ': rows ' + first + '–' + last + ' of ' + state.totalRows +
        (state.filter ? ' (filtered)' : '') +
        (state.rowIds ? '' : ' (read-only)')
    );
  }

  function setStatus(text, isError) {
    el.statusBar.textContent = text;
    el.statusBar.classList.toggle('status-error', !!isError);
  }

  function div(className, text) {
    const d = document.createElement('div');
    d.className = className;
    d.textContent = text;
    return d;
  }

  vscode.postMessage({ type: 'ready' });
})();
