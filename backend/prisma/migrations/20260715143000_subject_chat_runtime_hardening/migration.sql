ALTER TABLE `subject_chat_runs`
  MODIFY COLUMN `status` VARCHAR(24) NOT NULL DEFAULT 'queued',
  ADD COLUMN `error_code` VARCHAR(100) NULL,
  ADD COLUMN `last_heartbeat_at` DATETIME(3) NULL,
  ADD COLUMN `duration_ms` INTEGER NULL,
  ADD COLUMN `timeout_at` DATETIME(3) NULL,
  ADD COLUMN `retry_count` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `subject_chat_tasks`
  ADD COLUMN `error_code` VARCHAR(100) NULL,
  ADD COLUMN `last_heartbeat_at` DATETIME(3) NULL,
  ADD COLUMN `duration_ms` INTEGER NULL,
  ADD COLUMN `timeout_at` DATETIME(3) NULL,
  ADD COLUMN `retry_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `first_delta_at` DATETIME(3) NULL;

CREATE INDEX `subject_chat_runs_user_id_status_updated_at_idx`
  ON `subject_chat_runs`(`user_id`, `status`, `updated_at`);
