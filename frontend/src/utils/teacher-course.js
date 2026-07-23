export function teacherCourseLabel(course) {
  const name = String(course?.course_name || '未命名课程')
  const code = String(course?.course_code || '').trim()
  return code ? `${name}（${code}）` : name
}
