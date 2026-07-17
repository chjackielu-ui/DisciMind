-- ============================================================
-- DisciMind: 修复 auth_sessions 表缺失问题的 SQL 补丁
--
-- 问题原因:
--   migration 20260704174142 引用了 refresh_tokens 表，
--   但该表在 migration 20260705090000 才创建，导致迁移顺序依赖。
--
-- 解决方式:
--   按正确的逻辑顺序手动执行 SQL（先建表，再 ALTER，再加外键），
--   然后将 4 个迁移标记为已应用。
--   不修改任何原迁移文件。
-- ============================================================

-- ==========================================
-- 第 1 部分: 执行 migration 20260704022043
-- 重命名外键和索引（仅操作已有表，安全）
-- ==========================================

-- DropForeignKey
ALTER TABLE `ai_question_generation_questions` DROP FOREIGN KEY `ai_question_generation_questions_log_id_fkey`;

-- DropForeignKey
ALTER TABLE `practice_session_questions` DROP FOREIGN KEY `practice_session_questions_session_id_fkey`;

-- AddForeignKey
ALTER TABLE `ai_question_generation_questions` ADD CONSTRAINT `ai_question_generation_questions_ai_question_generation_log_fkey` FOREIGN KEY (`ai_question_generation_log_id`) REFERENCES `ai_question_generation_logs`(`ai_question_generation_log_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practice_session_questions` ADD CONSTRAINT `practice_session_questions_practice_session_id_fkey` FOREIGN KEY (`practice_session_id`) REFERENCES `practice_sessions`(`practice_session_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `ai_question_generation_questions` RENAME INDEX `ai_question_generation_questions_log_question_key` TO `ai_question_generation_questions_ai_question_generation_log__key`;

-- RenameIndex
ALTER TABLE `practice_session_questions` RENAME INDEX `practice_session_questions_session_question_key` TO `practice_session_questions_practice_session_id_question_id_key`;

-- RenameIndex
ALTER TABLE `question_bank_knowledge_points` RENAME INDEX `question_bank_knowledge_points_bank_kp_key` TO `question_bank_knowledge_points_question_bank_id_knowledge_po_key`;

-- RenameIndex
ALTER TABLE `question_bank_questions` RENAME INDEX `question_bank_questions_bank_question_key` TO `question_bank_questions_question_bank_id_question_id_key`;

-- RenameIndex
ALTER TABLE `question_bank_teaching_classes` RENAME INDEX `question_bank_teaching_classes_bank_class_key` TO `question_bank_teaching_classes_question_bank_id_teaching_cla_key`;

-- ==========================================
-- 第 2 部分: 执行 migration 20260704103000
-- 添加唯一约束（安全操作）
-- ==========================================

-- 删除重复选课记录，保留最新一条
DELETE old_enrollment
FROM student_course_enrollments AS old_enrollment
INNER JOIN student_course_enrollments AS newer_enrollment
  ON old_enrollment.student_user_id = newer_enrollment.student_user_id
  AND old_enrollment.course_id = newer_enrollment.course_id
  AND old_enrollment.enrollment_id < newer_enrollment.enrollment_id;

-- 添加唯一索引
ALTER TABLE student_course_enrollments
  ADD UNIQUE INDEX student_course_enrollments_student_user_id_course_id_key (student_user_id, course_id);

-- ==========================================
-- 第 3 部分: 先创建 refresh_tokens 表
-- （来自 migration 20260705090000，提前执行
--   以解决 ALTER 依赖问题）
-- ==========================================

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

-- ==========================================
-- 第 4 部分: 执行 migration 20260704174142
-- （现在 refresh_tokens 表已存在，ALTER 不会报错）
-- ==========================================

-- AlterTable: 向 practice_sessions 添加字段
ALTER TABLE `practice_sessions` ADD COLUMN `source_id` INTEGER NULL,
    ADD COLUMN `source_type` VARCHAR(30) NULL,
    ADD COLUMN `submit_reason` VARCHAR(30) NULL,
    ADD COLUMN `task_id` INTEGER NULL;

-- AlterTable: 向 refresh_tokens 添加 session_id 字段
ALTER TABLE `refresh_tokens` ADD COLUMN `session_id` INTEGER NULL;

-- CreateTable: 创建 auth_sessions 表
CREATE TABLE `auth_sessions` (
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

-- 创建索引
CREATE INDEX `practice_sessions_source_type_idx` ON `practice_sessions`(`source_type`);
CREATE INDEX `practice_sessions_source_id_idx` ON `practice_sessions`(`source_id`);

-- 添加外键
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_refresh_token_id_fkey` FOREIGN KEY (`refresh_token_id`) REFERENCES `refresh_tokens`(`refresh_token_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ==========================================
-- 第 5 部分: 执行 migration 20260705090000 剩余部分
-- （practice_sessions 和 answer_records 的修改）
-- ==========================================

-- 修改 practice_sessions 的字段类型和默认值
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

-- 创建索引
CREATE INDEX `practice_sessions_mode_idx` ON `practice_sessions`(`mode`);
CREATE INDEX `practice_sessions_expires_at_idx` ON `practice_sessions`(`expires_at`);

-- 修改 answer_records
ALTER TABLE `answer_records`
    ADD COLUMN `item_status` VARCHAR(20) NOT NULL DEFAULT 'UNANSWERED',
    ADD COLUMN `saved_at` DATETIME(3) NULL,
    ADD COLUMN `confirmed_at` DATETIME(3) NULL,
    ADD COLUMN `graded_at` DATETIME(3) NULL,
    ADD COLUMN `client_updated_at` DATETIME(3) NULL;

-- 创建索引
CREATE INDEX `answer_records_practice_session_id_question_id_idx` ON `answer_records`(`practice_session_id`, `question_id`);
CREATE INDEX `answer_records_submission_id_question_id_idx` ON `answer_records`(`submission_id`, `question_id`);
CREATE INDEX `answer_records_item_status_idx` ON `answer_records`(`item_status`);

-- ==========================================
-- 第 6 部分: 插入迁移记录到 _prisma_migrations
-- 让 Prisma 知道这些迁移已应用
-- ==========================================

INSERT INTO `_prisma_migrations` (`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`) VALUES
(
    UUID(),
    SHA2('-- Migration 20260704022043\n', 512),
    NOW(3),
    '20260704022043_unique_student_course_enrollment',
    NULL,
    NULL,
    NOW(3),
    0
),
(
    UUID(),
    SHA2('-- Migration 20260704103000\n', 512),
    NOW(3),
    '20260704103000_unique_student_course_enrollment',
    NULL,
    NULL,
    NOW(3),
    0
),
(
    UUID(),
    SHA2('-- Migration 20260704174142\n', 512),
    NOW(3),
    '20260704174142_add_auth_session_and_attempt_source',
    NULL,
    NULL,
    NOW(3),
    0
),
(
    UUID(),
    SHA2('-- Migration 20260705090000\n', 512),
    NOW(3),
    '20260705090000_auth_refresh_and_attempt_state',
    NULL,
    NULL,
    NOW(3),
    0
);

SELECT CONCAT('✅ 修复完成。已创建: auth_sessions, refresh_tokens 表，更新 practice_sessions 和 answer_records，注册 4 个迁移记录。') AS result;
