// GET  /api/graph  -> the full family graph, shaped exactly like the
//                     client's in-memory PEOPLE/PARENTS/TIES/... objects,
//                     so the client can hydrate straight into those vars.
// PUT  /api/graph  -> replace the whole graph with the client's current
//                     in-memory snapshot. Simple last-write-wins persistence
//                     for a small, low-concurrency single-family app —
//                     every human edit (add/edit/remove person, spouse tie,
//                     tier grant, story, photo) round-trips through this
//                     after refreshDerivedState() runs.
//
// Auth: a single shared passphrase gates every request (see requireAuth in
// api/lib/auth.js). This is intentionally simple — see README for the
// upgrade path if per-person accounts are ever needed.
const { sql } = require("./lib/db");
const { requireAuth } = require("./lib/auth");

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  if (req.method === "GET") return getGraph(req, res);
  if (req.method === "PUT") return putGraph(req, res);
  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ error: "method_not_allowed" });
};

async function getGraph(req, res) {
  try {
    const [peopleRows, parentRows, bioRows, tieRows, grantRows, timelineRows, photoRows] =
      await Promise.all([
        sql`SELECT id, name, years, gender FROM people`,
        sql`SELECT child_id, parent_id FROM parent_edges`,
        sql`SELECT child_id, parent_id FROM bio_parent_edges`,
        sql`SELECT person_a, person_b, status FROM ties`,
        sql`SELECT owner_id, subject_id, tier FROM grants`,
        sql`SELECT id, entry_date, title, description, tags, people_ids, pending, source FROM timeline_entries ORDER BY entry_date NULLS LAST`,
        sql`SELECT id, glyph, caption, meta, tags, people_ids, blob_url, is_image, mime_type, starred FROM photos`,
      ]);

    if (peopleRows.rows.length === 0) {
      // Nothing persisted yet — tell the client to keep using its built-in
      // seed data rather than hydrating into an empty archive.
      return res.status(200).json({ empty: true });
    }

    const PEOPLE = {};
    const GENDER = {};
    peopleRows.rows.forEach((r) => {
      PEOPLE[r.id] = { name: r.name, years: r.years || "" };
      if (r.gender) GENDER[r.id] = r.gender;
    });

    const PARENTS = {};
    parentRows.rows.forEach((r) => {
      (PARENTS[r.child_id] = PARENTS[r.child_id] || []).push(r.parent_id);
    });

    const BIO_PARENTS = {};
    bioRows.rows.forEach((r) => {
      (BIO_PARENTS[r.child_id] = BIO_PARENTS[r.child_id] || []).push(r.parent_id);
    });

    const TIES = tieRows.rows.map((r) => [r.person_a, r.person_b]);

    const GRANTS = {};
    grantRows.rows.forEach((r) => {
      GRANTS[r.subject_id] = GRANTS[r.subject_id] || { t3: [] };
      if (r.tier >= 3) GRANTS[r.subject_id].t3.push(r.owner_id);
    });

    const TIMELINE = timelineRows.rows.map((r) => ({
      id: r.id,
      date: r.entry_date || "",
      title: r.title || "",
      desc: r.description || "",
      tags: r.tags || [],
      people: r.people_ids || [],
      pending: !!r.pending,
      source: r.source || "manual",
    }));

    const PHOTOS = photoRows.rows.map((r) => ({
      id: r.id,
      glyph: r.glyph || "\u{1F5BC}\u{FE0F}",
      cap: r.caption || "",
      meta: r.meta || "",
      tags: (r.people_ids || []).map((pid) => ({ id: pid })),
      starred: !!r.starred,
      dataUrl: r.blob_url || undefined,
      isImage: !!r.is_image,
    }));

    return res.status(200).json({
      empty: false,
      PEOPLE,
      GENDER,
      PARENTS,
      BIO_PARENTS,
      TIES,
      GRANTS,
      TIMELINE,
      PHOTOS,
    });
  } catch (err) {
    console.error("GET /api/graph failed", err);
    return res.status(500).json({ error: "server_error", message: err.message });
  }
}

