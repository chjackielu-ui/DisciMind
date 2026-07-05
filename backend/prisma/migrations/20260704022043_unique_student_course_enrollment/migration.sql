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
