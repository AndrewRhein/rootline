// Minimal shared-passphrase gate. This is a starting point, not a full
// auth system — see README "Auth model" for the tradeoffs and the upgrade
// path to per-person accounts if that's ever needed.
//
// The client sends the passphrase on every API call as `x-app-passphrase`.
// It's stored in localStorage client-side after the user enters it once at
// the login gate (see the APP_ACCESS check in index.html).
function requireAuth(req, res) {
  const expected = process.env.APP_PASSPHRASE;
  if (!expected) {
    // No passphrase configured — the operator has chosen to run without a
    // gate (e.g. a private preview deployment). Allow the request through.
    return true;
  }
  const provided = req.headers["x-app-passphrase"];
  if (provided === expected) return true;
  res.status(401).json({ error: "unauthorized", message: "Missing or incorrect passphrase." });
  return false;
}

module.exports = { requireAuth };
