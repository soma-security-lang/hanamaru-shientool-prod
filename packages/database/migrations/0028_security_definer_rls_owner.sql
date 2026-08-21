-- FORCE ROW LEVEL SECURITY also applies to a table owner. The migration login
-- owns the narrowly granted SECURITY DEFINER runtime functions, so it must be
-- able to cross tenant policies inside those functions. Runtime API/Worker
-- logins remain NOINHERIT and NOBYPASSRLS.
DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I BYPASSRLS', current_user);
END $$;
