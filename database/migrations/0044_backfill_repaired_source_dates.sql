-- Repair the missing-data gap left by configuration migrations 0042 and 0043.
-- scripts/migrate.ts applies this plan through repairMaterialDateTx in the SAME
-- transaction: articles, publications, fact anchors and the selected sync ledger.
-- No content revision, analysis, processing state or delivery job changes.
-- Impinj card dates were not stored: use scripts/repair-impinj-dates.ts instead.
-- Only recognise verified Avery press-release datelines in the opening text;
-- narrative dates and month-only dates are not publication-date evidence.
CREATE TEMP TABLE repaired_source_dates ON COMMIT DROP AS
WITH datelines AS (
  SELECT a.id, (regexp_match(left(a.body_text, 2000),
    '(?:MENTOR|GLENDALE|MIAMISBURG|GREENWOOD VILLAGE|KUNSHAN|SHANGHAI|SAN FRANCISCO|ANYANG|OEGSTGEEST|NEW YORK CITY|DÜSSELDORF|IMM COLOGNE|SÃO PAULO)[[:alpha:][:space:],/().–—-]{0,80}((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})[[:space:]]*[:),–—-]', 'i'))[1] AS dateline
  FROM articles a JOIN sources s ON s.id = a.source_id
  WHERE a.source_id = 'web-avery-rfid' AND a.published_at IS NULL
    AND s.kind = 'web_list'
    AND s.config->>'url' = 'https://rfid.averydennison.com/en/home/news-insights/press-releases.html'
    AND s.config->>'publishedAtUtcOffset' = '+00:00'
), parts AS (
  SELECT id,
    regexp_match(lower(dateline), '^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})$') AS mf,
    regexp_match(lower(dateline), '^(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})$') AS df
  FROM datelines WHERE dateline IS NOT NULL
), numbered AS (
  SELECT id,
    array_position(ARRAY['january','february','march','april','may','june','july','august','september','october','november','december'], coalesce(mf[1], df[2])) AS mo,
    coalesce(mf[2], df[1])::int AS dy, coalesce(mf[3], df[3])::int AS yr
  FROM parts
), valid AS (
  SELECT id, yr, mo, dy,
    CASE WHEN mo BETWEEN 1 AND 12 AND yr BETWEEN 1990 AND 2100
      THEN make_date(yr, mo, 1) END AS month_start FROM numbered
)
SELECT id, (month_start + dy - 1)::timestamp AT TIME ZONE 'UTC' AS claimed
FROM valid WHERE month_start IS NOT NULL AND dy >= 1
  AND dy <= extract(day FROM month_start + interval '1 month' - interval '1 day');
