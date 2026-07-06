-- 补充修复：添加缺失的列和创建 auth_sessions 表
-- refresh_tokens 表和外键已存在，跳过重复部分

-- 添加 session_id 列（如果不存在）
SET @dbname = 'discimind';
SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='refresh_tokens' AND COLUMN_NAME='session_id');
SET @sql = IF(@exists = 0, 'ALTER TABLE refresh_tokens ADD COLUMN session_id INTEGER NULL', 'SELECT "session_id already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 创建 auth_sessions 表（如果不存在）
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

-- 添加外键（如果不存在）
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=@dbname AND TABLE_NAME='auth_sessions' AND CONSTRAINT_NAME='auth_sessions_user_id_fkey');
SET @sql2 = IF(@fk_exists = 0, 'ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT "auth_sessions_user_id_fkey already exists"');
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

SET @fk2_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=@dbname AND TABLE_NAME='auth_sessions' AND CONSTRAINT_NAME='auth_sessions_refresh_token_id_fkey');
SET @sql3 = IF(@fk2_exists = 0, 'ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_refresh_token_id_fkey FOREIGN KEY (refresh_token_id) REFERENCES refresh_tokens(refresh_token_id) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT "auth_sessions_refresh_token_id_fkey already exists"');
PREPARE stmt3 FROM @sql3;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;

-- 向 practice_sessions 添加字段
ALTER TABLE `practice_sessions` ADD COLUMN IF NOT EXISTS `source_id` INTEGER NULL,
    ADD COLUMN IF NOT EXISTS `source_type` VARCHAR(30) NULL,
    ADD COLUMN IF NOT EXISTS `submit_reason` VARCHAR(30) NULL,
    ADD COLUMN IF NOT EXISTS `task_id` INTEGER NULL;

-- 向 practice_sessions 添加更多字段
ALTER TABLE `practice_sessions` ADD COLUMN IF NOT EXISTS `answer_mode` VARCHAR(30) NOT NULL DEFAULT 'SINGLE',
    ADD COLUMN IF NOT EXISTS `expires_at` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `current_item_id` INTEGER NULL,
    ADD COLUMN IF NOT EXISTS `current_item_index` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS `last_active_at` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `submit_request_id` VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS `navigation_config` JSON NULL;

-- 向 answer_records 添加字段
ALTER TABLE `answer_records` ADD COLUMN IF NOT EXISTS `item_status` VARCHAR(20) NOT NULL DEFAULT 'UNANSWERED',
    ADD COLUMN IF NOT EXISTS `saved_at` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `confirmed_at` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `graded_at` DATETIME(3) NULL,
    ADD COLUMN IF NOT EXISTS `client_updated_at` DATETIME(3) NULL;

SELECT '✅ 修复完成' AS result;
