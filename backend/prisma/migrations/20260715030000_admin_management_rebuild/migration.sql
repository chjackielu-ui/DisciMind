-- Additive migration for the DisciMind admin management center.
-- Existing tables, columns, indexes and foreign keys are never removed.

-- AlterTable
ALTER TABLE `ai_agent_configs` ADD COLUMN `agent_key` VARCHAR(100) NULL,
    ADD COLUMN `archived_at` DATETIME(3) NULL,
    ADD COLUMN `base_url_override` VARCHAR(500) NULL,
    ADD COLUMN `created_by` INTEGER NULL,
    ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `knowledge_config_json` JSON NULL,
    ADD COLUMN `max_output_tokens` INTEGER NULL,
    ADD COLUMN `max_retries` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `model_config_id` INTEGER NULL,
    ADD COLUMN `prompt_version_id` INTEGER NULL,
    ADD COLUMN `provider_id` INTEGER NULL,
    ADD COLUMN `published_at` DATETIME(3) NULL,
    ADD COLUMN `runtime_config_json` JSON NULL,
    ADD COLUMN `runtime_type` VARCHAR(40) NOT NULL DEFAULT 'dify_workflow',
    ADD COLUMN `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
    ADD COLUMN `timeout_ms` INTEGER NOT NULL DEFAULT 120000,
    ADD COLUMN `tool_config_json` JSON NULL,
    ADD COLUMN `updated_by` INTEGER NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `ai_model_configs` ADD COLUMN `capabilities_json` JSON NULL,
    ADD COLUMN `currency` VARCHAR(12) NULL DEFAULT 'CNY',
    ADD COLUMN `display_name` VARCHAR(160) NULL,
    ADD COLUMN `input_price` DECIMAL(16, 8) NULL,
    ADD COLUMN `is_default` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `max_output_tokens` INTEGER NULL,
    ADD COLUMN `model_code` VARCHAR(120) NULL,
    ADD COLUMN `model_type` VARCHAR(40) NOT NULL DEFAULT 'chat',
    ADD COLUMN `output_price` DECIMAL(16, 8) NULL,
    ADD COLUMN `parameters_json` JSON NULL,
    ADD COLUMN `provider_id` INTEGER NULL,
    ADD COLUMN `supports_audio` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `supports_embedding` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `supports_stream` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `supports_tools` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `supports_vision` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `operation_logs` ADD COLUMN `action_status` VARCHAR(24) NOT NULL DEFAULT 'success',
    ADD COLUMN `after_summary_json` JSON NULL,
    ADD COLUMN `before_summary_json` JSON NULL,
    ADD COLUMN `failure_reason` VARCHAR(500) NULL,
    ADD COLUMN `request_id` VARCHAR(100) NULL,
    ADD COLUMN `updated_at` DATETIME(3) NULL;

UPDATE `operation_logs`
SET `updated_at` = `created_at`
WHERE `updated_at` IS NULL;

ALTER TABLE `operation_logs`
    MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL;

-- CreateTable
CREATE TABLE `ai_providers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider_code` VARCHAR(80) NOT NULL,
    `display_name` VARCHAR(160) NOT NULL,
    `provider_type` VARCHAR(40) NOT NULL,
    `base_url` VARCHAR(500) NULL,
    `auth_type` VARCHAR(40) NOT NULL DEFAULT 'bearer',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `connection_status` VARCHAR(24) NOT NULL DEFAULT 'unchecked',
    `last_checked_at` DATETIME(3) NULL,
    `last_latency_ms` INTEGER NULL,
    `timeout_ms` INTEGER NOT NULL DEFAULT 10000,
    `max_retries` INTEGER NOT NULL DEFAULT 1,
    `extra_config_json` JSON NULL,
    `secret_ciphertext` LONGTEXT NULL,
    `secret_iv` VARCHAR(64) NULL,
    `secret_auth_tag` VARCHAR(64) NULL,
    `secret_last_four` VARCHAR(8) NULL,
    `secret_updated_at` DATETIME(3) NULL,
    `source_type` VARCHAR(24) NOT NULL DEFAULT 'database',
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_providers_provider_code_key`(`provider_code`),
    INDEX `ai_providers_provider_type_idx`(`provider_type`),
    INDEX `ai_providers_enabled_connection_status_idx`(`enabled`, `connection_status`),
    INDEX `ai_providers_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_config_id` INTEGER NOT NULL,
    `version_number` INTEGER NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
    `model_config_id` INTEGER NULL,
    `prompt_version_id` INTEGER NULL,
    `knowledge_snapshot` JSON NULL,
    `tool_snapshot` JSON NULL,
    `parameter_snapshot` JSON NULL,
    `change_summary` VARCHAR(500) NULL,
    `rollback_from_id` INTEGER NULL,
    `created_by` INTEGER NULL,
    `published_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `published_at` DATETIME(3) NULL,
    `archived_at` DATETIME(3) NULL,

    INDEX `agent_versions_agent_config_id_status_idx`(`agent_config_id`, `status`),
    INDEX `agent_versions_model_config_id_idx`(`model_config_id`),
    INDEX `agent_versions_published_at_idx`(`published_at`),
    UNIQUE INDEX `agent_versions_agent_config_id_version_number_key`(`agent_config_id`, `version_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `role_code` VARCHAR(80) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NULL,
    `built_in` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_roles_role_code_key`(`role_code`),
    INDEX `admin_roles_enabled_idx`(`enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_permissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `permission_key` VARCHAR(120) NOT NULL,
    `module` VARCHAR(80) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` VARCHAR(500) NULL,
    `sensitive` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_permissions_permission_key_key`(`permission_key`),
    INDEX `admin_permissions_module_idx`(`module`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_role_permissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `role_id` INTEGER NOT NULL,
    `permission_id` INTEGER NOT NULL,
    `granted_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admin_role_permissions_permission_id_idx`(`permission_id`),
    UNIQUE INDEX `admin_role_permissions_role_id_permission_id_key`(`role_id`, `permission_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_user_roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `role_id` INTEGER NOT NULL,
    `granted_by` INTEGER NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `admin_user_roles_user_id_expires_at_idx`(`user_id`, `expires_at`),
    INDEX `admin_user_roles_role_id_idx`(`role_id`),
    UNIQUE INDEX `admin_user_roles_user_id_role_id_key`(`user_id`, `role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_prompt_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `prompt_key` VARCHAR(120) NOT NULL,
    `version_number` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `variables_json` JSON NULL,
    `checksum` VARCHAR(64) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
    `created_by` INTEGER NULL,
    `published_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `published_at` DATETIME(3) NULL,
    `archived_at` DATETIME(3) NULL,

    INDEX `ai_prompt_versions_prompt_key_status_idx`(`prompt_key`, `status`),
    UNIQUE INDEX `ai_prompt_versions_prompt_key_version_number_key`(`prompt_key`, `version_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_request_traces` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_id` VARCHAR(100) NOT NULL,
    `trace_id` VARCHAR(100) NOT NULL,
    `user_id` INTEGER NULL,
    `course_id` INTEGER NULL,
    `teaching_class_id` INTEGER NULL,
    `entry_point` VARCHAR(100) NOT NULL,
    `scene` VARCHAR(100) NULL,
    `agent_config_id` INTEGER NULL,
    `agent_version_id` INTEGER NULL,
    `provider_id` INTEGER NULL,
    `model_config_id` INTEGER NULL,
    `prompt_version_id` INTEGER NULL,
    `workflow_version_id` INTEGER NULL,
    `input_summary` TEXT NULL,
    `output_summary` TEXT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'running',
    `retrieval_hit` BOOLEAN NOT NULL DEFAULT false,
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `risk_flag` BOOLEAN NOT NULL DEFAULT false,
    `prompt_tokens` INTEGER NULL,
    `completion_tokens` INTEGER NULL,
    `total_tokens` INTEGER NULL,
    `latency_ms` INTEGER NULL,
    `error_type` VARCHAR(100) NULL,
    `error_message` VARCHAR(500) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_request_traces_request_id_key`(`request_id`),
    UNIQUE INDEX `ai_request_traces_trace_id_key`(`trace_id`),
    INDEX `ai_request_traces_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `ai_request_traces_course_id_created_at_idx`(`course_id`, `created_at`),
    INDEX `ai_request_traces_agent_config_id_created_at_idx`(`agent_config_id`, `created_at`),
    INDEX `ai_request_traces_provider_id_model_config_id_idx`(`provider_id`, `model_config_id`),
    INDEX `ai_request_traces_status_created_at_idx`(`status`, `created_at`),
    INDEX `ai_request_traces_risk_flag_created_at_idx`(`risk_flag`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_trace_steps` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trace_id` INTEGER NOT NULL,
    `parent_step_id` INTEGER NULL,
    `sequence_number` INTEGER NOT NULL,
    `step_type` VARCHAR(80) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'running',
    `input_summary` JSON NULL,
    `output_summary` JSON NULL,
    `latency_ms` INTEGER NULL,
    `error_type` VARCHAR(100) NULL,
    `error_message` VARCHAR(500) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_trace_steps_trace_id_step_type_idx`(`trace_id`, `step_type`),
    INDEX `ai_trace_steps_parent_step_id_idx`(`parent_step_id`),
    INDEX `ai_trace_steps_status_idx`(`status`),
    UNIQUE INDEX `ai_trace_steps_trace_id_sequence_number_key`(`trace_id`, `sequence_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_trace_retrievals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trace_id` INTEGER NOT NULL,
    `step_id` INTEGER NULL,
    `knowledge_base_id` INTEGER NULL,
    `document_id` INTEGER NULL,
    `chunk_id` INTEGER NULL,
    `document_title` VARCHAR(500) NULL,
    `source_uri` VARCHAR(1000) NULL,
    `chapter` VARCHAR(300) NULL,
    `page_number` INTEGER NULL,
    `excerpt_redacted` TEXT NULL,
    `retrieval_score` DOUBLE NULL,
    `rerank_score` DOUBLE NULL,
    `cited` BOOLEAN NOT NULL DEFAULT false,
    `adopted` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_trace_retrievals_trace_id_idx`(`trace_id`),
    INDEX `ai_trace_retrievals_step_id_idx`(`step_id`),
    INDEX `ai_trace_retrievals_knowledge_base_id_document_id_idx`(`knowledge_base_id`, `document_id`),
    INDEX `ai_trace_retrievals_cited_created_at_idx`(`cited`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_trace_tool_calls` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trace_id` INTEGER NOT NULL,
    `step_id` INTEGER NULL,
    `tool_name` VARCHAR(160) NOT NULL,
    `status` VARCHAR(24) NOT NULL,
    `input_summary` JSON NULL,
    `output_summary` JSON NULL,
    `latency_ms` INTEGER NULL,
    `error_message` VARCHAR(500) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_trace_tool_calls_trace_id_idx`(`trace_id`),
    INDEX `ai_trace_tool_calls_step_id_idx`(`step_id`),
    INDEX `ai_trace_tool_calls_tool_name_status_idx`(`tool_name`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_trace_feedback` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trace_id` INTEGER NOT NULL,
    `user_id` INTEGER NULL,
    `feedback_type` VARCHAR(40) NOT NULL,
    `comment_redacted` TEXT NULL,
    `teacher_disposition` VARCHAR(40) NULL,
    `teacher_revision` LONGTEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_trace_feedback_trace_id_created_at_idx`(`trace_id`, `created_at`),
    INDEX `ai_trace_feedback_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `learning_flow_validation_results` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workflow_template_id` INTEGER NOT NULL,
    `workflow_version_id` INTEGER NULL,
    `validation_type` VARCHAR(80) NOT NULL,
    `severity` VARCHAR(24) NOT NULL,
    `node_id` VARCHAR(120) NULL,
    `message` VARCHAR(500) NOT NULL,
    `evidence_json` JSON NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'open',
    `checked_by` INTEGER NULL,
    `resolved_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `resolved_at` DATETIME(3) NULL,

    INDEX `learning_flow_validation_results_workflow_template_id_status_idx`(`workflow_template_id`, `status`),
    INDEX `learning_flow_validation_results_workflow_version_id_idx`(`workflow_version_id`),
    INDEX `learning_flow_validation_results_validation_type_severity_idx`(`validation_type`, `severity`),
    INDEX `learning_flow_validation_results_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `learning_flow_effect_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workflow_template_id` INTEGER NOT NULL,
    `workflow_version_id` INTEGER NULL,
    `range_start` DATETIME(3) NOT NULL,
    `range_end` DATETIME(3) NOT NULL,
    `sample_size` INTEGER NOT NULL DEFAULT 0,
    `completion_rate` DOUBLE NULL,
    `interruption_rate` DOUBLE NULL,
    `average_duration_ms` INTEGER NULL,
    `mastery_delta` DOUBLE NULL,
    `wrong_fix_rate` DOUBLE NULL,
    `skip_rate` DOUBLE NULL,
    `data_quality_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `learning_flow_effect_snapshots_workflow_template_id_created__idx`(`workflow_template_id`, `created_at`),
    UNIQUE INDEX `lf_effect_window_key`(`workflow_template_id`, `workflow_version_id`, `range_start`, `range_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_health_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `knowledge_base_id` INTEGER NOT NULL,
    `course_id` INTEGER NULL,
    `health_score` DOUBLE NULL,
    `knowledge_coverage` DOUBLE NULL,
    `chapter_coverage` DOUBLE NULL,
    `document_count` INTEGER NOT NULL DEFAULT 0,
    `chunk_count` INTEGER NOT NULL DEFAULT 0,
    `retrieval_count` INTEGER NOT NULL DEFAULT 0,
    `retrieval_hit_rate` DOUBLE NULL,
    `open_issue_count` INTEGER NOT NULL DEFAULT 0,
    `sample_size` INTEGER NOT NULL DEFAULT 0,
    `calculation_method` VARCHAR(200) NOT NULL,
    `metrics_json` JSON NULL,
    `snapshot_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `knowledge_health_snapshots_knowledge_base_id_snapshot_at_idx`(`knowledge_base_id`, `snapshot_at`),
    INDEX `knowledge_health_snapshots_course_id_snapshot_at_idx`(`course_id`, `snapshot_at`),
    INDEX `knowledge_health_snapshots_health_score_idx`(`health_score`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_quality_issues` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `knowledge_base_id` INTEGER NOT NULL,
    `document_id` INTEGER NULL,
    `chunk_id` INTEGER NULL,
    `issue_type` VARCHAR(80) NOT NULL,
    `severity` VARCHAR(24) NOT NULL,
    `title` VARCHAR(240) NOT NULL,
    `description` TEXT NULL,
    `evidence_json` JSON NULL,
    `suggested_action` VARCHAR(500) NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'open',
    `assigned_to` INTEGER NULL,
    `resolved_by` INTEGER NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `resolved_at` DATETIME(3) NULL,

    INDEX `knowledge_quality_issues_knowledge_base_id_status_idx`(`knowledge_base_id`, `status`),
    INDEX `knowledge_quality_issues_document_id_idx`(`document_id`),
    INDEX `knowledge_quality_issues_issue_type_severity_idx`(`issue_type`, `severity`),
    INDEX `knowledge_quality_issues_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_query_failures` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `knowledge_base_id` INTEGER NULL,
    `course_id` INTEGER NULL,
    `knowledge_point_id` INTEGER NULL,
    `normalized_query_hash` VARCHAR(64) NOT NULL,
    `query_redacted` TEXT NOT NULL,
    `failure_type` VARCHAR(60) NOT NULL,
    `highest_score` DOUBLE NULL,
    `affected_user_count` INTEGER NOT NULL DEFAULT 0,
    `occurrence_count` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(24) NOT NULL DEFAULT 'open',
    `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `knowledge_query_failures_course_id_knowledge_point_id_idx`(`course_id`, `knowledge_point_id`),
    INDEX `knowledge_query_failures_status_occurrence_count_idx`(`status`, `occurrence_count`),
    INDEX `knowledge_query_failures_last_seen_at_idx`(`last_seen_at`),
    UNIQUE INDEX `kb_query_failure_key`(`knowledge_base_id`, `normalized_query_hash`, `failure_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teaching_issues` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `issue_type` VARCHAR(80) NOT NULL,
    `severity` VARCHAR(24) NOT NULL,
    `title` VARCHAR(240) NOT NULL,
    `description` TEXT NOT NULL,
    `course_id` INTEGER NULL,
    `teaching_class_id` INTEGER NULL,
    `knowledge_point_id` INTEGER NULL,
    `affected_count` INTEGER NOT NULL DEFAULT 0,
    `confidence` DOUBLE NULL,
    `detection_method` VARCHAR(200) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'open',
    `owner_user_id` INTEGER NULL,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `detected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `review_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `teaching_issues_issue_type_severity_idx`(`issue_type`, `severity`),
    INDEX `teaching_issues_course_id_teaching_class_id_idx`(`course_id`, `teaching_class_id`),
    INDEX `teaching_issues_knowledge_point_id_idx`(`knowledge_point_id`),
    INDEX `teaching_issues_status_detected_at_idx`(`status`, `detected_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teaching_issue_evidence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `teaching_issue_id` INTEGER NOT NULL,
    `evidence_type` VARCHAR(80) NOT NULL,
    `source_type` VARCHAR(80) NOT NULL,
    `source_id` VARCHAR(120) NULL,
    `metric_name` VARCHAR(120) NULL,
    `metric_value` DOUBLE NULL,
    `sample_size` INTEGER NULL,
    `evidence_json` JSON NULL,
    `observed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `teaching_issue_evidence_teaching_issue_id_idx`(`teaching_issue_id`),
    INDEX `teaching_issue_evidence_source_type_source_id_idx`(`source_type`, `source_id`),
    INDEX `teaching_issue_evidence_observed_at_idx`(`observed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teaching_interventions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `teaching_issue_id` INTEGER NULL,
    `intervention_type` VARCHAR(80) NOT NULL,
    `title` VARCHAR(240) NOT NULL,
    `content` TEXT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
    `scheduled_at` DATETIME(3) NULL,
    `executed_at` DATETIME(3) NULL,
    `review_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `teaching_interventions_teaching_issue_id_idx`(`teaching_issue_id`),
    INDEX `teaching_interventions_status_scheduled_at_idx`(`status`, `scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teaching_intervention_targets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `intervention_id` INTEGER NOT NULL,
    `target_type` VARCHAR(50) NOT NULL,
    `target_id` INTEGER NOT NULL,
    `delivery_status` VARCHAR(24) NOT NULL DEFAULT 'pending',
    `delivered_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `teaching_intervention_targets_target_type_target_id_idx`(`target_type`, `target_id`),
    INDEX `teaching_intervention_targets_delivery_status_idx`(`delivery_status`),
    UNIQUE INDEX `teaching_intervention_targets_intervention_id_target_type_ta_key`(`intervention_id`, `target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teaching_intervention_results` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `intervention_id` INTEGER NOT NULL,
    `target_type` VARCHAR(50) NULL,
    `target_id` INTEGER NULL,
    `metric_name` VARCHAR(120) NOT NULL,
    `baseline_value` DOUBLE NULL,
    `result_value` DOUBLE NULL,
    `sample_size` INTEGER NOT NULL DEFAULT 0,
    `evidence_json` JSON NULL,
    `measured_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `teaching_intervention_results_intervention_id_measured_at_idx`(`intervention_id`, `measured_at`),
    INDEX `teaching_intervention_results_target_type_target_id_idx`(`target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_evaluation_sets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `domain` VARCHAR(100) NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
    `version` INTEGER NOT NULL DEFAULT 1,
    `passing_score` DOUBLE NULL,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `published_at` DATETIME(3) NULL,
    `archived_at` DATETIME(3) NULL,

    INDEX `agent_evaluation_sets_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_evaluation_cases` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evaluation_set_id` INTEGER NOT NULL,
    `case_key` VARCHAR(120) NOT NULL,
    `title` VARCHAR(240) NOT NULL,
    `input_json` JSON NOT NULL,
    `expected_json` JSON NULL,
    `rubric_json` JSON NULL,
    `source_trace_id` INTEGER NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `agent_evaluation_cases_enabled_idx`(`enabled`),
    UNIQUE INDEX `agent_evaluation_cases_evaluation_set_id_case_key_key`(`evaluation_set_id`, `case_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_evaluation_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evaluation_set_id` INTEGER NOT NULL,
    `agent_config_id` INTEGER NOT NULL,
    `agent_version_id` INTEGER NULL,
    `model_config_id` INTEGER NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'queued',
    `total_cases` INTEGER NOT NULL DEFAULT 0,
    `completed_cases` INTEGER NOT NULL DEFAULT 0,
    `passed_cases` INTEGER NOT NULL DEFAULT 0,
    `aggregate_json` JSON NULL,
    `judge_model_id` INTEGER NULL,
    `judge_prompt_version_id` INTEGER NULL,
    `created_by` INTEGER NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `agent_evaluation_runs_evaluation_set_id_status_idx`(`evaluation_set_id`, `status`),
    INDEX `agent_evaluation_runs_agent_config_id_agent_version_id_idx`(`agent_config_id`, `agent_version_id`),
    INDEX `agent_evaluation_runs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_evaluation_results` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evaluation_run_id` INTEGER NOT NULL,
    `evaluation_case_id` INTEGER NOT NULL,
    `status` VARCHAR(24) NOT NULL,
    `output_json` JSON NULL,
    `score` DOUBLE NULL,
    `passed` BOOLEAN NULL,
    `metric_scores_json` JSON NULL,
    `scoring_evidence` JSON NULL,
    `latency_ms` INTEGER NULL,
    `total_tokens` INTEGER NULL,
    `cost_amount` DECIMAL(16, 8) NULL,
    `human_reviewed` BOOLEAN NOT NULL DEFAULT false,
    `reviewed_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `agent_evaluation_results_evaluation_case_id_idx`(`evaluation_case_id`),
    INDEX `agent_evaluation_results_passed_score_idx`(`passed`, `score`),
    UNIQUE INDEX `agent_evaluation_results_evaluation_run_id_evaluation_case_i_key`(`evaluation_run_id`, `evaluation_case_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_experiments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `experiment_key` VARCHAR(100) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `target_type` VARCHAR(60) NOT NULL,
    `target_id` INTEGER NULL,
    `course_id` INTEGER NULL,
    `teaching_class_id` INTEGER NULL,
    `assignment_salt` VARCHAR(100) NOT NULL,
    `success_metric_json` JSON NOT NULL,
    `stop_condition_json` JSON NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
    `version` INTEGER NOT NULL DEFAULT 1,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `published_at` DATETIME(3) NULL,
    `archived_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_experiments_experiment_key_key`(`experiment_key`),
    INDEX `ai_experiments_status_starts_at_ends_at_idx`(`status`, `starts_at`, `ends_at`),
    INDEX `ai_experiments_course_id_teaching_class_id_idx`(`course_id`, `teaching_class_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_experiment_variants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `experiment_id` INTEGER NOT NULL,
    `variant_key` VARCHAR(80) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `is_control` BOOLEAN NOT NULL DEFAULT false,
    `allocation_bp` INTEGER NOT NULL DEFAULT 0,
    `configuration_json` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_experiment_variants_experiment_id_enabled_idx`(`experiment_id`, `enabled`),
    UNIQUE INDEX `ai_experiment_variants_experiment_id_variant_key_key`(`experiment_id`, `variant_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_rollout_assignments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `experiment_id` INTEGER NOT NULL,
    `variant_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `assignment_hash` VARCHAR(64) NOT NULL,
    `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_rollout_assignments_variant_id_idx`(`variant_id`),
    INDEX `ai_rollout_assignments_user_id_expires_at_idx`(`user_id`, `expires_at`),
    UNIQUE INDEX `ai_rollout_assignments_experiment_id_user_id_key`(`experiment_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `digital_twin_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `teaching_class_id` INTEGER NOT NULL,
    `course_id` INTEGER NOT NULL,
    `range_start` DATETIME(3) NOT NULL,
    `range_end` DATETIME(3) NOT NULL,
    `sample_size` INTEGER NOT NULL DEFAULT 0,
    `calculation_method` VARCHAR(200) NOT NULL,
    `confidence` DOUBLE NULL,
    `knowledge_graph_json` JSON NULL,
    `mastery_matrix_json` JSON NULL,
    `learning_path_json` JSON NULL,
    `risk_distribution_json` JSON NULL,
    `data_quality_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `digital_twin_snapshots_teaching_class_id_created_at_idx`(`teaching_class_id`, `created_at`),
    INDEX `digital_twin_snapshots_course_id_created_at_idx`(`course_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `digital_twin_simulations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `snapshot_id` INTEGER NOT NULL,
    `intervention_type` VARCHAR(80) NOT NULL,
    `parameters_json` JSON NULL,
    `affected_student_count` INTEGER NULL,
    `expected_delta_min` DOUBLE NULL,
    `expected_delta_max` DOUBLE NULL,
    `confidence` DOUBLE NULL,
    `method_explanation` TEXT NOT NULL,
    `uncertainty_note` TEXT NOT NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `digital_twin_simulations_snapshot_id_created_at_idx`(`snapshot_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_teaching_assets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `asset_key` VARCHAR(100) NOT NULL,
    `asset_type` VARCHAR(80) NOT NULL,
    `title` VARCHAR(240) NOT NULL,
    `summary` TEXT NULL,
    `course_id` INTEGER NULL,
    `knowledge_point_id` INTEGER NULL,
    `source_type` VARCHAR(80) NOT NULL,
    `source_id` VARCHAR(120) NULL,
    `source_trace_id` INTEGER NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
    `version` INTEGER NOT NULL DEFAULT 1,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `published_at` DATETIME(3) NULL,
    `archived_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_teaching_assets_asset_key_key`(`asset_key`),
    INDEX `ai_teaching_assets_asset_type_status_idx`(`asset_type`, `status`),
    INDEX `ai_teaching_assets_course_id_knowledge_point_id_idx`(`course_id`, `knowledge_point_id`),
    INDEX `ai_teaching_assets_source_trace_id_idx`(`source_trace_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_teaching_asset_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `asset_id` INTEGER NOT NULL,
    `version_number` INTEGER NOT NULL,
    `content_json` JSON NOT NULL,
    `change_summary` VARCHAR(500) NULL,
    `checksum` VARCHAR(64) NOT NULL,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_teaching_asset_versions_created_at_idx`(`created_at`),
    UNIQUE INDEX `ai_teaching_asset_versions_asset_id_version_number_key`(`asset_id`, `version_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_teaching_asset_reviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `asset_id` INTEGER NOT NULL,
    `action` VARCHAR(24) NOT NULL,
    `reason` TEXT NULL,
    `reviewer_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_teaching_asset_reviews_asset_id_created_at_idx`(`asset_id`, `created_at`),
    INDEX `ai_teaching_asset_reviews_reviewer_id_idx`(`reviewer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_teaching_asset_usage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `asset_id` INTEGER NOT NULL,
    `user_id` INTEGER NULL,
    `usage_type` VARCHAR(60) NOT NULL,
    `target_type` VARCHAR(60) NULL,
    `target_id` INTEGER NULL,
    `outcome_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_teaching_asset_usage_asset_id_created_at_idx`(`asset_id`, `created_at`),
    INDEX `ai_teaching_asset_usage_user_id_idx`(`user_id`),
    INDEX `ai_teaching_asset_usage_target_type_target_id_idx`(`target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_strategy_profiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NULL,
    `profile_type` VARCHAR(80) NOT NULL,
    `profile_version` INTEGER NOT NULL DEFAULT 1,
    `confidence` DOUBLE NOT NULL,
    `range_start` DATETIME(3) NOT NULL,
    `range_end` DATETIME(3) NOT NULL,
    `sample_size` INTEGER NOT NULL DEFAULT 0,
    `metrics_json` JSON NOT NULL,
    `recommendation_json` JSON NULL,
    `calculation_method` VARCHAR(200) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_strategy_profiles_student_user_id_created_at_idx`(`student_user_id`, `created_at`),
    INDEX `student_strategy_profiles_course_id_profile_type_idx`(`course_id`, `profile_type`),
    INDEX `student_strategy_profiles_confidence_idx`(`confidence`),
    UNIQUE INDEX `strategy_profile_window_key`(`student_user_id`, `course_id`, `profile_version`, `range_start`, `range_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_strategy_evidence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `profile_id` INTEGER NOT NULL,
    `evidence_type` VARCHAR(80) NOT NULL,
    `source_type` VARCHAR(80) NOT NULL,
    `source_id` VARCHAR(120) NULL,
    `metric_name` VARCHAR(120) NOT NULL,
    `metric_value` DOUBLE NULL,
    `weight` DOUBLE NULL,
    `evidence_json` JSON NULL,
    `observed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_strategy_evidence_profile_id_idx`(`profile_id`),
    INDEX `student_strategy_evidence_source_type_source_id_idx`(`source_type`, `source_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_risk_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rule_key` VARCHAR(120) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `risk_type` VARCHAR(80) NOT NULL,
    `severity` VARCHAR(24) NOT NULL,
    `detection_type` VARCHAR(40) NOT NULL,
    `condition_json` JSON NOT NULL,
    `action_json` JSON NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
    `version` INTEGER NOT NULL DEFAULT 1,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `published_at` DATETIME(3) NULL,
    `archived_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_risk_rules_rule_key_key`(`rule_key`),
    INDEX `ai_risk_rules_risk_type_enabled_idx`(`risk_type`, `enabled`),
    INDEX `ai_risk_rules_severity_status_idx`(`severity`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_risk_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_key` VARCHAR(100) NOT NULL,
    `risk_rule_id` INTEGER NULL,
    `risk_type` VARCHAR(80) NOT NULL,
    `severity` VARCHAR(24) NOT NULL,
    `title` VARCHAR(240) NOT NULL,
    `description` TEXT NULL,
    `user_id` INTEGER NULL,
    `request_trace_id` INTEGER NULL,
    `agent_config_id` INTEGER NULL,
    `provider_id` INTEGER NULL,
    `model_config_id` INTEGER NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'open',
    `assignee_id` INTEGER NULL,
    `resolution` TEXT NULL,
    `confirmed` BOOLEAN NULL,
    `detected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_risk_events_event_key_key`(`event_key`),
    INDEX `ai_risk_events_risk_type_severity_idx`(`risk_type`, `severity`),
    INDEX `ai_risk_events_status_detected_at_idx`(`status`, `detected_at`),
    INDEX `ai_risk_events_user_id_detected_at_idx`(`user_id`, `detected_at`),
    INDEX `ai_risk_events_request_trace_id_idx`(`request_trace_id`),
    INDEX `ai_risk_events_agent_config_id_provider_id_idx`(`agent_config_id`, `provider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_risk_event_evidence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `risk_event_id` INTEGER NOT NULL,
    `evidence_type` VARCHAR(80) NOT NULL,
    `source_type` VARCHAR(80) NOT NULL,
    `source_id` VARCHAR(120) NULL,
    `evidence_redacted` TEXT NULL,
    `evidence_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_risk_event_evidence_risk_event_id_idx`(`risk_event_id`),
    INDEX `ai_risk_event_evidence_source_type_source_id_idx`(`source_type`, `source_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_risk_actions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `risk_event_id` INTEGER NOT NULL,
    `action_type` VARCHAR(80) NOT NULL,
    `status` VARCHAR(24) NOT NULL,
    `action_summary` VARCHAR(500) NULL,
    `actor_user_id` INTEGER NULL,
    `request_id` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_risk_actions_risk_event_id_created_at_idx`(`risk_event_id`, `created_at`),
    INDEX `ai_risk_actions_actor_user_id_idx`(`actor_user_id`),
    INDEX `ai_risk_actions_request_id_idx`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `ai_agent_configs_agent_key_key` ON `ai_agent_configs`(`agent_key`);

-- CreateIndex
CREATE INDEX `ai_agent_configs_provider_id_idx` ON `ai_agent_configs`(`provider_id`);

-- CreateIndex
CREATE INDEX `ai_agent_configs_model_config_id_idx` ON `ai_agent_configs`(`model_config_id`);

-- CreateIndex
CREATE INDEX `ai_agent_configs_runtime_type_idx` ON `ai_agent_configs`(`runtime_type`);

-- CreateIndex
CREATE INDEX `ai_agent_configs_status_idx` ON `ai_agent_configs`(`status`);

-- CreateIndex
CREATE INDEX `ai_model_configs_provider_id_idx` ON `ai_model_configs`(`provider_id`);

-- CreateIndex
CREATE INDEX `ai_model_configs_model_type_idx` ON `ai_model_configs`(`model_type`);

-- CreateIndex
CREATE INDEX `ai_model_configs_is_default_idx` ON `ai_model_configs`(`is_default`);

-- CreateIndex
CREATE UNIQUE INDEX `ai_model_provider_code_key` ON `ai_model_configs`(`provider_id`, `model_code`);

-- CreateIndex
CREATE INDEX `operation_logs_request_id_idx` ON `operation_logs`(`request_id`);

-- CreateIndex
CREATE INDEX `operation_logs_action_status_created_at_idx` ON `operation_logs`(`action_status`, `created_at`);

-- AddForeignKey
ALTER TABLE `ai_model_configs` ADD CONSTRAINT `ai_model_configs_provider_id_fkey` FOREIGN KEY (`provider_id`) REFERENCES `ai_providers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_agent_configs` ADD CONSTRAINT `ai_agent_configs_provider_id_fkey` FOREIGN KEY (`provider_id`) REFERENCES `ai_providers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_agent_configs` ADD CONSTRAINT `ai_agent_configs_model_config_id_fkey` FOREIGN KEY (`model_config_id`) REFERENCES `ai_model_configs`(`ai_model_config_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_versions` ADD CONSTRAINT `agent_versions_agent_config_id_fkey` FOREIGN KEY (`agent_config_id`) REFERENCES `ai_agent_configs`(`agent_config_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_role_permissions` ADD CONSTRAINT `admin_role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `admin_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_role_permissions` ADD CONSTRAINT `admin_role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `admin_permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_user_roles` ADD CONSTRAINT `admin_user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `admin_roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_trace_steps` ADD CONSTRAINT `ai_trace_steps_trace_id_fkey` FOREIGN KEY (`trace_id`) REFERENCES `ai_request_traces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_trace_retrievals` ADD CONSTRAINT `ai_trace_retrievals_trace_id_fkey` FOREIGN KEY (`trace_id`) REFERENCES `ai_request_traces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_trace_retrievals` ADD CONSTRAINT `ai_trace_retrievals_step_id_fkey` FOREIGN KEY (`step_id`) REFERENCES `ai_trace_steps`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_trace_tool_calls` ADD CONSTRAINT `ai_trace_tool_calls_trace_id_fkey` FOREIGN KEY (`trace_id`) REFERENCES `ai_request_traces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_trace_tool_calls` ADD CONSTRAINT `ai_trace_tool_calls_step_id_fkey` FOREIGN KEY (`step_id`) REFERENCES `ai_trace_steps`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_trace_feedback` ADD CONSTRAINT `ai_trace_feedback_trace_id_fkey` FOREIGN KEY (`trace_id`) REFERENCES `ai_request_traces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teaching_issue_evidence` ADD CONSTRAINT `teaching_issue_evidence_teaching_issue_id_fkey` FOREIGN KEY (`teaching_issue_id`) REFERENCES `teaching_issues`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teaching_interventions` ADD CONSTRAINT `teaching_interventions_teaching_issue_id_fkey` FOREIGN KEY (`teaching_issue_id`) REFERENCES `teaching_issues`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teaching_intervention_targets` ADD CONSTRAINT `teaching_intervention_targets_intervention_id_fkey` FOREIGN KEY (`intervention_id`) REFERENCES `teaching_interventions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teaching_intervention_results` ADD CONSTRAINT `teaching_intervention_results_intervention_id_fkey` FOREIGN KEY (`intervention_id`) REFERENCES `teaching_interventions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_evaluation_cases` ADD CONSTRAINT `agent_evaluation_cases_evaluation_set_id_fkey` FOREIGN KEY (`evaluation_set_id`) REFERENCES `agent_evaluation_sets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_evaluation_runs` ADD CONSTRAINT `agent_evaluation_runs_evaluation_set_id_fkey` FOREIGN KEY (`evaluation_set_id`) REFERENCES `agent_evaluation_sets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_evaluation_results` ADD CONSTRAINT `agent_evaluation_results_evaluation_run_id_fkey` FOREIGN KEY (`evaluation_run_id`) REFERENCES `agent_evaluation_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_evaluation_results` ADD CONSTRAINT `agent_evaluation_results_evaluation_case_id_fkey` FOREIGN KEY (`evaluation_case_id`) REFERENCES `agent_evaluation_cases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_experiment_variants` ADD CONSTRAINT `ai_experiment_variants_experiment_id_fkey` FOREIGN KEY (`experiment_id`) REFERENCES `ai_experiments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_rollout_assignments` ADD CONSTRAINT `ai_rollout_assignments_experiment_id_fkey` FOREIGN KEY (`experiment_id`) REFERENCES `ai_experiments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_rollout_assignments` ADD CONSTRAINT `ai_rollout_assignments_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `ai_experiment_variants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `digital_twin_simulations` ADD CONSTRAINT `digital_twin_simulations_snapshot_id_fkey` FOREIGN KEY (`snapshot_id`) REFERENCES `digital_twin_snapshots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_teaching_asset_versions` ADD CONSTRAINT `ai_teaching_asset_versions_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `ai_teaching_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_teaching_asset_reviews` ADD CONSTRAINT `ai_teaching_asset_reviews_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `ai_teaching_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_teaching_asset_usage` ADD CONSTRAINT `ai_teaching_asset_usage_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `ai_teaching_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_strategy_evidence` ADD CONSTRAINT `student_strategy_evidence_profile_id_fkey` FOREIGN KEY (`profile_id`) REFERENCES `student_strategy_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_risk_events` ADD CONSTRAINT `ai_risk_events_risk_rule_id_fkey` FOREIGN KEY (`risk_rule_id`) REFERENCES `ai_risk_rules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_risk_event_evidence` ADD CONSTRAINT `ai_risk_event_evidence_risk_event_id_fkey` FOREIGN KEY (`risk_event_id`) REFERENCES `ai_risk_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_risk_actions` ADD CONSTRAINT `ai_risk_actions_risk_event_id_fkey` FOREIGN KEY (`risk_event_id`) REFERENCES `ai_risk_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
