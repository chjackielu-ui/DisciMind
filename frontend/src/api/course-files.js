import { get, post, patch, del, request, BASE_URL } from './request.js'
import { getToken } from '../utils/auth.js'

const base = (courseId, classId) => `/courses/${courseId}/teaching-classes/${classId}/files`

export const getCourseFiles = (courseId, classId, params = {}) => get(base(courseId, classId), { params })
export const uploadCourseFile = (courseId, classId, formData) => request(base(courseId, classId), { method: 'POST', body: formData })
export const updateCourseFile = (courseId, classId, fileId, data) => patch(`${base(courseId, classId)}/${fileId}`, data)
export const publishCourseFile = (courseId, classId, fileId) => post(`${base(courseId, classId)}/${fileId}/publish`, {})
export const unpublishCourseFile = (courseId, classId, fileId) => post(`${base(courseId, classId)}/${fileId}/unpublish`, {})
export const deleteCourseFile = (courseId, classId, fileId) => del(`${base(courseId, classId)}/${fileId}`)

export async function downloadCourseFile(courseId, classId, fileId, fallbackName = 'course-file') {
  const response = await fetch(`${BASE_URL}${base(courseId, classId)}/${fileId}/download`, {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    credentials: 'include',
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || '课程文件下载失败')
  }
  const disposition = response.headers.get('content-disposition') || ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  let filename = fallbackName
  try { filename = decodeURIComponent(encoded || plain || fallbackName) } catch {}
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
