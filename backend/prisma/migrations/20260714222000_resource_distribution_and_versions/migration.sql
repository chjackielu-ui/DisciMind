ALTER TABLE `knowledge_documents`
  ADD COLUMN `resource_group_id` VARCHAR(64) NULL,
  ADD COLUMN `source_artifact_id` INTEGER NULL,
  ADD COLUMN `resource_version` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `version_source` VARCHAR(32) NOT NULL DEFAULT 'LOCAL_IMPORT',
  ADD COLUMN `folder_path` VARCHAR(500) NULL,
  ADD COLUMN `tags_json` JSON NULL,
  ADD COLUMN `is_favorite` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `resource_status` VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN `last_used_at` DATETIME(3) NULL;

CREATE UNIQUE INDEX `kd_resource_group_version_key`
  ON `knowledge_documents`(`resource_group_id`, `resource_version`);
CREATE INDEX `kd_owner_status_used_idx`
  ON `knowledge_documents`(`owner_user_id`, `resource_status`, `last_used_at`);
CREATE INDEX `kd_source_artifact_idx`
  ON `knowledge_documents`(`source_artifact_id`);

CREATE TABLE `resource_distributions` (
  `distribution_id` INTEGER NOT NULL AUTO_INCREMENT,
  `resource_id` INTEGER NOT NULL,
  `sender_user_id` INTEGER NOT NULL,
  `course_id` INTEGER NULL,
  `teaching_class_id` INTEGER NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` TEXT NULL,
  `distribution_type` VARCHAR(40) NOT NULL,
  `resource_version` INTEGER NOT NULL DEFAULT 1,
  `publish_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `due_at` DATETIME(3) NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PUBLISHED',
  `operation_id` VARCHAR(80) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `rd_operation_key`(`operation_id`),
  INDEX `rd_resource_version_idx`(`resource_id`, `resource_version`),
  INDEX `rd_sender_created_idx`(`sender_user_id`, `created_at`),
  INDEX `rd_course_class_publish_idx`(`course_id`, `teaching_class_id`, `publish_at`),
  INDEX `rd_status_publish_idx`(`status`, `publish_at`),
  PRIMARY KEY (`distribution_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `resource_recipients` (
  `recipient_id` INTEGER NOT NULL AUTO_INCREMENT,
  `distribution_id` INTEGER NOT NULL,
  `student_user_id` INTEGER NOT NULL,
  `read_at` DATETIME(3) NULL,
  `downloaded_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'UNREAD',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `rr_distribution_student_key`(`distribution_id`, `student_user_id`),
  INDEX `rr_student_status_created_idx`(`student_user_id`, `status`, `created_at`),
  PRIMARY KEY (`recipient_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `resource_distributions`
  ADD CONSTRAINT `resource_distributions_resource_id_fkey` FOREIGN KEY (`resource_id`) REFERENCES `knowledge_documents`(`document_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `resource_distributions_sender_user_id_fkey` FOREIGN KEY (`sender_user_id`) REFERENCES `users`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `resource_distributions_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `resource_distributions_teaching_class_id_fkey` FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `resource_recipients`
  ADD CONSTRAINT `resource_recipients_distribution_id_fkey` FOREIGN KEY (`distribution_id`) REFERENCES `resource_distributions`(`distribution_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `resource_recipients_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `knowledge_documents`
  ADD CONSTRAINT `knowledge_documents_source_artifact_id_fkey` FOREIGN KEY (`source_artifact_id`) REFERENCES `generated_artifacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
