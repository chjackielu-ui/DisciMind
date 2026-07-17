-- CreateTable: learning_workflow_templates
CREATE TABLE `learning_workflow_templates` (
    `template_id` INTEGER NOT NULL AUTO_INCREMENT,
    `template_key` VARCHAR(100) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `owner_type` ENUM('system', 'student', 'teacher', 'ai') NOT NULL DEFAULT 'student',
    `owner_user_id` INTEGER NULL,
    `course_id` INTEGER NULL,
    `source_type` ENUM('system', 'student', 'teacher', 'ai') NOT NULL DEFAULT 'student',
    `is_published` BOOLEAN NOT NULL DEFAULT false,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`template_id`),
    UNIQUE INDEX `learning_workflow_templates_template_key_key`(`template_key`),
    INDEX `learning_workflow_templates_owner_type_idx`(`owner_type`),
    INDEX `learning_workflow_templates_owner_user_id_idx`(`owner_user_id`),
    INDEX `learning_workflow_templates_course_id_idx`(`course_id`),
    INDEX `learning_workflow_templates_source_type_idx`(`source_type`),
    INDEX `learning_workflow_templates_is_published_idx`(`is_published`),
    INDEX `learning_workflow_templates_is_default_idx`(`is_default`),
    INDEX `learning_workflow_templates_template_key_idx`(`template_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: learning_workflow_versions
CREATE TABLE `learning_workflow_versions` (
    `version_id` INTEGER NOT NULL AUTO_INCREMENT,
    `template_id` INTEGER NOT NULL,
    `version_number` INTEGER NOT NULL DEFAULT 1,
    `graph_json` JSON NOT NULL,
    `settings_json` JSON NOT NULL,
    `created_by` INTEGER NULL,
    `change_summary` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`version_id`),
    INDEX `learning_workflow_versions_template_id_idx`(`template_id`),
    INDEX `learning_workflow_versions_template_id_version_number_idx`(`template_id`, `version_number`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: learning_sessions
CREATE TABLE `learning_sessions` (
    `session_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NULL,
    `knowledge_point_id` INTEGER NULL,
    `workflow_template_id` INTEGER NULL,
    `workflow_version_id` INTEGER NULL,
    `workflow_snapshot_json` JSON NULL,
    `runtime_graph_json` JSON NULL,
    `status` ENUM('created', 'running', 'paused', 'completed', 'abandoned', 'failed') NOT NULL DEFAULT 'created',
    `current_node_id` VARCHAR(100) NULL,
    `completion_mode` ENUM('flow_complete', 'mastery_target') NOT NULL DEFAULT 'flow_complete',
    `target_mastery` INTEGER NOT NULL DEFAULT 80,
    `adjustment_mode` ENUM('auto_adjust', 'ask_before_adjust', 'strict_original') NOT NULL DEFAULT 'auto_adjust',
    `mastery_before` DOUBLE NULL,
    `mastery_after` DOUBLE NULL,
    `mastery_current` DOUBLE NULL,
    `consecutive_correct` INTEGER NOT NULL DEFAULT 0,
    `consecutive_wrong` INTEGER NOT NULL DEFAULT 0,
    `total_correct` INTEGER NOT NULL DEFAULT 0,
    `total_wrong` INTEGER NOT NULL DEFAULT 0,
    `started_at` DATETIME(3) NULL,
    `paused_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `actual_duration_seconds` INTEGER NULL,
    `estimated_minutes` INTEGER NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`session_id`),
    INDEX `learning_sessions_student_user_id_idx`(`student_user_id`),
    INDEX `learning_sessions_student_user_id_status_idx`(`student_user_id`, `status`),
    INDEX `learning_sessions_course_id_idx`(`course_id`),
    INDEX `learning_sessions_knowledge_point_id_idx`(`knowledge_point_id`),
    INDEX `learning_sessions_workflow_template_id_idx`(`workflow_template_id`),
    INDEX `learning_sessions_status_idx`(`status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: learning_session_node_runs
CREATE TABLE `learning_session_node_runs` (
    `node_run_id` INTEGER NOT NULL AUTO_INCREMENT,
    `session_id` INTEGER NOT NULL,
    `node_id` VARCHAR(100) NOT NULL,
    `node_type` ENUM('concept_explanation','analogy_explanation','worked_example_analysis','socratic_questioning','basic_practice','adaptive_practice','wrong_question_repair','mastery_gate','learning_summary') NOT NULL,
    `status` ENUM('pending','running','completed','skipped','inserted','failed','waiting_confirmation') NOT NULL DEFAULT 'pending',
    `sequence_index` INTEGER NOT NULL DEFAULT 0,
    `agent_type` ENUM('course_qa','learning_analysis','personalized_recommendation','question_generation','document_summary','trainer','explainer','diagnostician') NULL,
    `agent_run_id` INTEGER NULL,
    `input_summary_json` JSON NULL,
    `output_summary_json` JSON NULL,
    `agent_conversation_id` INTEGER NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `skip_reason` TEXT NULL,
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `inserted_by` VARCHAR(50) NULL,
    `insert_reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`node_run_id`),
    INDEX `learning_session_node_runs_session_id_idx`(`session_id`),
    INDEX `learning_session_node_runs_session_id_node_id_idx`(`session_id`, `node_id`),
    INDEX `learning_session_node_runs_agent_run_id_idx`(`agent_run_id`),
    INDEX `learning_session_node_runs_status_idx`(`status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: learning_session_events
CREATE TABLE `learning_session_events` (
    `event_id` INTEGER NOT NULL AUTO_INCREMENT,
    `session_id` INTEGER NOT NULL,
    `event_type` ENUM('node_started','node_completed','node_skipped','node_inserted','node_failed','diag_adjustment','diag_adjustment_applied','diag_adjustment_rejected','session_paused','session_resumed','session_completed','session_abandoned','session_failed','agent_error') NOT NULL,
    `node_id` VARCHAR(100) NULL,
    `title` VARCHAR(200) NOT NULL,
    `data_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`event_id`),
    INDEX `learning_session_events_session_id_idx`(`session_id`),
    INDEX `learning_session_events_session_id_created_at_idx`(`session_id`, `created_at`),
    INDEX `learning_session_events_event_type_idx`(`event_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: ai_flow_generation_jobs
CREATE TABLE `ai_flow_generation_jobs` (
    `job_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `input_text` TEXT NOT NULL,
    `course_id` INTEGER NULL,
    `knowledge_point_id` INTEGER NULL,
    `draft_json` JSON NULL,
    `optimized_json` JSON NULL,
    `status` ENUM('pending','generating','completed','failed') NOT NULL DEFAULT 'pending',
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`job_id`),
    INDEX `ai_flow_generation_jobs_user_id_idx`(`user_id`),
    INDEX `ai_flow_generation_jobs_status_idx`(`status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `learning_workflow_templates` ADD CONSTRAINT `learning_workflow_templates_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `learning_workflow_templates` ADD CONSTRAINT `learning_workflow_templates_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_workflow_versions` ADD CONSTRAINT `learning_workflow_versions_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `learning_workflow_templates`(`template_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `learning_workflow_versions` ADD CONSTRAINT `learning_workflow_versions_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_sessions` ADD CONSTRAINT `learning_sessions_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `learning_sessions` ADD CONSTRAINT `learning_sessions_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `learning_sessions` ADD CONSTRAINT `learning_sessions_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `learning_sessions` ADD CONSTRAINT `learning_sessions_workflow_template_id_fkey` FOREIGN KEY (`workflow_template_id`) REFERENCES `learning_workflow_templates`(`template_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `learning_sessions` ADD CONSTRAINT `learning_sessions_workflow_version_id_fkey` FOREIGN KEY (`workflow_version_id`) REFERENCES `learning_workflow_versions`(`version_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_session_node_runs` ADD CONSTRAINT `learning_session_node_runs_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `learning_sessions`(`session_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `learning_session_node_runs` ADD CONSTRAINT `learning_session_node_runs_agent_run_id_fkey` FOREIGN KEY (`agent_run_id`) REFERENCES `agent_run_records`(`agent_run_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_session_events` ADD CONSTRAINT `learning_session_events_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `learning_sessions`(`session_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_flow_generation_jobs` ADD CONSTRAINT `ai_flow_generation_jobs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ai_flow_generation_jobs` ADD CONSTRAINT `ai_flow_generation_jobs_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ai_flow_generation_jobs` ADD CONSTRAINT `ai_flow_generation_jobs_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;
