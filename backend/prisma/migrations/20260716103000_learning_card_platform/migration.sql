-- Add the versioned learning-card platform without changing or deleting existing data.
CREATE TABLE `learning_cards` (
  `id` VARCHAR(80) NOT NULL,
  `owner_user_id` INTEGER NULL,
  `scope` VARCHAR(20) NOT NULL,
  `card_type` VARCHAR(32) NOT NULL,
  `course_id` INTEGER NULL,
  `knowledge_point_id` INTEGER NULL,
  `title` VARCHAR(200) NOT NULL,
  `summary` VARCHAR(1000) NOT NULL,
  `content_json` JSON NOT NULL,
  `source_refs_json` JSON NOT NULL,
  `generator_json` JSON NOT NULL,
  `cache_key` VARCHAR(128) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'READY',
  `version` VARCHAR(16) NOT NULL DEFAULT '1.0',
  `teacher_recommended` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `expires_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `daily_learning_card_sets` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `recommendation_date` DATE NOT NULL,
  `reason_summary` TEXT NULL,
  `data_snapshot_version` VARCHAR(128) NOT NULL,
  `generation_status` VARCHAR(20) NOT NULL DEFAULT 'GENERATING',
  `version` VARCHAR(16) NOT NULL DEFAULT '1.0',
  `generated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `refreshed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `daily_learning_card_set_items` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `set_id` INTEGER NOT NULL,
  `card_id` VARCHAR(80) NOT NULL,
  `slot` INTEGER NOT NULL,
  `score` DOUBLE NOT NULL DEFAULT 0,
  `reason` VARCHAR(500) NULL,
  `source_kind` VARCHAR(40) NOT NULL,
  `context_json` JSON NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_learning_card_states` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `card_id` VARCHAR(80) NOT NULL,
  `is_favorite` BOOLEAN NOT NULL DEFAULT false,
  `is_mastered` BOOLEAN NOT NULL DEFAULT false,
  `is_deferred` BOOLEAN NOT NULL DEFAULT false,
  `is_ignored` BOOLEAN NOT NULL DEFAULT false,
  `view_count` INTEGER NOT NULL DEFAULT 0,
  `total_dwell_time_ms` INTEGER NOT NULL DEFAULT 0,
  `viewed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `learning_card_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `card_id` VARCHAR(80) NOT NULL,
  `event_type` VARCHAR(40) NOT NULL,
  `context` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `learning_cards_owner_user_id_status_idx` ON `learning_cards`(`owner_user_id`, `status`);
CREATE INDEX `learning_cards_course_id_knowledge_point_id_card_type_idx` ON `learning_cards`(`course_id`, `knowledge_point_id`, `card_type`);
CREATE INDEX `learning_cards_cache_key_status_idx` ON `learning_cards`(`cache_key`, `status`);
CREATE INDEX `learning_cards_updated_at_idx` ON `learning_cards`(`updated_at`);
CREATE UNIQUE INDEX `daily_learning_card_sets_user_id_recommendation_date_key` ON `daily_learning_card_sets`(`user_id`, `recommendation_date`);
CREATE INDEX `daily_learning_card_sets_user_id_generated_at_idx` ON `daily_learning_card_sets`(`user_id`, `generated_at`);
CREATE UNIQUE INDEX `daily_learning_card_set_items_set_id_slot_key` ON `daily_learning_card_set_items`(`set_id`, `slot`);
CREATE UNIQUE INDEX `daily_learning_card_set_items_set_id_card_id_key` ON `daily_learning_card_set_items`(`set_id`, `card_id`);
CREATE INDEX `daily_learning_card_set_items_card_id_idx` ON `daily_learning_card_set_items`(`card_id`);
CREATE UNIQUE INDEX `user_learning_card_states_user_id_card_id_key` ON `user_learning_card_states`(`user_id`, `card_id`);
CREATE INDEX `user_learning_card_states_user_id_favorite_mastered_idx` ON `user_learning_card_states`(`user_id`, `is_favorite`, `is_mastered`);
CREATE INDEX `learning_card_events_user_id_type_created_at_idx` ON `learning_card_events`(`user_id`, `event_type`, `created_at`);
CREATE INDEX `learning_card_events_card_id_created_at_idx` ON `learning_card_events`(`card_id`, `created_at`);

ALTER TABLE `learning_cards` ADD CONSTRAINT `learning_cards_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `learning_cards` ADD CONSTRAINT `learning_cards_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `learning_cards` ADD CONSTRAINT `learning_cards_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `daily_learning_card_sets` ADD CONSTRAINT `daily_learning_card_sets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `daily_learning_card_set_items` ADD CONSTRAINT `daily_learning_card_set_items_set_id_fkey` FOREIGN KEY (`set_id`) REFERENCES `daily_learning_card_sets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `daily_learning_card_set_items` ADD CONSTRAINT `daily_learning_card_set_items_card_id_fkey` FOREIGN KEY (`card_id`) REFERENCES `learning_cards`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `user_learning_card_states` ADD CONSTRAINT `user_learning_card_states_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `user_learning_card_states` ADD CONSTRAINT `user_learning_card_states_card_id_fkey` FOREIGN KEY (`card_id`) REFERENCES `learning_cards`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `learning_card_events` ADD CONSTRAINT `learning_card_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `learning_card_events` ADD CONSTRAINT `learning_card_events_card_id_fkey` FOREIGN KEY (`card_id`) REFERENCES `learning_cards`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
