-- Fix missing columns in questions table
-- Prisma schema defines these columns but they were never added to the database

-- Add source_type column
ALTER TABLE `questions` ADD COLUMN `source_type` ENUM('original', 'variant', 'similar') NULL AFTER `is_ai_generated`,
    ADD INDEX `questions_source_type_idx`(`source_type`);

-- Add source_question_id column
ALTER TABLE `questions` ADD COLUMN `source_question_id` INTEGER NULL AFTER `source_type`,
    ADD INDEX `questions_source_question_id_idx`(`source_question_id`);

-- Add source_wrong_question_id column
ALTER TABLE `questions` ADD COLUMN `source_wrong_question_id` INTEGER NULL AFTER `source_question_id`;

-- Add generation_mode column
ALTER TABLE `questions` ADD COLUMN `generation_mode` ENUM('original', 'variant', 'similar') NULL AFTER `source_wrong_question_id`,
    ADD INDEX `questions_generation_mode_idx`(`generation_mode`);

-- Add generated_by_user_id column
ALTER TABLE `questions` ADD COLUMN `generated_by_user_id` INTEGER NULL AFTER `generation_mode`;

-- Add model_name column
ALTER TABLE `questions` ADD COLUMN `model_name` VARCHAR(100) NULL AFTER `generated_by_user_id`;

-- Add prompt_version column
ALTER TABLE `questions` ADD COLUMN `prompt_version` VARCHAR(50) NULL AFTER `model_name`;

-- Add content_hash column
ALTER TABLE `questions` ADD COLUMN `content_hash` VARCHAR(128) NULL AFTER `prompt_version`,
    ADD INDEX `questions_content_hash_idx`(`content_hash`);

-- Add is_reusable column
ALTER TABLE `questions` ADD COLUMN `is_reusable` BOOLEAN NOT NULL DEFAULT true AFTER `content_hash`;
