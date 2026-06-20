# Listed.

A local marketplace web app — browse, search, filter, save, and post listings.
Express + PostgreSQL backend, vanilla-JS frontend, ready to deploy on **Railway** via **GitHub**.

> The frontend is the original `Listed.` prototype, now wired to a real API:
> listings load from a database, the heart saves them per-visitor, the **Sell** button
> publishes new listings, and category / search / location / sort all hit the backend.

---

## What's inside

```
listed-marketplace/
├── server.js          Express app — REST API + serves the frontend
├── db.js              Storage layer (PostgreSQL on Railway, in-memory locally)
├── seed.js            Starter listings (loaded once when the DB is empty)
├── public/
│   ├── index.html     App shell
│   ├── styles.css     Original design system + new component styles
│   └── app.js         Frontend logic (fetch, render, sell, save, detail)
├── railway.json       Railway build/deploy config + health check
├── package.json
├── .env.example
└── .gitignore
```

### API

| Method | Route                       | Purpose                                            |
|--------|-----------------------------|----------------------------------------------------|
| GET    | `/api/listings`             | Browse. Query: `category`, `location`, `q`, `sort` |
| GET    | `/api/listings/:id`         | Single listing detail                              |
| POST   | `/api/listings`             | Create a listing (the **Sell** flow)               |
| GET    | `/api/saved`                | Listings saved by this visitor                     |
| POST   | `/api/listings/:id/save`    | Toggle a save on/off                               |
| GET    | `/api/health`               | Health check (used by Railway)                     |

`sort` accepts `newest`, `price_asc`, `price_desc`, `closest`.
Saves are tracked per browser via an anonymous `x-client-id` header — no login required.

---

## Run it locally

No database needed — without `DATABASE_URL` the app uses an in-memory store
(data resets when you stop it).

```bash
npm install
npm start
# → http://localhost:3000
```

To run against a local Postgres instead, copy `.env.example` to `.env` and set
`DATABASE_URL`. The app auto-creates its tables and seeds them on first run.

---

## Deploy: GitHub → Railway

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Listed. marketplace"
git branch -M main
git remote add origin https://github.com/<you>/listed-marketplace.git
git push -u origin main
```

### 2. Create the Railway project

1. Go to **railway.app → New Project → Deploy from GitHub repo** and pick this repo.
2. Railway auto-detects Node, runs `npm install`, and starts it with `npm start`
   (defined in `railway.json` / `package.json`).

### 3. Add the database

1. In the same project: **New → Database → Add PostgreSQL**.
2. Railway injects a `DATABASE_URL` variable into your app service automatically.
   On the next deploy the app switches to Postgres, creates its tables, and seeds them.
   *(If the variable isn't shared automatically, open your app service → Variables →
   add `DATABASE_URL` with the value `${{Postgres.DATABASE_URL}}`.)*

### 4. Make it public

Open your app service → **Settings → Networking → Generate Domain**.
Your marketplace is now live at the generated URL. The `/api/health` check confirms
it booted; the page should report `"store":"postgres"`.

### Updating

Every push to `main` triggers a new Railway deploy automatically.

---

## Environment variables

| Variable       | Required | Notes                                                              |
|----------------|----------|--------------------------------------------------------------------|
| `DATABASE_URL` | Prod     | Provided by Railway's Postgres plugin. Omit locally for in-memory. |
| `PORT`         | No       | Set automatically by Railway. Defaults to `3000` locally.          |
| `PGSSL`        | No       | Set to `disable` only for a local Postgres without TLS.            |

---

## Notes & next steps

- **Inbox / Profile** are stubbed (“coming soon”) — the core browse → save → sell loop is complete.
- New listings post as standard-tier sellers; `preferred` / `pro` placement is seeded data.
- Natural follow-ons: accounts + auth, real messaging, image uploads (vs. URLs), and
  geocoding so “Closest to me” sorts by distance.
