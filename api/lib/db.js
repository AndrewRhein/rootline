// Thin wrapper around @vercel/postgres. Every API route imports `sql` from
// here rather than the package directly, so there's one place to swap the
// backing store later if needed.
const { sql } = require("@vercel/postgres");

module.exports = { sql };
