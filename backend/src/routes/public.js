// Public (guest) API — no auth.
import { Router } from 'express';
import { db } from '../db.js';
import { buildMenu, getRestaurant } from '../menu.js';

const router = Router();
const RID = 1;

// GET /api/restaurant
router.get('/restaurant', async (_req, res) => {
  try { res.json({ restaurant: await getRestaurant() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/menu — guest menu. Sold-out items are removed entirely (not greyed);
// a category with no available items drops out too. The manager still sees
// everything via /api/manager/menu and can switch items back on.
router.get('/menu', async (_req, res) => {
  try { res.json(await buildMenu({ includeUnavailable: false })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/track { item_id } — log a view for analytics
router.post('/track', async (req, res) => {
  try {
    const itemId = Number(req.body && req.body.item_id);
    if (!Number.isInteger(itemId)) return res.status(400).json({ error: 'item_id required' });
    await db().query('INSERT INTO view_logs (restaurant_id, item_id) VALUES ($1, $2)', [RID, itemId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
