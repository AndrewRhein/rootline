// One-time setup: creates the tables in schema.sql against whatever
// Postgres connection Vercel's env vars point at.
//
// Usage:
//   vercel env pull .env.local     (pulls POSTGRES_* vars from your project)
//   npm run db:init
const fs = require("fs");
const path = require("path");

// Loads .env.local without adding a dependency on `dotenv`.
function loadDotEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  });
}

async function main() {
  loadDotEnvLocal();
  if (!process.env.POSTGRES_URL) {
    console.error(
      "POSTGRES_URL is not set. Run `vercel env pull .env.local` from a project linked to your " +
        "Vercel Postgres database first (see README.md → Setting up the backend)."
    );
    process.exit(1);
  }

  const { sql } = require("@vercel/postgres");
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");

  // Split on statement-terminating semicolons; @vercel/postgres runs one
  // statement per query.
  const statements = schema
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length && !s.startsWith("--"));

  for (const statement of statements) {
    console.log("Running:", statement.split("\n")[0].slice(0, 80) + "...");
    await sql.query(statement);
  }

  console.log(`Done — ${statements.length} statements applied.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
