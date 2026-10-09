// 日报启动时间、取稿截止与读者看到的说明共用这一配置（北京时间）。
export const DAILY_REPORT_TIME = "07:07";
const [hour, minute] = DAILY_REPORT_TIME.split(":").map(Number);
export const DAILY_REPORT_MINUTES = hour! * 60 + minute!;
export const DAILY_REPORT_CRON = `${minute} ${hour} * * *`;
