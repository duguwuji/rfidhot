import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@rfidhot/backend/db";
import { repairMaterialDateTx, upsertMaterial } from "@rfidhot/backend/content/materials";
import { getBoss, stopBoss } from "@rfidhot/backend/jobs/queue";
import { publishArticle } from "@rfidhot/backend/publication/publish";
import { repairListedDates } from "@rfidhot/backend/sources/repair-dates";
import type { SourceRow } from "@rfidhot/backend/sources/types";
import { applyMigration } from "../scripts/migrate.ts";

const SOURCE = `test-date-repair-${tag()}`;
const OTHER = `test-date-mirror-${tag()}`;
const DISCOVERED = new Date("2026-10-03T10:46:00Z");
const DATE = new Date("2025-07-15T00:00:00Z");
const AVERY = "web-avery-rfid";
const MIGRATION = "0044_backfill_repaired_source_dates.sql";
const migrationSql = readFileSync(new URL(`../database/migrations/${MIGRATION}`, import.meta.url), "utf8");
const averyConfig = { url: "https://rfid.averydennison.com/en/home/news-insights/press-releases.html", publishedAtUtcOffset: "+00:00" };

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, next_fetch_at)
    VALUES (${SOURCE}, 'Date repair', 'web_list', 'T1', '2100-01-01'),
      (${OTHER}, 'Mirror', 'web_list', 'T1', '2100-01-01')`;
  await sql`INSERT INTO sources (id, name, kind, tier, config, next_fetch_at)
    VALUES (${AVERY}, 'Avery', 'web_list', 'T1', ${sql.json(averyConfig)}, '2100-01-01')`;
  await getBoss();
});
after(async () => { await stopBoss(); await closeDb(); });

async function fixture(options: { sourceId?: string; bodyText?: string; backfill?: string; selected?: boolean } = {}) {
  const input = { sourceId: options.sourceId ?? SOURCE, url: `https://example.com/date-${tag()}`, title: "RFID release",
    bodyText: options.bodyText ?? "Original RFID content", backfill: options.backfill, discoveredAt: DISCOVERED, via: "fetch" as const };
  const { articleId: id } = await upsertMaterial(input);
  await sql`UPDATE articles SET processing_state = 'analyzed' WHERE id = ${id}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, reason_zh, score, selected)
    VALUES (${id}, 1, 'rule', 'pass', 'technology', 'RFID 新闻', '摘要', '理由', 90, ${options.selected ?? true})`;
  await publishArticle(id, { releasedAt: DISCOVERED });
  return { id, input };
}

async function snapshot(id: string) {
  const [a] = await sql`SELECT published_at, published_at_claim, timeline_at, discovered_at, backfill, backfill_reason,
    revision, content_hash, processing_state FROM articles WHERE id = ${id}`;
  const [p] = await sql`SELECT published_at, timeline_at, sort_at, backfill, visibility, eligible, selected,
    selected_ready_at, visible_after FROM publications WHERE article_id = ${id}`;
  const ledger = await sql`SELECT seq, payload FROM selected_ledger WHERE article_id = ${id} ORDER BY seq`;
  const jobs = await sql`SELECT id FROM pgboss.job WHERE data->>'articleId' = ${id}`;
  return { a, p, ledger, jobs };
}

test("unchanged content repairs dates and selected sync atomically, with no revision or jobs", async () => {
  const { id, input } = await fixture();
  const before = await snapshot(id);
  const result = await upsertMaterial({ ...input, publishedAt: DATE, discoveredAt: new Date("2026-11-01") });
  assert.equal(result.datesRepaired, true);
  assert.equal(result.revised, false);
  const after = await snapshot(id);
  assert.equal(after.a.published_at.toISOString(), DATE.toISOString());
  assert.equal(after.a.timeline_at.toISOString(), DATE.toISOString());
  assert.equal(after.a.discovered_at.toISOString(), DISCOVERED.toISOString());
  for (const key of ["revision", "content_hash", "processing_state"]) assert.equal(after.a[key], before.a[key]);
  assert.equal(after.a.backfill_reason, "stale-on-discovery");
  assert.equal(after.p.published_at.toISOString(), DATE.toISOString());
  assert.equal(after.p.sort_at.toISOString(), DATE.toISOString());
  assert.deepEqual(after.jobs, before.jobs);
  assert.equal(after.ledger.length, before.ledger.length + 1);
  assert.equal(after.ledger.at(-1)!.payload.publishedAt, DATE.toISOString());
  assert.deepEqual(await upsertMaterial({ ...input, publishedAt: DATE }),
    { articleId: id, created: false, revised: false, backfill: true });
  assert.deepEqual(await snapshot(id), after, "repeating the repair is a no-op");
});

