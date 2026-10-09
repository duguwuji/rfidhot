import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@rfidhot/backend/db";
import { latestDailyReportDate, dailyReportWindow, composeDaily, composeScheduledDaily, catchUpReports } from "@rfidhot/backend/reports/compose";

const dates = ["2023-04-30", "2023-05-01", "2050-01-01", "2050-01-02", "2051-01-01", "2051-01-02", "2051-01-03"];
after(async () => {
  await sql`DELETE FROM reports WHERE kind='daily' AND key IN ${sql(dates)}`;
  await closeDb();
});

async function edition(date: string, start: string, end: string) {
  await sql`INSERT INTO reports (kind,key,window_start,window_end,content,generated_at,origin)
    VALUES ('daily',${date},${new Date(start)},${new Date(end)},'{}',now(),'manual')`;
}

test("the due daily edition changes at exactly 07:07 Beijing, including midnight and year rollover", () => {
  for (const [instant, date] of [
    ["2026-10-10T00:00:00+08:00", "2026-10-09"],
    ["2026-10-10T07:06:59.999+08:00", "2026-10-09"],
    ["2026-10-10T07:07:00+08:00", "2026-10-10"],
    ["2026-10-10T23:59:59+08:00", "2026-10-10"],
    ["2027-01-01T00:00:00+08:00", "2026-12-31"],
  ]) assert.equal(latestDailyReportDate(new Date(instant)), date);
});

test("restart and catch-up do not publish early or regenerate an existing edition", async () => {
  await edition("2023-04-30", "2023-04-29T08:00:00+08:00", "2023-04-30T08:00:00+08:00");
  const early = new Date("2023-05-01T07:06:59+08:00"); // Monday and first of month; other reports are not due yet.
  assert.deepEqual(await composeScheduledDaily(early), { key: "2023-04-30", skipped: true });
  assert.deepEqual(await catchUpReports(early, 1), { generated: [] });
  assert.equal((await sql`SELECT 1 FROM reports WHERE kind='daily' AND key='2023-05-01'`).length, 0);
  assert.deepEqual(await catchUpReports(new Date("2023-05-01T07:07:00+08:00"), 1), { generated: ["daily:2023-05-01"] });
  assert.deepEqual(await composeScheduledDaily(new Date("2023-05-01T07:08:00+08:00")), { key: "2023-05-01", skipped: true });
  const [old] = await sql<{ revision: number }[]>`SELECT revision FROM reports WHERE kind='daily' AND key='2023-04-30'`;
  assert.equal(old!.revision, 1);
});

test("the first 07:07 edition continues the old 08:00 window and historical regeneration preserves bounds", async () => {
  await edition("2050-01-01", "2049-12-31T08:00:00+08:00", "2050-01-01T08:00:00+08:00");
  await composeDaily("2050-01-02");
  const window = await dailyReportWindow("2050-01-02");
  assert.equal(window.start.toISOString(), new Date("2050-01-01T08:00:00+08:00").toISOString());
  assert.equal(window.end.toISOString(), new Date("2050-01-02T07:07:00+08:00").toISOString());
  await composeDaily("2050-01-01", "manual regeneration");
  const old = await dailyReportWindow("2050-01-01");
  assert.equal(old.start.toISOString(), new Date("2049-12-31T08:00:00+08:00").toISOString());
  assert.equal(old.end.getTime(), window.start.getTime());
});

test("backfilling a hole between historical editions uses both adjacent windows", async () => {
  await edition("2051-01-01", "2050-12-31T08:00:00+08:00", "2051-01-01T08:00:00+08:00");
  await edition("2051-01-03", "2051-01-02T08:00:00+08:00", "2051-01-03T08:00:00+08:00");
  const window = await dailyReportWindow("2051-01-02");
  assert.equal(window.start.toISOString(), new Date("2051-01-01T08:00:00+08:00").toISOString());
  assert.equal(window.end.toISOString(), new Date("2051-01-02T08:00:00+08:00").toISOString());
});
