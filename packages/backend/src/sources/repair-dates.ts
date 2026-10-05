// Maintenance only: repair existing rows from reviewed listing dates, never create material.
import { sql } from "../db.ts";
import { decideTimeline, repairMaterialDateTx } from "../content/materials.ts";
import { rewriteUrl } from "./collect.ts";
import type { Candidate, SourceRow } from "./types.ts";

export async function repairListedDates(source: SourceRow, candidates: Candidate[], apply = false) {
  const plan: Array<{
    id: string; url: string; title: string; previousTimelineAt: Date; publishedAt: Date;
    timelineAt: Date; backfill: boolean; backfillReason: string | null;
  }> = [];
  let repaired = 0;
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.publishedAt || !Number.isFinite(candidate.publishedAt.getTime())) continue;
    const { url } = rewriteUrl(candidate, source);
    if (seen.has(url)) continue;
    seen.add(url);
    const run = async (db: typeof sql | Parameters<typeof repairMaterialDateTx>[0]) => {
      if (apply) await db`SELECT pg_advisory_xact_lock(hashtext('publication_dates'))`;
      const [row] = await db<{
        id: string; title: string; discovered_at: Date; timeline_at: Date; backfill: boolean; backfill_reason: string | null;
      }[]>`SELECT id, title, discovered_at, timeline_at, backfill, backfill_reason FROM articles
        WHERE source_id = ${source.id} AND url = ${url} AND published_at IS NULL
        ${apply ? db`FOR UPDATE` : db``}`;
      if (!row) return;
      const t = decideTimeline(candidate.publishedAt, row.discovered_at,
        row.backfill_reason ?? (row.backfill ? "existing-backfill" : null));
      if (!t.publishedAt) return;
      if (apply) {
        const result = await repairMaterialDateTx(db as Parameters<typeof repairMaterialDateTx>[0], row.id, source.id, candidate.publishedAt!);
        if (!result) return;
        repaired++;
      }
      plan.push({ id: row.id, url, title: row.title, previousTimelineAt: row.timeline_at,
        publishedAt: t.publishedAt, timelineAt: t.timelineAt, backfill: t.backfill, backfillReason: t.backfillReason });
    };
    if (apply) await sql.begin(run);
    else await run(sql);
  }
  return { source: source.id, candidates: candidates.length, planned: plan.length, repaired, dryRun: !apply, plan };
}
