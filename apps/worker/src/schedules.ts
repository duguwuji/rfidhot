// Cron-style schedules (Asia/Shanghai). Runs are recorded; only jobs marked once catch up missed slots.
import type { PgBoss } from "pg-boss";
import { DAILY_REPORT_CRON } from "@rfidhot/industry/reports";
import { COLLECTION_CRON } from "@rfidhot/industry/collection";
import { FEATURES } from "@rfidhot/industry/features";
import { credential } from "@rfidhot/backend/config";
import { ensureQueue, recordRun } from "@rfidhot/backend/jobs/queue";
import { sweepUnprocessed } from "@rfidhot/backend/jobs/content";
import { translatePending } from "@rfidhot/backend/editorial/translate";
import { scheduleCollectionSlot } from "@rfidhot/backend/sources/collect";
import { scheduleMpReconcile } from "@rfidhot/backend/sources/mp";
import { refreshSourceIcons } from "@rfidhot/backend/sources/icons";
import { computeHotRanking, snapshotHeat } from "@rfidhot/backend/events/hot";
import { refreshStoryStatuses } from "@rfidhot/backend/events/digest";
import { linkRelatedStories } from "@rfidhot/backend/events/group";
import { catchUpReports, composeScheduledDaily, composeMonthly, composeWeekly } from "@rfidhot/backend/reports/compose";
import { addDays, beijingDate, isoWeekLabel } from "@rfidhot/contracts/time";
import { runLeaderboardRound } from "@rfidhot/backend/leaderboard/method/run";
import { refreshLeaderboard } from "@rfidhot/backend/leaderboard/fetch/refresh";
import { monitorTick } from "@rfidhot/backend/monitor/scan";
import { dailyRetention } from "@rfidhot/backend/operations/retention";
import { submitIndexNow } from "@rfidhot/backend/operations/indexnow";
import { checkAlerts, sendDigest } from "@rfidhot/backend/operations/alerts";
import { autoReleaseUnknownReceipts } from "@rfidhot/backend/admin/runs";
import { reconcileVisibilityOverrides } from "@rfidhot/backend/admin/content";
import { forwardPendingFeedback } from "@rfidhot/backend/operations/feedback";
import { backupConfigured, runBackup } from "@rfidhot/backend/operations/backup";
import { sourceHealthWeekly } from "@rfidhot/backend/operations/reports";
import { markStalePendingReceipts } from "@rfidhot/backend/providers/receipts";
import { markStaleDeliveries } from "@rfidhot/backend/notify/deliver";

interface Scheduled {
  name: string;
  cron: string;
  run: () => Promise<unknown>;
  missed?: "skip" | "once";
}

const collecting = process.env.COLLECT_ENABLED !== "false";

