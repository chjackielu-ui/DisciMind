-- DisciMind C compiler history. User code is executed only by the local Judge0 service.
CREATE TABLE `compile_record` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `topic_id` INTEGER NULL,
    `source_code` LONGTEXT NOT NULL,
    `compile_msg` LONGTEXT NOT NULL,
    `run_output` LONGTEXT NOT NULL,
    `status` TINYINT NOT NULL,
    `create_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `compile_record_user_id_create_time_idx`(`user_id`, `create_time`),
    INDEX `compile_record_user_id_topic_id_create_time_idx`(`user_id`, `topic_id`, `create_time`),
    CONSTRAINT `compile_record_status_check` CHECK (`status` IN (0, 1, 2, 3)),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `compile_record`
    ADD CONSTRAINT `compile_record_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `compile_record`
    ADD CONSTRAINT `compile_record_topic_id_fkey`
    FOREIGN KEY (`topic_id`) REFERENCES `questions`(`question_id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
