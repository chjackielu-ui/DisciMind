-- CreateTable
CREATE TABLE `async_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `operation_id` VARCHAR(128) NOT NULL,
    `task_type` ENUM('KNOWLEDGE_INDEXING', 'FILE_GENERATION', 'DOCUMENT_EXPORT', 'LEARNING_FLOW_PRELOAD', 'VOICE_PRELOAD') NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'WAITING_EXTERNAL', 'SUCCEEDED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `stage` VARCHAR(100) NULL,
    `progress` INTEGER NULL,
    `progress_mode` ENUM('DETERMINATE', 'INDETERMINATE', 'STAGE_ONLY') NOT NULL DEFAULT 'STAGE_ONLY',
    `related_resource_type` VARCHAR(80) NULL,
    `related_resource_id` VARCHAR(100) NULL,
    `result_type` VARCHAR(80) NULL,
    `result_id` VARCHAR(100) NULL,
    `result_url` VARCHAR(500) NULL,
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `cancellable` BOOLEAN NOT NULL DEFAULT false,
    `requires_user_action` BOOLEAN NOT NULL DEFAULT false,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 3,
    `metadata_json` JSON NULL,
    `dismissed_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `async_tasks_user_status_updated_idx`(`user_id`, `status`, `updated_at`),
    INDEX `async_tasks_related_resource_idx`(`related_resource_type`, `related_resource_id`),
    INDEX `async_tasks_status_updated_idx`(`status`, `updated_at`),
    UNIQUE INDEX `async_tasks_user_operation_key`(`user_id`, `operation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `async_tasks` ADD CONSTRAINT `async_tasks_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
