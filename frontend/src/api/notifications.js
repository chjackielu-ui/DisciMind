import { get, put, del } from './request.js'

export function getUserNotifications(params = {}) { return get('/notifications', { params }) }
export function getUserUnreadCount() { return get('/notifications/unread-count') }
export function readUserNotification(id) { return put(`/notifications/${id}/read`) }
export function readAllUserNotifications() { return put('/notifications/read-all') }
export function deleteUserNotifications(ids) { return del('/notifications', { body: JSON.stringify({ notification_ids: ids }) }) }
