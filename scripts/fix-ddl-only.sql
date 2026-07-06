-- ============================================================
-- DisciMind: DDL 补丁 - 仅包含建表和改表操作
-- 不包含 _prisma_migrations 记录插入
-- ============================================================

-- 创建 refresh_tokens 表（来自 migration 9，提前执行以解决依赖）
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
    `refresh_token_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `token_hash` VARCHAR(128) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NULL,
    `device_info` VARCHAR(255) NULL,
    `ip_address` VARCHAR(64) NULL,
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

-- 创建 auth_sessions 表（来自 migration 8）
CREATE TABLE IF NOT EXISTS `auth_sessions` (
    `session_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `refresh_token_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_activity_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `device_info` VARCHAR(255) NULL,
    `ip_address` VARCHAR(64) NULL,
    INDEX `auth_sessions_user_id_idx`(`user_id`),
    INDEX `auth_sessions_last_activity_at_idx`(`last_activity_at`),
    INDEX `auth_sessions_revoked_at_idx`(`revoked_at`),
    INDEX `auth_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`session_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_refresh_token_id_fkey` FOREIGN KEY (`refresh_token_id`) REFERENCES `refresh_tokens`(`refresh_token_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 向 refresh_tokens 添加 session_id 字段
ALTER TABLE `refresh_tokens` ADD COLUMN IF NOT EXISTS `session_id` INTEGER NULL;

-- 向 practice_sessions 添加字段（来自 migration 8）
ALTER TABLE `practice_sessions` ADD COLUMN IF NOT EXISTS `source_id` INTEGER NULL,
    ADD COLUMN IF NOT EXISTS `source_type` VARCHAR(30) NULL,
    ADD COLUMN IF NOT EXISTS `submit_reason` VARCHAR(30) NULL,
    ADD COLUMN IF NOT EXISTS `task_id` INTEGER NULL;

CREATE INDEX IF NOT EXISTS `practice_sessions_source_type_idx` ON `practice_sessions`(`source_type`);
CREATE INDEX IF NOT EXISTS `practice_sessions_source_id_idx` ON `practice_sessions`(`source_id`);

-- 向 practice_sessions 添加更多字段（来自 migration 9）
ALTER TABLE `practice_sessions` ADD COLUMN IF NOT EXISTS `answer_mode` VARCHAR(30) NOT NULL DEFAULT 'SINGLE',
    ADD COLUMN IF NOT EXISTS `expires_at` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `current_item_id` INTEGER NULL,
    ADD COLUMN IF NOT EXISTS `current_item_index` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS `last_active_at` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `submit_request_id` VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS `navigation_config` JSON NULL;

-- 向 practice_sessions 创建索引（来自 migration 9）
CREATE INDEX IF NOT EXISTS `practice_sessions_mode_idx` ON `practice_sessions`(`mode`);
CREATE INDEX IF NOT EXISTS `practice_sessions_expires_at_idx` ON `practice_sessions`(`expires_at`);

-- 向 answer_records 添加字段（来自 migration 9）
ALTER TABLE `answer_records` ADD COLUMN IF NOT EXISTS `item_status` VARCHAR(20) NOT NULL DEFAULT 'UNANSWERED',
    ADD COLUMN IF NOT EXISTS `saved_at` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `confirmed_at` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `graded_at` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `client_updated_at` DATETIME(3) NULL;
