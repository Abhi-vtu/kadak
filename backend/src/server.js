import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import publicRoutes from './routes/public.js';
import managerRoutes from './routes/manager.js';
import { db } from './db.js';
import { UPLOAD_DIR, UPLOAD_URL } from './storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  try { await db().query('SELECT 1'); res.json({ ok: true }); }
  catch (e) { res.status(503).json({ ok: false, error: e.message }); }
});
app.use('/api', publicRoutes);
app.use('/api/manager', managerRoutes);

// Uploaded item photos. File names are random UUIDs, so they can be cached hard.
app.use(UPLOAD_URL, express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(UPLOAD_URL, (_req, res) => res.status(404).end());

// Serve the built React app (frontend/dist) and let client-side routing handle /manager.
const dist = join(__dirname, '..', '..', 'frontend', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(join(dist, 'index.html'));
  });
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Kadak AirMenu API on :${PORT}`));
