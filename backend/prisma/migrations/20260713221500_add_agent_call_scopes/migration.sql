ALTER TABLE `user_agents`
  ADD COLUMN `subject_scope` VARCHAR(24) NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN `course_id` INTEGER NULL,
  ADD COLUMN `subject_code` VARCHAR(64) NULL,
  ADD COLUMN `allowed_course_ids_json` JSON NULL,
  ADD COLUMN `is_cross_subject_utility` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `user_agents_subject_scope_course_id_idx` ON `user_agents`(`subject_scope`, `course_id`);

UPDATE `user_agents`
SET `is_cross_subject_utility` = true
WHERE `agent_type` = 'FILE_GENERATOR' OR `system_key` IN ('exam-paper-generator', 'study-handout-generator');
