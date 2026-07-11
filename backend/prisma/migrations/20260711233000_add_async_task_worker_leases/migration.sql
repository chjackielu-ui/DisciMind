-- Additive worker lease and scheduling fields. The original AsyncTask migration
-- remains immutable so existing environments can continue from migration 24.
ALTER TABLE `async_tasks`
    ADD COLUMN `locked_by` VARCHAR(128) NULL,
    ADD COLUMN `locked_at` DATETIME(3) NULL,
    ADD COLUMN `next_run_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `async_tasks_status_next_run_idx`
    ON `async_tasks`(`status`, `next_run_at`);

CREATE INDEX `async_tasks_locked_at_idx`
    ON `async_tasks`(`locked_at`);
