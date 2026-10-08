import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@rfidhot/backend/db";
import { upsertMaterial } from "@rfidhot/backend/content/materials";
import { stopBoss } from "@rfidhot/backend/jobs/queue";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const EXTERNAL = `test-ingest-${T}`;
const OFFICIAL = `test-official-${T}`;
const DISABLED = `test-disabled-${T}`;
const FOREIGN = `test-foreign-${T}`;
const TOKEN = "audit-ingest-test-token-0123456789";
process.env.INGEST_TOKEN = TOKEN;
process.env.INGEST_SOURCE_IDS = [EXTERNAL, OFFICIAL, DISABLED].join(",");
const app = await buildApp();
before(async () => {
  await sql`INSERT INTO sources (id, name, kind, participation_mode, enabled)
    VALUES (${OFFICIAL}, 'Official', 'rss', 'editorial', true), (${DISABLED}, 'Paused', 'external', 'editorial', false),
           (${FOREIGN}, 'Other script', 'external', 'isolated', true)`;
});
after(async () => { await app.close(); await stopBoss(); await closeDb(); });
const request = (sourceId: string, token: string | null = TOKEN, items = [{ url: `https://example.com/ingest-${tag()}`, title: "Test RFID news" }]) =>
  app.inject({ method: "POST", url: "/api/ingest/items", headers: token === null ? {} : { authorization: `Bearer ${token}` }, payload: { sourceId, items } });

test("missing and incorrect ingest tokens cannot create sources", async () => {
  for (const token of [null, "wrong-token"]) assert.equal((await request(EXTERNAL, token)).statusCode, 401);
  const [row] = await sql`SELECT count(*)::int AS n FROM sources WHERE id = ${EXTERNAL}`;
  assert.equal(row!.n, 0);
});

test("an explicit source allowlist is required, even for existing external sources", async () => {
  assert.equal((await request(FOREIGN)).statusCode, 403);
  process.env.INGEST_SOURCE_IDS = "";
  try { assert.equal((await request(EXTERNAL)).statusCode, 403); }
  finally { process.env.INGEST_SOURCE_IDS = [EXTERNAL, OFFICIAL, DISABLED].join(","); }
  const [row] = await sql`SELECT count(*)::int AS n FROM sources WHERE id = ${EXTERNAL}`;
  assert.equal(row!.n, 0);
});

test("allowed new external sources stay isolated and can revise their own content", async () => {
  const url = `https://example.com/ingest-own-${T}`;
  assert.equal((await request(EXTERNAL, TOKEN, [{ url, title: "Original RFID announcement" }])).statusCode, 200);
  const [source] = await sql`SELECT kind, participation_mode, site_fulltext FROM sources WHERE id = ${EXTERNAL}`;
  assert.equal(source!.kind, "external");
  assert.equal(source!.participation_mode, "isolated");
  assert.equal(source!.site_fulltext, false);
  assert.equal((await request(EXTERNAL, TOKEN, [{ url, title: "Corrected RFID announcement" }])).statusCode, 200);
  const [row] = await sql`SELECT title, revision FROM articles WHERE source_id = ${EXTERNAL} AND url = ${url}`;
  assert.equal(row!.title, "Corrected RFID announcement");
  assert.equal(row!.revision, 2);
});

test("official and disabled sources cannot be written even when named in the allowlist", async () => {
  const url = `https://example.com/official-${T}`;
  const { articleId } = await upsertMaterial({ sourceId: OFFICIAL, url, title: "Official original", via: "fetch" });
  assert.equal((await request(OFFICIAL, TOKEN, [{ url, title: "Forged revision" }])).statusCode, 403);
  assert.equal((await request(DISABLED)).statusCode, 403);
  const [row] = await sql`SELECT title, revision FROM articles WHERE id = ${articleId}`;
  assert.equal(row!.title, "Official original");
  assert.equal(row!.revision, 1);
  const sources = await sql`SELECT last_ok_at FROM sources WHERE id IN (${OFFICIAL}, ${DISABLED})`;
  assert.ok(sources.every((s) => s.last_ok_at === null), "rejected push did not update source health");
});

test("oversized source IDs are rejected rather than truncated into an allowed source", async () => {
  assert.equal((await request("x".repeat(121))).statusCode, 400);
});
