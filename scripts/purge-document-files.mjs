// One-off: empty the finance-documents storage bucket (test uploads).
// Needs SUPABASE_SECRET_KEY in .env.local (service role). Run once, then delete.
//   node scripts/purge-document-files.mjs            # dry run (lists files)
//   node scripts/purge-document-files.mjs --delete   # actually deletes
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
if (!env.SUPABASE_SECRET_KEY) {
  console.error("SUPABASE_SECRET_KEY is empty in .env.local — add it (from Vercel env) and re-run.");
  process.exit(1);
}

const BUCKET = "finance-documents";
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Recursively collect every object path in the bucket.
async function listAll(prefix = "") {
  const out = [];
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw error;
  for (const entry of data ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) out.push(...(await listAll(path))); // folder
    else out.push(path);
  }
  return out;
}

const paths = await listAll();
console.log(`${paths.length} object(s) in ${BUCKET}:`);
for (const p of paths) console.log("  " + p);

if (!process.argv.includes("--delete")) {
  console.log("\nDry run. Re-run with --delete to remove them.");
  process.exit(0);
}
if (paths.length === 0) process.exit(0);

const { error } = await supabase.storage.from(BUCKET).remove(paths);
if (error) { console.error("✗ delete failed:", error.message); process.exit(1); }
console.log(`\n✓ deleted ${paths.length} object(s)`);
