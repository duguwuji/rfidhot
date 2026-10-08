import "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { config } from "@rfidhot/backend/config";
import { closeDb, sql } from "@rfidhot/backend/db";
import { stopBoss } from "@rfidhot/backend/jobs/queue";
import { collectSource, scheduleDueSources, scheduleCollectionSlot } from "@rfidhot/backend/sources/collect";
import { nextCollectionAt } from "@rfidhot/industry/collection";
import { scheduleMpReconcile } from "@rfidhot/backend/sources/mp";
import { tag } from "./setup.ts";

const T = tag();
const migration = readFileSync(new URL("../database/migrations/0041_twice_daily_collection.sql", import.meta.url), "utf8");
const server = http.createServer((req, res) => {
  if (req.url === "/failed") {
    res.writeHead(503);
    res.end("temporarily unavailable");
    return;
  }
  res.writeHead(200, { "content-type": "application/rss+xml" });
  res.end('<?xml version="1.0"?><rss version="2.0"><channel><title>Quiet source</title></channel></rss>');
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const feedUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/feed.xml`;
config.allowPrivateNetworkFetch = true;

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await stopBoss();
  await closeDb();
});

test("the interval migration reschedules existing collectors without changing external sources", async () => {
  const rollback = new Error("rollback migration fixtures");
  await assert.rejects(sql.begin(async (tx) => {
    const recent = new Date(Date.now() - 3600_000);
    const old = new Date(Date.now() - 48 * 3600_000);
    const pending = new Date(Date.now() + 60_000);
    const ids = ["rss", "web_list", "json_list", "x_search", "mp_account"];
    for (const kind of ids) {
      await tx`INSERT INTO sources (id, name, kind, interval_minutes, last_fetch_at, next_fetch_at)
        VALUES (${`${kind}-${T}`}, ${kind}, ${kind}, 30, ${kind === "rss" ? old : kind === "mp_account" ? null : recent}, ${pending})`;
    }
    await tx`INSERT INTO sources (id, name, kind, interval_minutes, next_fetch_at)
      VALUES (${`external-${T}`}, 'External', 'external', 90, ${pending})`;
    await tx.unsafe(migration);
    const fixtureIds = [...ids.map((kind) => `${kind}-${T}`), `external-${T}`];
    const rows = await tx<{ id: string; kind: string; interval_minutes: number; next_fetch_at: Date }[]>`
      SELECT id, kind, interval_minutes, next_fetch_at FROM sources WHERE id = ANY(${fixtureIds}::text[])`;
    assert.equal(rows.length, 6);
    for (const row of rows) {
      assert.equal(row.interval_minutes, row.kind === "external" ? 90 : 720);
      if (row.kind === "external" || row.kind === "mp_account") assert.equal(row.next_fetch_at.getTime(), pending.getTime());
      else if (row.kind === "rss") assert.ok(Math.abs(row.next_fetch_at.getTime() - Date.now()) < 5000, "overdue sources remain due");
      else assert.equal(row.next_fetch_at.getTime(), recent.getTime() + 12 * 3600_000);
    }
    throw rollback;
  }), (error) => error === rollback);
});

test("a successful collection aligns to the next fixed slot without an early automatic fetch", async () => {
  const id = `rss-twice-daily-${T}`;
  const [created] = await sql<{ interval_minutes: number }[]>`
    INSERT INTO sources (id, name, kind, config, cursor)
    VALUES (${id}, 'Twice-daily RSS', 'rss', ${sql.json({ feedUrl })}, ${sql.json({ initializedAt: new Date().toISOString() })})
    RETURNING interval_minutes`;
  assert.equal(created!.interval_minutes, 720, "new rows default to twelve hours");
  const result = await collectSource(id);
  assert.equal(result.status, "ok");
  const [before] = await sql<{ last_fetch_at: Date; next_fetch_at: Date }[]>`SELECT last_fetch_at, next_fetch_at FROM sources WHERE id = ${id}`;
  assert.equal(before!.next_fetch_at.getTime(), nextCollectionAt(before!.last_fetch_at).getTime());
  await scheduleDueSources();
  const [after] = await sql<{ next_fetch_at: Date }[]>`SELECT next_fetch_at FROM sources WHERE id = ${id}`;
  assert.equal(after!.next_fetch_at.getTime(), before!.next_fetch_at.getTime());
});

test("a failed collection aligns to the next fixed slot", async () => {
  const id = `rss-twice-daily-failed-${T}`;
  await sql`INSERT INTO sources (id, name, kind, config)
    VALUES (${id}, 'Failed twice-daily RSS', 'rss', ${sql.json({ feedUrl: feedUrl.replace("/feed.xml", "/failed") })})`;
  const result = await collectSource(id);
  assert.equal(result.status, "failed");
  const [before] = await sql<{ last_fetch_at: Date; next_fetch_at: Date }[]>`SELECT last_fetch_at, next_fetch_at FROM sources WHERE id = ${id}`;
  assert.equal(before!.next_fetch_at.getTime(), nextCollectionAt(before!.last_fetch_at).getTime());
  await scheduleDueSources();
  const [after] = await sql<{ next_fetch_at: Date }[]>`SELECT next_fetch_at FROM sources WHERE id = ${id}`;
  assert.equal(after!.next_fetch_at.getTime(), before!.next_fetch_at.getTime());
});

test("fixed slots are stable across boundaries, midnight, year changes and host timezones", () => {
  for (const [from, to] of [
    ["2026-10-08T07:29:59+08:00", "2026-10-08T07:30:00+08:00"],
    ["2026-10-08T07:30:00+08:00", "2026-10-08T19:30:00+08:00"],
    ["2026-10-08T19:29:59+08:00", "2026-10-08T19:30:00+08:00"],
    ["2026-10-08T19:30:00+08:00", "2026-10-09T07:30:00+08:00"],
    ["2026-12-31T23:59:59+08:00", "2027-01-01T07:30:00+08:00"],
    ["2026-10-08T00:00:00+08:00", "2026-10-08T07:30:00+08:00"],
  ]) assert.equal(nextCollectionAt(new Date(from)).getTime(), new Date(to).getTime());
});

test("fixed-time migration aligns existing and paused collectors but preserves external pushes", async () => {
  const text = readFileSync(new URL("../database/migrations/0046_fixed_collection_times.sql", import.meta.url), "utf8");
  const rollback = new Error("rollback fixed-time fixtures");
  await assert.rejects(sql.begin(async (tx) => {
    const kinds = ["rss", "web_list", "json_list", "x_search", "mp_account", "external"];
    const pending = new Date("2025-01-01T00:00:00Z");
    for (const kind of kinds) await tx`INSERT INTO sources (id,name,kind,interval_minutes,next_fetch_at,enabled)
      VALUES (${`fixed-${kind}-${T}`},${kind},${kind},60,${pending},${kind !== "web_list"})`;
    await tx.unsafe(text);
    const [clock] = await tx<{ at: Date }[]>`SELECT now() AS at`;
    const rows = await tx<{ kind: string; interval_minutes: number; next_fetch_at: Date }[]>`SELECT kind,interval_minutes,next_fetch_at FROM sources WHERE id IN ${tx(kinds.map((kind) => `fixed-${kind}-${T}`))}`;
    for (const row of rows) {
      assert.equal(row.interval_minutes, row.kind === "external" ? 60 : 720);
      assert.equal(row.next_fetch_at.getTime(), row.kind === "external" ? pending.getTime() : nextCollectionAt(clock!.at).getTime());
    }
    throw rollback;
  }), (error) => error === rollback);
});

test("one fixed slot drains every batch and repeated scheduling does not duplicate sources", async () => {
  const ids = Array.from({ length: 5 }, (_, i) => `slot-batch-${T}-${i}`);
  for (const id of ids) await sql`INSERT INTO sources (id,name,kind,next_fetch_at) VALUES (${id},'Slot batch','rss',now()-interval '1 minute')`;
  const previous = process.env.FETCH_SCHEDULE_BATCH;
  process.env.FETCH_SCHEDULE_BATCH = "2";
  try {
    const result = await scheduleCollectionSlot();
    assert.ok(result.enqueued >= ids.length);
    const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.job WHERE name='sources.fetch' AND data->>'sourceId' IN ${sql(ids)}`;
    assert.equal(count!.n, ids.length);
    assert.deepEqual(await scheduleCollectionSlot(), { enqueued: 0, shards: 0 });
  } finally {
    if (previous === undefined) delete process.env.FETCH_SCHEDULE_BATCH; else process.env.FETCH_SCHEDULE_BATCH = previous;
  }
});

test("公众号 completion delays do not suppress a due fixed slot, or enqueue twice", async () => {
  const id = `mp-slot-${T}`;
  const now = new Date();
  await sql`INSERT INTO sources (id,name,kind,cursor,next_fetch_at) VALUES (${id},'MP slot','mp_account',${sql.json({ lastCheckedAt: new Date(now.getTime()-11*3600_000).toISOString() })},${now})`;
  const result = await scheduleMpReconcile(now);
  assert.ok(result.enqueued >= 1);
  const [row] = await sql<{ next_fetch_at: Date }[]>`SELECT next_fetch_at FROM sources WHERE id=${id}`;
  assert.equal(row!.next_fetch_at.getTime(), nextCollectionAt(now).getTime());
  assert.equal((await scheduleMpReconcile(now)).enqueued, 0);
});
