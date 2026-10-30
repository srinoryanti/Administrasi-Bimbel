'use strict';

// Driver Cloudflare D1 via REST API resmi.
// Bentuk API disamakan dengan driver lokal (prepare().run/get/all async),
// sehingga seluruh routes dapat menulis `await` tanpa peduli backend.
// D1 REST: POST /accounts/{account_id}/d1/database/{database_id}/query
// Mendukung multi-statement dalam satu body (digunakan untuk schema init).

function createD1Db({ accountId, apiToken, databaseId }) {
  if (!accountId || !apiToken || !databaseId) {
    throw new Error('D1: D1_ACCOUNT_ID, D1_API_TOKEN, dan D1_DATABASE_ID wajib diisi.');
  }
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;

  async function post(pathSuffix, body) {
    const res = await fetch(`${base}${pathSuffix}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.success === false) {
      const msg = json && json.errors && json.errors[0]
        ? json.errors[0].message
        : `D1 HTTP ${res.status}`;
      const err = new Error(`D1: ${msg}`);
      err.status = res.status;
      // Normalisasi agar errorHandler middleware mengenali bentrok constraint.
      if (/constraint|unique|foreign key|not null/i.test(msg)) err.code = 'SQLITE_CONSTRAINT';
      throw err;
    }
    return json;
  }

  function rowsOf(result) {
    // result: { results: [...], meta: { last_row_id, changes, ... } }
    return result && Array.isArray(result.results) ? result.results : [];
  }

  function metaOf(result) {
    return (result && result.meta) || {};
  }

  function wrapStmt(sql) {
    return {
      async run(...params) {
        const json = await post('/query', { sql: [sql], params });
        const result = rowsOf(json)[0] || {};
        const meta = metaOf(result);
        return { changes: Number(meta.changes || 0), lastInsertRowid: Number(meta.last_row_id || 0) };
      },
      async get(...params) {
        const json = await post('/query', { sql: [sql], params });
        const result = rowsOf(json)[0] || {};
        const rows = rowsOf(result);
        return rows.length ? rows[0] : undefined;
      },
      async all(...params) {
        const json = await post('/query', { sql: [sql], params });
        const result = rowsOf(json)[0] || {};
        return rowsOf(result);
      },
    };
  }

  const db = {
    backend: 'd1',
    prepare: wrapStmt,
    async exec(sql) {
      // Multi-statement. D1 tidak mendukung PRAGMA transaksional; dipakai untuk schema.
      const statements = String(sql)
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!statements.length) return;
      await post('/query', { sql: statements });
    },
    // Atomik: seluruh statement dijalankan dalam satu batch D1 (satu transaksi).
    async batch(items) {
      const list = items.map((it) => (typeof it === 'string' ? { sql: it, params: [] } : it));
      const sql = list.map((it) => it.sql);
      const params = list.map((it) => it.params || []);
      const json = await post('/query', { sql, params });
      const results = rowsOf(json);
      return results.map((result) => ({
        changes: Number((result.meta && result.meta.changes) || 0),
        lastInsertRowid: Number((result.meta && result.meta.last_row_id) || 0),
      }));
    },
    async close() {},
  };
  return db;
}

module.exports = { createD1Db };
