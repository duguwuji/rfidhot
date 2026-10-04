-- Older datelines use commas, en dashes, nonbreaking spaces or day-first dates.
-- Parse the explicit original date independently of the dateline separator.
UPDATE sources
SET config = config || '{"publishedAtRegex":"((?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{4})"}'::jsonb, updated_at = now()
WHERE id = 'web-avery-rfid' AND kind = 'web_list'
  AND config->>'url' = 'https://rfid.averydennison.com/en/home/news-insights/press-releases.html'
  AND config->>'publishedAtRegex' = '(?:—|&mdash;)\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})';
