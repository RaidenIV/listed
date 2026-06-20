// server.js — Listed. marketplace API + static frontend
const path = require('path');
const express = require('express');
const { createStore } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const store = createStore();

app.use(express.json({ limit: '1mb' }));

// Every browser gets an anonymous client id (sent as a header) so saves can be
// tracked per-visitor without requiring accounts.
function clientId(req) {
  return (req.get('x-client-id') || 'anon').slice(0, 100);
}

const CATEGORIES = [
  'all', 'vehicles', 'apparel', 'electronics', 'free',
  'home', 'tools', 'music', 'office', 'pets', 'toys',
];
const TIERS = ['preferred', 'pro', 'standard'];

function queryOpts(req) {
  return {
    category: req.query.category,
    location: req.query.location,
    q: req.query.q,
    sort: req.query.sort,
  };
}

/* ───────────────────────────── API ───────────────────────────── */

app.get('/api/health', (_req, res) => res.json({ ok: true, store: store.kind }));

// Browse listings (with category/location/search/sort filters)
app.get('/api/listings', async (req, res, next) => {
  try {
    const listings = await store.listListings(queryOpts(req));
    const savedIds = new Set(await store.getSavedIds(clientId(req)));
    res.json({ listings: listings.map((l) => ({ ...l, saved: savedIds.has(l.id) })) });
  } catch (err) { next(err); }
});

// Single listing detail
app.get('/api/listings/:id', async (req, res, next) => {
  try {
    const listing = await store.getListing(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    const savedIds = new Set(await store.getSavedIds(clientId(req)));
    res.json({ listing: { ...listing, saved: savedIds.has(listing.id) } });
  } catch (err) { next(err); }
});

// Create a listing (the "Sell" flow)
app.post('/api/listings', async (req, res, next) => {
  try {
    const b = req.body || {};
    const errors = [];

    const title = String(b.title || '').trim();
    if (title.length < 3) errors.push('Add a title of at least 3 characters.');
    if (title.length > 120) errors.push('Keep the title under 120 characters.');

    const price = Number(b.price);
    if (!Number.isFinite(price) || price < 0) errors.push('Enter a price of 0 or more.');

    const category = CATEGORIES.includes(b.category) && b.category !== 'all'
      ? b.category : 'home';
    const tier = TIERS.includes(b.tier) ? b.tier : 'standard';
    const city = String(b.city || '').trim() || 'Columbus, OH';
    const location = String(b.location || '').trim() || city;

    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });

    const listing = await store.createListing({
      title,
      price: Math.round(price),
      category,
      location,
      city,
      tier,
      seller_name: String(b.seller_name || '').trim() || 'A seller',
      image_url:
        String(b.image_url || '').trim() ||
        'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=480&h=360&fit=crop&auto=format',
      description: String(b.description || '').trim(),
    });

    res.status(201).json({ listing: { ...listing, saved: false } });
  } catch (err) { next(err); }
});

// Saved listings for this visitor
app.get('/api/saved', async (req, res, next) => {
  try {
    const listings = await store.getSavedListings(clientId(req), queryOpts(req));
    res.json({ listings: listings.map((l) => ({ ...l, saved: true })) });
  } catch (err) { next(err); }
});

// Toggle a save on/off
app.post('/api/listings/:id/save', async (req, res, next) => {
  try {
    const result = await store.toggleSave(clientId(req), req.params.id);
    if (!result) return res.status(404).json({ error: 'Listing not found.' });
    res.json(result);
  } catch (err) { next(err); }
});

/* ──────────────────────── Static frontend ────────────────────── */
app.use(express.static(path.join(__dirname, 'public')));

// Anything else falls back to the app shell (single-page client).
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// JSON error handler
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong on our end. Try again.' });
});

store
  .init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Listed. running on http://localhost:${PORT}  (store: ${store.kind})`);
    });
  })
  .catch((err) => {
    console.error('[fatal] failed to start:', err);
    process.exit(1);
  });
