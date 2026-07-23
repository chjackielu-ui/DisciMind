ALTER TABLE `knowledge_documents`
  ADD COLUMN `storage_key` VARCHAR(1024) NULL,
  ADD COLUMN `storage_bucket` VARCHAR(255) NULL,
  ADD COLUMN `storage_etag` VARCHAR(255) NULL,
  ADD COLUMN `storage_version_id` VARCHAR(255) NULL;
