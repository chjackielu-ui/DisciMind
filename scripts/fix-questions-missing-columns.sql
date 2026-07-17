-- ============================================================
-- DisciMind: 补全 questions 表缺失的列
-- 问题：Prisma Schema 定义了 source_type 等字段，但数据库
--       缺少对应列，导致 prisma.question.findMany() 报错。
-- 根因：Schema 变更后未生成并执行对应 migration。
-- 修复：新增所有 Schema 中有但数据库缺失的列和索引。
-- ============================================================

-- 1. 添加 source_type 列（题目来源/生成方式）
ALTER TABLE `questions`
  ADD COLUMN `source_type` ENUM('original', 'variant', 'similar') NULL AFTER `is_ai_generated`,
  ADD INDEX `questions_source_type_idx`(`source_type`);

-- 2. 添加 source_question_id 列（来源题目 ID）
ALTER TABLE `questions`
  ADD COLUMN `source_question_id` INTEGER NULL AFTER `source_type`,
  ADD INDEX `questions_source_question_id_idx`(`source_question_id`);

-- 3. 添加 source_wrong_question_id 列（来源错题 ID）
ALTER TABLE `questions`
  ADD COLUMN `source_wrong_question_id` INTEGER NULL AFTER `source_question_id`;

-- 4. 添加 generation_mode 列（生成模式）
ALTER TABLE `questions`
  ADD COLUMN `generation_mode` ENUM('original', 'variant', 'similar') NULL AFTER `source_wrong_question_id`,
  ADD INDEX `questions_generation_mode_idx`(`generation_mode`);

-- 5. 添加 generated_by_user_id 列（生成者）
ALTER TABLE `questions`
  ADD COLUMN `generated_by_user_id` INTEGER NULL AFTER `generation_mode`;

-- 6. 添加 model_name 列（AI 模型名）
ALTER TABLE `questions`
  ADD COLUMN `model_name` VARCHAR(100) NULL AFTER `generated_by_user_id`;

-- 7. 添加 prompt_version 列（Prompt 版本）
ALTER TABLE `questions`
  ADD COLUMN `prompt_version` VARCHAR(50) NULL AFTER `model_name`;

-- 8. 添加 content_hash 列（内容哈希，用于去重）
ALTER TABLE `questions`
  ADD COLUMN `content_hash` VARCHAR(128) NULL AFTER `prompt_version`,
  ADD INDEX `questions_content_hash_idx`(`content_hash`);

-- 9. 添加 is_reusable 列（是否可复用）
ALTER TABLE `questions`
  ADD COLUMN `is_reusable` BOOLEAN NOT NULL DEFAULT true AFTER `content_hash`;

SELECT '✅ questions 表缺失列补全完成' AS result;
