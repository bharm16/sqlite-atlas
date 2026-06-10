// Generates sample/chinook-lite.db for manually testing the extension (F5).
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

async function main() {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(path.dirname(require.resolve('sql.js')), file),
  });
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE artists (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE albums (
      id INTEGER PRIMARY KEY,
      artist_id INTEGER REFERENCES artists(id),
      title TEXT NOT NULL,
      year INTEGER
    );
    CREATE TABLE tracks (
      id INTEGER PRIMARY KEY,
      album_id INTEGER REFERENCES albums(id),
      name TEXT NOT NULL,
      duration_ms INTEGER,
      rating REAL
    );
    CREATE VIEW track_listing AS
      SELECT t.name AS track, a.title AS album, ar.name AS artist
      FROM tracks t
      JOIN albums a ON a.id = t.album_id
      JOIN artists ar ON ar.id = a.artist_id;
  `);

  const artists = ['Aurora Skies', 'The Midnight Owls', 'Cedar & Pine', 'Velvet Antenna'];
  artists.forEach((name, i) => {
    db.run('INSERT INTO artists (id, name) VALUES (?, ?)', [i + 1, name]);
  });

  let albumId = 0;
  let trackId = 0;
  for (let artistId = 1; artistId <= artists.length; artistId++) {
    for (let a = 1; a <= 3; a++) {
      albumId++;
      db.run('INSERT INTO albums (id, artist_id, title, year) VALUES (?, ?, ?, ?)', [
        albumId, artistId, `Album ${a} by ${artists[artistId - 1]}`, 1990 + ((albumId * 3) % 35),
      ]);
      for (let t = 1; t <= 12; t++) {
        trackId++;
        db.run(
          'INSERT INTO tracks (id, album_id, name, duration_ms, rating) VALUES (?, ?, ?, ?, ?)',
          [trackId, albumId, `Track ${t}`, 120000 + ((trackId * 7919) % 240000), ((trackId * 13) % 50) / 10]
        );
      }
    }
  }

  const outDir = path.join(__dirname, '..', 'sample');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'chinook-lite.db');
  fs.writeFileSync(outFile, Buffer.from(db.export()));
  db.close();
  console.log(`Wrote ${outFile} (${trackId} tracks, ${albumId} albums, ${artists.length} artists)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
