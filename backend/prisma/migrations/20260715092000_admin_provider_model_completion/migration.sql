-- Complete the provider/model administration contract without changing existing data.
ALTER TABLE `ai_model_configs`
  ADD COLUMN `supports_rerank` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `created_by` INTEGER NULL,
  ADD COLUMN `updated_by` INTEGER NULL;
