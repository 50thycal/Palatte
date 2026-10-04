# Palate v1 — Plan of record

Goal: a notes app that beats Apple Notes on **data ownership, retrieval and
input flow**, with a custom in-app keyboard that replaces the iOS keyboard.

## Architecture

```
 iPhone (PWA)                                   Vercel
 ┌──────────────────────────────────────┐      ┌───────────────────────────┐
 │ UI (vanilla JS, no build step)       │      │ /api/sync   (Node fn)     │
 │  ├─ Palate Keys (custom keyboard)    │      │ /api/versions             │
 │  ├─ Capture / Library / Note views   │ HTTPS│ /api/health               │
 │  └─ Recall strip                     │<────>│ /api/backup  (daily cron) │
 │ store.js  — IndexedDB (source of     │ token│        │                  │
 │             truth on device)         │      │        ▼                  │
 │ sync.js   — push dirty / pull seq    │      │ Postgres (Neon)           │
 │ search.js — full-text + TF-IDF recall│      │  projects, notes,         │
 │ morph.js  — n-gram predictions       │      │  note_versions            │
 └──────────────────────────────────────┘      └────────┬──────────────────┘
                                                         │ nightly
                                                         ▼
                                              GitHub repo of .md files
```

**Local-first.** The device never waits on the network. Every write goes to
IndexedDB, is marked `dirty`, and the sync engine pushes it when it can.

**Sync protocol.** One endpoint: `POST /api/sync {cursor, projects, notes}`.
The server applies each record by last-write-wins on `updatedAt`. Every
accepted write gets the next value of a global sequence (`seq`). The response
returns everything with `seq > cursor`, plus the server copy of any record it
rejected. Before a note's body is overwritten, the old body is copied into
`note_versions`, so nothing is ever lost, even on a conflict.

**Ownership, three layers deep.** You can get your data out in three ways:
1. Postgres in your own Vercel/Neon account (queryable, yours).
2. A nightly cron that writes every note as Markdown to a private GitHub repo,
   so every day is a commit.
3. An on-device "Export Markdown (.zip)" with no server involved.

**Auth.** Single user. `PALATE_TOKEN` env var on Vercel, pasted once into
Settings, sent as a Bearer token and compared in constant time.

## Features

### Notes
- **N1 Own your data:** IndexedDB store with migration from the old
  localStorage blob (kept as a backup key), Vercel Postgres sync, Markdown
  export, and the GitHub backup cron.
- **N2 Capture → shape:** the Palate scratch surface stays. Archived
  snapshots become editable notes, with a Library offering instant search,
  `#tags`, `[[links]]` + backlinks, pinning, move-to-project, soft delete
  with undo, and version history (local + server) with restore.
- **N3 Recall:** a TF-IDF index over all notes. While you write, related notes
  surface in a quiet strip. Tap to peek, open, or insert a `[[link]]`.

### Palate Keys (keyboard option A)
- Text fields get `inputmode="none"`, so the iOS keyboard never opens. A
  fixed-height in-app keyboard owns the bottom of the screen, which removes
  the viewport-tracking problem entirely.
- Three stable prediction slots in the keyboard's top row (Morph engine).
- Commit-on-release with slide correction, plus a nearest-key hit test (no
  dead zones) biased by which letter is likely next.
- Spacebar trackpad (drag or long-press), backspace hold-to-repeat that
  accelerates to whole words, swipe-left backspace to delete a word.
- Swipe up on a key for its number/symbol; long-press for accents.
- Auto-capitalisation, double-tap space for a period, smart punctuation spacing,
  shift / caps lock.
- Autocorrect: a dictionary plus your personal vocabulary, keyboard-adjacency
  weighted edit distance, and contraction fixes. Backspace right after a
  correction reverts it and learns the word.
- Haptics through the iOS 18 switch-input trick (optional).
- Setting: Palate keyboard Auto / Always / Off. Off is the escape hatch
  back to the iOS keyboard.

### Auto-organize (on-device)
- On Archive, a background queue runs each note through a local model
  (WebLLM on WebGPU in a worker; Qwen 2.5 3B, or 1.5B lite). The model returns
  JSON constrained by a schema: title, project, new-project suggestion, tags,
  to-dos, and the cleaned text.
- `planChanges()` applies the result defensively:
  - a cleanup is accepted only if it keeps the user's words (word-level LCS
    similarity ≥ 0.72);
  - tags become a trailing `#tag` line and to-dos a `- [ ]` checklist, so they
    sync and export as plain text;
  - a project is set only for notes archived without one, from the model's pick
    or a vote among similar notes.
- Safety:
  - the original is kept as a version snapshot plus an undo record;
  - a note open in the editor is never touched;
  - a crash marker turns the model off if iOS kills the app (out of memory)
    mid-run.
- Without the model, rule-based tidy-up and to-do extraction run instead.

## Phases (each lands as its own commit)
1. Data layer + migration + Vercel API + sync engine + Settings.
2. Palate Keys keyboard + autocorrect.
3. Library / note editor / search / tags / links / history.
4. Recall strip, Markdown export, GitHub backup cron.

## One-time setup (owner)
1. Vercel → palatte → Storage → Create Database → **Neon** → connect to
   the project (injects `DATABASE_URL`).
2. Vercel → palatte → Settings → Environment Variables:
   `PALATE_TOKEN` = a long random passphrase.
3. Optional backup: `GITHUB_BACKUP_TOKEN` (fine-grained PAT, contents:write
   on one private repo), `GITHUB_BACKUP_REPO` = `owner/repo`, `CRON_SECRET`.
4. Redeploy, open the app → Settings → Sync → paste the token.
