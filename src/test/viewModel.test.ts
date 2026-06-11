import { test } from 'node:test';
import * as assert from 'node:assert/strict';

// The view-model ships as a plain UMD script the webview loads before
// main.js; tests load it the CommonJS way. Same file, same code path.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ViewModel, PAGE_SIZE } = require('../../media/viewModel.js');

const sampleTables = [
  { name: 'albums', type: 'table', rowCount: 3 },
  { name: 'album_titles', type: 'view', rowCount: 3 },
];

test('webview view-model', async (t) => {
  await t.test('selecting a table resets paging and sort and yields the request', () => {
    const vm = new ViewModel();
    vm.applyInit(sampleTables);
    vm.selectTable('albums');
    assert.deepEqual(vm.dataRequest(), {
      table: 'albums',
      page: 0,
      pageSize: PAGE_SIZE,
      sortColumn: null,
      sortDir: 'asc',
      filter: '',
    });
  });

  await t.test('table data applies only when it matches the current table', () => {
    const vm = new ViewModel();
    vm.applyInit(sampleTables);
    vm.selectTable('albums');
    vm.selectedRow = 2;

    const stale = vm.receiveTableData('artists', {
      columns: [], rows: [['x']], totalRows: 1,
    });
    assert.equal(stale, false);
    assert.deepEqual(vm.rows, []);

    const applied = vm.receiveTableData('albums', {
      columns: [{ name: 'id', type: 'INTEGER', pk: true }],
      rows: [[1], [2]],
      totalRows: 2,
      rowIds: [1, 2],
    });
    assert.equal(applied, true);
    assert.equal(vm.totalRows, 2);
    assert.deepEqual(vm.rowIds, [1, 2]);
    assert.equal(vm.selectedRow, -1);
  });

  await t.test('sorting toggles direction on repeat and resets the page', () => {
    const vm = new ViewModel();
    vm.applyInit(sampleTables);
    vm.selectTable('albums');
    vm.page = 3;
    vm.sortBy('year');
    assert.deepEqual(
      [vm.sortColumn, vm.sortDir, vm.page],
      ['year', 'asc', 0]
    );
    vm.sortBy('year');
    assert.equal(vm.sortDir, 'desc');
    vm.sortBy('title');
    assert.deepEqual([vm.sortColumn, vm.sortDir], ['title', 'asc']);
  });

  await t.test('paging respects the bounds derived from totalRows', () => {
    const vm = new ViewModel();
    vm.applyInit(sampleTables);
    vm.selectTable('albums');
    vm.totalRows = PAGE_SIZE * 2 + 1; // three pages

    assert.equal(vm.prevPage(), false); // already at the first page
    assert.equal(vm.nextPage(), true);
    assert.equal(vm.nextPage(), true);
    assert.equal(vm.nextPage(), false); // already at the last page
    assert.equal(vm.page, 2);
    assert.equal(vm.prevPage(), true);
    assert.equal(vm.page, 1);

    const pager = vm.pager();
    assert.deepEqual(pager, {
      label: 'Page 2 / 3',
      prevDisabled: false,
      nextDisabled: false,
    });
  });

  await t.test('filtering resets the page and marks the status line', () => {
    const vm = new ViewModel();
    vm.applyInit(sampleTables);
    vm.selectTable('albums');
    vm.receiveTableData('albums', {
      columns: [{ name: 'id', type: 'INTEGER', pk: true }],
      rows: [[1], [2]],
      totalRows: 2,
      rowIds: [1, 2],
    });
    vm.page = 1;
    vm.setFilter('blue');
    assert.equal(vm.page, 0);
    assert.equal(vm.dataRequest().filter, 'blue');
    assert.equal(vm.statusText(), 'albums: rows 1–2 of 2 (filtered)');
  });

  await t.test('status marks read-only tables and empty results', () => {
    const vm = new ViewModel();
    vm.applyInit(sampleTables);
    vm.selectTable('album_titles');
    vm.receiveTableData('album_titles', {
      columns: [{ name: 'title', type: 'TEXT', pk: false }],
      rows: [['Pastel Blues']],
      totalRows: 1,
    });
    assert.equal(vm.statusText(), 'album_titles: rows 1–1 of 1 (read-only)');

    vm.receiveTableData('album_titles', { columns: [], rows: [], totalRows: 0 });
    assert.equal(vm.statusText(), 'album_titles: rows 0–0 of 0 (read-only)');
  });

  await t.test('edit buttons follow table type, rowids, selection, and schema view', () => {
    const vm = new ViewModel();
    vm.applyInit(sampleTables);

    vm.selectTable('album_titles'); // a view: nothing editable
    vm.receiveTableData('album_titles', {
      columns: [{ name: 'title', type: 'TEXT', pk: false }],
      rows: [['x']],
      totalRows: 1,
    });
    assert.deepEqual(vm.editButtons(), { addRowDisabled: true, deleteRowDisabled: true });

    vm.selectTable('albums'); // a real table: insert allowed, delete needs a selection
    vm.receiveTableData('albums', {
      columns: [{ name: 'id', type: 'INTEGER', pk: true }],
      rows: [[1], [2]],
      totalRows: 2,
      rowIds: [10, 20],
    });
    assert.deepEqual(vm.editButtons(), { addRowDisabled: false, deleteRowDisabled: true });
    vm.selectRow(1);
    assert.deepEqual(vm.editButtons(), { addRowDisabled: false, deleteRowDisabled: false });

    vm.showSchema(); // schema view: nothing editable
    assert.deepEqual(vm.editButtons(), { addRowDisabled: true, deleteRowDisabled: true });
  });

  await t.test('delete targets the selected row by rowid', () => {
    const vm = new ViewModel();
    vm.applyInit(sampleTables);
    vm.selectTable('albums');
    vm.receiveTableData('albums', {
      columns: [{ name: 'id', type: 'INTEGER', pk: true }],
      rows: [[1], [2]],
      totalRows: 2,
      rowIds: [10, 20],
    });
    assert.equal(vm.deleteMessage(), null); // nothing selected yet
    vm.selectRow(1);
    assert.deepEqual(vm.deleteMessage(), {
      type: 'deleteRow',
      table: 'albums',
      rowid: 20,
    });
  });

  await t.test('cell edits commit only real changes; the NULL literal means NULL', () => {
    const vm = new ViewModel();
    vm.applyInit(sampleTables);
    vm.selectTable('albums');
    vm.receiveTableData('albums', {
      columns: [
        { name: 'id', type: 'INTEGER', pk: true },
        { name: 'title', type: 'TEXT', pk: false },
      ],
      rows: [[1, 'Pastel Blues'], [2, null]],
      totalRows: 2,
      rowIds: [10, 20],
    });
    assert.equal(vm.cellEditMessage(0, 1, 'Pastel Blues'), null); // unchanged
    assert.equal(vm.cellEditMessage(1, 1, ''), null); // NULL rendered as '' and left alone
    assert.deepEqual(vm.cellEditMessage(0, 1, 'null'), {
      type: 'updateCell',
      table: 'albums',
      rowid: 10,
      column: 'title',
      value: null,
    });
    assert.deepEqual(vm.cellEditMessage(0, 1, 'Wild Is the Wind'), {
      type: 'updateCell',
      table: 'albums',
      rowid: 10,
      column: 'title',
      value: 'Wild Is the Wind',
    });
  });

  await t.test('copy takes the selected row, else the visible page; blocked when empty or in schema view', () => {
    const vm = new ViewModel();
    vm.applyInit(sampleTables);
    vm.selectTable('albums');
    assert.equal(vm.copyMessage('csv'), null); // nothing loaded yet
    vm.receiveTableData('albums', {
      columns: [
        { name: 'id', type: 'INTEGER', pk: true },
        { name: 'title', type: 'TEXT', pk: false },
      ],
      rows: [[1, 'Pastel Blues'], [2, 'Kind of Blue']],
      totalRows: 2,
      rowIds: [10, 20],
    });
    assert.deepEqual(vm.copyMessage('csv'), {
      type: 'copyRows',
      format: 'csv',
      table: 'albums',
      columns: ['id', 'title'],
      rows: [[1, 'Pastel Blues'], [2, 'Kind of Blue']],
    });
    vm.selectRow(0);
    assert.deepEqual(vm.copyMessage('json')?.rows, [[1, 'Pastel Blues']]);
    vm.showSchema();
    assert.equal(vm.copyMessage('csv'), null);
  });

  await t.test('insert builds a row from non-blank fields only', () => {
    const vm = new ViewModel();
    vm.applyInit(sampleTables);
    vm.selectTable('albums');
    assert.deepEqual(
      vm.insertMessage([
        { column: 'title', text: 'Nina at Newport' },
        { column: 'year', text: '' },
        { column: 'artist_id', text: 'NULL' },
      ]),
      {
        type: 'insertRow',
        table: 'albums',
        values: { title: 'Nina at Newport', artist_id: null },
      }
    );
  });

  await t.test('dataChanged refreshes tables and asks for a re-query only when showing one', () => {
    const vm = new ViewModel();
    vm.applyInit(sampleTables);
    vm.selectTable('albums');
    const renamed = [{ name: 'albums', type: 'table', rowCount: 4 }];
    assert.equal(vm.receiveDataChanged(renamed), true);
    assert.deepEqual(vm.tables, renamed);
    vm.showSchema();
    assert.equal(vm.receiveDataChanged(renamed), false);
  });
});
