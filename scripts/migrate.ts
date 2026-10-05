// Applies database/migrations/*.sql in order, each in its own transaction. Safe to re-run.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "@rfidhot/backend/config";
import { closeDb, sql, type Tx } from "@rfidhot/backend/db";
import { repairMaterialDateTx } from "@rfidhot/backend/content/materials";

/** SQL and the 0044 publication repair commit together, including the selected sync ledger. */
export async function applyMigration(tx: Tx, file: string, text: string): Promise<number> {
  const repairsDates = file === "0044_backfill_repaired_source_dates.sql";
  if (repairsDates) await tx`SELECT pg_advisory_xact_lock(hashtext('publication_dates'))`;
  await tx.unsafe(text);
  let repaired = 0;
  if (repairsDates) {
    const rows = await tx<{ id: string; claimed: Date }[]>`SELECT id, claimed FROM repaired_source_dates ORDER BY id`;
    for (const row of rows) if (await repairMaterialDateTx(tx, row.id, "web-avery-rfid", row.claimed)) repaired++;
  }
  return repaired;
}

async function migrate() {
  const dir = path.join(REPO_ROOT, "database/migrations");
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
  let count = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    const text = readFileSync(path.join(dir, file), "utf8");
    const repaired = await sql.begin(async (tx) => {
      const repaired = await applyMigration(tx, file, text);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      return repaired;
    });
    console.log(`applied ${file}${file === "0044_backfill_repaired_source_dates.sql" ? ` (${repaired} dates repaired)` : ""}`);
    count += 1;
  }
  console.log(count === 0 ? "database is up to date" : `${count} migration(s) applied`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await migrate();
  } finally {
    await closeDb();
  }
}
