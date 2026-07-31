-- 可直接在 MySQL 8.0 执行；Prisma migration 会在正式部署时自动维护同一结构。
CREATE TABLE IF NOT EXISTS `compile_record` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `topic_id` INT NULL,
  `language` VARCHAR(16) NOT NULL DEFAULT 'c',
  `source_code` LONGTEXT NOT NULL,
  `compile_msg` LONGTEXT NOT NULL,
  `run_output` LONGTEXT NOT NULL,
  `status` TINYINT NOT NULL,
  `create_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `compile_record_user_id_create_time_idx` (`user_id`, `create_time`),
  KEY `compile_record_user_id_topic_id_create_time_idx` (`user_id`, `topic_id`, `create_time`),
  KEY `compile_record_user_id_language_create_time_idx` (`user_id`, `language`, `create_time`),
  CONSTRAINT `compile_record_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `compile_record_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `questions` (`question_id`) ON DELETE SET NULL,
  CONSTRAINT `compile_record_status_check` CHECK (`status` IN (0, 1, 2, 3))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
