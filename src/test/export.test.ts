import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { formatRows } from '../export';

const COLS = ['id', 'name', 'note'];

test('csv: quotes fields containing commas, quotes, and newlines; NULL is empty', () => {
  const rows = [
    [1, 'plain', 'no escaping'],
    [2, 'has,comma', 'has "quotes"'],
    [3, 'line\nbreak', null],
  ];
  assert.equal(
    formatRows('csv', COLS, rows),
    'id,name,note\n' +
      '1,plain,no escaping\n' +
      '2,"has,comma","has ""quotes"""\n' +
      '3,"line\nbreak",\n'
  );
});

test('json: array of objects keyed by column, types and NULL preserved', () => {
  const rows = [
    [1, 'Nina', 4.5],
    [2, null, 0],
  ];
  assert.deepEqual(JSON.parse(formatRows('json', ['id', 'name', 'rating'], rows)), [
    { id: 1, name: 'Nina', rating: 4.5 },
    { id: 2, name: null, rating: 0 },
  ]);
});

test('sql: INSERT statements with escaped string literals and NULL', () => {
  const rows = [
    [1, "O'Brien", null],
    [2, 'plain', 3.5],
  ];
  assert.equal(
    formatRows('sql', ['id', 'name', 'rating'], rows, { table: 'my table' }),
    `INSERT INTO "my table" ("id", "name", "rating") VALUES (1, 'O''Brien', NULL);\n` +
      `INSERT INTO "my table" ("id", "name", "rating") VALUES (2, 'plain', 3.5);\n`
  );
});

test('markdown: header row, separator, pipes and newlines escaped, NULL empty', () => {
  const rows = [
    [1, 'a|b', 'two\nlines'],
    [2, 'plain', null],
  ];
  assert.equal(
    formatRows('markdown', COLS, rows),
    '| id | name | note |\n' +
      '| --- | --- | --- |\n' +
      '| 1 | a\\|b | two<br>lines |\n' +
      '| 2 | plain |  |\n'
  );
});

test('html: table markup with entity-escaped cells, NULL empty', () => {
  const rows = [[1, '<b>&"bold"</b>', null]];
  assert.equal(
    formatRows('html', COLS, rows),
    '<table>\n' +
      '<thead><tr><th>id</th><th>name</th><th>note</th></tr></thead>\n' +
      '<tbody>\n' +
      '<tr><td>1</td><td>&lt;b&gt;&amp;&quot;bold&quot;&lt;/b&gt;</td><td></td></tr>\n' +
      '</tbody>\n' +
      '</table>\n'
  );
});

test('tsv: tab-separated, quotes only when field contains tab/quote/newline', () => {
  const rows = [
    [1, 'has,comma', 'tab\there'],
    [2, 'plain', null],
  ];
  assert.equal(
    formatRows('tsv', COLS, rows),
    'id\tname\tnote\n' +
      '1\thas,comma\t"tab\there"\n' +
      '2\tplain\t\n'
  );
});
