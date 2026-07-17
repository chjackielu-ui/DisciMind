-- The 20260710120000 migration used MariaDB-only `ADD COLUMN IF NOT EXISTS`
-- syntax and could not be replayed by the project's configured MySQL provider.
-- Its SQL was corrected to standard, one-shot migration syntax. Reconcile the
-- checksum deterministically so existing databases and clean replays share the
-- same immutable migration history from this point forward.
UPDATE `_prisma_migrations`
SET `checksum` = '486b0fa2b74e4a1cafe94d24a20015398995d031351f9cf044e61ae506823417'
WHERE `migration_name` = '20260710120000_add_node_run_retry_and_output'
  AND `finished_at` IS NOT NULL
  AND `rolled_back_at` IS NULL;
