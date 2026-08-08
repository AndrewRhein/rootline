-- Rootline schema — Vercel Postgres (Neon)
-- Run once via `npm run db:init` (see scripts/init-db.js), or paste into the
-- Vercel Postgres query console.
--
-- Mirrors the in-memory graph shape the client already uses (PEOPLE, PARENTS,
-- TIES, GENDER, TIMELINE, PHOTOS, GRANTS, BIO_PARENTS) so the client's
-- existing mutation logic and the server's snapshot sync stay in lockstep.

CREATE TABLE IF NOT EXISTS people (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  years       TEXT,               -- e.g. "1928–2004" or "b. 1990"
  gender      TEXT,                -- 'm' | 'f' | null
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Parent -> child edges (child_id references parents via parent_id, one row per edge)
CREATE TABLE IF NOT EXISTS parent_edges (
  child_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  parent_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (child_id, parent_id)
);

-- Biological-but-not-raising-parent edges (distinct from parent_edges)
CREATE TABLE IF NOT EXISTS bio_parent_edges (
  child_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  parent_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (child_id, parent_id)
);

-- Marriages / partnerships (unordered pair, stored as a<b for a stable key)
CREATE TABLE IF NOT EXISTS ties (
  person_a    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  person_b    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  status      TEXT,               -- e.g. 'married', 'divorced', null
  PRIMARY KEY (person_a, person_b)
);

-- Privacy-tier grants: who (owner) sees what tier of whom (subject)
CREATE TABLE IF NOT EXISTS grants (
  owner_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  subject_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  tier        INTEGER NOT NULL,
  PRIMARY KEY (owner_id, subject_id)
);

-- Timeline entries: life events AND stories (a story is a timeline entry
-- with a long-enough desc — see isStoryEntry() client-side)
CREATE TABLE IF NOT EXISTS timeline_entries (
  id          TEXT PRIMARY KEY,
  entry_date  TEXT,               -- free-text date, e.g. "1962" or "June 1975"
  title       TEXT,
  description TEXT,
  tags        TEXT[] DEFAULT '{}',
  people_ids  TEXT[] DEFAULT '{}',   -- people this entry mentions/tags
  pending     BOOLEAN DEFAULT false, -- AI-extracted but not yet confirmed
  source      TEXT,               -- 'manual' | 'ai_transcript' | 'ai_document'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Photos and documents
CREATE TABLE IF NOT EXISTS photos (
  id          TEXT PRIMARY KEY,
  glyph       TEXT,               -- emoji/icon fallback when no image
  caption     TEXT,
  meta        TEXT,               -- free-text "who / when"
  tags        TEXT[] DEFAULT '{}',
  people_ids  TEXT[] DEFAULT '{}',
  blob_url    TEXT,               -- Vercel Blob URL for the actual file
  is_image    BOOLEAN DEFAULT false,
  mime_type   TEXT,
  starred     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Raw recorded-conversation audio (kept as a backup alongside the transcript)
CREATE TABLE IF NOT EXISTS recordings (
  id          TEXT PRIMARY KEY,
  blob_url    TEXT NOT NULL,
  transcript  TEXT,
  processed   BOOLEAN DEFAULT false,
  actions_applied JSONB,          -- log of the actions the AI took from this recording
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timeline_people ON timeline_entries USING GIN (people_ids);
CREATE INDEX IF NOT EXISTS idx_photos_people ON photos USING GIN (people_ids);
