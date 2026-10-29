# Kadak AirMenu — full-stack

A digital menu for **Kadak Brewpub, Thane** with a password-protected manager
dashboard. Same shape as your recruitment tracker: a `/backend` and a `/frontend`,
one GitHub repo, backed by **PostgreSQL** with item photos stored as files on
the server.

- **Guest view** — `/` — public, no login. Food/Drinks tabs, veg/non-veg filter,
  bestseller & new tags, sold-out items greyed out, pour/size prices.
- **Manager dashboard** — `/manager` — password-gated. Add/edit/delete categories
  & items, flip availability instantly, upload photos, see today's most-viewed items.
- **API** — Express + `pg` (PostgreSQL). Photos are resized with `sharp` and served from `/uploads`.

The guest never sees the manager — it's a separate route behind a password.

---

## Data model

`restaurants` → `categories` (each has a `world`: **food** or **drinks**) →
`menu_items` → `variants` (pours/sizes/brand tiers). Plus `view_logs` for analytics.
This extends your draft with `world` (so the Food/Drinks tabs work) and a `variants`
table (beer pours, 30/60/180ml pegs, glass/bottle).

```
restaurants(id, name, logo_url, theme_color, qr_slug, address, hours, tax_percent)
categories(id, restaurant_id, name, slug, world, sec_desc, display_order)
menu_items(id, category_id, name, description, price, image_url, icon, color,
           is_available, is_veg, is_bestseller, is_new, is_signature, display_order, …)
variants(id, item_id, name, price, display_order)
view_logs(id, restaurant_id, item_id, ts)
```

`price` is null when an item is priced by variants. `is_veg` is 1/0/null (null = drinks).

---

## Folder structure

```
kadak-airmenu/
├── render.yaml            # Render blueprint (one web service)
├── package.json           # convenience scripts
├── backend/
│   ├── src/
│   │   ├── server.js      # Express app; also serves the built frontend
│   │   ├── db.js  menu.js  auth.js  storage.js
│   │   └── routes/ public.js  manager.js
│   ├── db/ schema.sql  seed.js  seed-helpers.js  seed-data.json   # the full Thane menu
│   └── .env.example
└── frontend/              # Vite + React
    ├── src/
    │   ├── pages/ Guest.jsx  Manager.jsx
    │   ├── components/ Visual.jsx
    │   ├── api.js  assets.js  styles.css  main.jsx
    └── .env.example
```

---

## API reference

Public:
- `GET /api/menu` → `{ restaurant, groups:[{world,label,categories:[{…,items:[{…,variants}]}]}] }`
- `GET /api/restaurant`
- `POST /api/track` `{ item_id }` → logs a view

Manager (all need header `Authorization: Bearer <MANAGER_PASSWORD>`):
- `POST /api/manager/login` `{ password }` → `{ token }`
- `GET /api/manager/menu`
- `POST/PATCH/DELETE /api/manager/categories[/:id]`
- `POST/PATCH/DELETE /api/manager/items[/:id]`  (PATCH toggles `is_available`, edits price/variants/flags)
- `POST /api/manager/upload` (multipart `image`) → `{ url }`  (resized to WebP, saved in `backend/uploads`)
- `GET /api/manager/analytics/top?period=today|7d|all`

---

## A. Run locally

Needs **Node 20+** and **PostgreSQL 14+**.

1. Create a database and user (in `psql` as the postgres superuser):

   ```sql
   CREATE USER kadak WITH PASSWORD 'kadak';
   CREATE DATABASE kadak OWNER kadak;
   ```

2. Install, configure, seed:

   ```bash
   npm run install:all
   cp backend/.env.example backend/.env    # check DATABASE_URL, set MANAGER_PASSWORD
   npm run seed                            # creates the tables and loads the Thane menu
   ```

3. Run (two terminals):

   ```bash
   npm run dev:backend          # API on :4000
   npm run dev:frontend         # app on :5173 (proxies /api and /uploads to :4000)
   ```

Open **http://localhost:5173** (guest) and **http://localhost:5173/manager**
(log in with your `MANAGER_PASSWORD`).

## B. Images

Uploaded photos are resized to fit 900×900, converted to WebP and saved in
`UPLOAD_DIR` (default `backend/uploads/`). The database stores the URL
(`/uploads/<uuid>.webp`), and the backend serves the folder. Replacing or
deleting an item's photo removes the old file. **Back up this folder together
with the database** — it is the only copy of the photos.

## C. Re-seeding food

`npm --prefix backend run reseed-food` replaces the food side of the menu with
`seed-data.json` in one transaction and leaves drinks untouched.

## D. Deploy to Render (free)

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml` and
   creates one web service (build installs both apps + builds the frontend;
   start runs the backend, which also serves the built app).
3. In the service's **Environment**, add the values (they're marked `sync:false`
   in the blueprint, so Render prompts for them):
   - `MANAGER_PASSWORD` — your manager password
   - `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
   - Cloudinary: `CLOUDINARY_URL` **or** `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET`
4. Deploy. If you didn't seed Turso in step B, run `npm run seed` locally once
   with the Turso env vars set (same DB the site uses).
5. Live: `https://<your-service>.onrender.com/` (guest) and `/manager` (staff).

Note: Render free web services sleep after ~15 min idle and take a few seconds
to wake on the next visit — normal for the free tier.

---

## Notes & next steps

- **Auth** is a single shared password sent as a Bearer token (MVP, as requested).
  Easy to upgrade to per-user logins / JWT later — the API already checks a token
  on every manager route.
- **Analytics** logs a view when a guest opens an item (taps it / opens its sizes),
  de-duped per browser session so the "most viewed" list stays meaningful.
- **Multi-restaurant** later: everything hangs off `restaurant_id` (currently 1) and
  `qr_slug` is in place — add a `:slug` param to the public routes when you expand.
- The seed contains the real live beverages (with pours) + the V5 food list. Prices
  for food are the indicative ones; edit any of it in the manager dashboard.
