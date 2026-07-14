CREATE TABLE `editable_teaching_documents` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `owner_user_id` INTEGER NOT NULL,
  `lesson_plan_id` INTEGER NULL,
  `course_id` INTEGER NULL,
  `teaching_class_id` INTEGER NULL,
  `title` VARCHAR(240) NOT NULL,
  `document_type` VARCHAR(40) NOT NULL DEFAULT 'LESSON_PLAN',
  `source_type` VARCHAR(40) NOT NULL DEFAULT 'BLANK',
  `source_resource_id` INTEGER NULL,
  `source_artifact_id` INTEGER NULL,
  `current_version_id` INTEGER NULL,
  `revision` INTEGER NOT NULL DEFAULT 0,
  `status` VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deleted_at` DATETIME(3) NULL,
  UNIQUE INDEX `editable_teaching_documents_current_version_id_key`(`current_version_id`),
  INDEX `editable_teaching_documents_owner_status_updated_idx`(`owner_user_id`, `status`, `updated_at`),
  INDEX `editable_teaching_documents_plan_updated_idx`(`lesson_plan_id`, `updated_at`),
  INDEX `editable_teaching_documents_course_class_idx`(`course_id`, `teaching_class_id`),
  INDEX `editable_teaching_documents_source_resource_idx`(`source_resource_id`),
  INDEX `editable_teaching_documents_source_artifact_idx`(`source_artifact_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `editable_teaching_document_versions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `document_id` INTEGER NOT NULL,
  `version_number` INTEGER NOT NULL,
  `parent_version_id` INTEGER NULL,
  `title` VARCHAR(240) NOT NULL,
  `content_json` JSON NOT NULL,
  `sanitized_html` LONGTEXT NOT NULL,
  `plain_text` LONGTEXT NOT NULL,
  `outline_json` JSON NOT NULL,
  `metadata_json` JSON NULL,
  `source_type` VARCHAR(40) NOT NULL DEFAULT 'TEACHER_MANUAL',
  `change_summary` VARCHAR(500) NULL,
  `created_by_user_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `published_at` DATETIME(3) NULL,
  UNIQUE INDEX `editable_teaching_document_versions_document_version_key`(`document_id`, `version_number`),
  INDEX `editable_teaching_document_versions_parent_idx`(`parent_version_id`),
  INDEX `editable_teaching_document_versions_creator_idx`(`created_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `document_revisions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `document_id` INTEGER NOT NULL,
  `version_id` INTEGER NOT NULL,
  `operation_id` VARCHAR(80) NOT NULL,
  `revision_type` VARCHAR(40) NOT NULL,
  `instruction` TEXT NULL,
  `before_content` JSON NULL,
  `after_content` JSON NOT NULL,
  `source_context` JSON NULL,
  `created_by_user_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `document_revisions_operation_id_key`(`operation_id`),
  INDEX `document_revisions_document_created_idx`(`document_id`, `created_at`),
  INDEX `document_revisions_version_idx`(`version_id`),
  INDEX `document_revisions_creator_idx`(`created_by_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `editable_teaching_documents`
  ADD CONSTRAINT `editable_teaching_documents_owner_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `editable_teaching_documents_lesson_plan_fkey` FOREIGN KEY (`lesson_plan_id`) REFERENCES `lesson_plans`(`lesson_plan_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `editable_teaching_documents_course_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `editable_teaching_documents_teaching_class_fkey` FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `editable_teaching_documents_source_resource_fkey` FOREIGN KEY (`source_resource_id`) REFERENCES `knowledge_documents`(`document_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `editable_teaching_documents_source_artifact_fkey` FOREIGN KEY (`source_artifact_id`) REFERENCES `generated_artifacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `editable_teaching_document_versions`
  ADD CONSTRAINT `editable_teaching_document_versions_document_fkey` FOREIGN KEY (`document_id`) REFERENCES `editable_teaching_documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `editable_teaching_document_versions_parent_fkey` FOREIGN KEY (`parent_version_id`) REFERENCES `editable_teaching_document_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `editable_teaching_document_versions_creator_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `editable_teaching_documents`
  ADD CONSTRAINT `editable_teaching_documents_current_version_fkey` FOREIGN KEY (`current_version_id`) REFERENCES `editable_teaching_document_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `document_revisions`
  ADD CONSTRAINT `document_revisions_document_fkey` FOREIGN KEY (`document_id`) REFERENCES `editable_teaching_documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `document_revisions_version_fkey` FOREIGN KEY (`version_id`) REFERENCES `editable_teaching_document_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `document_revisions_creator_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
