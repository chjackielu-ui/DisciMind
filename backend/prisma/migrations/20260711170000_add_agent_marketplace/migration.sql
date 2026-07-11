-- AlterTable
ALTER TABLE `knowledge_bases` ADD COLUMN `category_id` INTEGER NULL,
    ADD COLUMN `deleted_at` DATETIME(3) NULL,
    ADD COLUMN `document_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `marketplace_status` VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN `marketplace_visibility` VARCHAR(24) NOT NULL DEFAULT 'PRIVATE',
    ADD COLUMN `operation_id` VARCHAR(64) NULL,
    ADD COLUMN `total_size_bytes` BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `knowledge_documents` ADD COLUMN `deleted_at` DATETIME(3) NULL,
    ADD COLUMN `dify_batch_id` VARCHAR(255) NULL,
    ADD COLUMN `file_checksum` VARCHAR(64) NULL,
    ADD COLUMN `marketplace_status` VARCHAR(32) NOT NULL DEFAULT 'UPLOADING',
    ADD COLUMN `operation_id` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `agent_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `slug` VARCHAR(64) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `agent_categories_name_key`(`name`),
    UNIQUE INDEX `agent_categories_slug_key`(`slug`),
    INDEX `agent_categories_sort_order_idx`(`sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_tags` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(30) NOT NULL,
    `group_name` VARCHAR(30) NOT NULL,
    `is_custom` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `agent_tags_group_name_idx`(`group_name`),
    UNIQUE INDEX `agent_tags_name_group_name_key`(`name`, `group_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_agents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `creator_user_id` INTEGER NOT NULL,
    `current_public_version_id` INTEGER NULL,
    `current_draft_version_id` INTEGER NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PRIVATE',
    `visibility` VARCHAR(24) NOT NULL DEFAULT 'PRIVATE',
    `category_id` INTEGER NULL,
    `usage_count` INTEGER NOT NULL DEFAULT 0,
    `favorite_count` INTEGER NOT NULL DEFAULT 0,
    `rating_average` DOUBLE NOT NULL DEFAULT 0,
    `rating_count` INTEGER NOT NULL DEFAULT 0,
    `copied_from_agent_id` INTEGER NULL,
    `operation_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `user_agents_current_public_version_id_key`(`current_public_version_id`),
    UNIQUE INDEX `user_agents_current_draft_version_id_key`(`current_draft_version_id`),
    UNIQUE INDEX `user_agents_operation_id_key`(`operation_id`),
    INDEX `user_agents_creator_user_id_status_idx`(`creator_user_id`, `status`),
    INDEX `user_agents_status_visibility_deleted_at_idx`(`status`, `visibility`, `deleted_at`),
    INDEX `user_agents_category_id_idx`(`category_id`),
    INDEX `user_agents_copied_from_agent_id_idx`(`copied_from_agent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_agent_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `version_number` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `short_description` VARCHAR(300) NOT NULL,
    `avatar_url` VARCHAR(500) NULL,
    `system_prompt` TEXT NOT NULL,
    `welcome_message` VARCHAR(500) NOT NULL,
    `suggested_questions_json` JSON NULL,
    `capabilities_json` JSON NULL,
    `limitations_json` JSON NULL,
    `response_mode` VARCHAR(32) NOT NULL DEFAULT 'DEFAULT',
    `top_k` INTEGER NOT NULL DEFAULT 5,
    `score_threshold` DOUBLE NOT NULL DEFAULT 0.55,
    `max_output_tokens` INTEGER NOT NULL DEFAULT 1200,
    `memory_enabled_by_default` BOOLEAN NOT NULL DEFAULT false,
    `review_status` VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    `review_reason` TEXT NULL,
    `change_summary` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `published_at` DATETIME(3) NULL,

    INDEX `user_agent_versions_review_status_created_at_idx`(`review_status`, `created_at`),
    UNIQUE INDEX `user_agent_versions_agent_id_version_number_key`(`agent_id`, `version_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_version_tags` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_version_id` INTEGER NOT NULL,
    `tag_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_version_tags_tag_id_idx`(`tag_id`),
    UNIQUE INDEX `agent_version_tags_agent_version_id_tag_id_key`(`agent_version_id`, `tag_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_knowledge_bases` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_version_id` INTEGER NOT NULL,
    `knowledge_base_id` INTEGER NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_knowledge_bases_knowledge_base_id_idx`(`knowledge_base_id`),
    UNIQUE INDEX `agent_knowledge_bases_agent_version_id_knowledge_base_id_key`(`agent_version_id`, `knowledge_base_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_market_conversations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `agent_id` INTEGER NOT NULL,
    `agent_version_id` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL DEFAULT '新对话',
    `memory_enabled` BOOLEAN NOT NULL DEFAULT false,
    `operation_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `agent_market_conversations_operation_id_key`(`operation_id`),
    INDEX `agent_market_conversations_user_id_updated_at_idx`(`user_id`, `updated_at`),
    INDEX `agent_market_conversations_agent_id_idx`(`agent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_market_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `answer_source` VARCHAR(24) NULL,
    `knowledge_fallback_used` BOOLEAN NOT NULL DEFAULT false,
    `token_usage_json` JSON NULL,
    `operation_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `agent_market_messages_operation_id_key`(`operation_id`),
    INDEX `agent_market_messages_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_message_sources` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `message_id` INTEGER NOT NULL,
    `knowledge_base_id` INTEGER NOT NULL,
    `document_id` INTEGER NULL,
    `document_name` VARCHAR(255) NOT NULL,
    `segment_id` VARCHAR(255) NULL,
    `page_number` INTEGER NULL,
    `quote` TEXT NOT NULL,
    `score` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_message_sources_message_id_idx`(`message_id`),
    INDEX `agent_message_sources_knowledge_base_id_idx`(`knowledge_base_id`),
    INDEX `agent_message_sources_document_id_idx`(`document_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_memories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `agent_id` INTEGER NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `content` TEXT NOT NULL,
    `source_message_id` INTEGER NULL,
    `confirmed` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `agent_memories_user_id_agent_id_deleted_at_idx`(`user_id`, `agent_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_favorites` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `agent_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_favorites_agent_id_idx`(`agent_id`),
    UNIQUE INDEX `agent_favorites_user_id_agent_id_key`(`user_id`, `agent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_ratings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `agent_id` INTEGER NOT NULL,
    `rating` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `agent_ratings_agent_id_idx`(`agent_id`),
    UNIQUE INDEX `agent_ratings_user_id_agent_id_key`(`user_id`, `agent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_reports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `agent_id` INTEGER NOT NULL,
    `reason` VARCHAR(50) NOT NULL,
    `detail` TEXT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `resolver_user_id` INTEGER NULL,
    `resolution` TEXT NULL,
    `operation_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `resolved_at` DATETIME(3) NULL,

    UNIQUE INDEX `agent_reports_operation_id_key`(`operation_id`),
    INDEX `agent_reports_status_created_at_idx`(`status`, `created_at`),
    INDEX `agent_reports_agent_id_idx`(`agent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_review_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `agent_version_id` INTEGER NOT NULL,
    `reviewer_user_id` INTEGER NULL,
    `action` VARCHAR(24) NOT NULL,
    `reason` TEXT NULL,
    `operation_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `agent_review_records_operation_id_key`(`operation_id`),
    INDEX `agent_review_records_agent_version_id_created_at_idx`(`agent_version_id`, `created_at`),
    INDEX `agent_review_records_reviewer_user_id_idx`(`reviewer_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_base_review_records` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `knowledge_base_id` INTEGER NOT NULL,
    `reviewer_user_id` INTEGER NULL,
    `action` VARCHAR(24) NOT NULL,
    `reason` TEXT NULL,
    `operation_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `knowledge_base_review_records_operation_id_key`(`operation_id`),
    INDEX `knowledge_base_review_records_knowledge_base_id_created_at_idx`(`knowledge_base_id`, `created_at`),
    INDEX `knowledge_base_review_records_reviewer_user_id_idx`(`reviewer_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `knowledge_bases_operation_id_key` ON `knowledge_bases`(`operation_id`);

-- CreateIndex
CREATE INDEX `knowledge_bases_marketplace_visibility_marketplace_status_idx` ON `knowledge_bases`(`marketplace_visibility`, `marketplace_status`);

-- CreateIndex
CREATE INDEX `knowledge_bases_category_id_idx` ON `knowledge_bases`(`category_id`);

-- CreateIndex
CREATE INDEX `knowledge_bases_deleted_at_idx` ON `knowledge_bases`(`deleted_at`);

-- CreateIndex
CREATE UNIQUE INDEX `knowledge_documents_operation_id_key` ON `knowledge_documents`(`operation_id`);

-- CreateIndex
CREATE INDEX `knowledge_documents_marketplace_status_idx` ON `knowledge_documents`(`marketplace_status`);

-- CreateIndex
CREATE INDEX `knowledge_documents_deleted_at_idx` ON `knowledge_documents`(`deleted_at`);

-- CreateIndex
CREATE UNIQUE INDEX `knowledge_documents_knowledge_base_id_file_checksum_key` ON `knowledge_documents`(`knowledge_base_id`, `file_checksum`);

-- AddForeignKey
ALTER TABLE `knowledge_bases` ADD CONSTRAINT `knowledge_bases_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `agent_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_agents` ADD CONSTRAINT `user_agents_creator_user_id_fkey` FOREIGN KEY (`creator_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_agents` ADD CONSTRAINT `user_agents_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `agent_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_agents` ADD CONSTRAINT `user_agents_copied_from_agent_id_fkey` FOREIGN KEY (`copied_from_agent_id`) REFERENCES `user_agents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_agents` ADD CONSTRAINT `user_agents_current_public_version_id_fkey` FOREIGN KEY (`current_public_version_id`) REFERENCES `user_agent_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_agents` ADD CONSTRAINT `user_agents_current_draft_version_id_fkey` FOREIGN KEY (`current_draft_version_id`) REFERENCES `user_agent_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_agent_versions` ADD CONSTRAINT `user_agent_versions_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `user_agents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_version_tags` ADD CONSTRAINT `agent_version_tags_agent_version_id_fkey` FOREIGN KEY (`agent_version_id`) REFERENCES `user_agent_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_version_tags` ADD CONSTRAINT `agent_version_tags_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `agent_tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_knowledge_bases` ADD CONSTRAINT `agent_knowledge_bases_agent_version_id_fkey` FOREIGN KEY (`agent_version_id`) REFERENCES `user_agent_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_knowledge_bases` ADD CONSTRAINT `agent_knowledge_bases_knowledge_base_id_fkey` FOREIGN KEY (`knowledge_base_id`) REFERENCES `knowledge_bases`(`knowledge_base_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_market_conversations` ADD CONSTRAINT `agent_market_conversations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_market_conversations` ADD CONSTRAINT `agent_market_conversations_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `user_agents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_market_conversations` ADD CONSTRAINT `agent_market_conversations_agent_version_id_fkey` FOREIGN KEY (`agent_version_id`) REFERENCES `user_agent_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_market_messages` ADD CONSTRAINT `agent_market_messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `agent_market_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_message_sources` ADD CONSTRAINT `agent_message_sources_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `agent_market_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_message_sources` ADD CONSTRAINT `agent_message_sources_knowledge_base_id_fkey` FOREIGN KEY (`knowledge_base_id`) REFERENCES `knowledge_bases`(`knowledge_base_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_message_sources` ADD CONSTRAINT `agent_message_sources_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`document_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_memories` ADD CONSTRAINT `agent_memories_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_memories` ADD CONSTRAINT `agent_memories_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `user_agents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_memories` ADD CONSTRAINT `agent_memories_source_message_id_fkey` FOREIGN KEY (`source_message_id`) REFERENCES `agent_market_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_favorites` ADD CONSTRAINT `agent_favorites_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_favorites` ADD CONSTRAINT `agent_favorites_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `user_agents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_ratings` ADD CONSTRAINT `agent_ratings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_ratings` ADD CONSTRAINT `agent_ratings_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `user_agents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_reports` ADD CONSTRAINT `agent_reports_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_reports` ADD CONSTRAINT `agent_reports_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `user_agents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_reports` ADD CONSTRAINT `agent_reports_resolver_user_id_fkey` FOREIGN KEY (`resolver_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_review_records` ADD CONSTRAINT `agent_review_records_reviewer_user_id_fkey` FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_review_records` ADD CONSTRAINT `agent_review_records_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `user_agents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_review_records` ADD CONSTRAINT `agent_review_records_agent_version_id_fkey` FOREIGN KEY (`agent_version_id`) REFERENCES `user_agent_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_base_review_records` ADD CONSTRAINT `knowledge_base_review_records_knowledge_base_id_fkey` FOREIGN KEY (`knowledge_base_id`) REFERENCES `knowledge_bases`(`knowledge_base_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_base_review_records` ADD CONSTRAINT `knowledge_base_review_records_reviewer_user_id_fkey` FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;
