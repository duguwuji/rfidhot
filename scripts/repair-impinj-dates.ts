// Dry-run by default. Fetch the original Impinj listing outside database transactions;
// apply locks each existing row and commits its date and public projection together.
// node --env-file=.env scripts/repair-impinj-dates.ts [--apply]
import { closeDb, sql } from "@rfidhot/backend/db";
import { fetchWebList } from "@rfidhot/backend/sources/web-list";
import { repairListedDates } from "@rfidhot/backend/sources/repair-dates";
import type { SourceRow } from "@rfidhot/backend/sources/types";

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== "--apply")) throw new Error("Usage: repair-impinj-dates.ts [--apply]");
  const [source] = await sql<SourceRow[]>`SELECT * FROM sources WHERE id = 'web-impinj-blog'`;
  if (!source || source.kind !== "web_list" || source.config.url !== "https://www.impinj.com/library/blog"
      || source.config.publishedAtSelector !== "small.feature-meta" || source.config.publishedAtUtcOffset !== "+00:00") {
    throw new Error("Expected the original Impinj blog source with migration 0042 applied; review customised sources separately");
  }
  const candidates = await fetchWebList(source);
  if (!candidates.length || !candidates.some((c) => c.publishedAt)) throw new Error("Listing returned no dated candidates; no repairs applied");
  console.log(JSON.stringify(await repairListedDates(source, candidates, args.includes("--apply")), null, 2));
} finally {
  await closeDb();
}
