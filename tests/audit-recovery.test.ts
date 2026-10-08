import { gate, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@rfidhot/backend/db";
import { autoReleaseUnknownReceipts, releaseReceipt } from "@rfidhot/backend/admin/runs";
import { reconcileVisibilityOverrides, setVisibility } from "@rfidhot/backend/admin/content";
import { ANALYSIS_PURPOSES } from "@rfidhot/backend/editorial/purposes";
import { upsertMaterial } from "@rfidhot/backend/content/materials";
import { ensureQueue, QUEUES, stopBoss } from "@rfidhot/backend/jobs/queue";
import { markStalePendingReceipts } from "@rfidhot/backend/providers/receipts";
import { publishArticle } from "@rfidhot/backend/publication/publish";
import { loadItemDetail } from "@rfidhot/backend/publication/detail";

const T = tag();
const SOURCE = `test-audit-recovery-${T}`;
before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, site_fulltext, next_fetch_at)
            VALUES (${SOURCE}, 'Audit recovery', 'rss', 'T1', 'editorial', true, '2100-01-01')`;
  await ensureQueue(QUEUES.analyze);
});
after(async () => { await stopBoss(); await closeDb(); });

async function article(selected = false) {
  const { articleId: id } = await upsertMaterial({ sourceId: SOURCE, title: `Audit ${tag()}`, url: `https://example.com/${tag()}`,
    language: "en", bodyText: `Original body ${T}`.repeat(20), bodyHtml: `<p>Original body ${T}</p>`, bodyStatus: "ok", via: "fetch" });
  if (selected) {
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, reason_zh, score, selected)
              VALUES (${id}, 1, 'rule', 'pass', 'technology', '审计文章', '摘要', '理由', 90, true)`;
    await publishArticle(id, { releasedAt: new Date(Date.now() - 60_000) });
  }
  return id;
}

async function receipt(articleId: string, purpose: string, status = "unknown", revision = 1) {
  const [r] = await sql<{ id: number }[]>`
    INSERT INTO receipts (logical_key, service, purpose, subject, status, attempts, updated_at)
    VALUES (${`audit-${tag()}`}, 'audit-local', ${purpose}, ${`article:${articleId}@${revision}`}, ${status}, 1, now() - interval '31 minutes') RETURNING id`;
  await sql`INSERT INTO receipt_attempts (receipt_id, attempt, service, status) VALUES (${r!.id}, 1, 'audit-local', ${status === "completed" ? "received" : status})`;
  return r!.id;
}
const failed = (id: string, receiptId: number) => sql`UPDATE articles SET processing_state = 'failed', processing_attempts = 2,
  processing_error = ${`receipt ${receiptId} outcome unknown`} WHERE id = ${id}`;

for (const mode of ["manual", "automatic"]) {
  test(`${mode} receipt release atomically requeues every analysis purpose once`, async () => {
    for (const purpose of Object.values(ANALYSIS_PURPOSES)) {
      const id = await article();
      const r = await receipt(id, purpose);
      await failed(id, r);
      if (mode === "manual") assert.equal((await releaseReceipt(r, { billed: false, note: "test release" }, "test"))?.requeued, true);
      else assert.equal((await autoReleaseUnknownReceipts()).requeued, 1);
      const [a] = await sql`SELECT processing_state, processing_attempts, processing_error FROM articles WHERE id = ${id}`;
      assert.equal(a!.processing_state, "new");
      assert.equal(a!.processing_attempts, 0);
      assert.equal(a!.processing_error, null);
      const [status] = await sql`SELECT status FROM receipts WHERE id = ${r}`;
      assert.equal(status!.status, "failed");
      if (mode === "manual") await assert.rejects(releaseReceipt(r, { billed: false, note: "repeat" }, "test"), /只有结果未知/);
      else await autoReleaseUnknownReceipts();
      const [jobs] = await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name = ${QUEUES.analyze} AND data->>'articleId' = ${id}`;
      assert.equal(jobs!.n, 1);
    }
  });
}

