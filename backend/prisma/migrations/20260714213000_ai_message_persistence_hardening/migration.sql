-- Long AI answers must not be truncated by MySQL TEXT (64 KiB), and a retry
-- must not create duplicate assistant messages.
ALTER TABLE `ai_messages`
  ADD COLUMN `client_request_id` VARCHAR(80) NULL,
  MODIFY `content` LONGTEXT NOT NULL;

CREATE UNIQUE INDEX `ai_messages_conversation_id_client_request_id_key`
  ON `ai_messages`(`conversation_id`, `client_request_id`);
