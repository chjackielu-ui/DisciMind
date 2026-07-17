-- DropForeignKey
ALTER TABLE `generated_artifacts` DROP FOREIGN KEY `generated_artifacts_agent_id_fkey`;

-- DropForeignKey
ALTER TABLE `generated_artifacts` DROP FOREIGN KEY `generated_artifacts_conversation_id_fkey`;

-- DropIndex
DROP INDEX `student_course_enrollments_student_user_id_course_id_key` ON `student_course_enrollments`;

-- AlterTable
ALTER TABLE `admin_classes` ADD COLUMN `advisor_user_id` INTEGER NULL,
    ADD COLUMN `college_id` INTEGER NULL,
    ADD COLUMN `major_id` INTEGER NULL,
    ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE `async_tasks` MODIFY `task_type` ENUM('KNOWLEDGE_INDEXING', 'FILE_GENERATION', 'DOCUMENT_EXPORT', 'ARTIFACT_CLEANUP', 'LEARNING_FLOW_PRELOAD', 'VOICE_PRELOAD', 'LESSON_PLAN_GENERATION', 'LESSON_PLAN_EXPORT', 'TEACHER_ANALYTICS') NOT NULL;

-- AlterTable
ALTER TABLE `generated_artifacts` ADD COLUMN `lesson_plan_id` INTEGER NULL,
    MODIFY `agent_id` INTEGER NULL,
    MODIFY `conversation_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `knowledge_documents` ADD COLUMN `external_url` VARCHAR(1000) NULL,
    ADD COLUMN `is_teaching_resource` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `lesson_plan_id` INTEGER NULL,
    ADD COLUMN `metadata_json` JSON NULL,
    ADD COLUMN `resource_category` VARCHAR(100) NULL,
    ADD COLUMN `resource_kind` VARCHAR(50) NULL;

-- AlterTable
ALTER TABLE `learning_tasks` ADD COLUMN `ai_grade_subjective` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `allow_pause` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `allowed_attempts` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `analysis_release_at` DATETIME(3) NULL,
    ADD COLUMN `auto_grade` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `configuration_json` JSON NULL,
    ADD COLUMN `duration_minutes` INTEGER NULL,
    ADD COLUMN `full_screen_mode` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `instructions` TEXT NULL,
    ADD COLUMN `pass_score` DOUBLE NULL,
    ADD COLUMN `published_at` DATETIME(3) NULL,
    ADD COLUMN `randomize_options` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `randomize_questions` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `rules` TEXT NULL,
    ADD COLUMN `save_draft` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `score_release_at` DATETIME(3) NULL,
    ADD COLUMN `show_analysis_policy` VARCHAR(30) NOT NULL DEFAULT 'after_deadline',
    ADD COLUMN `show_answer_policy` VARCHAR(30) NOT NULL DEFAULT 'after_deadline',
    ADD COLUMN `show_score_policy` VARCHAR(30) NOT NULL DEFAULT 'after_submit',
    ADD COLUMN `source_mode` VARCHAR(30) NOT NULL DEFAULT 'question_bank',
    ADD COLUMN `total_score` DOUBLE NULL,
    MODIFY `task_type` ENUM('homework', 'exam', 'practice', 'material', 'announcement', 'quiz', 'study_task', 'review_plan') NOT NULL;

-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `business_id` INTEGER NULL,
    ADD COLUMN `business_type` VARCHAR(50) NULL,
    ADD COLUMN `deleted_at` DATETIME(3) NULL,
    ADD COLUMN `expires_at` DATETIME(3) NULL,
    ADD COLUMN `idempotency_key` VARCHAR(160) NULL,
    MODIFY `notification_type` ENUM('task_published', 'task_deadline', 'task_submitted', 'exam_submitted', 'document_review', 'document_parsed', 'knowledge_application', 'ai_grading_done', 'file_generated', 'ai_task_done', 'student_risk', 'class_alert', 'frequent_question', 'resource_shared', 'system_notice') NOT NULL;

-- AlterTable
ALTER TABLE `student_course_enrollments` ADD COLUMN `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `task_questions` ADD COLUMN `score` DOUBLE NULL;