test("releasing a receipt from an older revision does not reset a newer article's failure", async () => {
  const id = await article();
  const r = await receipt(id, ANALYSIS_PURPOSES.score);
  await failed(id, r);
  await sql`UPDATE articles SET revision = 2, processing_error = 'new revision failure' WHERE id = ${id}`;
  assert.equal((await releaseReceipt(r, { billed: false, note: "old answer" }, "test"))?.requeued, false);
  const [a] = await sql`SELECT processing_state, processing_error FROM articles WHERE id = ${id}`;
  assert.equal(a!.processing_state, "failed");
  assert.equal(a!.processing_error, "new revision failure");
});

async function failingTrigger(table: string, predicate: string, name: string) {
  await sql.unsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit injected failure'; END $$`);
  await sql.unsafe(`CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW WHEN (${predicate}) EXECUTE FUNCTION ${name}()`);
  return async () => {
    await sql.unsafe(`DROP TRIGGER ${name} ON ${table}`);
    await sql.unsafe(`DROP FUNCTION ${name}()`);
  };
}

test("a queue failure rolls back receipt release, article recovery and audit together", async () => {
  const id = await article();
  const r = await receipt(id, ANALYSIS_PURPOSES.prefilter);
  await failed(id, r);
  const remove = await failingTrigger("pgboss.job", `NEW.name = '${QUEUES.analyze}' AND NEW.data->>'articleId' = '${id}'`, `audit_queue_${T}`);
  try {
    await assert.rejects(releaseReceipt(r, { billed: false, note: "queue failure" }, "test"), /audit injected failure/);
    const [row] = await sql`SELECT r.status, a.processing_state FROM receipts r JOIN articles a ON a.id = ${id} WHERE r.id = ${r}`;
    assert.equal(row!.status, "unknown");
    assert.equal(row!.processing_state, "failed");
    const [audit] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject = ${`receipt:${r}`}`;
    assert.equal(audit!.n, 0);
  } finally { await remove(); }
  assert.equal((await releaseReceipt(r, { billed: false, note: "retry" }, "test"))?.requeued, true);
});

test("a failed withdrawal leaves neither an override nor a partially updated public projection", async () => {
  const id = await article(true);
  const [ledger] = await sql`SELECT count(*)::int AS n FROM selected_ledger WHERE article_id = ${id}`;
  const remove = await failingTrigger("publications", `NEW.article_id = '${id}'`, `audit_withdraw_${T}`);
  try {
    await assert.rejects(setVisibility(id, { visibility: "withdrawn", version: 0, reason: "test withdrawal" }, "test"), /audit injected failure/);
    const [override] = await sql`SELECT count(*)::int AS n FROM editorial_overrides WHERE article_id = ${id}`;
    const [audit] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject = ${`content:${id}`}`;
    const [currentLedger] = await sql`SELECT count(*)::int AS n FROM selected_ledger WHERE article_id = ${id}`;
    assert.equal(override!.n, 0);
    assert.equal(audit!.n, 0);
    assert.equal(currentLedger!.n, ledger!.n);
    assert.equal((await loadItemDetail(id)).kind, "found", "failed transaction preserved the original state");
  } finally { await remove(); }
  await setVisibility(id, { visibility: "withdrawn", version: 0, reason: "retry withdrawal" }, "test");
  assert.equal((await loadItemDetail(id)).kind, "not_found");
  const [audit] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject = ${`content:${id}`} AND action = 'content.visibility'`;
  assert.equal(audit!.n, 1);
});

test("concurrent visibility writes from the same version have one winner", async () => {
  const id = await article(true);
  const writes = await Promise.allSettled(["withdrawn", "summary-only"].map((visibility) =>
    setVisibility(id, { visibility: visibility as "withdrawn" | "summary-only", version: 0, reason: "concurrent" }, "test")));
  assert.equal(writes.filter((w) => w.status === "fulfilled").length, 1);
  const rejected = writes.find((w) => w.status === "rejected");
  assert.equal(rejected?.status === "rejected" ? rejected.reason.code : null, "conflict");
  const [row] = await sql`SELECT o.version, o.visibility AS override, p.visibility AS projection
                         FROM editorial_overrides o JOIN publications p USING (article_id) WHERE o.article_id = ${id}`;
  assert.equal(row!.version, 1);
  assert.equal(row!.override, row!.projection);
});

test("periodic recovery reconciles a withdrawal left behind by the old code", async () => {
  const id = await article(true);
  await sql`INSERT INTO editorial_overrides (article_id, visibility, reason, version) VALUES (${id}, 'withdrawn', 'old interrupted write', 1)`;
  assert.equal((await loadItemDetail(id)).kind, "found");
  assert.ok((await reconcileVisibilityOverrides()).repaired >= 1);
  assert.equal((await loadItemDetail(id)).kind, "not_found");
  assert.equal((await reconcileVisibilityOverrides()).repaired, 0);
  const [row] = await sql`SELECT version FROM editorial_overrides WHERE article_id = ${id}`;
  assert.equal(row!.version, 1, "reconciliation does not fabricate a new manual edit");
});

for (const target of ["received", "completed", "pending"]) {
  test(`stale receipt sweep preserves a concurrent ${target === "pending" ? "lease renewal" : target} transition`, async () => {
    const id = await article();
    const r = await receipt(id, "audit_stale", "pending");
    const locked = gate<number>();
    const proceed = gate();
    const writer = sql.begin(async (tx) => {
      await tx`SELECT id FROM receipts WHERE id = ${r} FOR UPDATE`;
      const [pid] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      locked.open(pid!.pid);
      await proceed.promise;
      await tx`UPDATE receipts SET status = ${target}, response = '{"ok":true}', updated_at = now() WHERE id = ${r}`;
      if (target !== "pending") await tx`UPDATE receipt_attempts SET status = 'received' WHERE receipt_id = ${r}`;
    });
    const pid = await locked.promise;
    const sweep = markStalePendingReceipts();
    try {
      let blocked = false;
      for (let i = 0; i < 250; i++) {
        const [row] = await sql`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
        if (row!.blocked) { blocked = true; break; }
        await setTimeout(20);
      }
      assert.ok(blocked, "the sweep read the stale row and reached its blocked update");
    } finally {
      proceed.open();
      await writer;
      await sweep;
    }
    const [row] = await sql`SELECT status, response FROM receipts WHERE id = ${r}`;
    assert.equal(row!.status, target);
    assert.deepEqual(row!.response, { ok: true });
    const [attempt] = await sql`SELECT status FROM receipt_attempts WHERE receipt_id = ${r}`;
    assert.equal(attempt!.status, target === "pending" ? "pending" : "received");
  });
}

