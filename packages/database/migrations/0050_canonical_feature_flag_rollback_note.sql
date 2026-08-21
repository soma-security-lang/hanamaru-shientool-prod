-- Canonicalize the legacy development-seed label before production bootstrap
-- validates feature flag metadata. Unknown values remain untouched so that the
-- bootstrap drift guard continues to fail closed.
UPDATE feature_flags
SET rollback_note = 'チーム分析を無効化',
    updated_at = now()
WHERE flag_key = 'team_analytics'
  AND rollback_note = '分析画面停止';
