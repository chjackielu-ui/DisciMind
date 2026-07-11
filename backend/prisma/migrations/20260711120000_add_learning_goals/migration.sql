-- Additive migration: natural-language learning goals are stored separately
-- from the formal knowledge graph. Existing learning sessions remain valid.
CREATE TABLE `learning_goals` (
    `goal_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NOT NULL,
    `raw_goal` TEXT NOT NULL,
    `normalized_goal_hash` VARCHAR(64) NOT NULL,
    `normalized_title` VARCHAR(255) NOT NULL,
    `focus_question` TEXT NULL,
    `goal_type` VARCHAR(50) NOT NULL,
    `status` VARCHAR(50) NOT NULL,
    `operation_id` VARCHAR(128) NULL,
    `primary_knowledge_point_id` INTEGER NULL,
    `related_knowledge_points` JSON NULL,
    `sub_goals` JSON NULL,
    `prerequisite_goals` JSON NULL,
    `clarification_options` JSON NULL,
    `target_depth` VARCHAR(50) NULL,
    `target_mastery` INTEGER NULL,
    `estimated_minutes` INTEGER NULL,
    `coverage_status` VARCHAR(50) NULL,
    `coverage_score` DOUBLE NULL,
    `coverage_details` JSON NULL,
    `resolver_snapshot` JSON NULL,
    `planner_snapshot` JSON NULL,
    `goal_snapshot` JSON NULL,
    `workflow_template_id` INTEGER NULL,
    `workflow_version_id` INTEGER NULL,
    `result_snapshot` JSON NULL,
    `completed_sub_goals` JSON NULL,
    `unresolved_sub_goals` JSON NULL,
    `error_code` VARCHAR(100) NULL,
    `error_message` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `confirmed_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,

    UNIQUE INDEX `lg_student_operation_key`(`student_user_id`, `operation_id`),
    INDEX `lg_student_created_idx`(`student_user_id`, `created_at`),
    INDEX `lg_idempotency_lookup_idx`(`student_user_id`, `course_id`, `normalized_goal_hash`, `status`),
    INDEX `lg_course_status_idx`(`course_id`, `status`),
    INDEX `lg_primary_kp_idx`(`primary_knowledge_point_id`),
    PRIMARY KEY (`goal_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `learning_sessions`
    ADD COLUMN `learning_goal_id` INTEGER NULL,
    ADD COLUMN `goal_snapshot` JSON NULL,
    ADD UNIQUE INDEX `learning_sessions_learning_goal_id_key`(`learning_goal_id`),
    ADD INDEX `learning_sessions_learning_goal_id_idx`(`learning_goal_id`);

ALTER TABLE `learning_goals` ADD CONSTRAINT `learning_goals_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `learning_goals` ADD CONSTRAINT `learning_goals_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `learning_goals` ADD CONSTRAINT `learning_goals_primary_knowledge_point_id_fkey` FOREIGN KEY (`primary_knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `learning_goals` ADD CONSTRAINT `learning_goals_workflow_template_id_fkey` FOREIGN KEY (`workflow_template_id`) REFERENCES `learning_workflow_templates`(`template_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `learning_goals` ADD CONSTRAINT `learning_goals_workflow_version_id_fkey` FOREIGN KEY (`workflow_version_id`) REFERENCES `learning_workflow_versions`(`version_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `learning_sessions` ADD CONSTRAINT `learning_sessions_learning_goal_id_fkey` FOREIGN KEY (`learning_goal_id`) REFERENCES `learning_goals`(`goal_id`) ON DELETE SET NULL ON UPDATE CASCADE;
