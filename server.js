// server.js — Listed. marketplace API + static frontend
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { createStore } = require('./db');
const { sendVerificationEmail, sendProfileCreatedEmail, emailConfigured, smtpConfigured, resendConfigured } = require('./email');

const app = express();
app.set('trust proxy', 1); // Railway terminates TLS at its edge; trust X-Forwarded-* headers
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
app.get('/api/listings', requireProfile, async (req, res, next) => {
  try {
    const listings = await store.listListings(queryOpts(req));
    const savedIds = new Set(await store.getSavedIds(clientId(req)));
    res.json({ listings: listings.map((l) => ({ ...l, saved: savedIds.has(l.id) })) });
  } catch (err) { next(err); }
});

// Single listing detail
app.get('/api/listings/:id', requireProfile, async (req, res, next) => {
  try {
    const listing = await store.getListing(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    const savedIds = new Set(await store.getSavedIds(clientId(req)));
    res.json({ listing: { ...listing, saved: savedIds.has(listing.id) } });
  } catch (err) { next(err); }
});

// Create a listing (the "Sell" flow)
app.post('/api/listings', requireProfile, async (req, res, next) => {
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
      seller_name: String(b.seller_name || '').trim() || req.user.profile.display_name,
      image_url:
        String(b.image_url || '').trim() ||
        'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=480&h=360&fit=crop&auto=format',
      description: String(b.description || '').trim(),
    });

    res.status(201).json({ listing: { ...listing, saved: false } });
  } catch (err) { next(err); }
});

// Saved listings for this visitor
app.get('/api/saved', requireProfile, async (req, res, next) => {
  try {
    const listings = await store.getSavedListings(clientId(req), queryOpts(req));
    res.json({ listings: listings.map((l) => ({ ...l, saved: true })) });
  } catch (err) { next(err); }
});

// Toggle a save on/off
app.post('/api/listings/:id/save', requireProfile, async (req, res, next) => {
  try {
    const result = await store.toggleSave(clientId(req), req.params.id);
    if (!result) return res.status(404).json({ error: 'Listing not found.' });
    res.json(result);
  } catch (err) { next(err); }
});

/* ────────────────────────────── Auth ─────────────────────────────── */

