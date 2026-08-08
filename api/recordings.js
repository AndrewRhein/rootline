// POST /api/recordings — logs a processed recording (transcript + whatever
// actions the AI ended up taking from it) for a durable audit trail. The
// actual audio lives in Blob storage (see api/upload.js, kind:"recording")
// — this just links the transcript and outcome to that file so "what did
// the AI do with this recording, and why" is always answerable later, not
// just visible in the moment as an on-screen log.
//
// GET  /api/recordings — lists recent recordings (newest first), for a
// future "recording history" view.
const { sql } = require("./lib/db");
const { requireAuth } = require("./lib/auth");

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  if (req.method === "GET") return listRecordings(req, res);
  if (req.method === "POST") return createRecording(req, res);
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method_not_allowed" });
};

async function createRecording(req, res) {
  const { blobUrl, transcript, actionsApplied } = req.body || {};
  if (!transcript || typeof transcript !== "string") {
    return res.status(400).json({ error: "invalid_request", message: "transcript is required" });
  }
  try {
    const id = "r" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    await sql`INSERT INTO recordings (id, blob_url, transcript, processed, actions_applied)
      VALUES (${id}, ${blobUrl || null}, ${transcript}, true, ${JSON.stringify(actionsApplied || [])})`;
    return res.status(200).json({ ok: true, id });
  } catch (err) {
    console.error("POST /api/recordings failed", err);
    return res.status(500).json({ error: "server_error", message: err.message });
  }
}

async function listRecordings(req, res) {
  try {
    const result = await sql`SELECT id, blob_url, transcript, processed, actions_applied, created_at
      FROM recordings ORDER BY created_at DESC LIMIT 50`;
    return res.status(200).json({ ok: true, recordings: result.rows });
  } catch (err) {
    console.error("GET /api/recordings failed", err);
    return res.status(500).json({ error: "server_error", message: err.message });
  }
}
