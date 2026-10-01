-- A manually confirmed product card may cite the confirmed PDF extraction.
-- Multiple cards can reference one appraisalItems field; the field is never split automatically.
ALTER TABLE visit_products
  ADD COLUMN source_extraction_id uuid NULL REFERENCES document_extractions(id) ON DELETE RESTRICT;
CREATE INDEX visit_products_source_extraction_idx ON visit_products(organization_id,source_extraction_id)
  WHERE source_extraction_id IS NOT NULL;
