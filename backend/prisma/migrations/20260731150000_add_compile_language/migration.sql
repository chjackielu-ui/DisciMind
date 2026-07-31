ALTER TABLE `compile_record`
    ADD COLUMN `language` VARCHAR(16) NOT NULL DEFAULT 'c' AFTER `topic_id`;

CREATE INDEX `compile_record_user_id_language_create_time_idx`
    ON `compile_record`(`user_id`, `language`, `create_time`);
