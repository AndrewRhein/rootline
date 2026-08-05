# Rootline — a family archive

A single-file, self-contained interactive concept demo: an oral-history recorder, a self-building family tree, tiered per-person privacy, and multi-source stories — all derived live from one shared graph, not hand-maintained in parallel.

Everything — markup, styles, and logic — lives in [`index.html`](index.html). No build step, no dependencies, no external requests (no CDNs, no web fonts, no API calls).

## Run it locally

Just open the file:

- Double-click [`index.html`](index.html), or
- Right-click → Open with → your browser

That's it — it's a plain static page, so there's nothing to install and no server required. Everything (your logged-in viewer, sharing tiers, collapsed branches, theme, drafts) persists to your browser's local storage between visits, scoped to wherever you're opening it from.

If you'd rather serve it locally instead of opening the file directly (e.g. to test it the way a browser would see it over HTTP), any static file server works:

```bash
python -m http.server 8080
```

then visit `http://localhost:8080`.

## Deploy it on GitHub Pages

1. Push this repo to GitHub.
2. In the repo's **Settings → Pages**, set the source to the `main` branch, root (`/`) folder.
3. GitHub serves `index.html` automatically at `https://<username>.github.io/<repo>/`.

No further configuration needed — same single file, no build.

## What's in the demo

- A tidy-tree layout that lays itself out from the family graph (parents/ties), with couple units, in-law satellite clusters, and collapsible branches.
- Two logged-in personas (Jim and Michelle) with independently scoped views — what's visible, and at what sharing tier, is computed per viewer rather than stored per person.
- Add/edit/remove/merge people directly from the tree, with undo.
- An oral-history recorder with a simulated transcript, extracted people/places/events, and a merge-into-timeline flow.
- Tiered privacy (Manage Access) with a visual tier-cycling UI on the tree itself.
- Zoom/pan/pinch on the tree canvas, plus a minimap overview.
- Generation- and family-branch color-coding, a relationship path finder, focus mode, a photo/document archive with albums and a lightbox, a timeline with tag filters, and a printable/exportable tree.

This is a UI/interaction concept demo — the "recording," "transcription," and "extraction" are simulated, not backed by a real speech or AI pipeline.
