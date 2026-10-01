-- Keep the human-selected PDF appraisal phrase beside the confirmed extraction reference.
-- Existing linked cards remain readable with NULL: their exact cited phrase was not recorded.
ALTER TABLE visit_products
  ADD COLUMN source_appraisal_excerpt varchar(500) NULL,
  ADD CONSTRAINT visit_product_excerpt_source CHECK (
    source_appraisal_excerpt IS NULL OR
    (source_extraction_id IS NOT NULL AND length(trim(source_appraisal_excerpt)) BETWEEN 1 AND 500)
  );
