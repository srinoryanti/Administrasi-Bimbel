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

  // Respons /query: { success, errors, result: [ { results, meta, success } ] }
  function listOf(json) {
    if (Array.isArray(json && json.result)) return json.result;
    if (Array.isArray(json && json.results)) return json.results;
    return [];
  }

  function wrapStmt(sql) {
    return {
      async run(...params) {
        const json = await post('/query', { sql, params });
        const result = listOf(json)[0] || {};
        const meta = result.meta || {};
        return { changes: Number(meta.changes || 0), lastInsertRowid: Number(meta.last_row_id || 0) };
      },
      async get(...params) {
        const json = await post('/query', { sql, params });
        const rows = (listOf(json)[0] || {}).results || [];
        return rows.length ? rows[0] : undefined;
      },
      async all(...params) {
        const json = await post('/query', { sql, params });
        return (listOf(json)[0] || {}).results || [];
      },
    };
  }

  const db = {
    backend: 'd1',
    prepare: wrapStmt,
    async exec(sql) {
      // Multi-statement didukung endpoint /query (dipisah ';' di sisi server).
      await post('/query', { sql: String(sql) });
    },
    // Atomik: seluruh statement dijalankan dalam satu batch D1 (satu transaksi).
    async batch(items) {
      const batch = (items || []).map((it) =>
        typeof it === 'string' ? { sql: it, params: [] } : { sql: it.sql, params: it.params || [] }
      );
      const json = await post('/query', { batch });
      return listOf(json).map((result) => ({
        changes: Number((result.meta && result.meta.changes) || 0),
        lastInsertRowid: Number((result.meta && result.meta.last_row_id) || 0),
      }));
    },
    async close() {},
  };
  return db;
}

module.exports = { createD1Db, createD1BindingDb };

// Driver D1 via binding runtime (wrangler/d1_databases) — dipakai di Cloudflare Workers.
// API-nya identik dengan createD1Db (REST) di atas.
function createD1BindingDb(binding) {
  const normalize = (params) => params.map((p) => (p === undefined ? null : p));

  function wrapStmt(sql) {
    return {
      async run(...params) {
        const info = await binding.prepare(sql).bind(...normalize(params)).run();
        const meta = info.meta || {};
        return {
          changes: Number(meta.changes || 0),
          lastInsertRowid: Number(meta.last_row_id || 0),
        };
      },
      async get(...params) {
        const stmt = binding.prepare(sql).bind(...normalize(params));
        const row = await stmt.first();
        return row === null ? undefined : row;
      },
      async all(...params) {
        const res = await binding.prepare(sql).bind(...normalize(params)).all();
        return res.results || [];
      },
    };
  }

  return {
    backend: 'd1',
    prepare: wrapStmt,
    async exec(sql) {
      // binding.exec() hanya menerima SQL satu baris; pecah manual per-statement
      // (aman: schema tidak memakai ';' di dalam string literal) lalu jalankan via prepare().
      const statements = String(sql)
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        await binding.prepare(stmt).run();
      }
    },
    async batch(items) {
      const stmts = (items || []).map((it) =>
        typeof it === 'string' ? binding.prepare(it) : binding.prepare(it.sql).bind(...normalize(it.params || []))
      );
      const results = await binding.batch(stmts);
      return (results || []).map((r) => ({
        changes: Number((r.meta && r.meta.changes) || 0),
        lastInsertRowid: Number((r.meta && r.meta.last_row_id) || 0),
      }));
    },
    async close() {},
  };
}
