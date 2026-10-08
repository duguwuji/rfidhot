-- Receipts released before the purpose-routing fix left their failed articles behind.
-- Only the same revision and the exact unknown-receipt failure are eligible for the normal sweep.
UPDATE articles a
SET processing_state = 'new', processing_attempts = 0, processing_retry_at = NULL,
    processing_queued_at = NULL, processing_error = NULL
FROM receipts r
WHERE a.processing_state = 'failed'
  AND a.processing_error = 'receipt ' || r.id::text || ' outcome unknown'
  AND r.status = 'failed'
  AND r.purpose IN ('analyze_article', 'prefilter_article', 'score_article', 'structure_article', 'understand_article', 'summarize_article')
  AND r.subject = 'article:' || a.id || '@' || a.revision::text;

-- Reconsider language-based skips once with the shared, stricter language detector.
-- Real Chinese bodies will be skipped again without a model call; other skip reasons stay terminal.
DELETE FROM translation_attempts t
USING articles a, publications p
WHERE t.article_id = a.id AND p.article_id = a.id AND t.revision = a.revision
  AND t.outcome = 'skipped' AND t.reason IN ('already Chinese', 'no foreign-language body')
  AND p.selected AND p.visibility = 'public' AND p.body_mode = 'full'
  AND coalesce(a.language, '') !~* '^zh([-_]|$)'
  AND coalesce(a.body_text, '') <> '';
