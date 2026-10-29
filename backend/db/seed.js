// Creates the schema (idempotent) and loads the Kadak Thane menu if empty.
//   node db/seed.js      (uses DATABASE_URL from backend/.env)
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, tx } from '../src/db.js';
import { insertCategories, insertItems, insertVariants, resetSequences } from './seed-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  await db().query(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
  console.log('✓ schema ready');

  const have = await db().query('SELECT COUNT(*) AS n FROM menu_items');
  if (Number(have.rows[0].n) > 0) {
    console.log(`• already has ${have.rows[0].n} items — leaving data as is.`);
    return;
  }

  const seed = JSON.parse(readFileSync(join(__dirname, 'seed-data.json'), 'utf8'));
  const r = seed.restaurant;
  await tx(async (client) => {
    await client.query(
      `INSERT INTO restaurants (id, name, logo_url, theme_color, qr_slug, address, hours, tax_percent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.name, r.logo_url, r.theme_color, r.qr_slug, r.address, r.hours, r.tax_percent]
    );
    await insertCategories(client, seed.categories, r.id);
    await insertItems(client, seed.items);
    await insertVariants(client, seed.variants);
    await resetSequences(client);
  });
  console.log(`✓ seeded ${seed.categories.length} categories, ${seed.items.length} items, ${seed.variants.length} variants`);
}
main()
  .catch((e) => { console.error('seed failed:', e); process.exitCode = 1; })
  .finally(() => db().end());
