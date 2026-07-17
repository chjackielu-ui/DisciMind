ALTER TABLE `user_agent_versions`
    ADD COLUMN `operation_id` VARCHAR(64) NULL,
    ADD UNIQUE INDEX `user_agent_versions_operation_id_key`(`operation_id`);
