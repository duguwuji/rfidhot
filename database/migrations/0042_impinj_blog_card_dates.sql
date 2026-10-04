-- Read every blog card's original date before the bounded detail requests. Otherwise older
-- cards beyond that budget enter the live timeline at discovery time with no source date.
-- Only update the original selector configuration; preserve manually customised sources.
UPDATE sources
SET config = config || '{"itemSelector":"a.feature-destination","titleSelector":"h5.feature-heading","publishedAtSelector":"small.feature-meta","publishedAtUtcOffset":"+00:00"}'::jsonb,
    updated_at = now()
WHERE id = 'web-impinj-blog'
  AND kind = 'web_list'
  AND config->>'url' = 'https://www.impinj.com/library/blog'
  AND config->>'itemSelector' = 'a[href]'
  AND NOT config ? 'titleSelector'
  AND NOT config ? 'publishedAtSelector'
  AND NOT config ? 'publishedAtRegex';
