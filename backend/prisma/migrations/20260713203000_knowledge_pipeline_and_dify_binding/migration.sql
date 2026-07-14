ALTER TABLE `knowledge_bases`
  ADD COLUMN `provider` VARCHAR(32) NOT NULL DEFAULT 'DIFY',
  ADD COLUMN `ownership_mode` VARCHAR(32) NOT NULL DEFAULT 'LOCAL_MANAGED',
  ADD COLUMN `remote_status` VARCHAR(32) NULL,
  ADD COLUMN `remote_document_count` INTEGER NULL,
  ADD COLUMN `last_synced_at` DATETIME(3) NULL,
  ADD COLUMN `sync_error` TEXT NULL,
  ADD COLUMN `remote_documents_json` JSON NULL;

ALTER TABLE `knowledge_documents`
  ADD COLUMN `error_code` VARCHAR(100) NULL,
  ADD COLUMN `error_stage` VARCHAR(32) NULL,
  ADD COLUMN `retryable` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN `failed_at` DATETIME(3) NULL,
  ADD COLUMN `attempt_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `processing_state` VARCHAR(32) NOT NULL DEFAULT 'uploaded',
  ADD COLUMN `cleaned_text` LONGTEXT NULL,
  ADD COLUMN `page_count` INTEGER NULL,
  ADD COLUMN `chunk_size` INTEGER NOT NULL DEFAULT 800,
  ADD COLUMN `chunk_overlap` INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN `separator_strategy` VARCHAR(32) NOT NULL DEFAULT 'structure';

ALTER TABLE `knowledge_document_chunks`
  ADD COLUMN `title_path` VARCHAR(500) NULL,
  ADD COLUMN `char_count` INTEGER NULL,
  ADD COLUMN `chunk_hash` VARCHAR(64) NULL,
  ADD COLUMN `metadata_json` JSON NULL,
  ADD COLUMN `status` VARCHAR(24) NOT NULL DEFAULT 'ready';

CREATE INDEX `knowledge_documents_processing_state_idx` ON `knowledge_documents`(`processing_state`);
CREATE INDEX `knowledge_documents_error_stage_idx` ON `knowledge_documents`(`error_stage`);
