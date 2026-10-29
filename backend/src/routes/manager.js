// Manager API — all routes require the Bearer password (except /login).
import { Router } from 'express';
import multer from 'multer';
import { db, tx } from '../db.js';
import { buildMenu } from '../menu.js';
import { checkPassword, requireManager } from '../auth.js';
import { saveImage, deleteImage } from '../storage.js';

const router = Router();
const RID = 1;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

const COLORS = ['yellow', 'orange', 'red', 'green', 'blue'];
const TZ = process.env.APP_TZ || 'Asia/Kolkata'; // "today" in analytics follows the restaurant's clock

// POST /api/manager/login { password } -> { token }
router.post('/login', (req, res) => {
  const pw = req.body && req.body.password;
  if (!checkPassword(pw)) return res.status(401).json({ error: 'Wrong password' });
  res.json({ token: pw }); // token IS the password (stateless MVP)
});

// Everything below requires auth
router.use(requireManager);

// GET /api/manager/menu — full menu incl. sold-out
router.get('/menu', async (_req, res) => {
  try { res.json(await buildMenu({ includeUnavailable: true })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- Categories ---- */
router.post('/categories', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const world = b.world === 'drinks' ? 'drinks' : 'food';
    const slug = String(b.slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || ('cat' + Date.now());
    const ord = Number.isFinite(Number(b.display_order)) && b.display_order != null ? Number(b.display_order)
      : Number((await db().query('SELECT COALESCE(MAX(display_order),0)+1 AS n FROM categories')).rows[0].n);
    const r = await db().query(
      'INSERT INTO categories (restaurant_id, name, slug, world, sec_desc, display_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [RID, name, slug, world, String(b.sec_desc || ''), ord]
    );
    res.json({ id: r.rows[0].id, created: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch('/categories/:id', async (req, res) => {
  try {
    const id = Number(req.params.id); const b = req.body || {};
    const sets = [], args = [];
    const put = (c, v) => { args.push(v); sets.push(`${c} = $${args.length}`); };
    if (b.name != null) put('name', String(b.name).trim());
    if (b.world != null) put('world', b.world === 'drinks' ? 'drinks' : 'food');
    if (b.sec_desc != null) put('sec_desc', String(b.sec_desc));
    if (b.display_order != null) put('display_order', Number(b.display_order) || 0);
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    args.push(id);
    const r = await db().query(`UPDATE categories SET ${sets.join(', ')} WHERE id = $${args.length}`, args);
    if (!r.rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ id, updated: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    // items + variants go with it (ON DELETE CASCADE); clean up their photos too
    const imgs = await db().query('SELECT image_url FROM menu_items WHERE category_id = $1 AND image_url IS NOT NULL', [id]);
    await db().query('DELETE FROM categories WHERE id = $1', [id]);
    await Promise.all(imgs.rows.map((r) => deleteImage(r.image_url)));
    res.json({ id, deleted: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---- Items ---- */
async function replaceVariants(client, itemId, variants) {
  await client.query('DELETE FROM variants WHERE item_id = $1', [itemId]);
  const list = Array.isArray(variants) ? variants : [];
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    const name = String(v.name || '').trim();
    const price = Math.round(Number(v.price));
    if (!name || !Number.isFinite(price)) continue;
    await client.query(
      'INSERT INTO variants (item_id, name, price, display_order) VALUES ($1,$2,$3,$4)',
      [itemId, name, price, i + 1]
    );
  }
}

router.post('/items', async (req, res) => {
  try {
    const b = req.body || {};
    const category_id = Number(b.category_id);
    const name = String(b.name || '').trim();
    if (!Number.isInteger(category_id)) return res.status(400).json({ error: 'category_id required' });
    if (!name) return res.status(400).json({ error: 'name required' });
    const hasVariants = Array.isArray(b.variants) && b.variants.length;
    const price = hasVariants ? null : Math.round(Number(b.price));
    if (!hasVariants && (!Number.isFinite(price) || price < 0)) return res.status(400).json({ error: 'valid price or variants required' });
    const color = COLORS.includes(b.color) ? b.color : 'yellow';
    const id = await tx(async (client) => {
      const ord = Number((await client.query('SELECT COALESCE(MAX(display_order),0)+1 AS n FROM menu_items WHERE category_id = $1', [category_id])).rows[0].n);
      const r = await client.query(
        `INSERT INTO menu_items (category_id, name, description, price, image_url, icon, color, is_available, is_veg, is_bestseller, is_new, is_signature, display_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [category_id, name, String(b.description || ''), price, b.image_url || null,
          String(b.icon || 'plate'), color,
          b.is_available === false ? 0 : 1,
          b.is_veg === true ? 1 : b.is_veg === false ? 0 : null,
          b.is_bestseller ? 1 : 0, b.is_new ? 1 : 0, b.is_signature ? 1 : 0, ord]
      );
      const newId = r.rows[0].id;
      if (hasVariants) await replaceVariants(client, newId, b.variants);
      return newId;
    });
    res.json({ id, created: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch('/items/:id', async (req, res) => {
  try {
    const id = Number(req.params.id); const b = req.body || {};
    const sets = [], args = [];
    const put = (c, v) => { args.push(v); sets.push(`${c} = $${args.length}`); };
    if (b.name != null) put('name', String(b.name).trim());
    if (b.description != null) put('description', String(b.description));
    if (b.category_id != null) put('category_id', Number(b.category_id));
    if (b.image_url !== undefined) put('image_url', b.image_url || null);
    if (b.icon != null) put('icon', String(b.icon));
    if (b.color != null) put('color', COLORS.includes(b.color) ? b.color : 'yellow');
    if (typeof b.is_available === 'boolean') put('is_available', b.is_available ? 1 : 0);
    if (b.is_veg !== undefined) put('is_veg', b.is_veg === true ? 1 : b.is_veg === false ? 0 : null);
    if (b.is_bestseller !== undefined) put('is_bestseller', b.is_bestseller ? 1 : 0);
    if (b.is_new !== undefined) put('is_new', b.is_new ? 1 : 0);
    if (b.is_signature !== undefined) put('is_signature', b.is_signature ? 1 : 0);
    if (b.display_order != null) put('display_order', Number(b.display_order) || 0);
    // price / variants
    if (Array.isArray(b.variants) && b.variants.length) put('price', null);
    if (b.price !== undefined && !(Array.isArray(b.variants) && b.variants.length)) {
      const price = b.price === null ? null : Math.round(Number(b.price));
      put('price', price);
    }
    sets.push('updated_at = now()');
    args.push(id);

    const result = await tx(async (client) => {
      const old = await client.query('SELECT image_url FROM menu_items WHERE id = $1 FOR UPDATE', [id]);
      if (!old.rowCount) return null;
      await client.query(`UPDATE menu_items SET ${sets.join(', ')} WHERE id = $${args.length}`, args);
      if (Array.isArray(b.variants)) await replaceVariants(client, id, b.variants);
      return { oldImage: old.rows[0].image_url };
    });
    if (!result) return res.status(404).json({ error: 'not found' });
    if (b.image_url !== undefined && result.oldImage && result.oldImage !== b.image_url) await deleteImage(result.oldImage);
    res.json({ id, updated: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/items/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await db().query('DELETE FROM menu_items WHERE id = $1 RETURNING image_url', [id]);
    if (r.rowCount) await deleteImage(r.rows[0].image_url);
    res.json({ id, deleted: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---- Image upload (local disk) ---- */
router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no image file' });
    const url = await saveImage(req.file.buffer);
    res.json({ url });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

/* ---- Analytics ---- */
// GET /api/manager/analytics/top?period=today|7d|all
router.get('/analytics/top', async (req, res) => {
  try {
    const period = req.query.period || 'today';
    let where = '', args = [];
    if (period === 'today') { where = 'WHERE (v.ts AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date'; args = [TZ]; }
    else if (period === '7d') where = "WHERE v.ts >= now() - interval '7 days'";
    const r = await db().query(
      `SELECT v.item_id, m.name, COUNT(*) AS views
       FROM view_logs v JOIN menu_items m ON m.id = v.item_id
       ${where}
       GROUP BY v.item_id, m.name ORDER BY views DESC LIMIT 10`,
      args
    );
    const totalRow = await db().query(`SELECT COUNT(*) AS n FROM view_logs v ${where}`, args);
    res.json({ period, total_views: Number(totalRow.rows[0].n), top: r.rows.map((x) => ({ item_id: x.item_id, name: x.name, views: Number(x.views) })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
