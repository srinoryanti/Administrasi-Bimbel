let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, options = {}) {
  const opts = {
    method: options.method || 'GET',
    credentials: 'include',
    headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
  };
  let res;
  try {
    res = await fetch(path.startsWith('/api') ? path : `/api${path}`, opts);
  } catch (e) {
    throw new Error('Tidak dapat terhubung ke server. Pastikan backend berjalan.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-json */ }
  if (res.status === 401 && onUnauthorized) onUnauthorized();
  if (!res.ok) {
    const err = new Error((data && data.error) || `Kesalahan ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const del = (p, body) => api(p, { method: 'DELETE', body });
