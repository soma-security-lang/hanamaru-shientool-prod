-- PostgreSQL SELECT ... FOR UPDATE requires UPDATE in addition to SELECT.
-- The deletion Worker locks incomplete upload rows before deleting their GCS
-- objects so a concurrent upload completion cannot resurrect visit data.
GRANT UPDATE ON upload_sessions TO hanamaru_worker;
