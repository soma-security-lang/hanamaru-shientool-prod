-- Preserve schema-defined fields even when the provider cannot extract a value.
-- The UI must be able to show and correct a missing required field.
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
    FROM pg_constraint
   WHERE conrelid='visit_field_values'::regclass
     AND contype='c'
     AND pg_get_constraintdef(oid) LIKE '%num_nonnulls%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE visit_field_values DROP CONSTRAINT %I',constraint_name);
  END IF;
END $$;

ALTER TABLE visit_field_values
  ADD CONSTRAINT visit_field_values_at_most_one_value_check
  CHECK (num_nonnulls(text_value,number_value,date_value,boolean_value,json_value)<=1);
