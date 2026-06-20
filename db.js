// db.js
// Two interchangeable storage backends behind one async interface:
//   • Postgres  — used automatically when DATABASE_URL is set (e.g. on Railway)
//   • In-memory — used locally so `npm start` works with zero setup
//
// Both expose the same methods, so the rest of the app never cares which is active.

const crypto = require('crypto');
const { SEED_LISTINGS } = require('./seed');

const SORTS = {
  newest: 'created_at DESC',
  price_asc: 'price ASC',
  price_desc: 'price DESC',
  closest: 'created_at DESC', // no geo data yet — behaves like newest
};

function newId() {
  return crypto.randomUUID();
}

// Apply category / location / search / sort to an array of listings (in-memory path).
function filterAndSort(rows, { category, location, q, sort }) {
  let out = rows.slice();

  if (category && category !== 'all') {
    if (category === 'free') out = out.filter((l) => Number(l.price) === 0);
    else out = out.filter((l) => l.category === category);
  }
  if (location) out = out.filter((l) => l.city === location);
  if (q) {
    const needle = q.trim().toLowerCase();
    out = out.filter(
      (l) =>
        l.title.toLowerCase().includes(needle) ||
        (l.description || '').toLowerCase().includes(needle)
    );
  }

  switch (sort) {
    case 'price_asc':
      out.sort((a, b) => a.price - b.price);
      break;
    case 'price_desc':
      out.sort((a, b) => b.price - a.price);
      break;
    default:
      out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  return out;
}

/* ───────────────────────── In-memory backend ───────────────────────── */
function createMemoryStore() {
  const listings = [];
  const saves = new Map(); // clientId -> Set(listingId)

  return {
    kind: 'memory',
    async init() {
      const now = Date.now();
      SEED_LISTINGS.forEach((l, i) => {
        listings.push({
          id: newId(),
          ...l,
          // stagger timestamps so "newest" ordering is stable and seeded order is preserved
          created_at: new Date(now - (SEED_LISTINGS.length - i) * 1000).toISOString(),
        });
      });
      console.log(`[db] in-memory store ready with ${listings.length} listings (data resets on restart)`);
    },
    async listListings(opts) {
      return filterAndSort(listings, opts);
    },
    async getListing(id) {
      return listings.find((l) => l.id === id) || null;
    },
    async createListing(data) {
      const row = { id: newId(), created_at: new Date().toISOString(), ...data };
      listings.push(row);
      return row;
    },
    async getSavedIds(clientId) {
      return [...(saves.get(clientId) || [])];
    },
    async getSavedListings(clientId, opts) {
      const ids = new Set(saves.get(clientId) || []);
      return filterAndSort(listings.filter((l) => ids.has(l.id)), opts);
    },
    async toggleSave(clientId, listingId) {
      if (!listings.some((l) => l.id === listingId)) return null;
      let set = saves.get(clientId);
      if (!set) saves.set(clientId, (set = new Set()));
      const saved = set.has(listingId);
      if (saved) set.delete(listingId);
      else set.add(listingId);
      return { saved: !saved };
    },
  };
}

/* ───────────────────────── Postgres backend ───────────────────────── */
function createPostgresStore(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString,
    // Railway's managed Postgres terminates TLS; allow self-signed in production.
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  });

  return {
    kind: 'postgres',
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS listings (
          id          UUID PRIMARY KEY,
          title       TEXT        NOT NULL,
          price       NUMERIC     NOT NULL DEFAULT 0,
          category    TEXT        NOT NULL DEFAULT 'home',
          location    TEXT        NOT NULL DEFAULT '',
          city        TEXT        NOT NULL DEFAULT '',
          tier        TEXT        NOT NULL DEFAULT 'standard',
          seller_name TEXT        NOT NULL DEFAULT 'A seller',
          image_url   TEXT        NOT NULL DEFAULT '',
          description TEXT        NOT NULL DEFAULT '',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS saves (
          client_id  TEXT NOT NULL,
          listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (client_id, listing_id)
        );
      `);

      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM listings');
      if (rows[0].n === 0) {
        const now = Date.now();
        for (let i = 0; i < SEED_LISTINGS.length; i++) {
          const l = SEED_LISTINGS[i];
          await pool.query(
            `INSERT INTO listings
               (id, title, price, category, location, city, tier, seller_name, image_url, description, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              newId(), l.title, l.price, l.category, l.location, l.city, l.tier,
              l.seller_name, l.image_url, l.description,
              new Date(now - (SEED_LISTINGS.length - i) * 1000),
            ]
          );
        }
        console.log(`[db] postgres seeded with ${SEED_LISTINGS.length} listings`);
      }
      console.log('[db] postgres store ready');
    },

    async listListings({ category, location, q, sort }) {
      const where = [];
      const params = [];
      if (category && category !== 'all') {
        if (category === 'free') {
          where.push('price = 0');
        } else {
          params.push(category);
          where.push(`category = $${params.length}`);
        }
      }
      if (location) {
        params.push(location);
        where.push(`city = $${params.length}`);
      }
      if (q) {
        params.push(`%${q.trim()}%`);
        where.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const order = SORTS[sort] || SORTS.newest;
      const { rows } = await pool.query(
        `SELECT * FROM listings ${clause} ORDER BY ${order}`,
        params
      );
      return rows.map(normalize);
    },

    async getListing(id) {
      const { rows } = await pool.query('SELECT * FROM listings WHERE id = $1', [id]);
      return rows[0] ? normalize(rows[0]) : null;
    },

    async createListing(data) {
      const id = newId();
      const { rows } = await pool.query(
        `INSERT INTO listings
           (id, title, price, category, location, city, tier, seller_name, image_url, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          id, data.title, data.price, data.category, data.location, data.city,
          data.tier, data.seller_name, data.image_url, data.description,
        ]
      );
      return normalize(rows[0]);
    },

    async getSavedIds(clientId) {
      const { rows } = await pool.query(
        'SELECT listing_id FROM saves WHERE client_id = $1',
        [clientId]
      );
      return rows.map((r) => r.listing_id);
    },

    async getSavedListings(clientId, { category, location, q, sort }) {
      const params = [clientId];
      const where = ['s.client_id = $1'];
      if (category && category !== 'all') {
        if (category === 'free') where.push('l.price = 0');
        else { params.push(category); where.push(`l.category = $${params.length}`); }
      }
      if (location) { params.push(location); where.push(`l.city = $${params.length}`); }
      if (q) { params.push(`%${q.trim()}%`); where.push(`(l.title ILIKE $${params.length} OR l.description ILIKE $${params.length})`); }
      const order = (SORTS[sort] || SORTS.newest).replace(/\b(created_at|price)\b/g, 'l.$1');
      const { rows } = await pool.query(
        `SELECT l.* FROM saves s JOIN listings l ON l.id = s.listing_id
         WHERE ${where.join(' AND ')} ORDER BY ${order}`,
        params
      );
      return rows.map(normalize);
    },

    async toggleSave(clientId, listingId) {
      const exists = await pool.query('SELECT 1 FROM listings WHERE id = $1', [listingId]);
      if (!exists.rowCount) return null;
      const del = await pool.query(
        'DELETE FROM saves WHERE client_id = $1 AND listing_id = $2',
        [clientId, listingId]
      );
      if (del.rowCount) return { saved: false };
      await pool.query(
        'INSERT INTO saves (client_id, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [clientId, listingId]
      );
      return { saved: true };
    },
  };
}

// Postgres returns NUMERIC as a string and Date objects for timestamps — normalize for JSON.
function normalize(row) {
  return {
    ...row,
    price: Number(row.price),
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function createStore() {
  const url = process.env.DATABASE_URL;
  if (url) return createPostgresStore(url);
  console.warn('[db] DATABASE_URL not set — using in-memory store (data will not persist).');
  return createMemoryStore();
}

module.exports = { createStore };
