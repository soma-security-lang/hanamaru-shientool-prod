-- KS-06: retain a named owner and reason when market-price research cannot finish.
ALTER TABLE visit_products DROP CONSTRAINT visit_products_status_check;
ALTER TABLE visit_products ADD CONSTRAINT visit_products_status_check
  CHECK (status IN ('draft','research_hold','research_pending','ready','cancelled'));
ALTER TABLE visit_products
  ADD COLUMN research_hold_category varchar(30) NULL
    CHECK (research_hold_category IN ('no_candidates','ambiguous','search_failed')),
  ADD COLUMN research_hold_reason varchar(1000) NULL,
  ADD COLUMN research_hold_assignee_id uuid NULL,
  ADD COLUMN research_hold_opened_at timestamptz NULL,
  ADD COLUMN research_hold_resolved_at timestamptz NULL,
  ADD COLUMN research_hold_resolution_note varchar(1000) NULL,
  ADD CONSTRAINT visit_products_research_hold_assignee_fk
    FOREIGN KEY (organization_id,research_hold_assignee_id)
    REFERENCES memberships(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT visit_products_research_hold_complete_check CHECK (
    status <> 'research_hold' OR
    (research_hold_category IS NOT NULL AND research_hold_reason IS NOT NULL
      AND research_hold_assignee_id IS NOT NULL AND research_hold_opened_at IS NOT NULL
      AND research_hold_resolved_at IS NULL)
  );
CREATE INDEX visit_products_open_research_hold_idx
  ON visit_products(organization_id,research_hold_assignee_id,research_hold_opened_at)
  WHERE status='research_hold';
