ALTER TABLE `async_tasks`
  ADD COLUMN `parent_task_id` INTEGER NULL,
  ADD COLUMN `root_task_id` INTEGER NULL,
  ADD COLUMN `task_group_id` VARCHAR(64) NULL,
  ADD COLUMN `dedupe_key` VARCHAR(128) NULL,
  ADD COLUMN `user_visible` BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX `async_tasks_hierarchy_idx` ON `async_tasks`(`root_task_id`, `parent_task_id`);
CREATE INDEX `async_tasks_user_type_dedupe_idx` ON `async_tasks`(`user_id`, `task_type`, `dedupe_key`);
