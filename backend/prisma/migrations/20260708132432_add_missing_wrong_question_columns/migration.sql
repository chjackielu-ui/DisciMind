-- AlterTable
ALTER TABLE `wrong_questions` ADD COLUMN `chapter_id` INTEGER NULL,
    ADD COLUMN `consecutive_correct_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `ignored_at` DATETIME(3) NULL,
    ADD COLUMN `last_reviewed_at` DATETIME(3) NULL,
    ADD COLUMN `last_wrong_at` DATETIME(3) NULL,
    ADD COLUMN `review_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `review_status` ENUM('pending_review', 'reinforcing', 'wrong_again', 'mastered', 'ignored') NOT NULL DEFAULT 'pending_review',
    ADD COLUMN `wrong_reason` ENUM('concept_misunderstanding', 'memory_weak', 'formula_error', 'calculation_error', 'question_reading_error', 'method_selection_error', 'careless', 'time_insufficient', 'unknown', 'other') NULL,
    ADD COLUMN `wrong_reason_source` ENUM('user', 'ai_suggested', 'system') NOT NULL DEFAULT 'user';

-- CreateTable
CREATE TABLE `wrong_question_tags` (
    `tag_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `color` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `wrong_question_tags_user_id_idx`(`user_id`),
    UNIQUE INDEX `wrong_question_tags_user_id_name_key`(`user_id`, `name`),
    PRIMARY KEY (`tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wrong_question_tag_relations` (
    `relation_id` INTEGER NOT NULL AUTO_INCREMENT,
    `wrong_question_id` INTEGER NOT NULL,
    `tag_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `wrong_question_tag_relations_tag_id_idx`(`tag_id`),
    UNIQUE INDEX `wrong_question_tag_relations_wrong_question_id_tag_id_key`(`wrong_question_id`, `tag_id`),
    PRIMARY KEY (`relation_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wrong_question_collections` (
    `collection_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `wrong_question_collections_user_id_idx`(`user_id`),
    PRIMARY KEY (`collection_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wrong_question_collection_items` (
    `item_id` INTEGER NOT NULL AUTO_INCREMENT,
    `collection_id` INTEGER NOT NULL,
    `wrong_question_id` INTEGER NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,

    INDEX `wrong_question_collection_items_wrong_question_id_idx`(`wrong_question_id`),
    UNIQUE INDEX `wrong_question_collection_items_collection_id_wrong_question_key`(`collection_id`, `wrong_question_id`),
    PRIMARY KEY (`item_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_generation_jobs` (
    `job_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `mode` ENUM('original', 'variant', 'similar') NOT NULL,
    `status` ENUM('pending', 'generating', 'parsing', 'validating', 'saving', 'partial_success', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
    `source_type` VARCHAR(20) NULL,
    `total_batches` INTEGER NOT NULL DEFAULT 0,
    `current_batch` INTEGER NOT NULL DEFAULT 0,
    `success_count` INTEGER NOT NULL DEFAULT 0,
    `fail_count` INTEGER NOT NULL DEFAULT 0,
    `target_count` INTEGER NOT NULL DEFAULT 0,
    `difficulty` VARCHAR(20) NULL,
    `progress_data` JSON NULL,
    `result_data` JSON NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_generation_jobs_user_id_idx`(`user_id`),
    INDEX `ai_generation_jobs_status_idx`(`status`),
    PRIMARY KEY (`job_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `wrong_questions_chapter_id_idx` ON `wrong_questions`(`chapter_id`);

-- CreateIndex
CREATE INDEX `wrong_questions_review_status_idx` ON `wrong_questions`(`review_status`);

-- CreateIndex
CREATE INDEX `wrong_questions_wrong_reason_idx` ON `wrong_questions`(`wrong_reason`);

-- CreateIndex
CREATE INDEX `wrong_questions_last_wrong_at_idx` ON `wrong_questions`(`last_wrong_at`);

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_generated_by_user_id_fkey` FOREIGN KEY (`generated_by_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wrong_questions` ADD CONSTRAINT `wrong_questions_chapter_id_fkey` FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`chapter_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wrong_question_tags` ADD CONSTRAINT `wrong_question_tags_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wrong_question_tag_relations` ADD CONSTRAINT `wrong_question_tag_relations_wrong_question_id_fkey` FOREIGN KEY (`wrong_question_id`) REFERENCES `wrong_questions`(`wrong_question_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wrong_question_tag_relations` ADD CONSTRAINT `wrong_question_tag_relations_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `wrong_question_tags`(`tag_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wrong_question_collections` ADD CONSTRAINT `wrong_question_collections_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wrong_question_collection_items` ADD CONSTRAINT `wrong_question_collection_items_collection_id_fkey` FOREIGN KEY (`collection_id`) REFERENCES `wrong_question_collections`(`collection_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wrong_question_collection_items` ADD CONSTRAINT `wrong_question_collection_items_wrong_question_id_fkey` FOREIGN KEY (`wrong_question_id`) REFERENCES `wrong_questions`(`wrong_question_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_generation_jobs` ADD CONSTRAINT `ai_generation_jobs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
