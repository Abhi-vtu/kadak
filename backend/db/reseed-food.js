// Replace the FOOD side of the menu with the current seed-data.json, leaving
// DRINKS completely untouched. Runs in one transaction — all or nothing.
//   node db/reseed-food.js      (uses DATABASE_URL from backend/.env)
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, tx } from '../src/db.js';
import { insertCategories, insertItems, insertVariants, resetSequences } from './seed-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // make sure schema exists (no-op if already there)
  await db().query(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));

  const seed = JSON.parse(readFileSync(join(__dirname, 'seed-data.json'), 'utf8'));
  const foodCats = seed.categories.filter((c) => c.world === 'food');
  const foodCatIds = new Set(foodCats.map((c) => c.id));
  const foodItems = seed.items.filter((it) => foodCatIds.has(it.category_id));
  const foodItemIds = new Set(foodItems.map((it) => it.id));
  const foodVars = seed.variants.filter((v) => foodItemIds.has(v.item_id));

  const before = await db().query("SELECT COUNT(*) AS n FROM categories WHERE world='drinks'");
  const drinkCatsBefore = Number(before.rows[0].n);

  await tx(async (client) => {
    // 1) delete ONLY existing food — items and variants go with it (ON DELETE CASCADE)
    await client.query("DELETE FROM categories WHERE world='food'");
    console.log('✓ old food cleared (drinks left untouched)');

    // 2) insert the new food from seed-data.json
    await insertCategories(client, foodCats, 1);
    await insertItems(client, foodItems);
    await insertVariants(client, foodVars);
    await resetSequences(client);
  });

  const after = await db().query(
    `SELECT (SELECT COUNT(*) FROM categories WHERE world='drinks') AS drink_cats,
            (SELECT COUNT(*) FROM menu_items mi JOIN categories c ON c.id=mi.category_id WHERE c.world='drinks') AS drink_items`
  );
  console.log(`✓ new food: ${foodCats.length} categories, ${foodItems.length} items, ${foodVars.length} variants`);
  console.log(`✓ drinks untouched: ${after.rows[0].drink_cats} categories (was ${drinkCatsBefore}), ${after.rows[0].drink_items} items`);
}
main()
  .catch((e) => { console.error('reseed-food failed:', e); process.exitCode = 1; })
  .finally(() => db().end());
