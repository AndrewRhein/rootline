# Rootline — a family archive

A self-building family tree, tiered per-person privacy, multi-source stories, and a real AI-powered archivist: record a conversation, and Rootline transcribes it, reads it, and updates the archive itself — new people, corrected details, new relationships, new stories — with nothing to review or approve.

The frontend ([`index.html`](index.html)) is still a single self-contained file — no build step, no framework, no bundler. It works completely offline as a local file, exactly as before, seeded with a seven-generation demo family. Layered on top of it is a small set of Vercel serverless functions (`/api`) that give it a real, persistent backend: Postgres for the family graph, Blob storage for photos and recordings, and the Claude API for turning a recorded conversation into structured updates.

## Two ways to run this

| | Local file, no backend | Deployed on Vercel |
|---|---|---|
| How | Double-click `index.html`, or `python -m http.server` | `vercel deploy` (see below) |
| Data | The built-in demo family, in memory, reset on every reload | Real, persistent, shared across every device that opens the URL |
| Recording → AI | Shows a message that no backend is connected | Fully live — transcribes, reads, and updates the archive automatically |
| Photo/document upload | Kept as a local file preview only | Uploaded to durable storage (Vercel Blob) |

The frontend detects which situation it's in automatically (it tries `/api/graph` on load and falls back gracefully) — there's no mode switch to flip.

## Run it locally (no backend)

- Double-click [`index.html`](index.html), or
- `python -m http.server 8080` and visit `http://localhost:8080`

Nothing to install. This is the same standalone demo mode as before — useful for quickly showing someone the concept, or for local development on the UI itself.

## Setting up the real backend

This is what makes recording actually work, and makes every edit — by a person or by the AI — persist for good. It takes about 10 minutes the first time.

### 1. Get an Anthropic API key

