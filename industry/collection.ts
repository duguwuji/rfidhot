// 北京时间每天 07:30、19:30 启动自动采集；手工试抓不改变后续自动时点。
export const COLLECTION_INTERVAL_MINUTES = 720;
export const COLLECTION_CRON = "30 7,19 * * *";
export const COLLECTION_LABEL = "北京时间 07:30 / 19:30";
const TIMES = [7 * 60 + 30, 19 * 60 + 30];

/** The next strictly future slot. Asia/Shanghai is UTC+8 without daylight saving. */
export function nextCollectionAt(from = new Date()): Date {
  const offset = 8 * 3600_000;
  const day = Math.floor((from.getTime() + offset) / 86400_000) * 86400_000 - offset;
  const slots = [...TIMES.map((minute) => day + minute * 60_000), day + 86400_000 + TIMES[0]! * 60_000];
  return new Date(slots.find((slot) => slot > from.getTime())!);
}
