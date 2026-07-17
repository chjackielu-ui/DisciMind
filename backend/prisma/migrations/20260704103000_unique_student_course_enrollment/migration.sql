-- Keep one enrollment per student/course before adding the unique constraint.
-- If a student was inserted into two teaching classes for the same course,
-- the latest enrollment_id is kept and older duplicates are removed.
DELETE old_enrollment
FROM student_course_enrollments AS old_enrollment
INNER JOIN student_course_enrollments AS newer_enrollment
  ON old_enrollment.student_user_id = newer_enrollment.student_user_id
  AND old_enrollment.course_id = newer_enrollment.course_id
  AND old_enrollment.enrollment_id < newer_enrollment.enrollment_id;

ALTER TABLE student_course_enrollments
  ADD UNIQUE INDEX student_course_enrollments_student_user_id_course_id_key (student_user_id, course_id);
