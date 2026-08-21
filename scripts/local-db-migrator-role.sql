-- Assigns the localhost-only migrator password without exposing it in process
-- arguments or logs. The caller connects over the owner-only Unix socket.
\getenv migrator_role HANAMARU_LOCAL_MIGRATOR_DB_ROLE
\getenv migrator_password HANAMARU_LOCAL_MIGRATOR_DB_PASSWORD
\if :{?migrator_role}
\else
  \echo 'HANAMARU_LOCAL_MIGRATOR_DB_ROLE is required'
  \quit 3
\endif
\if :{?migrator_password}
\else
  \echo 'HANAMARU_LOCAL_MIGRATOR_DB_PASSWORD is required'
  \quit 3
\endif
ALTER ROLE :"migrator_role" PASSWORD :'migrator_password';
