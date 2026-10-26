# GameRecon — every game, where to watch it, live play-by-play

Python server (stdlib only, no installs) + plain HTML/CSS/JS front end.
Schedules, scores, broadcasts and play-by-play come from ESPN's public feeds.

## Run locally

```
python server.py
```

Then open http://localhost:5173 (`PORT=8080 python server.py` to change port).

## Features

- Today / This Week / Calendar views for NFL, NBA, MLB, NHL, WNBA, college football, basketball & baseball,
  soccer (EPL, MLS, Champions League, La Liga, Liga MX, Serie A, Bundesliga, Ligue 1, NWSL),
  tennis (ATP/WTA), UFC, F1, NASCAR, golf (PGA/LPGA)
- **Where To Watch** box per game: every channel, ways to get it, subscription type, estimated monthly price
- **Play-by-play** under it: latest 3 plays, click to scroll the full list; live games refresh every 30s
- Live games are highlighted with the score and clock, and float to the top of their sport
- **Accounts** (email + password): pinned teams/players, sport order, and area sync across devices.
  Guests get the same features saved in the browser; signing in merges them into the account.
- **Sport order**: set your own, or by default it's ranked by popularity in your area
  (your state if set, otherwise guessed from your time zone)

## Files

| File | What |
|---|---|
| `server.py` | HTTP server: static files from `public/` + JSON API |
| `db.py` | SQLite accounts (`data/gametime.db`): PBKDF2 password hashes, hashed session tokens |
| `espn.py` | Fetches/caches ESPN and normalizes every sport into one event shape; play-by-play |
| `public/app.js` | The site |
| `public/networks.js` | Network → ways to watch + **estimated** prices. Update prices here. |
| `public/sports.js` | Regional popularity rankings used for the default sport order |
| `scripts/update_teams.py` | Rebuilds `public/teams.json` (favorites picker) |

## API

`GET /api/config`, `GET /api/day?date=YYYYMMDD`, `GET /api/plays?league=mlb&id=…`,
`POST /api/auth/signup|login|logout`, `GET|PUT /api/me`

## Deploying for free (Render + Turso)

Render's free web service sleeps after 15 minutes without visitors (about a minute to wake) and has
no persistent disk, so accounts live in a free [Turso](https://turso.tech) database instead.

1. **Turso:** sign up → **Create Database** → copy its URL (`libsql://…turso.io`) and create a token.
2. **Render:** sign up with GitHub → **New → Blueprint** → pick this repo. `render.yaml` sets everything up;
   paste `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` when asked, leave `PUBLIC_URL` blank for now.
3. After the first deploy, copy the `https://…onrender.com` address into `PUBLIC_URL` (Environment tab).

Every push to `main` redeploys automatically.

## Deploying (Railway)

The repo includes a `Dockerfile` and `railway.json` (health check at `/api/health`).

1. Push this folder to a GitHub repo.
2. On railway.com: **New Project → Deploy from GitHub repo** → pick the repo.
3. In the service: **Settings → Volumes → Add volume**, mount path `/data` (keeps accounts across deploys).
4. **Variables:** `SECURE_COOKIES=1`, `TRUST_PROXY=1`, `PUBLIC_URL=https://<your domain>`,
   `RESEND_API_KEY=re_...`, `EMAIL_FROM=GameRecon <noreply@<your domain>>` (`DATA_DIR=/data` and `PORT` are already set).
5. **Settings → Networking → Generate domain** for a `*.up.railway.app` URL, or **Custom domain** and add the
   CNAME record it shows at your domain registrar. Railway issues the HTTPS certificate.

Any Docker host works the same way (Fly.io, Render, a VPS): run the image, mount a volume at `/data`, set the variables above.

## Prices

`public/networks.js` holds every service's list price with a `src` link and the `PRICES_CHECKED` date shown in the footer.
Re-check and bump the date every couple of months — streaming prices change often.

## Email (password reset)

Password reset emails go through [Resend](https://resend.com) (free: 100/day, 3,000/month).
1. Sign up at resend.com → **API Keys → Create** → set `RESEND_API_KEY`.
2. **Domains → Add domain** → add the DNS records it shows at your registrar → set `EMAIL_FROM` to an address on it.
   Until a domain is verified, Resend only delivers to your own Resend account email.

Without `RESEND_API_KEY` (local dev) the email, including the reset link, is printed to the server console.

Not yet built: email verification on sign-up.
