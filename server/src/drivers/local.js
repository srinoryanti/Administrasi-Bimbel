'use strict';
const path = require('path');
const fs = require('fs');

// Driver lokal berbasis node:sqlite (DatabaseSync).
// Menyamakan bentuk API dengan driver D1 (async) sehingga seluruh kode routes
// dapat menulis `await stmt.run(...)` / `.get(...)` / `.all(...)` tanpa peduli backend.
function createLocalDb(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const raw = new DatabaseSync(dbPath);
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec('PRAGMA journal_mode = WAL;');

  function wrapStmt(sql) {
    return {
      run(...params) {
        return Promise.resolve(raw.prepare(sql).run(...params));
      },
      get(...params) {
        return Promise.resolve(raw.prepare(sql).get(...params));
      },
      all(...params) {
        return Promise.resolve(raw.prepare(sql).all(...params));
      },
    };
  }

  const db = {
    backend: 'sqlite',
    prepare: wrapStmt,
    exec(sql) {
      raw.exec(sql);
      return Promise.resolve();
    },
    // Atomik secara lokal. items: array of { sql, params } atau string sql.
    batch(items) {
      const list = items.map((it) => (typeof it === 'string' ? { sql: it, params: [] } : it));
      raw.exec('BEGIN');
      try {
        const out = list.map(({ sql, params = [] }) => raw.prepare(sql).run(...params));
        raw.exec('COMMIT');
        return Promise.resolve(out);
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch (_) { /* ignore */ }
        return Promise.reject(e);
      }
    },
    close() {
      raw.close();
      return Promise.resolve();
    },
  };
  return db;
}

module.exports = { createLocalDb };