const SESSION_COOKIE = 'listed_session';
const SESSION_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const randomToken = () => crypto.randomBytes(32).toString('hex');
const hasProfile = (u) => !!(u && u.profile && String(u.profile.display_name || '').trim());
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  verified: u.verified,
  profile: u.profile || null,
  profileComplete: hasProfile(u),
});

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function secureCookies(req) {
  return process.env.NODE_ENV === 'production' || req.get('x-forwarded-proto') === 'https';
}
function setSessionCookie(req, res, token) {
  const parts = [
    `${SESSION_COOKIE}=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];
  if (secureCookies(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(req, res) {
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (secureCookies(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

async function currentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const sess = await store.getSession(token);
  if (!sess) return null;
  if (new Date(sess.expires_at) < new Date()) { await store.deleteSession(token); return null; }
  return (await store.getUserById(sess.user_id)) || null;
}

async function requireUser(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to continue.', authRequired: true });
    req.user = user;
    next();
  } catch (err) { next(err); }
}

async function requireProfile(req, res, next) {
  try {
    const user = req.user || await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to continue.', authRequired: true });
    if (!hasProfile(user)) return res.status(403).json({ error: 'Create your profile to continue.', profileRequired: true });
    req.user = user;
    next();
  } catch (err) { next(err); }
}

function profileFromBody(body) {
  const display_name = String(body?.display_name || '').trim();
  const city = String(body?.city || '').trim() || 'Columbus, OH';
  const bio = String(body?.bio || '').trim();
  const avatar_url = String(body?.avatar_url || '').trim();
  const errors = [];
  if (display_name.length < 2) errors.push('Add a display name of at least 2 characters.');
  if (display_name.length > 60) errors.push('Keep your display name under 60 characters.');
  if (bio.length > 160) errors.push('Keep your bio under 160 characters.');
  if (avatar_url.length > 300) errors.push('Keep your photo URL under 300 characters.');
  return { errors, profile: { display_name, city, bio, avatar_url } };
}

async function startSession(req, res, userId) {
  const token = randomToken();
  await store.createSession(userId, token, new Date(Date.now() + SESSION_DAYS * 864e5));
  setSessionCookie(req, res, token);
}

async function issueVerification(req, user) {
  await store.deleteEmailTokensForUser(user.id);
  const token = randomToken();
  await store.createEmailToken(user.id, token, new Date(Date.now() + 24 * 60 * 60 * 1000));
  const link = `${baseUrl(req)}/api/auth/verify?token=${token}`;
  const result = await sendVerificationEmail(user.email, link);
  return { link, dev: !!result.dev, sent: !!result.sent, provider: result.provider };
}

// Create an account → send the verification email (account stays inactive until verified)
app.post('/api/auth/signup', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const existing = await store.getUserByEmail(email);
    if (existing && existing.verified) {
      return res.status(409).json({ error: 'That email is already registered. Try signing in.' });
    }

    let user = existing;
    if (!user) {
      const password_hash = await bcrypt.hash(password, 10);
      user = await store.createUser({ email, password_hash });
    }

    const { link, dev, sent, provider } = await issueVerification(req, user);
    const payload = sent
      ? { message: 'Check your email for a link to activate your account.', email: { sent: true, provider } }
      : {
          message: 'Email is not configured. Use the development verification link below, or configure SMTP/Resend.',
          email: { sent: false, dev: true, provider },
        };
    // Dev convenience only: expose the link when no mailer is configured (never in production).
    if (dev && process.env.NODE_ENV !== 'production') payload.devVerifyUrl = link;
    res.status(201).json(payload);
  } catch (err) {
    if (err.code === 'EMAIL_TAKEN') {
      return res.status(409).json({ error: 'That email is already registered. Try signing in.' });
    }
    next(err);
  }
});

// Verification link target → activate the account, sign the user in, redirect to /login
app.get('/api/auth/verify', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    const row = token ? await store.getEmailToken(token) : null;
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.redirect('/login?verify=expired');
    }
    await store.setUserVerified(row.user_id);
    await store.deleteEmailToken(token);
    await startSession(req, res, row.user_id); // log them in immediately, like a real app
    res.redirect('/login?verified=1');
  } catch (err) { next(err); }
});

// Resend a verification link (responds the same whether or not the account exists)
app.post('/api/auth/resend', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = await store.getUserByEmail(email);
    let devVerifyUrl;
    if (user && !user.verified) {
      const { link, dev } = await issueVerification(req, user);
      if (dev && process.env.NODE_ENV !== 'production') devVerifyUrl = link;
    }
    res.json({ message: 'If that account still needs verifying, a new link is on its way.', devVerifyUrl });
  } catch (err) { next(err); }
});

// Sign in
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = await store.getUserByEmail(email);
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });
    if (!user.verified) {
      return res.status(403).json({ error: 'Verify your email before signing in.', needsVerification: true });
    }
    await startSession(req, res, user.id);
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

// Sign out
app.post('/api/auth/logout', async (req, res, next) => {
  try {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) await store.deleteSession(token);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Who am I?
app.get('/api/auth/me', async (req, res, next) => {
  try {
    const user = await currentUser(req);
    res.json({ user: user ? publicUser(user) : null });
  } catch (err) { next(err); }
});

app.get('/api/profile', requireUser, async (req, res) => {
  res.json({ profile: req.user.profile || null, profileComplete: hasProfile(req.user) });
});

app.put('/api/profile', requireUser, async (req, res, next) => {
  try {
    const { errors, profile } = profileFromBody(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });

    const wasProfileComplete = hasProfile(req.user);
    const user = await store.updateUserProfile(req.user.id, {
      ...profile,
      updated_at: new Date().toISOString(),
    });

    let profileEmail = { sent: false, dev: false };
    if (!wasProfileComplete && hasProfile(user)) {
      const result = await sendProfileCreatedEmail(user.email, user.profile);
      profileEmail = { sent: !!result.sent, dev: !!result.dev, provider: result.provider };
    }

    res.json({ user: publicUser(user), profile: user.profile, profileEmail });
  } catch (err) { next(err); }
});

/* ──────────────────────── Static frontend ────────────────────── */
// Login / sign-up page at a clean URL.
app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});
app.get('/login.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'login.js'));
});

app.get(['/', '/index.html'], async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (err) { next(err); }
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Anything else falls back to the app shell (single-page client) after sign-in.
app.get(/.*/, async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (err) { next(err); }
});

// JSON error handler
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  if (err?.code === 'EMAIL_NOT_CONFIGURED') {
    return res.status(503).json({
      error: 'Email delivery is not configured. Add SMTP_* variables or RESEND_API_KEY and EMAIL_FROM to the deployment environment.',
      emailConfigRequired: true,
    });
  }
  if (err?.code === 'EMAIL_DELIVERY_FAILED') {
    return res.status(502).json({ error: 'Email delivery failed. Check your email provider credentials, sender address, and domain verification.' });
  }
  res.status(500).json({ error: 'Something went wrong on our end. Try again.' });
});

store
  .init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Listed. running on http://localhost:${PORT}  (store: ${store.kind})`);
      const emailProvider = smtpConfigured ? 'SMTP' : resendConfigured ? 'Resend' : 'not configured';
      console.log(`[email] ${emailConfigured ? `${emailProvider} configured — emails will send` : 'not configured — production email requests will fail visibly'}`);
    });
  })
  .catch((err) => {
    console.error('[fatal] failed to start:', err);
    process.exit(1);
  });
