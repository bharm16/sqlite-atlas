// Webview front-end for the SQLite viewer custom editor.
// Communicates with the extension host exclusively via postMessage;
// the message types are defined once in src/protocol.ts and enforced
// here by media/tsconfig.json (checkJs). All UI decisions live in the
// view-model (viewModel.js, loaded first); this file only renders the
// DOM and forwards events.
(function () {
  'use strict';

  /** @typedef {import('../src/protocol').WebviewToHost} WebviewToHost */
  /** @typedef {import('../src/protocol').HostToWebview} HostToWebview */

  const vscode = acquireVsCodeApi();
  const { ViewModel } = /** @type {typeof import('./viewModel')} */ (
    SqliteViewModel
  );
  const vm = new ViewModel();

  /**
   * Post a message to the extension host. Every outgoing message goes
   * through here so the compiler checks it against the protocol.
   * @param {WebviewToHost} msg
   */
  function post(msg) {
    vscode.postMessage(msg);
  }

  const el = {
    fileName: document.getElementById('file-name'),
    tableList: document.getElementById('table-list'),
    schemaBtn: document.getElementById('schema-btn'),
    search: /** @type {HTMLInputElement} */ (document.getElementById('search')),
    addRow: /** @type {HTMLButtonElement} */ (document.getElementById('add-row')),
    deleteRow: /** @type {HTMLButtonElement} */ (document.getElementById('delete-row')),
    copyFormat: /** @type {HTMLSelectElement} */ (document.getElementById('copy-format')),
    prev: /** @type {HTMLButtonElement} */ (document.getElementById('prev')),
    next: /** @type {HTMLButtonElement} */ (document.getElementById('next')),
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
    const msg = /** @type {HostToWebview} */ (event.data);
    switch (msg.type) {
      case 'init':
        el.fileName.textContent = msg.fileName;
        el.fileName.title = msg.fileName;
        vm.applyInit(msg.tables);
        renderTableList();
        if (vm.tables.length > 0) {
          selectTable(vm.tables[0].name);
        } else {
          el.grid.textContent = '';
          el.grid.appendChild(div('empty', 'No tables in this database.'));
        }
        break;
      case 'tableData':
        if (vm.receiveTableData(msg.table, msg.data)) {
          renderGrid(msg.data);
          renderPager();
          updateEditButtons();
        }
        break;
      case 'dataChanged': {
        const requery = vm.receiveDataChanged(msg.tables);
        renderTableList();
        markActiveTable();
        if (requery) {
          requestData();
        }
        break;
      }
      case 'schema':
        renderSchema(msg.entries);
        break;
      case 'error':
        setStatus('Error: ' + msg.message, true);
        break;
    }
  });

  function requestData() {
    post({ type: 'getTableData', request: vm.dataRequest() });
  }

  // ---- Sidebar ----

  function renderTableList() {
    el.tableList.textContent = '';
    for (const table of vm.tables) {
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
        !vm.showingSchema &&
          /** @type {HTMLElement} */ (li).dataset.name === vm.currentTable
      );
    }
  }

  function selectTable(name) {
    vm.selectTable(name);
    markActiveTable();
    requestData();
  }

  // ---- Data grid ----

  function renderGrid(data) {
    el.grid.textContent = '';
    if (data.rows.length === 0) {
      el.grid.appendChild(
        div('empty', vm.filter ? 'No rows match the filter.' : 'Table is empty.')
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
      if (vm.sortColumn === col.name) {
        th.textContent += vm.sortDir === 'asc' ? ' ▲' : ' ▼';
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
        if (vm.rowIds) {
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
    vm.selectRow(rowIndex);
    const tbody = el.grid.querySelector('tbody');
    if (tbody) {
      Array.from(tbody.children).forEach((tr, i) => {
        tr.classList.toggle('selected', i === rowIndex);
      });
    }
    updateEditButtons();
  }

  function sortBy(column) {
    vm.sortBy(column);
    requestData();
  }

  // ---- Cell editing ----

  function beginCellEdit(td, rowIndex, colIndex) {
    if (td.querySelector('input')) {
      return;
    }
    const original = vm.rows[rowIndex][colIndex];
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
      const message = commit
        ? vm.cellEditMessage(rowIndex, colIndex, input.value)
        : null;
      if (message) {
        post(message);
        // The grid refreshes via dataChanged; show the value optimistically.
        renderCell(td, message.value);
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

  // ---- Insert / delete rows ----

  el.addRow.addEventListener('click', () => {
    if (!vm.rowIds && vm.rows.length > 0) {
      return;
    }
    el.insertTitle.textContent = 'Insert into ' + vm.currentTable;
    el.insertFields.textContent = '';
    for (const col of vm.columns) {
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
    const entries = [];
    for (const input of el.insertFields.querySelectorAll('input')) {
      entries.push({ column: input.dataset.column, text: input.value });
    }
    post(vm.insertMessage(entries));
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
    const message = vm.deleteMessage();
    if (message) {
      post(message);
    }
  });

  function updateEditButtons() {
    const buttons = vm.editButtons();
    el.addRow.disabled = buttons.addRowDisabled;
    el.deleteRow.disabled = buttons.deleteRowDisabled;
  }

  // ---- Copy / export ----

  el.copyFormat.addEventListener('change', () => {
    // The option values are exactly the export formats (or the placeholder).
    const format = /** @type {import('../src/protocol').ExportFormat | ''} */ (
      el.copyFormat.value
    );
    el.copyFormat.value = '';
    const message = vm.copyMessage(format);
    if (message) {
      post(message);
    }
  });

  // ---- Schema ----

  el.schemaBtn.addEventListener('click', () => {
    vm.showSchema();
    markActiveTable();
    updateEditButtons();
    post({ type: 'getSchema' });
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
    if (vm.prevPage()) {
      requestData();
    }
  });

  el.next.addEventListener('click', () => {
    if (vm.nextPage()) {
      requestData();
    }
  });

  let filterTimer;
  el.search.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      vm.setFilter(el.search.value);
      if (vm.currentTable && !vm.showingSchema) {
        requestData();
      }
    }, 250);
  });

  function renderPager() {
    const pager = vm.pager();
    el.pageInfo.textContent = pager.label;
    el.prev.disabled = pager.prevDisabled;
    el.next.disabled = pager.nextDisabled;
  }

  function updateStatus() {
    setStatus(vm.statusText());
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

  post({ type: 'ready' });
})();
