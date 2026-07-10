-- Migration: Add retry_count and output_content to learning_session_node_runs
-- Date: 2026-07-10

ALTER TABLE learning_session_node_runs
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_content LONGTEXT NULL;
