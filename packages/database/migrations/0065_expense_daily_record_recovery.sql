-- Optional record provenance and manually reported time. Neither value approves
-- a receipt, reconciles cash, or verifies delivery to an external service.
ALTER TABLE expense_days
  ADD COLUMN purchase_source_note varchar(1000) NULL;

ALTER TABLE expense_followups
  ADD COLUMN reported_at timestamptz NULL,
  ADD CONSTRAINT expense_reported_at_kind_check
    CHECK (reported_at IS NULL OR kind='report');
