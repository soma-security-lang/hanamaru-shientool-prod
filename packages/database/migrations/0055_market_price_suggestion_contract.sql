UPDATE market_price_identifications
SET suggestion_json='{"productCandidates":[],"searchQueries":[],"excludeKeywords":[],"suggestedConditions":[],"warnings":[]}'::jsonb
WHERE suggestion_json='{}'::jsonb;

ALTER TABLE market_price_identifications
  ALTER COLUMN suggestion_json SET DEFAULT '{"productCandidates":[],"searchQueries":[],"excludeKeywords":[],"suggestedConditions":[],"warnings":[]}'::jsonb;
