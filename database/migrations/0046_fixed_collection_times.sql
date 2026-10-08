-- Align automatic collectors to 07:30 and 19:30 Asia/Shanghai, independently of completion time.
-- External sources receive pushes and have no collection schedule.
WITH next_slot AS (
  SELECT min(slot) AS at FROM (
    SELECT ((now() AT TIME ZONE 'Asia/Shanghai')::date + day + local_time)
      AT TIME ZONE 'Asia/Shanghai' AS slot
    FROM generate_series(0, 1) AS day
    CROSS JOIN (VALUES (time '07:30'), (time '19:30')) AS times(local_time)
  ) slots WHERE slot > now()
)
UPDATE sources SET interval_minutes = 720, next_fetch_at = next_slot.at, updated_at = now()
FROM next_slot
WHERE kind IN ('rss', 'web_list', 'json_list', 'x_search', 'mp_account');
