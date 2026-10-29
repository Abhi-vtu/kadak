// Runtime configuration — read from window.APP_CONFIG, which /config.js sets
// before the app bundle runs. Editing the deployed config.js changes the API
// address without rebuilding. Plain ESM with no browser imports, so CI and the
// deploy scripts can reuse validateConfig() from Node.

// Returns { baseUrl, error }. baseUrl is '' for same-origin, otherwise an
// absolute http(s) origin (optionally with a path prefix) with no trailing slash.
export function validateConfig(cfg, page) {
  if (!cfg || typeof cfg !== 'object') {
    return { baseUrl: null, error: 'window.APP_CONFIG is missing — /config.js did not load or does not define it.' };
  }
  const raw = cfg.API_BASE_URL;
  if (typeof raw !== 'string') {
    return { baseUrl: null, error: 'APP_CONFIG.API_BASE_URL must be a string ("" means same origin).' };
  }
  const value = raw.trim();
  if (value === '') return { baseUrl: '', error: null };
  if (/YOUR_|[<>{}]/.test(value)) {
    return { baseUrl: null, error: `APP_CONFIG.API_BASE_URL still contains a placeholder: "${value}".` };
  }

  let url;
  try { url = new URL(value); } catch {
    return { baseUrl: null, error: `APP_CONFIG.API_BASE_URL is not a valid URL: "${value}".` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { baseUrl: null, error: `APP_CONFIG.API_BASE_URL must start with http:// or https:// (got "${value}").` };
  }
  if (url.search || url.hash || url.username || url.password) {
    return { baseUrl: null, error: 'APP_CONFIG.API_BASE_URL must not contain a query string, fragment or credentials.' };
  }

  // Checks that need the page's own location (skipped when validating from Node).
  if (page) {
    if (page.protocol === 'https:' && url.protocol === 'http:') {
      return { baseUrl: null, error: `This page is served over HTTPS but APP_CONFIG.API_BASE_URL is plain HTTP ("${value}"); browsers block that.` };
    }
    const local = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    if (local(url.hostname) && !local(page.hostname)) {
      return { baseUrl: null, error: `APP_CONFIG.API_BASE_URL points at ${url.hostname}, which only works on the developer's own machine.` };
    }
  }

  return { baseUrl: (url.origin + url.pathname).replace(/\/+$/, ''), error: null };
}

const fromWindow = typeof window !== 'undefined' ? window.APP_CONFIG : undefined;
const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;

let result = validateConfig(fromWindow, typeof location !== 'undefined' ? location : null);
if (result.error && isDev && fromWindow === undefined) {
  // Dev only: frontend/public/config.js is served by Vite, so this means it was deleted.
  console.warn('[config] ' + result.error + ' Falling back to same-origin (Vite proxy) for development.');
  result = { baseUrl: '', error: null };
}

export const API_BASE_URL = result.baseUrl;
export const configError = result.error;

// Absolute URL for something the backend serves (e.g. an uploaded photo saved as
// "/uploads/<uuid>.webp"). Absolute, data: and blob: URLs pass through unchanged.
export function backendUrl(path) {
  if (!path || typeof path !== 'string') return path;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return (API_BASE_URL || '') + path;
}
