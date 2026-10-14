-- Optional branch master address; existing branch IDs and references are unchanged.
-- Operational branch records are provisioned separately, never seeded into production.
ALTER TABLE branches ADD COLUMN address text;
ALTER TABLE branches ADD CONSTRAINT branches_address_length
 CHECK (address IS NULL OR char_length(address) <= 2000);
