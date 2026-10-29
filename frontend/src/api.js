// Tiny API client. Base is same-origin in production (backend serves the app);
// in dev, Vite proxies /api to the backend.
const BASE = import.meta.env.VITE_API_BASE || '';
const TOKEN_KEY = 'kadak_mgr_token';

export function getToken() { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } }
export function setToken(t) { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch {} }

async function req(path, { method = 'GET', body, auth = false, form = false } = {}) {
  const headers = {};
  if (!form) headers['content-type'] = 'application/json';
  if (auth) headers['authorization'] = 'Bearer ' + (getToken() || '');
  const res = await fetch(BASE + path, { method, headers, body: form ? body : body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // public
  getMenu: () => req('/api/menu'),
  track: (item_id) => req('/api/track', { method: 'POST', body: { item_id } }).catch(() => {}),
  // manager
  login: (password) => req('/api/manager/login', { method: 'POST', body: { password } }),
  managerMenu: () => req('/api/manager/menu', { auth: true }),
  addCategory: (b) => req('/api/manager/categories', { method: 'POST', body: b, auth: true }),
  updateCategory: (id, b) => req('/api/manager/categories/' + id, { method: 'PATCH', body: b, auth: true }),
  deleteCategory: (id) => req('/api/manager/categories/' + id, { method: 'DELETE', auth: true }),
  addItem: (b) => req('/api/manager/items', { method: 'POST', body: b, auth: true }),
  updateItem: (id, b) => req('/api/manager/items/' + id, { method: 'PATCH', body: b, auth: true }),
  deleteItem: (id) => req('/api/manager/items/' + id, { method: 'DELETE', auth: true }),
  analytics: (period) => req('/api/manager/analytics/top?period=' + period, { auth: true }),
  upload: (file) => {
    const fd = new FormData(); fd.append('image', file);
    return req('/api/manager/upload', { method: 'POST', body: fd, auth: true, form: true });
  },
};