export const SCHEDULES: Scheduled[] = [
  { name: "content.sweep", cron: "*/5 * * * *", run: sweepUnprocessed },
  // Full-text translations of newly selected items (model calls; off with MODEL_CALLS_ENABLED=false).
  { name: "content.translate", cron: "*/5 * * * *", run: () => translatePending() },
  { name: "hot.rank", cron: "*/5 * * * *", run: () => computeHotRanking() },
  { name: "hot.snapshot", cron: "2 * * * *", run: () => snapshotHeat() },
  { name: "stories.status", cron: "7 * * * *", run: refreshStoryStatuses },
  { name: "stories.links", cron: "12 * * * *", run: linkRelatedStories },
  { name: "reports.daily", cron: DAILY_REPORT_CRON, missed: "once", run: () => composeScheduledDaily() },
  { name: "reports.weekly", cron: "0 10 * * 1", missed: "once", run: () => composeWeekly(isoWeekLabel(addDays(beijingDate(Date.now()), -7))) },
  {
    name: "reports.monthly",
    cron: "30 10 1 * *",
    missed: "once",
    run: () => {
      const [y, m] = beijingDate(Date.now()).split("-").map(Number) as [number, number];
      return composeMonthly(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`);
    },
  },
  // Keep recovery separate from the 07:15 daily generation slot.
  { name: "reports.catch-up", cron: "30 * * * *", run: () => catchUpReports() },
  { name: "ops.retention", cron: "30 3 * * *", missed: "once", run: () => dailyRetention() },
  { name: "sources.icons", cron: "40 4 * * *", missed: "once", run: () => refreshSourceIcons() },
  // IndexNow for new indexable pages (off unless INDEXNOW_SUBMIT_ENABLED).
  { name: "seo.indexnow", cron: "50 5 * * *", missed: "once", run: () => submitIndexNow() },
  // Work a stopped process left half way becomes visible, and unknown paid requests get their one
  // automatic release, before the alerts look.
  {
    name: "ops.recover",
    cron: "*/10 * * * *",
    run: async () => ({ receipts: await markStalePendingReceipts(), released: await autoReleaseUnknownReceipts(),
      publications: await reconcileVisibilityOverrides(), deliveries: await markStaleDeliveries() }),
  },
  { name: "ops.alerts", cron: "*/10 * * * *", run: () => checkAlerts() },
  // One message with the follow-ups that do not touch readers (nothing when there are none).
  { name: "ops.digest", cron: "0 9 * * *", missed: "once", run: () => sendDigest() },
  // Feedback that did not reach the internal Feishu chat when it was sent (off with FEISHU_INTERNAL_ENABLED).
  { name: "feedback.forward", cron: "*/10 * * * *", run: () => forwardPendingFeedback() },
  ...(backupConfigured() ? [{ name: "ops.backup", cron: "10 4 * * *", missed: "once" as const, run: () => runBackup() }] : []),
  { name: "reports.source-health", cron: "0 9 * * 1", missed: "once", run: () => sourceHealthWeekly() },
  // Four upstream checks a day; a new run is published only when the evidence changed. With collection
  // off only the computation runs, over the snapshots already stored.
  ...(FEATURES.leaderboard
    ? [{ name: "leaderboard.round", cron: "5 2,8,14,20 * * *", missed: "once" as const, run: () => (collecting ? refreshLeaderboard() : runLeaderboardRound()) }]
    : []),
  ...(collecting
    ? [
        { name: "sources.schedule", cron: COLLECTION_CRON, run: () => scheduleCollectionSlot() },
        // WeChat official accounts (paid), using the same fixed slots.
        { name: "sources.mp-reconcile", cron: COLLECTION_CRON, run: () => scheduleMpReconcile() },
      ]
    : []),
  // Codex reset monitor: checked every minute, scanned every 5 (every 3 while hot). It reads X through
  // SocialData, so without that key there is nothing to run.
  ...(collecting && FEATURES.codexResetMonitor && credential("collectors", "SOCIALDATA_API_KEY")
    ? [
        { name: "monitor.tick", cron: "* * * * *", run: () => monitorTick() },
        { name: "monitor.lookback", cron: "40 4 * * *", run: () => monitorTick({ lookbackHours: 48 }) },
      ]
    : []),
];

export async function registerSchedules(boss: PgBoss) {
  for (const s of SCHEDULES) {
    const queue = `cron.${s.name}`;
    await ensureQueue(queue, { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 });
    await boss.schedule(queue, s.cron, {}, { tz: "Asia/Shanghai", missed: s.missed ?? "skip" });
    // Schedules fire at minute boundaries; a 15 s pickup keeps them on time with a third of the polling.
    await boss.work(queue, { pollingIntervalSeconds: 15 }, async () => recordRun(s.name, s.run));
  }
  // A schedule removed from the table (a module switched off) must not keep firing from an earlier run.
  const names = new Set(SCHEDULES.map((s) => `cron.${s.name}`));
  for (const existing of await boss.getSchedules()) {
    if (existing.name.startsWith("cron.") && !names.has(existing.name)) await boss.unschedule(existing.name);
  }
}
