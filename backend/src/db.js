// PostgreSQL connection pool (DATABASE_URL).
import pg from 'pg';

let _pool = null;
export function db() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set (see backend/.env.example).');
  _pool = new pg.Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  return _pool;
}

// Run fn(client) inside a transaction; rolls back on error.
export async function tx(fn) {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
