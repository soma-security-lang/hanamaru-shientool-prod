-- Explicit visit deletion filters review comments by organization and review,
-- which requires SELECT as well as the existing DELETE privilege.
GRANT SELECT ON review_comments TO hanamaru_worker;
