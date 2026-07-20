-- Student course experience: explicit course pinning is per enrollment.
ALTER TABLE `student_course_enrollments`
  ADD COLUMN `is_pinned` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `pinned_at` DATETIME(3) NULL;

CREATE INDEX `student_course_enrollments_student_pinned_idx`
  ON `student_course_enrollments`(`student_user_id`, `is_pinned`, `pinned_at`);
