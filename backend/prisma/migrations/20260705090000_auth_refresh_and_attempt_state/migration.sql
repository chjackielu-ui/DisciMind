-- Auth refresh token persistence.
CREATE TABLE `refresh_tokens` (
    `refresh_token_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `token_hash` VARCHAR(128) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NULL,
    `device_info` VARCHAR(255) NULL,
    `ip_address` VARCHAR(64) NULL,
    `session_id` INTEGER NULL,

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_idx`(`user_id`),
    INDEX `refresh_tokens_expires_at_idx`(`expires_at`),
    INDEX `refresh_tokens_revoked_at_idx`(`revoked_at`),
    PRIMARY KEY (`refresh_token_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `refresh_tokens`
    ADD CONSTRAINT `refresh_tokens_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Add FK for auth_sessions → refresh_tokens (moved from 20260704174142)
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_refresh_token_id_fkey` FOREIGN KEY (`refresh_token_id`) REFERENCES `refresh_tokens`(`refresh_token_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Practice session state machine fields. Existing rows remain readable through service-level compatibility mapping.
ALTER TABLE `practice_sessions`
    MODIFY `mode` VARCHAR(30) NOT NULL DEFAULT 'SINGLE_PRACTICE',
    MODIFY `status` VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    ADD COLUMN `answer_mode` VARCHAR(30) NOT NULL DEFAULT 'SINGLE',
    ADD COLUMN `expires_at` DATETIME(3) NULL,
    ADD COLUMN `current_item_id` INTEGER NULL,
    ADD COLUMN `current_item_index` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `last_active_at` DATETIME(3) NULL,
    ADD COLUMN `submit_request_id` VARCHAR(100) NULL,
    ADD COLUMN `navigation_config` JSON NULL;

CREATE INDEX `practice_sessions_mode_idx` ON `practice_sessions`(`mode`);
CREATE INDEX `practice_sessions_expires_at_idx` ON `practice_sessions`(`expires_at`);

-- Per-question attempt state fields.
ALTER TABLE `answer_records`
    ADD COLUMN `item_status` VARCHAR(20) NOT NULL DEFAULT 'UNANSWERED',
    ADD COLUMN `saved_at` DATETIME(3) NULL,
    ADD COLUMN `confirmed_at` DATETIME(3) NULL,
    ADD COLUMN `graded_at` DATETIME(3) NULL,
    ADD COLUMN `client_updated_at` DATETIME(3) NULL;

CREATE INDEX `answer_records_practice_session_id_question_id_idx` ON `answer_records`(`practice_session_id`, `question_id`);
CREATE INDEX `answer_records_submission_id_question_id_idx` ON `answer_records`(`submission_id`, `question_id`);
CREATE INDEX `answer_records_item_status_idx` ON `answer_records`(`item_status`);
