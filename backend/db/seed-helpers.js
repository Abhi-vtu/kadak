// Shared inserts for seed.js and reseed-food.js. Rows keep their ids from
// seed-data.json, so the identity counters are bumped afterwards.

export async function insertCategories(client, categories, restaurantId) {
  for (const c of categories) {
    await client.query(
      'INSERT INTO categories (id, restaurant_id, name, slug, world, sec_desc, display_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [c.id, restaurantId, c.name, c.slug, c.world, c.sec_desc, c.display_order]
    );
  }
}

export async function insertItems(client, items) {
  for (const it of items) {
    await client.query(
      `INSERT INTO menu_items (id, category_id, name, description, price, image_url, icon, color, is_available, is_veg, is_bestseller, is_new, is_signature, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [it.id, it.category_id, it.name, it.description, it.price, it.image_url, it.icon, it.color,
        it.is_available, it.is_veg, it.is_bestseller, it.is_new, it.is_signature, it.display_order]
    );
  }
}

export async function insertVariants(client, variants) {
  for (const v of variants) {
    await client.query(
      'INSERT INTO variants (id, item_id, name, price, display_order) VALUES ($1,$2,$3,$4,$5)',
      [v.id, v.item_id, v.name, v.price, v.display_order]
    );
  }
}

// Move each table's id counter past the highest id, so new rows don't collide.
export async function resetSequences(client) {
  for (const t of ['restaurants', 'categories', 'menu_items', 'variants']) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`
    );
  }
}
