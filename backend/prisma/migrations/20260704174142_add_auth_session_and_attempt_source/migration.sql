-- AlterTable
ALTER TABLE `practice_sessions` ADD COLUMN `source_id` INTEGER NULL,
    ADD COLUMN `source_type` VARCHAR(30) NULL,
    ADD COLUMN `submit_reason` VARCHAR(30) NULL,
    ADD COLUMN `task_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `session_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `refresh_token_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_activity_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `device_info` VARCHAR(255) NULL,
    `ip_address` VARCHAR(64) NULL,

    INDEX `auth_sessions_user_id_idx`(`user_id`),
    INDEX `auth_sessions_last_activity_at_idx`(`last_activity_at`),
    INDEX `auth_sessions_revoked_at_idx`(`revoked_at`),
    INDEX `auth_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`session_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `practice_sessions_source_type_idx` ON `practice_sessions`(`source_type`);

-- CreateIndex
CREATE INDEX `practice_sessions_source_id_idx` ON `practice_sessions`(`source_id`);

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
