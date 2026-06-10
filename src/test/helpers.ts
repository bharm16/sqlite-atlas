import initSqlJs from 'sql.js';
import * as path from 'path';
import { SqliteDriver } from '../driver';
import { SqlJsDriver } from '../drivers/sqljs';

export async function buildSampleBytes(): Promise<Uint8Array> {
  const SQL = await initSqlJs({
    locateFile: (file: string) =>
      path.join(path.dirname(require.resolve('sql.js')), file),
  });
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE artists (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE albums (
      id INTEGER PRIMARY KEY,
      artist_id INTEGER REFERENCES artists(id),
      title TEXT NOT NULL,
      year INTEGER,
      cover BLOB
    );
    CREATE VIEW album_titles AS SELECT title FROM albums;
  `);
  db.run(`INSERT INTO artists (id, name) VALUES (1, 'Nina Simone'), (2, 'Miles Davis')`);
  db.run(
    `INSERT INTO albums (id, artist_id, title, year, cover) VALUES
     (1, 1, 'Pastel Blues', 1965, x'DEADBEEF'),
     (2, 2, 'Kind of Blue', 1959, NULL),
     (3, 2, 'Sketches of Spain', 1960, NULL)`
  );
  const bytes = db.export();
  db.close();
  return bytes;
}

export interface DriverFactory {
  name: string;
  /** Open a driver over the given database image. Throws Error('driver unavailable') to skip. */
  open(bytes: Uint8Array): Promise<SqliteDriver>;
}

export const driverFactories: DriverFactory[] = [
  {
    name: 'sqljs',
    open: (bytes) => SqlJsDriver.open(bytes),
  },
];
