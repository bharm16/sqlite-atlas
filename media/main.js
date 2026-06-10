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
  };

  const el = {
    fileName: document.getElementById('file-name'),
    tableList: document.getElementById('table-list'),
    schemaBtn: document.getElementById('schema-btn'),
    search: document.getElementById('search'),
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    pageInfo: document.getElementById('page-info'),
    grid: document.getElementById('grid-container'),
    statusBar: document.getElementById('status-bar'),
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
          renderGrid(msg.data);
          renderPager();
        }
        break;
      case 'schema':
        renderSchema(msg.entries);
        break;
      case 'error':
        el.grid.textContent = '';
        el.grid.appendChild(div('error', 'Error: ' + msg.message));
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

  function selectTable(name) {
    state.currentTable = name;
    state.page = 0;
    state.sortColumn = null;
    state.sortDir = 'asc';
    state.showingSchema = false;
    for (const li of el.tableList.children) {
      li.classList.toggle('active', li.dataset.name === name);
    }
    requestData();
  }

  // ---- Data grid ----

  function renderGrid(data) {
    el.grid.textContent = '';
    if (data.rows.length === 0) {
      el.grid.appendChild(div('empty', state.filter ? 'No rows match the filter.' : 'Table is empty.'));
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
    for (const row of data.rows) {
      const tr = document.createElement('tr');
      for (const value of row) {
        const td = document.createElement('td');
        if (value === null) {
          td.className = 'null';
          td.textContent = 'NULL';
        } else {
          td.textContent = String(value);
          td.title = String(value);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    el.grid.appendChild(table);
    updateStatus();
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

  // ---- Schema ----

  el.schemaBtn.addEventListener('click', () => {
    state.showingSchema = true;
    for (const li of el.tableList.children) {
      li.classList.remove('active');
    }
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
    el.statusBar.textContent = entries.length + ' schema objects';
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
    el.statusBar.textContent =
      state.currentTable + ': rows ' + first + '–' + last + ' of ' + state.totalRows +
      (state.filter ? ' (filtered)' : '');
  }

  function div(className, text) {
    const d = document.createElement('div');
    d.className = className;
    d.textContent = text;
    return d;
  }

  vscode.postMessage({ type: 'ready' });
})();
