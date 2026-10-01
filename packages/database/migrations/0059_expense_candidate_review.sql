-- A rejected OCR/manual candidate is retained for audit but never counted (phase 2).
ALTER TABLE expense_items DROP CONSTRAINT expense_items_status_check;
ALTER TABLE expense_items ADD CONSTRAINT expense_items_status_check CHECK(status IN ('candidate','confirmed','excluded'));
ALTER TABLE expense_items ADD COLUMN excluded_reason varchar(1000) NULL;
ALTER TABLE expense_items ADD COLUMN excluded_at timestamptz NULL;
ALTER TABLE expense_items ADD CONSTRAINT expense_items_exclusion_consistency CHECK(
  (status='excluded')=(excluded_at IS NOT NULL)
  AND (status='excluded')=(excluded_reason IS NOT NULL)
);