test("a date arriving with a real content change is repaired as well", async () => {
  const { id, input } = await fixture();
  const result = await upsertMaterial({ ...input, title: "Updated RFID release", publishedAt: DATE });
  assert.equal(result.revised, true);
  assert.equal(result.datesRepaired, true);
  assert.equal((await snapshot(id)).p.published_at.toISOString(), DATE.toISOString());
});

test("mirrors and invalid/future claims cannot repair an owner's date; known dates are preserved", async () => {
  const { id, input } = await fixture();
  const before = await snapshot(id);
  await upsertMaterial({ ...input, sourceId: OTHER, publishedAt: DATE });
  await upsertMaterial({ ...input, publishedAt: new Date(DISCOVERED.getTime() + 3_600_001) });
  // Test repair validation directly: invalid Dates are not serialisable as new material claims.
  await sql.begin((tx) => repairMaterialDateTx(tx, id, SOURCE, new Date(NaN)));
  assert.deepEqual(await snapshot(id), before);
  await upsertMaterial({ ...input, publishedAt: DATE });
  const repaired = await snapshot(id);
  await upsertMaterial({ ...input, publishedAt: new Date("2025-08-01") });
  assert.deepEqual(await snapshot(id), repaired);
});

test("preserves first-import and legacy backfill, unpublished rows and editorial visibility", async () => {
  const { id, input } = await fixture({ backfill: "first-import" });
  await sql`UPDATE publications SET visibility = 'summary-only' WHERE article_id = ${id}`;
  await upsertMaterial({ ...input, publishedAt: DATE });
  assert.equal((await snapshot(id)).a.backfill_reason, "first-import");
  assert.equal((await snapshot(id)).p.visibility, "summary-only");
  const unpublished = await upsertMaterial({ ...input, url: `${input.url}-unpublished` });
  await sql`UPDATE articles SET backfill = true, backfill_reason = NULL WHERE id = ${unpublished.articleId}`;
  await upsertMaterial({ ...input, url: `${input.url}-unpublished`, publishedAt: DATE });
  const s = await snapshot(unpublished.articleId);
  assert.equal(s.a.backfill, true);
  assert.equal(s.p, undefined);
  assert.equal(s.jobs.length, 0);
});

test("date repair refreshes selected fact mates' sorting anchor without changing their dates", async () => {
  const a = await fixture({ selected: false });
  const b = await fixture();
  const [fact] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, title) VALUES (${tag()}, 'RFID fact') RETURNING id`;
  for (const id of [a.id, b.id]) {
    await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${id}, 'report')`;
    await publishArticle(id, { releasedAt: DISCOVERED });
  }
  const previous = await snapshot(b.id);
  await upsertMaterial({ ...a.input, publishedAt: DATE });
  const next = await snapshot(b.id);
  assert.equal(next.p.sort_at.toISOString(), DATE.toISOString());
  assert.equal(next.p.timeline_at.toISOString(), DISCOVERED.toISOString());
  assert.deepEqual(next.ledger, previous.ledger);
});

test("a projection failure rolls the article date back for a retry", async () => {
  const { id } = await fixture();
  const before = await snapshot(id);
  // Force the ledger's real INSERT to fail after the article and projection updates.
  await assert.rejects(sql.begin(async (tx) => {
    await tx`ALTER TABLE selected_ledger ADD CONSTRAINT test_date_repair_failure CHECK (payload->>'publishedAt' IS NULL) NOT VALID`;
    await repairMaterialDateTx(tx, id, SOURCE, DATE);
  }));
  assert.deepEqual(await snapshot(id), before);
  await sql.begin((tx) => repairMaterialDateTx(tx, id, SOURCE, DATE));
  assert.equal((await snapshot(id)).a.published_at.toISOString(), DATE.toISOString());
});

