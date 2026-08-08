// POST /api/upload
// Body: { filename: string, contentType: string, dataBase64: string, kind?: "photo"|"recording" }
// Uploads to Vercel Blob and returns the public URL. The client sends the
// file as a base64 data URL (it already reads files that way for the local
// preview), so this endpoint just strips the data: prefix and re-uploads
// the bytes to durable storage instead of keeping them in memory only.
const { put } = require("@vercel/blob");
const { requireAuth } = require("./lib/auth");

const MAX_BYTES = 15 * 1024 * 1024; // 15MB — a bit more headroom than the client's own 8MB image cap, to allow audio recordings through

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: "server_misconfigured", message: "BLOB_READ_WRITE_TOKEN is not set." });
  }

  const { filename, contentType, dataBase64, kind } = req.body || {};
  if (!dataBase64 || typeof dataBase64 !== "string") {
    return res.status(400).json({ error: "invalid_request", message: "dataBase64 is required" });
  }

  try {
    const commaIdx = dataBase64.indexOf(",");
    const raw = commaIdx > -1 && dataBase64.slice(0, commaIdx).indexOf("base64") > -1
      ? dataBase64.slice(commaIdx + 1)
      : dataBase64;
    const buffer = Buffer.from(raw, "base64");
    if (buffer.length > MAX_BYTES) {
      return res.status(413).json({ error: "file_too_large", message: "File exceeds the 15MB limit." });
    }

    const safeName = (filename || "upload").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const prefix = kind === "recording" ? "recordings" : "photos";
    const pathname = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

    const blob = await put(pathname, buffer, {
      access: "public",
      contentType: contentType || "application/octet-stream",
      addRandomSuffix: false,
    });

    return res.status(200).json({ ok: true, url: blob.url, pathname: blob.pathname });
  } catch (err) {
    console.error("POST /api/upload failed", err);
    return res.status(500).json({ error: "server_error", message: err.message });
  }
};
