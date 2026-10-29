// Manager auth — a single shared password (MANAGER_PASSWORD env).
// The client sends it as `Authorization: Bearer <password>` on every manager call.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkPassword(pw) {
  const expected = process.env.MANAGER_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(String(pw || ''), expected);
}

export function requireManager(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!checkPassword(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