async function putGraph(req, res) {
  const body = req.body || {};
  const PEOPLE = body.PEOPLE || {};
  const GENDER = body.GENDER || {};
  const PARENTS = body.PARENTS || {};
  const BIO_PARENTS = body.BIO_PARENTS || {};
  const TIES = Array.isArray(body.TIES) ? body.TIES : [];
  const GRANTS = body.GRANTS || {};
  const TIMELINE = Array.isArray(body.TIMELINE) ? body.TIMELINE : [];
  const PHOTOS = Array.isArray(body.PHOTOS) ? body.PHOTOS : [];

  const peopleIds = Object.keys(PEOPLE);
  if (!peopleIds.length) {
    return res.status(400).json({ error: "invalid_request", message: "PEOPLE is required and cannot be empty" });
  }

  try {
    // Whole-graph replace inside one transaction — simplest correct
    // approach at this scale; a partial write here would corrupt the
    // family record, so all-or-nothing beats fine-grained diffing.
    await sql`BEGIN`;
    try {
      await sql`DELETE FROM photos`;
      await sql`DELETE FROM timeline_entries`;
      await sql`DELETE FROM grants`;
      await sql`DELETE FROM ties`;
      await sql`DELETE FROM bio_parent_edges`;
      await sql`DELETE FROM parent_edges`;
      await sql`DELETE FROM people`;

      for (const id of peopleIds) {
        const p = PEOPLE[id];
        await sql`INSERT INTO people (id, name, years, gender) VALUES (${id}, ${p.name}, ${p.years || null}, ${GENDER[id] || null})`;
      }
      for (const childId of Object.keys(PARENTS)) {
        for (const parentId of PARENTS[childId] || []) {
          if (!PEOPLE[parentId]) continue; // guard against dangling refs
          await sql`INSERT INTO parent_edges (child_id, parent_id) VALUES (${childId}, ${parentId}) ON CONFLICT DO NOTHING`;
        }
      }
      for (const childId of Object.keys(BIO_PARENTS)) {
        for (const parentId of BIO_PARENTS[childId] || []) {
          if (!PEOPLE[parentId]) continue;
          await sql`INSERT INTO bio_parent_edges (child_id, parent_id) VALUES (${childId}, ${parentId}) ON CONFLICT DO NOTHING`;
        }
      }
      for (const tie of TIES) {
        const [a, b] = tie;
        if (!PEOPLE[a] || !PEOPLE[b]) continue;
        await sql`INSERT INTO ties (person_a, person_b) VALUES (${a}, ${b}) ON CONFLICT DO NOTHING`;
      }
      for (const subjectId of Object.keys(GRANTS)) {
        const t3 = (GRANTS[subjectId] && GRANTS[subjectId].t3) || [];
        for (const ownerId of t3) {
          if (!PEOPLE[ownerId] || !PEOPLE[subjectId]) continue;
          await sql`INSERT INTO grants (owner_id, subject_id, tier) VALUES (${ownerId}, ${subjectId}, 3) ON CONFLICT DO NOTHING`;
        }
      }
      for (const entry of TIMELINE) {
        const id = entry.id || cryptoRandomId();
        const peopleIdsForEntry = (entry.people || []).filter((pid) => PEOPLE[pid]);
        await sql`INSERT INTO timeline_entries (id, entry_date, title, description, tags, people_ids, pending, source)
          VALUES (${id}, ${entry.date || null}, ${entry.title || null}, ${entry.desc || null}, ${entry.tags || []}, ${peopleIdsForEntry}, ${!!entry.pending}, ${entry.source || "manual"})`;
      }
      for (const photo of PHOTOS) {
        const id = photo.id || cryptoRandomId();
        const peopleIdsForPhoto = (photo.tags || []).filter((t) => t && t.id && PEOPLE[t.id]).map((t) => t.id);
        await sql`INSERT INTO photos (id, glyph, caption, meta, tags, people_ids, blob_url, is_image, starred)
          VALUES (${id}, ${photo.glyph || null}, ${photo.cap || null}, ${photo.meta || null}, ${[]}, ${peopleIdsForPhoto}, ${photo.dataUrl && photo.dataUrl.indexOf("http") === 0 ? photo.dataUrl : null}, ${!!photo.isImage}, ${!!photo.starred})`;
      }
      await sql`COMMIT`;
    } catch (innerErr) {
      await sql`ROLLBACK`;
      throw innerErr;
    }

    return res.status(200).json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error("PUT /api/graph failed", err);
    return res.status(500).json({ error: "server_error", message: err.message });
  }
}

function cryptoRandomId() {
  return "e" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
