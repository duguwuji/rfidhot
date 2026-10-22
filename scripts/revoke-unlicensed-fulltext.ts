// Dry-run by default. Turns off website full text for every source without a verified reuse licence
// in industry/fulltext.ts. Each change goes through the admin updateSource path, so it is audited and
// the worker re-derives every public exit (site, Markdown, API, RSS) for that source's articles.
// node --env-file=.env scripts/revoke-unlicensed-fulltext.ts [--apply]
import { closeDb, sql } from "@rfidhot/backend/db";
import { updateSource } from "@rfidhot/backend/admin/sources";
import { FULLTEXT_LICENSES } from "@rfidhot/industry/fulltext";

const REASON = "收回未核验再使用许可的网站全文：仅保留摘要与原文链接（industry/fulltext.ts 之外的来源）";

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== "--apply")) throw new Error("Usage: revoke-unlicensed-fulltext.ts [--apply]");
  const apply = args.includes("--apply");
  const licensed = Object.keys(FULLTEXT_LICENSES);
  const rows = await sql<{ id: string; name: string; updated_at: Date; syndicate_fulltext: boolean }[]>`
    SELECT id, name, updated_at, syndicate_fulltext FROM sources
    WHERE site_fulltext AND NOT (id = ANY(${licensed})) ORDER BY id`;
  const plan = rows.map((r) => ({ id: r.id, name: r.name, site_fulltext: false, ...(r.syndicate_fulltext ? { syndicate_fulltext: false } : {}) }));
  if (apply) {
    for (const r of rows) {
      const patch = r.syndicate_fulltext ? { site_fulltext: false, syndicate_fulltext: false } : { site_fulltext: false };
      await updateSource(r.id, { patch, version: new Date(r.updated_at).toISOString(), reason: REASON }, "script:revoke-unlicensed-fulltext");
    }
  }
  console.log(JSON.stringify({ applied: apply, keptLicensed: licensed, revoked: plan }, null, 2));
} finally {
  await closeDb();
}
