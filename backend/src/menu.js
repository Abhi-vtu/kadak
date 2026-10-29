// Shared: assemble the full menu (restaurant + categories + items + variants),
// grouped by world → category, ready for both guest and manager.
import { db } from './db.js';

const RID = 1; // single-restaurant MVP

export async function getRestaurant() {
  const r = await db().query('SELECT * FROM restaurants WHERE id = $1', [RID]);
  return r.rows[0] || null;
}

export async function buildMenu({ includeUnavailable = true } = {}) {
  const client = db();
  const [restaurant, cats, items, vars] = await Promise.all([
    getRestaurant(),
    client.query('SELECT * FROM categories WHERE restaurant_id = $1 ORDER BY display_order, id', [RID]),
    client.query('SELECT * FROM menu_items ORDER BY display_order, id'),
    client.query('SELECT * FROM variants ORDER BY display_order, id'),
  ]);

  const varsByItem = new Map();
  for (const v of vars.rows) {
    if (!varsByItem.has(v.item_id)) varsByItem.set(v.item_id, []);
    varsByItem.get(v.item_id).push({ id: v.id, name: v.name, price: v.price });
  }
  const itemsByCat = new Map();
  for (const it of items.rows) {
    if (!includeUnavailable && Number(it.is_available) !== 1) continue;
    if (!itemsByCat.has(it.category_id)) itemsByCat.set(it.category_id, []);
    itemsByCat.get(it.category_id).push({
      id: it.id, category_id: it.category_id, name: it.name, description: it.description || '',
      price: it.price, image_url: it.image_url || null, icon: it.icon || 'plate', color: it.color || 'yellow',
      is_available: Number(it.is_available) === 1,
      is_veg: it.is_veg === null || it.is_veg === undefined ? null : Number(it.is_veg) === 1,
      is_bestseller: Number(it.is_bestseller) === 1,
      is_new: Number(it.is_new) === 1,
      is_signature: Number(it.is_signature) === 1,
      display_order: it.display_order,
      variants: varsByItem.get(it.id) || [],
    });
  }

  // group by world, preserving category order; label groups from category world
  const WORLD_LABEL = { food: 'FOOD', drinks: 'DRINKS' };
  const worlds = ['food', 'drinks'];
  const groups = worlds.map((w) => ({
    world: w,
    label: WORLD_LABEL[w],
    categories: cats.rows
      .filter((c) => c.world === w)
      .map((c) => ({
        id: c.id, name: c.name, slug: c.slug, world: c.world, sec_desc: c.sec_desc || '',
        display_order: c.display_order,
        items: itemsByCat.get(c.id) || [],
      }))
      .filter((c) => c.items.length || includeUnavailable),
  })).filter((g) => g.categories.length);

  return { restaurant, groups };
}