-- AlterTable
ALTER TABLE `teaching_classes` ADD COLUMN `archived_at` DATETIME(3) NULL,
    ADD COLUMN `capacity` INTEGER NULL,
    ADD COLUMN `code` VARCHAR(80) NULL,
    ADD COLUMN `course_offering_id` INTEGER NULL,
    ADD COLUMN `location` VARCHAR(200) NULL,
    ADD COLUMN `schedule` JSON NULL,
    ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    ADD COLUMN `teacher_user_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `user_profiles` ADD COLUMN `default_course_id` INTEGER NULL,
    ADD COLUMN `professional_title` VARCHAR(100) NULL,
    ADD COLUMN `teacher_preferences` JSON NULL;

-- CreateTable
CREATE TABLE `colleges` (
    `college_id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `code` VARCHAR(50) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `colleges_name_key`(`name`),
    UNIQUE INDEX `colleges_code_key`(`code`),
    PRIMARY KEY (`college_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `majors` (
    `major_id` INTEGER NOT NULL AUTO_INCREMENT,
    `college_id` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `code` VARCHAR(50) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `majors_code_key`(`code`),
    INDEX `majors_college_id_idx`(`college_id`),
    UNIQUE INDEX `majors_college_id_name_key`(`college_id`, `name`),
    PRIMARY KEY (`major_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `academic_semesters` (
    `semester_id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `start_date` DATETIME(3) NOT NULL,
    `end_date` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `academic_semesters_code_key`(`code`),
    INDEX `academic_semesters_status_idx`(`status`),
    PRIMARY KEY (`semester_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_offerings` (
    `course_offering_id` INTEGER NOT NULL AUTO_INCREMENT,
    `course_id` INTEGER NOT NULL,
    `semester_id` INTEGER NOT NULL,
    `start_date` DATETIME(3) NULL,
    `end_date` DATETIME(3) NULL,
    `teaching_progress` JSON NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `course_offerings_semester_id_idx`(`semester_id`),
    INDEX `course_offerings_status_idx`(`status`),
    UNIQUE INDEX `course_offerings_course_id_semester_id_key`(`course_id`, `semester_id`),
    PRIMARY KEY (`course_offering_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teaching_class_teacher_authorizations` (
    `authorization_id` INTEGER NOT NULL AUTO_INCREMENT,
    `teaching_class_id` INTEGER NOT NULL,
    `teacher_user_id` INTEGER NOT NULL,
    `role` VARCHAR(30) NOT NULL DEFAULT 'assistant',
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `granted_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `teaching_class_teacher_authorizations_teacher_user_id_status_idx`(`teacher_user_id`, `status`),
    UNIQUE INDEX `teaching_class_teacher_authorizations_teaching_class_id_teac_key`(`teaching_class_id`, `teacher_user_id`),
    PRIMARY KEY (`authorization_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teaching_class_admin_classes` (
    `link_id` INTEGER NOT NULL AUTO_INCREMENT,
    `teaching_class_id` INTEGER NOT NULL,
    `admin_class_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `teaching_class_admin_classes_admin_class_id_idx`(`admin_class_id`),
    UNIQUE INDEX `teaching_class_admin_classes_teaching_class_id_admin_class_i_key`(`teaching_class_id`, `admin_class_id`),
    PRIMARY KEY (`link_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `learning_task_recipients` (
    `recipient_id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `student_user_id` INTEGER NOT NULL,
    `teaching_class_id` INTEGER NOT NULL,
    `delivery_status` VARCHAR(20) NOT NULL DEFAULT 'delivered',
    `viewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `learning_task_recipients_student_user_id_delivery_status_idx`(`student_user_id`, `delivery_status`),
    INDEX `learning_task_recipients_teaching_class_id_idx`(`teaching_class_id`),
    UNIQUE INDEX `learning_task_recipients_task_id_student_user_id_key`(`task_id`, `student_user_id`),
    PRIMARY KEY (`recipient_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teaching_task_attachments` (
    `attachment_id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `document_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `teaching_task_attachments_document_id_idx`(`document_id`),
    UNIQUE INDEX `teaching_task_attachments_task_id_document_id_key`(`task_id`, `document_id`),
    PRIMARY KEY (`attachment_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lesson_plans` (
    `lesson_plan_id` INTEGER NOT NULL AUTO_INCREMENT,
    `teacher_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NOT NULL,
    `course_offering_id` INTEGER NULL,
    `teaching_class_id` INTEGER NULL,
    `chapter_id` INTEGER NULL,
    `topic` VARCHAR(240) NOT NULL,
    `teaching_date` DATETIME(3) NULL,
    `duration_minutes` INTEGER NOT NULL DEFAULT 45,
    `lesson_type` VARCHAR(50) NULL,
    `location` VARCHAR(200) NULL,
    `textbook` VARCHAR(500) NULL,
    `input_json` JSON NULL,
    `source_snapshot_json` JSON NULL,
    `status` ENUM('draft', 'generating', 'review', 'ready', 'published', 'archived', 'failed') NOT NULL DEFAULT 'draft',
    `current_version` INTEGER NOT NULL DEFAULT 0,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `errors_json` JSON NULL,
    `generation_task_id` INTEGER NULL,
    `published_at` DATETIME(3) NULL,
    `archived_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `lesson_plans_teacher_user_id_status_updated_at_idx`(`teacher_user_id`, `status`, `updated_at`),
    INDEX `lesson_plans_course_id_teaching_class_id_idx`(`course_id`, `teaching_class_id`),
    INDEX `lesson_plans_course_offering_id_idx`(`course_offering_id`),
    INDEX `lesson_plans_chapter_id_idx`(`chapter_id`),
    PRIMARY KEY (`lesson_plan_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lesson_plan_versions` (
    `lesson_plan_version_id` INTEGER NOT NULL AUTO_INCREMENT,
    `lesson_plan_id` INTEGER NOT NULL,
    `version_number` INTEGER NOT NULL,
    `created_by_user_id` INTEGER NOT NULL,
    `change_summary` VARCHAR(500) NULL,
    `ai_content_json` JSON NULL,
    `teacher_content_json` JSON NULL,
    `merged_content_json` JSON NOT NULL,
    `locked_blocks_json` JSON NULL,
    `data_range_json` JSON NULL,
    `agents_json` JSON NULL,
    `data_sources_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lesson_plan_versions_created_by_user_id_idx`(`created_by_user_id`),
    UNIQUE INDEX `lesson_plan_versions_lesson_plan_id_version_number_key`(`lesson_plan_id`, `version_number`),
    PRIMARY KEY (`lesson_plan_version_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lesson_plan_agent_executions` (
    `execution_id` INTEGER NOT NULL AUTO_INCREMENT,
    `lesson_plan_id` INTEGER NOT NULL,
    `teacher_user_id` INTEGER NOT NULL,
    `agent_key` VARCHAR(80) NOT NULL,
    `stage_key` VARCHAR(80) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'queued',
    `input_hash` VARCHAR(128) NULL,
    `input_json` JSON NULL,
    `output_json` JSON NULL,
    `data_sources_json` JSON NULL,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `lesson_plan_agent_executions_lesson_plan_id_status_idx`(`lesson_plan_id`, `status`),
    INDEX `lesson_plan_agent_executions_teacher_user_id_created_at_idx`(`teacher_user_id`, `created_at`),
    INDEX `lesson_plan_agent_executions_input_hash_idx`(`input_hash`),
    PRIMARY KEY (`execution_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teacher_analytics_snapshots` (
    `snapshot_id` INTEGER NOT NULL AUTO_INCREMENT,
    `teacher_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NOT NULL,
    `teaching_class_id` INTEGER NULL,
    `analysis_type` VARCHAR(80) NOT NULL,
    `range_start` DATETIME(3) NULL,
    `range_end` DATETIME(3) NULL,
    `filter_json` JSON NULL,
    `result_json` JSON NOT NULL,
    `data_sources_json` JSON NOT NULL,
    `cache_key` VARCHAR(160) NULL,
    `generated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,

    UNIQUE INDEX `teacher_analytics_snapshots_cache_key_key`(`cache_key`),
    INDEX `teacher_analytics_snapshots_teacher_user_id_generated_at_idx`(`teacher_user_id`, `generated_at`),
    INDEX `teacher_analytics_snapshots_course_id_teaching_class_id_anal_idx`(`course_id`, `teaching_class_id`, `analysis_type`),
    PRIMARY KEY (`snapshot_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teacher_student_interventions` (
    `intervention_id` INTEGER NOT NULL AUTO_INCREMENT,
    `teacher_user_id` INTEGER NOT NULL,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NOT NULL,
    `teaching_class_id` INTEGER NULL,
    `intervention_type` VARCHAR(50) NOT NULL,
    `content` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'open',
    `follow_up_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `teacher_student_interventions_teacher_user_id_status_idx`(`teacher_user_id`, `status`),
    INDEX `teacher_student_interventions_student_user_id_created_at_idx`(`student_user_id`, `created_at`),
    INDEX `teacher_student_interventions_course_id_teaching_class_id_idx`(`course_id`, `teaching_class_id`),
    PRIMARY KEY (`intervention_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill stable ownership from the existing teacher-course relation. Existing rows and legacy fields are preserved.
UPDATE `teaching_classes` tc
LEFT JOIN `course_teacher_relations` ctr ON ctr.`course_id` = tc.`course_id` AND ctr.`teacher_role` = 'main_teacher'
SET tc.`teacher_user_id` = ctr.`teacher_user_id`
WHERE tc.`teacher_user_id` IS NULL AND ctr.`teacher_user_id` IS NOT NULL;

INSERT IGNORE INTO `teaching_class_teacher_authorizations`
  (`teaching_class_id`, `teacher_user_id`, `role`, `status`, `granted_by_user_id`, `created_at`, `updated_at`)
SELECT tc.`teaching_class_id`, tc.`teacher_user_id`, 'owner', 'active', tc.`teacher_user_id`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `teaching_classes` tc
WHERE tc.`teacher_user_id` IS NOT NULL;

-- Backfill delivery rows for previously published tasks without duplicating a student-task relation.
INSERT IGNORE INTO `learning_task_recipients`
  (`task_id`, `student_user_id`, `teaching_class_id`, `delivery_status`, `created_at`, `updated_at`)
SELECT lt.`task_id`, sce.`student_user_id`, lt.`teaching_class_id`, 'delivered', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `learning_tasks` lt
JOIN `student_course_enrollments` sce ON sce.`teaching_class_id` = lt.`teaching_class_id` AND sce.`enrollment_status` = 'active'
WHERE lt.`status` = 'published';

-- CreateIndex
CREATE INDEX `admin_classes_college_id_idx` ON `admin_classes`(`college_id`);

-- CreateIndex
CREATE INDEX `admin_classes_major_id_idx` ON `admin_classes`(`major_id`);

-- CreateIndex
CREATE INDEX `admin_classes_advisor_user_id_idx` ON `admin_classes`(`advisor_user_id`);

-- CreateIndex
CREATE INDEX `admin_classes_status_idx` ON `admin_classes`(`status`);

-- CreateIndex
CREATE INDEX `generated_artifacts_lesson_plan_id_idx` ON `generated_artifacts`(`lesson_plan_id`);

-- CreateIndex
CREATE INDEX `knowledge_documents_lesson_plan_id_idx` ON `knowledge_documents`(`lesson_plan_id`);

-- CreateIndex
CREATE INDEX `knowledge_documents_owner_user_id_is_teaching_resource_idx` ON `knowledge_documents`(`owner_user_id`, `is_teaching_resource`);

-- CreateIndex
CREATE UNIQUE INDEX `notifications_idempotency_key_key` ON `notifications`(`idempotency_key`);

-- CreateIndex
CREATE INDEX `notifications_receiver_user_id_deleted_at_created_at_idx` ON `notifications`(`receiver_user_id`, `deleted_at`, `created_at`);

-- CreateIndex
CREATE INDEX `notifications_business_type_business_id_idx` ON `notifications`(`business_type`, `business_id`);

-- CreateIndex
CREATE INDEX `student_course_enrollments_student_user_id_course_id_idx` ON `student_course_enrollments`(`student_user_id`, `course_id`);

-- CreateIndex
CREATE UNIQUE INDEX `teaching_classes_code_key` ON `teaching_classes`(`code`);

-- CreateIndex
CREATE INDEX `teaching_classes_course_offering_id_idx` ON `teaching_classes`(`course_offering_id`);

-- CreateIndex
CREATE INDEX `teaching_classes_teacher_user_id_idx` ON `teaching_classes`(`teacher_user_id`);

-- CreateIndex
CREATE INDEX `teaching_classes_status_idx` ON `teaching_classes`(`status`);

-- AddForeignKey
ALTER TABLE `admin_classes` ADD CONSTRAINT `admin_classes_college_id_fkey` FOREIGN KEY (`college_id`) REFERENCES `colleges`(`college_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_classes` ADD CONSTRAINT `admin_classes_major_id_fkey` FOREIGN KEY (`major_id`) REFERENCES `majors`(`major_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_classes` ADD CONSTRAINT `admin_classes_advisor_user_id_fkey` FOREIGN KEY (`advisor_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `majors` ADD CONSTRAINT `majors_college_id_fkey` FOREIGN KEY (`college_id`) REFERENCES `colleges`(`college_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_offerings` ADD CONSTRAINT `course_offerings_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_offerings` ADD CONSTRAINT `course_offerings_semester_id_fkey` FOREIGN KEY (`semester_id`) REFERENCES `academic_semesters`(`semester_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teaching_classes` ADD CONSTRAINT `teaching_classes_course_offering_id_fkey` FOREIGN KEY (`course_offering_id`) REFERENCES `course_offerings`(`course_offering_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teaching_classes` ADD CONSTRAINT `teaching_classes_teacher_user_id_fkey` FOREIGN KEY (`teacher_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teaching_class_teacher_authorizations` ADD CONSTRAINT `teaching_class_teacher_authorizations_teaching_class_id_fkey` FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teaching_class_teacher_authorizations` ADD CONSTRAINT `teaching_class_teacher_authorizations_teacher_user_id_fkey` FOREIGN KEY (`teacher_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teaching_class_admin_classes` ADD CONSTRAINT `teaching_class_admin_classes_teaching_class_id_fkey` FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teaching_class_admin_classes` ADD CONSTRAINT `teaching_class_admin_classes_admin_class_id_fkey` FOREIGN KEY (`admin_class_id`) REFERENCES `admin_classes`(`admin_class_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_documents` ADD CONSTRAINT `knowledge_documents_lesson_plan_id_fkey` FOREIGN KEY (`lesson_plan_id`) REFERENCES `lesson_plans`(`lesson_plan_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_task_recipients` ADD CONSTRAINT `learning_task_recipients_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `learning_tasks`(`task_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_task_recipients` ADD CONSTRAINT `learning_task_recipients_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teaching_task_attachments` ADD CONSTRAINT `teaching_task_attachments_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `learning_tasks`(`task_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teaching_task_attachments` ADD CONSTRAINT `teaching_task_attachments_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`document_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generated_artifacts` ADD CONSTRAINT `generated_artifacts_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `user_agents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generated_artifacts` ADD CONSTRAINT `generated_artifacts_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `agent_market_conversations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generated_artifacts` ADD CONSTRAINT `generated_artifacts_lesson_plan_id_fkey` FOREIGN KEY (`lesson_plan_id`) REFERENCES `lesson_plans`(`lesson_plan_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lesson_plans` ADD CONSTRAINT `lesson_plans_teacher_user_id_fkey` FOREIGN KEY (`teacher_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lesson_plans` ADD CONSTRAINT `lesson_plans_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lesson_plans` ADD CONSTRAINT `lesson_plans_course_offering_id_fkey` FOREIGN KEY (`course_offering_id`) REFERENCES `course_offerings`(`course_offering_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lesson_plans` ADD CONSTRAINT `lesson_plans_teaching_class_id_fkey` FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lesson_plans` ADD CONSTRAINT `lesson_plans_chapter_id_fkey` FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`chapter_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lesson_plan_versions` ADD CONSTRAINT `lesson_plan_versions_lesson_plan_id_fkey` FOREIGN KEY (`lesson_plan_id`) REFERENCES `lesson_plans`(`lesson_plan_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lesson_plan_versions` ADD CONSTRAINT `lesson_plan_versions_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lesson_plan_agent_executions` ADD CONSTRAINT `lesson_plan_agent_executions_lesson_plan_id_fkey` FOREIGN KEY (`lesson_plan_id`) REFERENCES `lesson_plans`(`lesson_plan_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lesson_plan_agent_executions` ADD CONSTRAINT `lesson_plan_agent_executions_teacher_user_id_fkey` FOREIGN KEY (`teacher_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_analytics_snapshots` ADD CONSTRAINT `teacher_analytics_snapshots_teacher_user_id_fkey` FOREIGN KEY (`teacher_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_analytics_snapshots` ADD CONSTRAINT `teacher_analytics_snapshots_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_analytics_snapshots` ADD CONSTRAINT `teacher_analytics_snapshots_teaching_class_id_fkey` FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_student_interventions` ADD CONSTRAINT `teacher_student_interventions_teacher_user_id_fkey` FOREIGN KEY (`teacher_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_student_interventions` ADD CONSTRAINT `teacher_student_interventions_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_student_interventions` ADD CONSTRAINT `teacher_student_interventions_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_student_interventions` ADD CONSTRAINT `teacher_student_interventions_teaching_class_id_fkey` FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE SET NULL ON UPDATE CASCADE;
