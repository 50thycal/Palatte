# Palate

A local-first notes app for iPhone (installable PWA) with its own keyboard.

- **Capture → shape.** Type into the Palate scratch surface, archive it into a
  project, then search, edit, tag (`#tag`) and link (`[[Note title]]`) your notes
  in the Library. Every note keeps a version history.
- **Recall.** Related notes surface while you write.
- **Palate Keys.** An in-app keyboard replaces the iOS keyboard. It has
  predictions in the top row, autocorrect that learns from your notes, a space-bar
  trackpad, swipe-to-delete words, swipe-up symbols and long-press accents.
- **You own the data.** Notes live in IndexedDB on the device. They sync to your
  own Postgres database on Vercel, are backed up nightly as Markdown to a private
  GitHub repo, and can be exported as a Markdown zip at any time.

## Setup (Vercel)

1. **Database:** Vercel → project → Storage → Create Database → Neon (Postgres),
   connected to this project. This sets `DATABASE_URL`. Tables are created
   automatically on first sync.
2. **Token:** Settings → Environment Variables → `PALATE_TOKEN` = a long random
   passphrase. Redeploy.
3. **On the phone:** open the site → Share → Add to Home Screen → open Palate →
   Library → ⚙︎ → Sync & storage → paste the token → *Turn on sync*.
4. **Optional nightly backup to GitHub:** create a private repo with a README,
   then set `GITHUB_BACKUP_REPO` (`owner/repo`), `GITHUB_BACKUP_TOKEN` (a
   fine-grained PAT with *Contents: read & write* on that repo only), and
   optionally `GITHUB_BACKUP_BRANCH` (default `main`). Vercel Cron calls
   `/api/backup` daily (`vercel.json`).

Without a token the app works fully offline, with data on the device only.

## Development

```sh
npm install
DATABASE_URL=postgres://… PALATE_TOKEN=dev npm run dev   # http://localhost:3000
TEST_DATABASE_URL=postgres://… npm test                  # API + keyboard + export tests
node tests/e2e/keyboard.e2e.mjs                          # needs the dev server + Playwright
```

There's no build step: `index.html` loads ES modules from `js/`, and `api/` holds
the Vercel functions. The architecture and sync protocol are in
[`docs/PLAN.md`](docs/PLAN.md). Rebuild the keyboard dictionary with
`scripts/build-dictionary.py`.