test("listing dry-run writes nothing; apply uses canonical URLs, locks and preserves concurrent dates", async () => {
  const { id, input } = await fixture();
  const [source] = await sql<SourceRow[]>`SELECT * FROM sources WHERE id = ${SOURCE}`;
  source!.config.itemUrlPrefixRewrite = { from: "https://listing.example/", to: "https://example.com/" };
  const candidates = [{ ...input, url: input.url.replace("https://example.com/", "https://listing.example/"), publishedAt: DATE }];
  const before = await snapshot(id);
  const preview = await repairListedDates(source!, candidates);
  assert.equal(preview.planned, 1);
  assert.equal(preview.repaired, 0);
  assert.deepEqual(await snapshot(id), before);
  const results = await Promise.all([repairListedDates(source!, candidates, true), repairListedDates(source!, candidates, true)]);
  assert.equal(results.reduce((sum, r) => sum + r.repaired, 0), 1);
  assert.equal((await repairListedDates(source!, candidates, true)).repaired, 0);
  assert.equal((await repairListedDates(source!, [{ ...candidates[0], url: `${input.url}-absent` }], true)).repaired, 0);
  const newer = await fixture();
  await repairListedDates(source!, [{ ...newer.input, publishedAt: new Date("2025-08-01") }]);
  await upsertMaterial({ ...newer.input, publishedAt: DATE });
  assert.equal((await repairListedDates(source!, [{ ...newer.input, publishedAt: new Date("2025-08-01") }], true)).repaired, 0);
  assert.equal((await snapshot(newer.id)).a.published_at.toISOString(), DATE.toISOString());
});

test("0044 repairs verified stored datelines, skips invalid/narrative/month-only dates, and is idempotent", async () => {
  const samples: Array<[string, string | null]> = [
    ["Headline GLENDALE, Calif. – March 02, 2020, Avery Dennison announces RFID.", "2020-03-02"],
    ["Oegstgeest, NL 20 October 2022: RFID launch.", "2022-10-20"],
    ["Düsseldorf, November 21th 2022 - payfree provides RFID checkout.", "2022-11-21"],
    ["MENTOR, Ohio, 25th June, 2025 — Recyclable RFID release.", "2025-06-25"],
    ["GLENDALE, Calif. – 23 September, 2021, RFID release.", "2021-09-23"],
    ["SÃO PAULO, APRIL 6, 2022, Avery Dennison announces RFID.", "2022-04-06"],
    ["MENTOR, OH – February 29, 2024 — Leap-day release.", "2024-02-29"],
    ["MENTOR, OH – February 31, 2024 — Invalid day.", null],
    ["MENTOR, OH – February 29, 2023 — Non-leap year.", null],
    ["São Paulo, January 2020 – Plans reference a meeting on March 2, 2020.", null],
    ["An RFID story references March 2, 2020 in its narrative.", null],
    ["MENTOR, OH – October 3, 2027 — Future claim.", null],
  ];
  const rows = await Promise.all(samples.map(([bodyText]) => fixture({ sourceId: AVERY, bodyText })));
  await sql.begin((tx) => applyMigration(tx, MIGRATION, migrationSql));
  for (const [i, row] of rows.entries()) {
    const s = await snapshot(row.id);
    const expected = samples[i][1];
    assert.equal(s.a.published_at?.toISOString() ?? null, expected ? `${expected}T00:00:00.000Z` : null);
    assert.equal(s.p.published_at?.toISOString() ?? null, s.a.published_at?.toISOString() ?? null);
    assert.equal(s.a.revision, 1);
    assert.equal(s.a.processing_state, "analyzed");
    assert.equal(s.jobs.length, 0);
    if (expected) assert.equal(s.ledger.at(-1)!.payload.publishedAt, s.a.published_at.toISOString());
  }
  const before = await Promise.all(rows.map((row) => snapshot(row.id)));
  await sql.begin((tx) => applyMigration(tx, MIGRATION, migrationSql));
  assert.deepEqual(await Promise.all(rows.map((row) => snapshot(row.id))), before);
});

test("0044 respects customised source endpoints", async () => {
  const { id } = await fixture({ sourceId: AVERY, bodyText: "MENTOR, OH – January 1, 2020 — Release." });
  await sql`UPDATE sources SET config = '{"url":"https://example.com/custom"}' WHERE id = ${AVERY}`;
  try {
    await sql.begin((tx) => applyMigration(tx, MIGRATION, migrationSql));
    assert.equal((await snapshot(id)).a.published_at, null);
  } finally {
    await sql`UPDATE sources SET config = ${sql.json(averyConfig)} WHERE id = ${AVERY}`;
  }
});