Create one at [console.anthropic.com](https://console.anthropic.com) → API Keys. This is what the AI archivist runs on (Claude Opus 5, via the Anthropic API). You're billed per use — a typical recording-processing pass is a few cents.

### 2. Create a Vercel project

```bash
npm install -g vercel   # if you don't have it
vercel login
vercel link             # run from this repo's folder — creates/links a Vercel project
```

(Or connect the GitHub repo directly at [vercel.com/new](https://vercel.com/new) — either way works, the steps below are the same.)

### 3. Add storage

In the Vercel dashboard, on your project's **Storage** tab:

- **Create Database → Postgres** — this is where the family graph lives (people, relationships, timeline, photo metadata). Vercel wires up the connection env vars (`POSTGRES_URL` and friends) automatically.
- **Create Database → Blob** — this is where actual photo/document files and recorded audio are stored. Vercel wires up `BLOB_READ_WRITE_TOKEN` automatically.

### 4. Set the remaining environment variables

In **Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | The key from step 1 |
| `APP_PASSPHRASE` | Any passphrase only your family knows — see "Auth model" below |

### 5. Create the database tables

```bash
vercel env pull .env.local   # pulls the POSTGRES_URL etc. Vercel just set up
npm install
npm run db:init              # runs schema.sql against your new database, once
```

### 6. Deploy

```bash
vercel --prod
```

Open the deployed URL — the app will fetch `/api/graph`, find it empty, and seed the server with the built-in demo family on the first save. From there, every edit (by hand, or by recording a conversation) persists.

### Local dev against the real backend

```bash
vercel dev
```

This runs the static file and the `/api` functions together on `localhost`, using the env vars in `.env.local`.

## How the AI archivist works

There are two ways material gets into the archive automatically — recording a conversation, and uploading a document — and both end up going through the same fixed, small set of tools Claude is allowed to use: `create_person`, `edit_person`, `add_relationship`, `add_story`, `edit_story` (see [`api/lib/claude-tools.js`](api/lib/claude-tools.js)). Claude never invents its own way of editing the archive — it can only propose actions from that fixed vocabulary, matching how a human editing the app would make the same changes. Those proposed actions come back to the browser and are applied immediately, through the exact same functions a human-driven form submit uses (`addPerson`, `editPersonFields`, the spouse-tie logic, and so on — see `applyAiActions()` in `index.html`). There's no separate confirm/approve step: what actually got changed is logged on screen as it happens, so it's never a black box — just not a gate.

**Recording a conversation** (Record a Story) captures audio and produces a live transcript in the browser using the [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) — no extra API key or paid transcription service needed. It works well in Chrome and Edge; Safari and Firefox don't support it yet, so on those browsers you can paste or type a transcript instead (the "process this transcript" path is identical either way). When you stop, the full transcript — along with a snapshot of who's already in the archive — goes to `/api/process-transcript`. Every processed recording (its transcript, whatever actions the AI actually took, and a link to the saved audio) is logged via `/api/recordings` for a durable audit trail, independent of what's visible on screen in the moment.

**Uploading a document** (Photos & Documents) automatically gets read by the AI too, for file types it can actually read — PDFs and plain text go to `/api/process-document`, which sends the file itself to Claude (as a document or image content block) alongside the same fixed tool vocabulary. This is deliberately narrow: most uploads are just family photos with nothing to extract beyond what the caption already says, so the AI is instructed to call no tools at all unless the file clearly supports a specific fact. `.doc`/`.docx` files are saved but not auto-read (Claude doesn't accept that format directly).

## Auth model

The whole app — and every API call — is gated by a single shared passphrase (`APP_PASSPHRASE`), stored in the visitor's browser after they enter it once. This is intentionally simple: it's meant for one family, not a multi-tenant product, and everyone who has the URL and the passphrase has full read/write access to everything (there's no per-person login and no distinction between "Jim" and "Michelle" beyond the existing in-app persona switcher, which is just a UI lens on the same shared data, not an account system).

If you leave `APP_PASSPHRASE` unset, the backend runs with no gate at all — fine for a private preview deployment, not recommended once the URL is something you'd share.

**Upgrading this** (not built): real per-person accounts would mean adding an auth provider (e.g. NextAuth, Clerk, or Vercel's own), a `users` table, and changing `requireAuth()` in `api/lib/auth.js` to check a session instead of a static passphrase. The rest of the backend (the graph schema, the action vocabulary, the AI pipeline) wouldn't need to change.

## What's built vs. what's a natural next step

**Built and working end to end:** persistent storage for the whole family graph; real photo/document upload to durable storage; real microphone recording with live transcription; AI-driven extraction of people, relationship corrections, and stories from a recorded conversation *or* an uploaded PDF/text document, auto-applied with no review gate; every AI-sourced timeline entry visibly marked with where it came from (see the "from a recording" / "from a document" pills); a durable audit log of every processed recording; a shared-passphrase gate on the whole app and API.

**Natural extensions, not yet built:**
- Tagging existing photos to *people* via AI vision (the document pipeline reads text/content out of a file, but it doesn't attempt facial recognition or otherwise guess who's pictured in a plain photo with no accompanying text).
- Per-person accounts (see "Auth model" above).
- Real-time multi-device sync — right now every edit does a debounced full-snapshot save (`PUT /api/graph`); two people editing at the exact same moment on two devices would have the later save win, with no merge. Fine for how one family actually uses this, but worth knowing.
- `edit_story` only works on stories that already have a stable `id` (everything created through the app does; a couple of the original seed timeline entries were given ids too, but the rest of the seed data's vital-record entries weren't, since they're not really "stories" the AI would ever be asked to revise).
- `.doc`/`.docx` uploads are saved but not auto-read by the AI — Claude's document input only accepts PDF directly. Converting to PDF first (or just pasting the text) gets it read.

## What's in the demo family

- A tidy-tree layout that lays itself out from the family graph (parents/ties), with couple units, in-law satellite clusters, and collapsible branches — including the extended-family dotted-line clusters.
- Two logged-in personas (Jim and Michelle) with independently scoped views — what's visible, and at what sharing tier, is computed per viewer rather than stored per person.
- Add/edit/remove/merge people directly from the tree, with undo.
- Tiered privacy (Manage Access) with a visual tier-cycling UI on the tree itself.
- Zoom/pan/pinch on the tree canvas, plus a minimap overview.
- Generation- and family-branch color-coding, focus mode, a photo/document archive with albums and a lightbox, a timeline with tag filters, and a printable/exportable tree.
- Individual profile pages per person with an overview, timeline, stories, and photos tab.
