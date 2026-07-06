-- ============================================================
-- DisciMind: 剩余修复 v2（兼容 MySQL 语法）
-- 使用信息模式表检查列存在性，避免 IF NOT EXISTS
-- ============================================

-- 1. 添加 session_id 到 refresh_tokens（如果列不存在）
SET @dbname = 'discimind';
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='refresh_tokens' AND COLUMN_NAME='session_id');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE refresh_tokens ADD COLUMN session_id INTEGER NULL', 'SELECT "skip: session_id already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. 创建 auth_sessions 表
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

-- 3. 添加 auth_sessions 外键（如果不存在）
SET @fk1 = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=@dbname AND TABLE_NAME='auth_sessions' AND CONSTRAINT_NAME='auth_sessions_user_id_fkey');
SET @sql1 = IF(@fk1 = 0, 'ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT "skip: auth_sessions_user_id_fkey exists"');
PREPARE stmt1 FROM @sql1;
EXECUTE stmt1;
DEALLOCATE PREPARE stmt1;

SET @fk2 = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=@dbname AND TABLE_NAME='auth_sessions' AND CONSTRAINT_NAME='auth_sessions_refresh_token_id_fkey');
SET @sql2 = IF(@fk2 = 0, 'ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_refresh_token_id_fkey FOREIGN KEY (refresh_token_id) REFERENCES refresh_tokens(refresh_token_id) ON DELETE SET NULL ON UPDATE CASCADE', 'SELECT "skip: auth_sessions_refresh_token_id_fkey exists"');
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- 4. 向 practice_sessions 添加字段
SET @col1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='practice_sessions' AND COLUMN_NAME='source_id');
SET @sql_p1 = IF(@col1 = 0, 'ALTER TABLE practice_sessions ADD COLUMN source_id INTEGER NULL', 'SELECT "skip: source_id exists"');
PREPARE stmt_p1 FROM @sql_p1;
EXECUTE stmt_p1;
DEALLOCATE PREPARE stmt_p1;

SET @col2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='practice_sessions' AND COLUMN_NAME='source_type');
SET @sql_p2 = IF(@col2 = 0, 'ALTER TABLE practice_sessions ADD COLUMN source_type VARCHAR(30) NULL', 'SELECT "skip: source_type exists"');
PREPARE stmt_p2 FROM @sql_p2;
EXECUTE stmt_p2;
DEALLOCATE PREPARE stmt_p2;

SET @col3 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='practice_sessions' AND COLUMN_NAME='submit_reason');
SET @sql_p3 = IF(@col3 = 0, 'ALTER TABLE practice_sessions ADD COLUMN submit_reason VARCHAR(30) NULL', 'SELECT "skip: submit_reason exists"');
PREPARE stmt_p3 FROM @sql_p3;
EXECUTE stmt_p3;
DEALLOCATE PREPARE stmt_p3;

SET @col4 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='practice_sessions' AND COLUMN_NAME='task_id');
SET @sql_p4 = IF(@col4 = 0, 'ALTER TABLE practice_sessions ADD COLUMN task_id INTEGER NULL', 'SELECT "skip: task_id exists"');
PREPARE stmt_p4 FROM @sql_p4;
EXECUTE stmt_p4;
DEALLOCATE PREPARE stmt_p4;

SET @col5 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='practice_sessions' AND COLUMN_NAME='answer_mode');
SET @sql_p5 = IF(@col5 = 0, 'ALTER TABLE practice_sessions ADD COLUMN answer_mode VARCHAR(30) NOT NULL DEFAULT "SINGLE"', 'SELECT "skip: answer_mode exists"');
PREPARE stmt_p5 FROM @sql_p5;
EXECUTE stmt_p5;
DEALLOCATE PREPARE stmt_p5;

SET @col6 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='practice_sessions' AND COLUMN_NAME='expires_at');
SET @sql_p6 = IF(@col6 = 0, 'ALTER TABLE practice_sessions ADD COLUMN expires_at DATETIME(3) NULL', 'SELECT "skip: expires_at exists"');
PREPARE stmt_p6 FROM @sql_p6;
EXECUTE stmt_p6;
DEALLOCATE PREPARE stmt_p6;