test("a genuinely abandoned receipt and attempt become unknown together", async () => {
  const id = await article();
  const r = await receipt(id, "audit_stale", "pending");
  assert.ok((await markStalePendingReceipts()) >= 1);
  const [row] = await sql`SELECT r.status, a.status AS attempt FROM receipts r JOIN receipt_attempts a ON a.receipt_id = r.id WHERE r.id = ${r}`;
  assert.equal(row!.status, "unknown");
  assert.equal(row!.attempt, "unknown");
});

test("the repair migration recovers released failures and only language-based current skips", async () => {
  const id = await article();
  const r = await receipt(id, ANALYSIS_PURPOSES.understand, "failed");
  await failed(id, r);
  const old = await article();
  const oldReceipt = await receipt(old, ANALYSIS_PURPOSES.understand, "failed");
  await failed(old, oldReceipt);
  await sql`UPDATE articles SET revision = 2 WHERE id = ${old}`;
  const translated = await article(true);
  const other = await article(true);
  await sql`INSERT INTO translation_attempts (article_id, revision, attempts, outcome, reason)
            VALUES (${translated}, 1, 1, 'skipped', 'no foreign-language body'), (${other}, 1, 1, 'skipped', 'short post')`;
  const migration = await readFile(new URL("../database/migrations/0045_recover_audit_failures.sql", import.meta.url), "utf8");
  for (let i = 0; i < 2; i++) await sql.begin((tx) => tx.unsafe(migration).simple());
  const rows = await sql`SELECT id, processing_state FROM articles WHERE id IN (${id}, ${old})`;
  assert.equal(rows.find((a) => a.id === id)!.processing_state, "new");
  assert.equal(rows.find((a) => a.id === old)!.processing_state, "failed");
  const attempts = await sql`SELECT article_id FROM translation_attempts WHERE article_id IN (${translated}, ${other})`;
  assert.deepEqual(attempts.map((a) => a.article_id), [other]);
});
