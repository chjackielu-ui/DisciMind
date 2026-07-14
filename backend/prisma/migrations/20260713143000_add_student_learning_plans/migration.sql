-- Additive migration: freeze the selected goal, workflow version, graph and settings for each plan.
CREATE TABLE `student_learning_plans` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `student_user_id` INTEGER NOT NULL,
  `course_id` INTEGER NOT NULL,
  `knowledge_point_id` INTEGER NULL,
  `knowledge_point_ids_json` JSON NOT NULL,
  `learning_goal_id` INTEGER NOT NULL,
  `goal_snapshot` JSON NOT NULL,
  `workflow_template_id` INTEGER NULL,
  `workflow_version_id` INTEGER NOT NULL,
  `graph_snapshot` JSON NOT NULL,
  `settings_snapshot` JSON NOT NULL,
  `creation_mode` ENUM('goal_based', 'ai_generated', 'custom') NOT NULL,
  `status` ENUM('draft', 'ready', 'running', 'paused', 'completed', 'failed', 'archived') NOT NULL DEFAULT 'draft',
  `current_node_id` VARCHAR(100) NULL,
  `progress` INTEGER NOT NULL DEFAULT 0,
  `target_mastery` INTEGER NULL,
  `completion_mode` VARCHAR(32) NULL,
  `estimated_minutes` INTEGER NULL,
  `learning_session_id` INTEGER NULL,
  `active_key` VARCHAR(64) NULL,
  `error_code` VARCHAR(100) NULL,
  `error_message` VARCHAR(500) NULL,
  `ready_at` DATETIME(3) NULL,
  `started_at` DATETIME(3) NULL,
  `paused_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `archived_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `student_learning_plans_learning_session_id_key`(`learning_session_id`),
  UNIQUE INDEX `student_learning_plans_active_key_key`(`active_key`),
  INDEX `student_learning_plans_user_status_updated_idx`(`student_user_id`, `status`, `updated_at`),
  INDEX `student_learning_plans_scope_idx`(`course_id`, `knowledge_point_id`),
  INDEX `student_learning_plans_goal_idx`(`learning_goal_id`),
  INDEX `student_learning_plans_workflow_idx`(`workflow_template_id`, `workflow_version_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `learning_flow_preloads` ADD COLUMN `learning_plan_id` INTEGER NULL;
ALTER TABLE `learning_flow_resource_links` ADD COLUMN `learning_plan_id` INTEGER NULL;
CREATE INDEX `learning_flow_preloads_plan_idx` ON `learning_flow_preloads`(`learning_plan_id`);
CREATE INDEX `learning_flow_resource_links_plan_idx` ON `learning_flow_resource_links`(`learning_plan_id`);

ALTER TABLE `student_learning_plans` ADD CONSTRAINT `student_learning_plans_student_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `student_learning_plans` ADD CONSTRAINT `student_learning_plans_course_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `student_learning_plans` ADD CONSTRAINT `student_learning_plans_kp_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `student_learning_plans` ADD CONSTRAINT `student_learning_plans_goal_fkey` FOREIGN KEY (`learning_goal_id`) REFERENCES `learning_goals`(`goal_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `student_learning_plans` ADD CONSTRAINT `student_learning_plans_template_fkey` FOREIGN KEY (`workflow_template_id`) REFERENCES `learning_workflow_templates`(`template_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `student_learning_plans` ADD CONSTRAINT `student_learning_plans_version_fkey` FOREIGN KEY (`workflow_version_id`) REFERENCES `learning_workflow_versions`(`version_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `student_learning_plans` ADD CONSTRAINT `student_learning_plans_session_fkey` FOREIGN KEY (`learning_session_id`) REFERENCES `learning_sessions`(`session_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `learning_flow_preloads` ADD CONSTRAINT `lf_preload_plan_fkey` FOREIGN KEY (`learning_plan_id`) REFERENCES `student_learning_plans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `learning_flow_resource_links` ADD CONSTRAINT `lf_resource_plan_fkey` FOREIGN KEY (`learning_plan_id`) REFERENCES `student_learning_plans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