SET @col7 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='practice_sessions' AND COLUMN_NAME='current_item_id');
SET @sql_p7 = IF(@col7 = 0, 'ALTER TABLE practice_sessions ADD COLUMN current_item_id INTEGER NULL', 'SELECT "skip: current_item_id exists"');
PREPARE stmt_p7 FROM @sql_p7;
EXECUTE stmt_p7;
DEALLOCATE PREPARE stmt_p7;

SET @col8 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='practice_sessions' AND COLUMN_NAME='current_item_index');
SET @sql_p8 = IF(@col8 = 0, 'ALTER TABLE practice_sessions ADD COLUMN current_item_index INTEGER NOT NULL DEFAULT 0', 'SELECT "skip: current_item_index exists"');
PREPARE stmt_p8 FROM @sql_p8;
EXECUTE stmt_p8;
DEALLOCATE PREPARE stmt_p8;

SET @col9 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='practice_sessions' AND COLUMN_NAME='last_active_at');
SET @sql_p9 = IF(@col9 = 0, 'ALTER TABLE practice_sessions ADD COLUMN last_active_at DATETIME(3) NULL', 'SELECT "skip: last_active_at exists"');
PREPARE stmt_p9 FROM @sql_p9;
EXECUTE stmt_p9;
DEALLOCATE PREPARE stmt_p9;

SET @col10 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='practice_sessions' AND COLUMN_NAME='submit_request_id');
SET @sql_p10 = IF(@col10 = 0, 'ALTER TABLE practice_sessions ADD COLUMN submit_request_id VARCHAR(100) NULL', 'SELECT "skip: submit_request_id exists"');
PREPARE stmt_p10 FROM @sql_p10;
EXECUTE stmt_p10;
DEALLOCATE PREPARE stmt_p10;

SET @col11 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='practice_sessions' AND COLUMN_NAME='navigation_config');
SET @sql_p11 = IF(@col11 = 0, 'ALTER TABLE practice_sessions ADD COLUMN navigation_config JSON NULL', 'SELECT "skip: navigation_config exists"');
PREPARE stmt_p11 FROM @sql_p11;
EXECUTE stmt_p11;
DEALLOCATE PREPARE stmt_p11;

-- 5. 向 answer_records 添加字段
SET @col_a1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='answer_records' AND COLUMN_NAME='item_status');
SET @sql_a1 = IF(@col_a1 = 0, 'ALTER TABLE answer_records ADD COLUMN item_status VARCHAR(20) NOT NULL DEFAULT "UNANSWERED"', 'SELECT "skip: item_status exists"');
PREPARE stmt_a1 FROM @sql_a1;
EXECUTE stmt_a1;
DEALLOCATE PREPARE stmt_a1;

SET @col_a2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='answer_records' AND COLUMN_NAME='saved_at');
SET @sql_a2 = IF(@col_a2 = 0, 'ALTER TABLE answer_records ADD COLUMN saved_at DATETIME(3) NULL', 'SELECT "skip: saved_at exists"');
PREPARE stmt_a2 FROM @sql_a2;
EXECUTE stmt_a2;
DEALLOCATE PREPARE stmt_a2;

SET @col_a3 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='answer_records' AND COLUMN_NAME='confirmed_at');
SET @sql_a3 = IF(@col_a3 = 0, 'ALTER TABLE answer_records ADD COLUMN confirmed_at DATETIME(3) NULL', 'SELECT "skip: confirmed_at exists"');
PREPARE stmt_a3 FROM @sql_a3;
EXECUTE stmt_a3;
DEALLOCATE PREPARE stmt_a3;

SET @col_a4 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='answer_records' AND COLUMN_NAME='graded_at');
SET @sql_a4 = IF(@col_a4 = 0, 'ALTER TABLE answer_records ADD COLUMN graded_at DATETIME(3) NULL', 'SELECT "skip: graded_at exists"');
PREPARE stmt_a4 FROM @sql_a4;
EXECUTE stmt_a4;
DEALLOCATE PREPARE stmt_a4;

SET @col_a5 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='answer_records' AND COLUMN_NAME='client_updated_at');
SET @sql_a5 = IF(@col_a5 = 0, 'ALTER TABLE answer_records ADD COLUMN client_updated_at DATETIME(3) NULL', 'SELECT "skip: client_updated_at exists"');
PREPARE stmt_a5 FROM @sql_a5;
EXECUTE stmt_a5;
DEALLOCATE PREPARE stmt_a5;

SELECT '✅ 所有修复已完成' AS result;
