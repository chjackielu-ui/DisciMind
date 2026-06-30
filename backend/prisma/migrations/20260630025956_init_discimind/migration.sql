-- CreateTable
CREATE TABLE `users` (
    `user_id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('admin', 'teacher', 'student') NOT NULL,
    `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    `phone` VARCHAR(20) NULL,
    `email` VARCHAR(100) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_phone_key`(`phone`),
    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_role_idx`(`role`),
    INDEX `users_status_idx`(`status`),
    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_profiles` (
    `profile_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `real_name` VARCHAR(50) NOT NULL,
    `gender` ENUM('male', 'female', 'unknown') NOT NULL DEFAULT 'unknown',
    `student_no` VARCHAR(50) NULL,
    `teacher_no` VARCHAR(50) NULL,
    `college` VARCHAR(100) NULL,
    `major` VARCHAR(100) NULL,
    `grade` VARCHAR(20) NULL,
    `admin_class_id` INTEGER NULL,
    `avatar_url` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_profiles_user_id_key`(`user_id`),
    UNIQUE INDEX `user_profiles_student_no_key`(`student_no`),
    UNIQUE INDEX `user_profiles_teacher_no_key`(`teacher_no`),
    INDEX `user_profiles_admin_class_id_idx`(`admin_class_id`),
    PRIMARY KEY (`profile_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_classes` (
    `admin_class_id` INTEGER NOT NULL AUTO_INCREMENT,
    `class_name` VARCHAR(100) NOT NULL,
    `college` VARCHAR(100) NULL,
    `major` VARCHAR(100) NULL,
    `grade` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_classes_class_name_grade_key`(`class_name`, `grade`),
    PRIMARY KEY (`admin_class_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `courses` (
    `course_id` INTEGER NOT NULL AUTO_INCREMENT,
    `course_name` VARCHAR(100) NOT NULL,
    `course_code` VARCHAR(50) NOT NULL,
    `subject_category` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `cover_url` VARCHAR(500) NULL,
    `status` ENUM('active', 'archived') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `courses_course_code_key`(`course_code`),
    INDEX `courses_status_idx`(`status`),
    PRIMARY KEY (`course_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_teacher_relations` (
    `relation_id` INTEGER NOT NULL AUTO_INCREMENT,
    `course_id` INTEGER NOT NULL,
    `teacher_user_id` INTEGER NOT NULL,
    `teacher_role` ENUM('main_teacher', 'assistant', 'manager') NOT NULL DEFAULT 'main_teacher',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `course_teacher_relations_teacher_user_id_idx`(`teacher_user_id`),
    UNIQUE INDEX `course_teacher_relations_course_id_teacher_user_id_key`(`course_id`, `teacher_user_id`),
    PRIMARY KEY (`relation_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teaching_classes` (
    `teaching_class_id` INTEGER NOT NULL AUTO_INCREMENT,
    `course_id` INTEGER NOT NULL,
    `teaching_class_name` VARCHAR(100) NOT NULL,
    `semester` VARCHAR(50) NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `teaching_classes_course_id_teaching_class_name_key`(`course_id`, `teaching_class_name`),
    PRIMARY KEY (`teaching_class_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_course_enrollments` (
    `enrollment_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NOT NULL,
    `teaching_class_id` INTEGER NOT NULL,
    `enrollment_status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `student_course_enrollments_course_id_idx`(`course_id`),
    INDEX `student_course_enrollments_teaching_class_id_idx`(`teaching_class_id`),
    UNIQUE INDEX `student_course_enrollments_student_user_id_course_id_teachin_key`(`student_user_id`, `course_id`, `teaching_class_id`),
    PRIMARY KEY (`enrollment_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chapters` (
    `chapter_id` INTEGER NOT NULL AUTO_INCREMENT,
    `course_id` INTEGER NOT NULL,
    `chapter_name` VARCHAR(100) NOT NULL,
    `chapter_order` INTEGER NOT NULL DEFAULT 0,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `chapters_course_id_idx`(`course_id`),
    PRIMARY KEY (`chapter_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_points` (
    `knowledge_point_id` INTEGER NOT NULL AUTO_INCREMENT,
    `course_id` INTEGER NOT NULL,
    `chapter_id` INTEGER NULL,
    `parent_id` INTEGER NULL,
    `knowledge_point_name` VARCHAR(100) NOT NULL,
    `knowledge_point_code` VARCHAR(50) NOT NULL,
    `description` TEXT NULL,
    `difficulty_level` ENUM('basic', 'medium', 'hard') NOT NULL DEFAULT 'basic',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `knowledge_points_chapter_id_idx`(`chapter_id`),
    INDEX `knowledge_points_parent_id_idx`(`parent_id`),
    UNIQUE INDEX `knowledge_points_course_id_knowledge_point_code_key`(`course_id`, `knowledge_point_code`),
    PRIMARY KEY (`knowledge_point_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_point_aliases` (
    `alias_id` INTEGER NOT NULL AUTO_INCREMENT,
    `knowledge_point_id` INTEGER NOT NULL,
    `alias_text` VARCHAR(100) NOT NULL,
    `source` VARCHAR(20) NULL DEFAULT 'system',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `knowledge_point_aliases_knowledge_point_id_alias_text_key`(`knowledge_point_id`, `alias_text`),
    PRIMARY KEY (`alias_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_bases` (
    `knowledge_base_id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `scope_type` ENUM('platform', 'course', 'class', 'personal') NOT NULL,
    `course_id` INTEGER NULL,
    `teaching_class_id` INTEGER NULL,
    `owner_user_id` INTEGER NULL,
    `description` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `dify_dataset_id` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `knowledge_bases_scope_type_idx`(`scope_type`),
    INDEX `knowledge_bases_course_id_idx`(`course_id`),
    INDEX `knowledge_bases_teaching_class_id_idx`(`teaching_class_id`),
    INDEX `knowledge_bases_owner_user_id_idx`(`owner_user_id`),
    PRIMARY KEY (`knowledge_base_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_documents` (
    `document_id` INTEGER NOT NULL AUTO_INCREMENT,
    `knowledge_base_id` INTEGER NULL,
    `title` VARCHAR(200) NOT NULL,
    `original_filename` VARCHAR(255) NOT NULL,
    `file_ext` VARCHAR(20) NOT NULL,
    `file_size_bytes` INTEGER NULL,
    `mime_type` VARCHAR(100) NULL,
    `storage_type` ENUM('local', 'oss') NOT NULL DEFAULT 'local',
    `file_url` VARCHAR(500) NOT NULL,
    `scope_type` ENUM('platform', 'course', 'class', 'personal') NOT NULL,
    `visibility` ENUM('private', 'class', 'college', 'school') NOT NULL DEFAULT 'private',
    `course_id` INTEGER NULL,
    `teaching_class_id` INTEGER NULL,
    `owner_user_id` INTEGER NOT NULL,
    `parse_status` ENUM('uploaded', 'parsing', 'parsed', 'chunking', 'chunked', 'embedding', 'embedded', 'failed') NOT NULL DEFAULT 'uploaded',
    `review_status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `reviewer_user_id` INTEGER NULL,
    `review_comment` TEXT NULL,
    `dify_dataset_id` VARCHAR(255) NULL,
    `dify_document_id` VARCHAR(255) NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `knowledge_documents_knowledge_base_id_idx`(`knowledge_base_id`),
    INDEX `knowledge_documents_owner_user_id_idx`(`owner_user_id`),
    INDEX `knowledge_documents_course_id_idx`(`course_id`),
    INDEX `knowledge_documents_teaching_class_id_idx`(`teaching_class_id`),
    INDEX `knowledge_documents_parse_status_idx`(`parse_status`),
    INDEX `knowledge_documents_review_status_idx`(`review_status`),
    PRIMARY KEY (`document_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_document_chunks` (
    `chunk_id` INTEGER NOT NULL AUTO_INCREMENT,
    `document_id` INTEGER NOT NULL,
    `chunk_index` INTEGER NOT NULL,
    `chunk_text` TEXT NOT NULL,
    `page_number` INTEGER NULL,
    `token_count` INTEGER NULL,
    `embedding_id` VARCHAR(255) NULL,
    `vector_store_type` VARCHAR(50) NULL,
    `dify_segment_id` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `knowledge_document_chunks_document_id_idx`(`document_id`),
    UNIQUE INDEX `knowledge_document_chunks_document_id_chunk_index_key`(`document_id`, `chunk_index`),
    PRIMARY KEY (`chunk_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_document_reviews` (
    `review_id` INTEGER NOT NULL AUTO_INCREMENT,
    `document_id` INTEGER NOT NULL,
    `reviewer_user_id` INTEGER NOT NULL,
    `review_status` ENUM('pending', 'approved', 'rejected') NOT NULL,
    `review_comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `knowledge_document_reviews_document_id_idx`(`document_id`),
    INDEX `knowledge_document_reviews_reviewer_user_id_idx`(`reviewer_user_id`),
    PRIMARY KEY (`review_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_conversations` (
    `conversation_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `course_id` INTEGER NULL,
    `teaching_class_id` INTEGER NULL,
    `agent_type` ENUM('course_qa', 'learning_analysis', 'personalized_recommendation', 'question_generation', 'document_summary') NOT NULL DEFAULT 'course_qa',
    `title` VARCHAR(200) NULL,
    `dify_conversation_id` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `chat_conversations_user_id_idx`(`user_id`),
    INDEX `chat_conversations_course_id_idx`(`course_id`),
    INDEX `chat_conversations_teaching_class_id_idx`(`teaching_class_id`),
    PRIMARY KEY (`conversation_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_messages` (
    `message_id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `user_id` INTEGER NULL,
    `role` ENUM('user', 'assistant', 'system') NOT NULL,
    `content` TEXT NOT NULL,
    `is_ai_generated` BOOLEAN NOT NULL DEFAULT false,
    `ai_provider` VARCHAR(50) NULL,
    `model_name` VARCHAR(100) NULL,
    `agent_type` ENUM('course_qa', 'learning_analysis', 'personalized_recommendation', 'question_generation', 'document_summary') NULL,
    `dify_message_id` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `chat_messages_conversation_id_idx`(`conversation_id`),
    INDEX `chat_messages_user_id_idx`(`user_id`),
    INDEX `chat_messages_role_idx`(`role`),
    PRIMARY KEY (`message_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_sources` (
    `source_id` INTEGER NOT NULL AUTO_INCREMENT,
    `message_id` INTEGER NOT NULL,
    `document_id` INTEGER NULL,
    `chunk_id` INTEGER NULL,
    `document_title` VARCHAR(200) NULL,
    `page_number` INTEGER NULL,
    `chunk_text` TEXT NULL,
    `similarity` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `message_sources_message_id_idx`(`message_id`),
    INDEX `message_sources_document_id_idx`(`document_id`),
    INDEX `message_sources_chunk_id_idx`(`chunk_id`),
    PRIMARY KEY (`source_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_question_records` (
    `student_question_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NULL,
    `conversation_id` INTEGER NULL,
    `message_id` INTEGER NULL,
    `raw_question` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `student_question_records_student_user_id_idx`(`student_user_id`),
    INDEX `student_question_records_course_id_idx`(`course_id`),
    INDEX `student_question_records_conversation_id_idx`(`conversation_id`),
    INDEX `student_question_records_message_id_idx`(`message_id`),
    PRIMARY KEY (`student_question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_analysis_records` (
    `analysis_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_question_id` INTEGER NOT NULL,
    `raw_question` TEXT NOT NULL,
    `question_summary` TEXT NULL,
    `knowledge_point_id` INTEGER NULL,
    `normalized_question_type` VARCHAR(100) NULL,
    `confidence` DOUBLE NULL,
    `need_teacher_review` BOOLEAN NOT NULL DEFAULT false,
    `reviewed_by_user_id` INTEGER NULL,
    `teacher_comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `question_analysis_records_student_question_id_idx`(`student_question_id`),
    INDEX `question_analysis_records_knowledge_point_id_idx`(`knowledge_point_id`),
    INDEX `question_analysis_records_need_teacher_review_idx`(`need_teacher_review`),
    PRIMARY KEY (`analysis_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_keywords` (
    `keyword_id` INTEGER NOT NULL AUTO_INCREMENT,
    `analysis_id` INTEGER NOT NULL,
    `keyword` VARCHAR(100) NOT NULL,
    `weight` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `question_keywords_analysis_id_idx`(`analysis_id`),
    INDEX `question_keywords_keyword_idx`(`keyword`),
    PRIMARY KEY (`keyword_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_confusion_tags` (
    `tag_id` INTEGER NOT NULL AUTO_INCREMENT,
    `analysis_id` INTEGER NOT NULL,
    `tag` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `question_confusion_tags_analysis_id_idx`(`analysis_id`),
    INDEX `question_confusion_tags_tag_idx`(`tag`),
    PRIMARY KEY (`tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_knowledge_point_mappings` (
    `mapping_id` INTEGER NOT NULL AUTO_INCREMENT,
    `analysis_id` INTEGER NOT NULL,
    `knowledge_point_id` INTEGER NOT NULL,
    `similarity` DOUBLE NULL,
    `source` VARCHAR(50) NULL,
    `is_final` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `question_knowledge_point_mappings_analysis_id_idx`(`analysis_id`),
    INDEX `question_knowledge_point_mappings_knowledge_point_id_idx`(`knowledge_point_id`),
    PRIMARY KEY (`mapping_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `questions` (
    `question_id` INTEGER NOT NULL AUTO_INCREMENT,
    `course_id` INTEGER NOT NULL,
    `knowledge_point_id` INTEGER NULL,
    `question_type` ENUM('single_choice', 'multiple_choice', 'true_false', 'blank', 'short_answer', 'programming') NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` TEXT NOT NULL,
    `correct_answer` JSON NULL,
    `answer_keywords` JSON NULL,
    `analysis` TEXT NULL,
    `difficulty_level` ENUM('basic', 'medium', 'hard') NOT NULL DEFAULT 'basic',
    `score` DOUBLE NOT NULL DEFAULT 0,
    `is_ai_generated` BOOLEAN NOT NULL DEFAULT false,
    `created_by_user_id` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `questions_course_id_idx`(`course_id`),
    INDEX `questions_knowledge_point_id_idx`(`knowledge_point_id`),
    INDEX `questions_question_type_idx`(`question_type`),
    INDEX `questions_difficulty_level_idx`(`difficulty_level`),
    PRIMARY KEY (`question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_options` (
    `option_id` INTEGER NOT NULL AUTO_INCREMENT,
    `question_id` INTEGER NOT NULL,
    `option_key` VARCHAR(10) NOT NULL,
    `option_content` TEXT NOT NULL,
    `option_order` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `question_options_question_id_option_key_key`(`question_id`, `option_key`),
    PRIMARY KEY (`option_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `learning_tasks` (
    `task_id` INTEGER NOT NULL AUTO_INCREMENT,
    `course_id` INTEGER NOT NULL,
    `teaching_class_id` INTEGER NOT NULL,
    `created_by_user_id` INTEGER NOT NULL,
    `task_type` ENUM('homework', 'quiz', 'study_task', 'review_plan') NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `start_time` DATETIME(3) NULL,
    `deadline` DATETIME(3) NULL,
    `allow_late_submit` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('draft', 'published', 'closed') NOT NULL DEFAULT 'draft',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `learning_tasks_course_id_idx`(`course_id`),
    INDEX `learning_tasks_teaching_class_id_idx`(`teaching_class_id`),
    INDEX `learning_tasks_created_by_user_id_idx`(`created_by_user_id`),
    INDEX `learning_tasks_task_type_idx`(`task_type`),
    INDEX `learning_tasks_status_idx`(`status`),
    PRIMARY KEY (`task_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_questions` (
    `task_question_id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `question_id` INTEGER NOT NULL,
    `question_order` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `task_questions_task_id_question_id_key`(`task_id`, `question_id`),
    PRIMARY KEY (`task_question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_knowledge_points` (
    `task_knowledge_point_id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `knowledge_point_id` INTEGER NOT NULL,

    UNIQUE INDEX `task_knowledge_points_task_id_knowledge_point_id_key`(`task_id`, `knowledge_point_id`),
    PRIMARY KEY (`task_knowledge_point_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_submissions` (
    `submission_id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `student_user_id` INTEGER NOT NULL,
    `started_at` DATETIME(3) NULL,
    `submitted_at` DATETIME(3) NULL,
    `duration_seconds` INTEGER NULL,
    `is_late` BOOLEAN NOT NULL DEFAULT false,
    `total_score` DOUBLE NULL,
    `objective_score` DOUBLE NULL,
    `ai_score` DOUBLE NULL,
    `submission_status` ENUM('in_progress', 'submitted', 'graded') NOT NULL DEFAULT 'in_progress',
    `grading_status` ENUM('pending', 'auto_graded', 'ai_graded', 'manual_graded', 'failed') NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `task_submissions_task_id_idx`(`task_id`),
    INDEX `task_submissions_student_user_id_idx`(`student_user_id`),
    PRIMARY KEY (`submission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `answer_records` (
    `answer_record_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `question_id` INTEGER NOT NULL,
    `task_id` INTEGER NULL,
    `submission_id` INTEGER NULL,
    `answer_content` JSON NOT NULL,
    `started_at` DATETIME(3) NULL,
    `submitted_at` DATETIME(3) NULL,
    `duration_seconds` INTEGER NULL,
    `viewed_analysis` BOOLEAN NOT NULL DEFAULT false,
    `attempt_no` INTEGER NOT NULL DEFAULT 1,
    `is_correct` BOOLEAN NULL,
    `score` DOUBLE NULL,
    `max_score` DOUBLE NULL,
    `grading_status` ENUM('pending', 'auto_graded', 'ai_graded', 'manual_graded', 'failed') NOT NULL DEFAULT 'pending',
    `feedback` TEXT NULL,
    `auto_added_wrong_book` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `answer_records_student_user_id_idx`(`student_user_id`),
    INDEX `answer_records_question_id_idx`(`question_id`),
    INDEX `answer_records_task_id_idx`(`task_id`),
    INDEX `answer_records_submission_id_idx`(`submission_id`),
    PRIMARY KEY (`answer_record_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_grading_records` (
    `ai_grading_record_id` INTEGER NOT NULL AUTO_INCREMENT,
    `answer_record_id` INTEGER NOT NULL,
    `score` DOUBLE NOT NULL,
    `total_score` DOUBLE NOT NULL,
    `comment` TEXT NULL,
    `rubric_matched` JSON NULL,
    `rubric_missing` JSON NULL,
    `is_ai_generated` BOOLEAN NOT NULL DEFAULT true,
    `ai_provider` VARCHAR(50) NULL,
    `model_name` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_grading_records_answer_record_id_idx`(`answer_record_id`),
    PRIMARY KEY (`ai_grading_record_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `programming_submissions` (
    `programming_submission_id` INTEGER NOT NULL AUTO_INCREMENT,
    `question_id` INTEGER NOT NULL,
    `student_user_id` INTEGER NOT NULL,
    `language` VARCHAR(50) NOT NULL,
    `source_code` TEXT NOT NULL,
    `judge_status` ENUM('pending', 'judging', 'accepted', 'wrong_answer', 'compile_error', 'runtime_error', 'time_limit_exceeded', 'memory_limit_exceeded', 'system_error') NOT NULL DEFAULT 'pending',
    `score` DOUBLE NULL,
    `time_ms` INTEGER NULL,
    `memory_kb` INTEGER NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `programming_submissions_question_id_idx`(`question_id`),
    INDEX `programming_submissions_student_user_id_idx`(`student_user_id`),
    INDEX `programming_submissions_judge_status_idx`(`judge_status`),
    PRIMARY KEY (`programming_submission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wrong_questions` (
    `wrong_question_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `question_id` INTEGER NOT NULL,
    `course_id` INTEGER NULL,
    `knowledge_point_id` INTEGER NULL,
    `source_type` VARCHAR(20) NOT NULL DEFAULT 'auto',
    `status` ENUM('unresolved', 'mastered', 'removed') NOT NULL DEFAULT 'unresolved',
    `remove_reason` TEXT NULL,
    `mastered_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `wrong_questions_course_id_idx`(`course_id`),
    INDEX `wrong_questions_knowledge_point_id_idx`(`knowledge_point_id`),
    INDEX `wrong_questions_status_idx`(`status`),
    UNIQUE INDEX `wrong_questions_student_user_id_question_id_key`(`student_user_id`, `question_id`),
    PRIMARY KEY (`wrong_question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `study_records` (
    `study_record_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NOT NULL,
    `knowledge_point_id` INTEGER NULL,
    `resource_type` VARCHAR(50) NOT NULL,
    `resource_id` INTEGER NULL,
    `action_type` ENUM('start', 'view', 'pause', 'finish', 'review') NOT NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `duration_seconds` INTEGER NULL,
    `progress_percent` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `study_records_student_user_id_idx`(`student_user_id`),
    INDEX `study_records_course_id_idx`(`course_id`),
    INDEX `study_records_knowledge_point_id_idx`(`knowledge_point_id`),
    INDEX `study_records_action_type_idx`(`action_type`),
    PRIMARY KEY (`study_record_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_mastery_records` (
    `mastery_record_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NOT NULL,
    `knowledge_point_id` INTEGER NOT NULL,
    `mastery_score` DOUBLE NOT NULL DEFAULT 0,
    `mastery_level` ENUM('weak', 'general', 'good', 'excellent') NOT NULL DEFAULT 'weak',
    `quiz_score` DOUBLE NULL,
    `question_score` DOUBLE NULL,
    `study_progress_score` DOUBLE NULL,
    `teacher_mark_score` DOUBLE NULL,
    `system_score` DOUBLE NULL,
    `teacher_mark_level` ENUM('weak', 'general', 'good', 'excellent') NULL,
    `teacher_comment` TEXT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_mastery_records_course_id_idx`(`course_id`),
    INDEX `student_mastery_records_knowledge_point_id_idx`(`knowledge_point_id`),
    UNIQUE INDEX `student_mastery_records_student_user_id_course_id_knowledge__key`(`student_user_id`, `course_id`, `knowledge_point_id`),
    PRIMARY KEY (`mastery_record_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_portraits` (
    `portrait_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NOT NULL,
    `learning_total_score` DOUBLE NOT NULL DEFAULT 0,
    `progress_score` DOUBLE NULL,
    `mastery_score` DOUBLE NULL,
    `test_score` DOUBLE NULL,
    `wrong_question_score` DOUBLE NULL,
    `activity_score` DOUBLE NULL,
    `qa_score` DOUBLE NULL,
    `research_total_score` DOUBLE NULL,
    `competition_total_score` DOUBLE NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_portraits_course_id_idx`(`course_id`),
    UNIQUE INDEX `student_portraits_student_user_id_course_id_key`(`student_user_id`, `course_id`),
    PRIMARY KEY (`portrait_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_portrait_snapshots` (
    `snapshot_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NOT NULL,
    `snapshot_date` DATETIME(3) NOT NULL,
    `learning_scores` JSON NULL,
    `mastery_summary` JSON NULL,
    `activity_summary` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `student_portrait_snapshots_course_id_idx`(`course_id`),
    UNIQUE INDEX `student_portrait_snapshots_student_user_id_course_id_snapsho_key`(`student_user_id`, `course_id`, `snapshot_date`),
    PRIMARY KEY (`snapshot_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_research_profiles` (
    `research_profile_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NULL,
    `total_score` DOUBLE NOT NULL DEFAULT 0,
    `tags` JSON NULL,
    `teacher_comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `student_research_profiles_student_user_id_course_id_key`(`student_user_id`, `course_id`),
    PRIMARY KEY (`research_profile_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_competition_profiles` (
    `competition_profile_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NULL,
    `total_score` DOUBLE NOT NULL DEFAULT 0,
    `tags` JSON NULL,
    `teacher_comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `student_competition_profiles_student_user_id_course_id_key`(`student_user_id`, `course_id`),
    PRIMARY KEY (`competition_profile_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recommendation_records` (
    `recommendation_record_id` INTEGER NOT NULL AUTO_INCREMENT,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NOT NULL,
    `recommend_type` ENUM('all', 'knowledge_point', 'question', 'learning_path', 'video', 'review_plan') NOT NULL DEFAULT 'all',
    `generated_by_agent_run_id` INTEGER NULL,
    `reason_summary` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recommendation_records_student_user_id_idx`(`student_user_id`),
    INDEX `recommendation_records_course_id_idx`(`course_id`),
    INDEX `recommendation_records_recommend_type_idx`(`recommend_type`),
    PRIMARY KEY (`recommendation_record_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recommendation_items` (
    `recommendation_item_id` INTEGER NOT NULL AUTO_INCREMENT,
    `recommendation_record_id` INTEGER NOT NULL,
    `item_type` VARCHAR(50) NOT NULL,
    `target_type` VARCHAR(50) NULL,
    `target_id` INTEGER NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` JSON NULL,
    `reason` TEXT NULL,
    `rank` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recommendation_items_recommendation_record_id_idx`(`recommendation_record_id`),
    INDEX `recommendation_items_item_type_idx`(`item_type`),
    PRIMARY KEY (`recommendation_item_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `learning_paths` (
    `learning_path_id` INTEGER NOT NULL AUTO_INCREMENT,
    `recommendation_record_id` INTEGER NULL,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `learning_paths_student_user_id_idx`(`student_user_id`),
    INDEX `learning_paths_course_id_idx`(`course_id`),
    PRIMARY KEY (`learning_path_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `learning_path_steps` (
    `learning_path_step_id` INTEGER NOT NULL AUTO_INCREMENT,
    `learning_path_id` INTEGER NOT NULL,
    `step_order` INTEGER NOT NULL,
    `knowledge_point_id` INTEGER NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `resource_type` VARCHAR(50) NULL,
    `resource_id` INTEGER NULL,
    `is_completed` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `learning_path_steps_learning_path_id_idx`(`learning_path_id`),
    INDEX `learning_path_steps_knowledge_point_id_idx`(`knowledge_point_id`),
    PRIMARY KEY (`learning_path_step_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review_plans` (
    `review_plan_id` INTEGER NOT NULL AUTO_INCREMENT,
    `recommendation_record_id` INTEGER NULL,
    `student_user_id` INTEGER NOT NULL,
    `course_id` INTEGER NOT NULL,
    `plan_title` VARCHAR(200) NOT NULL,
    `start_date` DATETIME(3) NULL,
    `end_date` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `review_plans_student_user_id_idx`(`student_user_id`),
    INDEX `review_plans_course_id_idx`(`course_id`),
    PRIMARY KEY (`review_plan_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review_plan_items` (
    `review_plan_item_id` INTEGER NOT NULL AUTO_INCREMENT,
    `review_plan_id` INTEGER NOT NULL,
    `day_no` INTEGER NULL,
    `plan_date` DATETIME(3) NULL,
    `content` TEXT NOT NULL,
    `is_completed` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `review_plan_items_review_plan_id_idx`(`review_plan_id`),
    PRIMARY KEY (`review_plan_item_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `video_resources` (
    `video_id` INTEGER NOT NULL AUTO_INCREMENT,
    `course_id` INTEGER NULL,
    `knowledge_point_id` INTEGER NULL,
    `title` VARCHAR(200) NOT NULL,
    `source` ENUM('bilibili', 'external_search', 'self_generated', 'other') NOT NULL DEFAULT 'bilibili',
    `bvid` VARCHAR(100) NULL,
    `cover_url` VARCHAR(500) NULL,
    `embed_url` VARCHAR(500) NULL,
    `original_url` VARCHAR(500) NULL,
    `duration_seconds` INTEGER NULL,
    `recommend_reason` TEXT NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `video_resources_course_id_idx`(`course_id`),
    INDEX `video_resources_knowledge_point_id_idx`(`knowledge_point_id`),
    INDEX `video_resources_source_idx`(`source`),
    PRIMARY KEY (`video_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `video_generation_tasks` (
    `video_generation_task_id` INTEGER NOT NULL AUTO_INCREMENT,
    `course_id` INTEGER NULL,
    `knowledge_point_id` INTEGER NULL,
    `created_by_user_id` INTEGER NOT NULL,
    `script_prompt` TEXT NOT NULL,
    `style` VARCHAR(100) NULL,
    `voice_type` VARCHAR(50) NULL,
    `status` ENUM('pending', 'generating', 'success', 'failed') NOT NULL DEFAULT 'pending',
    `result_url` VARCHAR(500) NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `video_generation_tasks_course_id_idx`(`course_id`),
    INDEX `video_generation_tasks_knowledge_point_id_idx`(`knowledge_point_id`),
    INDEX `video_generation_tasks_status_idx`(`status`),
    PRIMARY KEY (`video_generation_task_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_model_configs` (
    `ai_model_config_id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(50) NOT NULL,
    `model_name` VARCHAR(100) NOT NULL,
    `base_url` VARCHAR(500) NULL,
    `api_key_encrypted` TEXT NULL,
    `max_context_length` INTEGER NULL,
    `temperature` DOUBLE NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `usage_type` ENUM('qa', 'summary', 'question_generation', 'grading', 'recommendation', 'embedding', 'safety') NOT NULL,
    `daily_call_limit` INTEGER NULL,
    `single_user_daily_limit` INTEGER NULL,
    `token_budget` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_model_configs_provider_idx`(`provider`),
    INDEX `ai_model_configs_usage_type_idx`(`usage_type`),
    INDEX `ai_model_configs_enabled_idx`(`enabled`),
    PRIMARY KEY (`ai_model_config_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_agent_configs` (
    `agent_config_id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_type` ENUM('course_qa', 'learning_analysis', 'personalized_recommendation', 'question_generation', 'document_summary') NOT NULL,
    `agent_name` VARCHAR(100) NOT NULL,
    `dify_base_url` VARCHAR(500) NULL,
    `dify_api_key_encrypted` TEXT NULL,
    `dify_app_id` VARCHAR(255) NULL,
    `dify_workflow_id` VARCHAR(255) NULL,
    `dify_dataset_id` VARCHAR(255) NULL,
    `response_mode` VARCHAR(20) NOT NULL DEFAULT 'blocking',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_agent_configs_agent_type_idx`(`agent_type`),
    INDEX `ai_agent_configs_enabled_idx`(`enabled`),
    PRIMARY KEY (`agent_config_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_run_records` (
    `agent_run_id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_config_id` INTEGER NULL,
    `user_id` INTEGER NULL,
    `agent_type` ENUM('course_qa', 'learning_analysis', 'personalized_recommendation', 'question_generation', 'document_summary') NOT NULL,
    `course_id` INTEGER NULL,
    `student_user_id` INTEGER NULL,
    `input_json` JSON NULL,
    `output_json` JSON NULL,
    `status` ENUM('pending', 'running', 'success', 'failed', 'stopped') NOT NULL DEFAULT 'pending',
    `error_message` TEXT NULL,
    `dify_workflow_run_id` VARCHAR(255) NULL,
    `response_time_ms` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_run_records_agent_type_idx`(`agent_type`),
    INDEX `agent_run_records_user_id_idx`(`user_id`),
    INDEX `agent_run_records_status_idx`(`status`),
    PRIMARY KEY (`agent_run_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_call_logs` (
    `ai_call_log_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `provider` VARCHAR(50) NOT NULL,
    `model_name` VARCHAR(100) NULL,
    `usage_type` ENUM('qa', 'summary', 'question_generation', 'grading', 'recommendation', 'embedding', 'safety') NOT NULL,
    `prompt_tokens` INTEGER NULL,
    `completion_tokens` INTEGER NULL,
    `total_tokens` INTEGER NULL,
    `status` ENUM('pending', 'running', 'success', 'failed', 'stopped') NOT NULL,
    `response_time_ms` INTEGER NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_call_logs_user_id_idx`(`user_id`),
    INDEX `ai_call_logs_provider_idx`(`provider`),
    INDEX `ai_call_logs_usage_type_idx`(`usage_type`),
    INDEX `ai_call_logs_status_idx`(`status`),
    PRIMARY KEY (`ai_call_log_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_summary_records` (
    `summary_id` INTEGER NOT NULL AUTO_INCREMENT,
    `document_id` INTEGER NOT NULL,
    `summary_type` VARCHAR(50) NOT NULL,
    `summary_content` TEXT NOT NULL,
    `is_ai_generated` BOOLEAN NOT NULL DEFAULT true,
    `ai_provider` VARCHAR(50) NULL,
    `model_name` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `document_summary_records_document_id_idx`(`document_id`),
    INDEX `document_summary_records_summary_type_idx`(`summary_type`),
    PRIMARY KEY (`summary_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `notification_id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiver_user_id` INTEGER NOT NULL,
    `sender_user_id` INTEGER NULL,
    `notification_type` ENUM('task_published', 'task_deadline', 'document_review', 'document_parsed', 'ai_grading_done', 'system_notice') NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` TEXT NULL,
    `target_type` VARCHAR(50) NULL,
    `target_id` INTEGER NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_receiver_user_id_idx`(`receiver_user_id`),
    INDEX `notifications_notification_type_idx`(`notification_type`),
    INDEX `notifications_is_read_idx`(`is_read`),
    PRIMARY KEY (`notification_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `operation_logs` (
    `operation_log_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `role` ENUM('admin', 'teacher', 'student') NULL,
    `operation_type` VARCHAR(100) NOT NULL,
    `operation_desc` TEXT NULL,
    `target_type` VARCHAR(50) NULL,
    `target_id` INTEGER NULL,
    `ip_address` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `operation_logs_user_id_idx`(`user_id`),
    INDEX `operation_logs_operation_type_idx`(`operation_type`),
    INDEX `operation_logs_target_type_idx`(`target_type`),
    PRIMARY KEY (`operation_log_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feedback_records` (
    `feedback_record_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `message_id` INTEGER NULL,
    `feedback_type` ENUM('incorrect', 'unclear', 'no_source', 'unsafe', 'helpful', 'other') NOT NULL,
    `content` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `feedback_records_user_id_idx`(`user_id`),
    INDEX `feedback_records_message_id_idx`(`message_id`),
    INDEX `feedback_records_feedback_type_idx`(`feedback_type`),
    PRIMARY KEY (`feedback_record_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `safety_check_records` (
    `safety_check_id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `content_hash` VARCHAR(255) NULL,
    `check_type` VARCHAR(50) NOT NULL,
    `safe` BOOLEAN NOT NULL DEFAULT true,
    `risk_level` VARCHAR(20) NULL,
    `risk_tags` JSON NULL,
    `suggestion` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `safety_check_records_user_id_idx`(`user_id`),
    INDEX `safety_check_records_check_type_idx`(`check_type`),
    INDEX `safety_check_records_safe_idx`(`safe`),
    PRIMARY KEY (`safety_check_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_configs` (
    `config_id` INTEGER NOT NULL AUTO_INCREMENT,
    `config_key` VARCHAR(100) NOT NULL,
    `config_value` JSON NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `system_configs_config_key_key`(`config_key`),
    PRIMARY KEY (`config_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_admin_class_id_fkey` FOREIGN KEY (`admin_class_id`) REFERENCES `admin_classes`(`admin_class_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_teacher_relations` ADD CONSTRAINT `course_teacher_relations_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_teacher_relations` ADD CONSTRAINT `course_teacher_relations_teacher_user_id_fkey` FOREIGN KEY (`teacher_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teaching_classes` ADD CONSTRAINT `teaching_classes_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_course_enrollments` ADD CONSTRAINT `student_course_enrollments_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_course_enrollments` ADD CONSTRAINT `student_course_enrollments_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_course_enrollments` ADD CONSTRAINT `student_course_enrollments_teaching_class_id_fkey` FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chapters` ADD CONSTRAINT `chapters_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_points` ADD CONSTRAINT `knowledge_points_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_points` ADD CONSTRAINT `knowledge_points_chapter_id_fkey` FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`chapter_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_points` ADD CONSTRAINT `knowledge_points_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_point_aliases` ADD CONSTRAINT `knowledge_point_aliases_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_bases` ADD CONSTRAINT `knowledge_bases_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_bases` ADD CONSTRAINT `knowledge_bases_teaching_class_id_fkey` FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_bases` ADD CONSTRAINT `knowledge_bases_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_documents` ADD CONSTRAINT `knowledge_documents_knowledge_base_id_fkey` FOREIGN KEY (`knowledge_base_id`) REFERENCES `knowledge_bases`(`knowledge_base_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_documents` ADD CONSTRAINT `knowledge_documents_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_documents` ADD CONSTRAINT `knowledge_documents_teaching_class_id_fkey` FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_documents` ADD CONSTRAINT `knowledge_documents_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_documents` ADD CONSTRAINT `knowledge_documents_reviewer_user_id_fkey` FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_document_chunks` ADD CONSTRAINT `knowledge_document_chunks_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`document_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_document_reviews` ADD CONSTRAINT `knowledge_document_reviews_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`document_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_document_reviews` ADD CONSTRAINT `knowledge_document_reviews_reviewer_user_id_fkey` FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_conversations` ADD CONSTRAINT `chat_conversations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_conversations` ADD CONSTRAINT `chat_conversations_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_conversations` ADD CONSTRAINT `chat_conversations_teaching_class_id_fkey` FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`conversation_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_sources` ADD CONSTRAINT `message_sources_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`message_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_sources` ADD CONSTRAINT `message_sources_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`document_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_sources` ADD CONSTRAINT `message_sources_chunk_id_fkey` FOREIGN KEY (`chunk_id`) REFERENCES `knowledge_document_chunks`(`chunk_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_question_records` ADD CONSTRAINT `student_question_records_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_question_records` ADD CONSTRAINT `student_question_records_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_question_records` ADD CONSTRAINT `student_question_records_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`conversation_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_question_records` ADD CONSTRAINT `student_question_records_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`message_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_analysis_records` ADD CONSTRAINT `question_analysis_records_student_question_id_fkey` FOREIGN KEY (`student_question_id`) REFERENCES `student_question_records`(`student_question_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_analysis_records` ADD CONSTRAINT `question_analysis_records_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_analysis_records` ADD CONSTRAINT `question_analysis_records_reviewed_by_user_id_fkey` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_keywords` ADD CONSTRAINT `question_keywords_analysis_id_fkey` FOREIGN KEY (`analysis_id`) REFERENCES `question_analysis_records`(`analysis_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_confusion_tags` ADD CONSTRAINT `question_confusion_tags_analysis_id_fkey` FOREIGN KEY (`analysis_id`) REFERENCES `question_analysis_records`(`analysis_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_knowledge_point_mappings` ADD CONSTRAINT `question_knowledge_point_mappings_analysis_id_fkey` FOREIGN KEY (`analysis_id`) REFERENCES `question_analysis_records`(`analysis_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_knowledge_point_mappings` ADD CONSTRAINT `question_knowledge_point_mappings_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_options` ADD CONSTRAINT `question_options_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `questions`(`question_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_tasks` ADD CONSTRAINT `learning_tasks_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_tasks` ADD CONSTRAINT `learning_tasks_teaching_class_id_fkey` FOREIGN KEY (`teaching_class_id`) REFERENCES `teaching_classes`(`teaching_class_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_tasks` ADD CONSTRAINT `learning_tasks_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_questions` ADD CONSTRAINT `task_questions_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `learning_tasks`(`task_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_questions` ADD CONSTRAINT `task_questions_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `questions`(`question_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_knowledge_points` ADD CONSTRAINT `task_knowledge_points_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `learning_tasks`(`task_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_knowledge_points` ADD CONSTRAINT `task_knowledge_points_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_submissions` ADD CONSTRAINT `task_submissions_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `learning_tasks`(`task_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_submissions` ADD CONSTRAINT `task_submissions_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `answer_records` ADD CONSTRAINT `answer_records_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `answer_records` ADD CONSTRAINT `answer_records_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `questions`(`question_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `answer_records` ADD CONSTRAINT `answer_records_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `learning_tasks`(`task_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `answer_records` ADD CONSTRAINT `answer_records_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `task_submissions`(`submission_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_grading_records` ADD CONSTRAINT `ai_grading_records_answer_record_id_fkey` FOREIGN KEY (`answer_record_id`) REFERENCES `answer_records`(`answer_record_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `programming_submissions` ADD CONSTRAINT `programming_submissions_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `questions`(`question_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `programming_submissions` ADD CONSTRAINT `programming_submissions_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wrong_questions` ADD CONSTRAINT `wrong_questions_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wrong_questions` ADD CONSTRAINT `wrong_questions_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `questions`(`question_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wrong_questions` ADD CONSTRAINT `wrong_questions_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wrong_questions` ADD CONSTRAINT `wrong_questions_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `study_records` ADD CONSTRAINT `study_records_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `study_records` ADD CONSTRAINT `study_records_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `study_records` ADD CONSTRAINT `study_records_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_mastery_records` ADD CONSTRAINT `student_mastery_records_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_mastery_records` ADD CONSTRAINT `student_mastery_records_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_mastery_records` ADD CONSTRAINT `student_mastery_records_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_portraits` ADD CONSTRAINT `student_portraits_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_portraits` ADD CONSTRAINT `student_portraits_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_portrait_snapshots` ADD CONSTRAINT `student_portrait_snapshots_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_portrait_snapshots` ADD CONSTRAINT `student_portrait_snapshots_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_research_profiles` ADD CONSTRAINT `student_research_profiles_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_research_profiles` ADD CONSTRAINT `student_research_profiles_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_competition_profiles` ADD CONSTRAINT `student_competition_profiles_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_competition_profiles` ADD CONSTRAINT `student_competition_profiles_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recommendation_records` ADD CONSTRAINT `recommendation_records_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recommendation_records` ADD CONSTRAINT `recommendation_records_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recommendation_records` ADD CONSTRAINT `recommendation_records_generated_by_agent_run_id_fkey` FOREIGN KEY (`generated_by_agent_run_id`) REFERENCES `agent_run_records`(`agent_run_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recommendation_items` ADD CONSTRAINT `recommendation_items_recommendation_record_id_fkey` FOREIGN KEY (`recommendation_record_id`) REFERENCES `recommendation_records`(`recommendation_record_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_paths` ADD CONSTRAINT `learning_paths_recommendation_record_id_fkey` FOREIGN KEY (`recommendation_record_id`) REFERENCES `recommendation_records`(`recommendation_record_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_paths` ADD CONSTRAINT `learning_paths_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_paths` ADD CONSTRAINT `learning_paths_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_path_steps` ADD CONSTRAINT `learning_path_steps_learning_path_id_fkey` FOREIGN KEY (`learning_path_id`) REFERENCES `learning_paths`(`learning_path_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `learning_path_steps` ADD CONSTRAINT `learning_path_steps_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_plans` ADD CONSTRAINT `review_plans_recommendation_record_id_fkey` FOREIGN KEY (`recommendation_record_id`) REFERENCES `recommendation_records`(`recommendation_record_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_plans` ADD CONSTRAINT `review_plans_student_user_id_fkey` FOREIGN KEY (`student_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_plans` ADD CONSTRAINT `review_plans_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_plan_items` ADD CONSTRAINT `review_plan_items_review_plan_id_fkey` FOREIGN KEY (`review_plan_id`) REFERENCES `review_plans`(`review_plan_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_resources` ADD CONSTRAINT `video_resources_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_resources` ADD CONSTRAINT `video_resources_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_resources` ADD CONSTRAINT `video_resources_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_generation_tasks` ADD CONSTRAINT `video_generation_tasks_course_id_fkey` FOREIGN KEY (`course_id`) REFERENCES `courses`(`course_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_generation_tasks` ADD CONSTRAINT `video_generation_tasks_knowledge_point_id_fkey` FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`knowledge_point_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_generation_tasks` ADD CONSTRAINT `video_generation_tasks_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_run_records` ADD CONSTRAINT `agent_run_records_agent_config_id_fkey` FOREIGN KEY (`agent_config_id`) REFERENCES `ai_agent_configs`(`agent_config_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_run_records` ADD CONSTRAINT `agent_run_records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_call_logs` ADD CONSTRAINT `ai_call_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_summary_records` ADD CONSTRAINT `document_summary_records_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`document_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_receiver_user_id_fkey` FOREIGN KEY (`receiver_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_sender_user_id_fkey` FOREIGN KEY (`sender_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `operation_logs` ADD CONSTRAINT `operation_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feedback_records` ADD CONSTRAINT `feedback_records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feedback_records` ADD CONSTRAINT `feedback_records_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`message_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `safety_check_records` ADD CONSTRAINT `safety_check_records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;
