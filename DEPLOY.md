# Deploying to Render + Turso

Two services, both have free tiers. Total setup time: ~15 minutes.

---

## Step 1 — Set up Turso (hosted database)

1. Go to [turso.tech](https://turso.tech) and sign up (free)
2. Install the Turso CLI:
   ```
   brew install tursodatabase/tap/turso
   ```
3. Log in and create a database:
   ```
   turso auth login
   turso db create math-companion
   ```
4. Get your credentials:
   ```
   turso db show math-companion      # copy the URL (libsql://...)
   turso db tokens create math-companion  # copy the auth token
   ```
   Save both — you'll need them in Step 3.

---

## Step 2 — Push to GitHub

Render deploys from a Git repo.

```bash
cd ~/Projects/math-companion
git init
git add .
git commit -m "Initial commit"
```

Create a new repo on GitHub (github.com → New repository → name it `math-companion`), then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/math-companion.git
git push -u origin main
```

---

## Step 3 — Deploy on Render

1. Go to [render.com](https://render.com) and sign up (free)
2. Click **New → Web Service**
3. Connect your GitHub account and select the `math-companion` repo
4. Render will detect `render.yaml` automatically — click **Create Web Service**
5. While it's building, go to **Environment** tab and add two variables:
   - `TURSO_DATABASE_URL` → the `libsql://...` URL from Step 1
   - `TURSO_AUTH_TOKEN` → the token from Step 1
6. Trigger a redeploy (or wait for the first one to finish)

Your app will be live at `https://math-companion.onrender.com` (or similar).

---

## Notes

**Free tier behaviour:** Render's free plan spins the service down after 15 minutes of inactivity. The first visit after idle takes ~30 seconds to wake up. Subsequent visits are instant. If this bothers you, Render's Starter plan ($7/mo) keeps it warm.

**Local development still works:** With no env vars set, the app uses local SQLite as before:
```
uvicorn app:app --reload --port 8080
```

**Migrating existing local progress to Turso:** If you've built up local progress you want to keep, run this once after Turso is set up:
```bash
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... python3 -c "
import database
database.init_db()
print('Turso tables created.')
"
```
Then manually re-mark your completed sections in the app (or ask for a migration script).
