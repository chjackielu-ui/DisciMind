#!/usr/bin/env python3
"""Read-only database integrity checks for DisciMind admin recovery.

The program reads repository metadata and executes a fixed allow-list of
aggregate SELECT statements through the backend's existing Prisma client.  It
never returns row samples and never renders environment values.  Exit codes:

* 0: no critical failures (warnings may exist)
* 1: one or more critical integrity failures, or --strict-warnings fired
* 2: the harness itself could not run safely
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


MARKER = "__ADMIN_DB_INTEGRITY_JSON__"
FORBIDDEN_SQL = re.compile(
    r"\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|CALL|LOAD|LOCK|UNLOCK|GRANT|REVOKE)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Invariant:
    key: str
    group: str
    severity: str
    label: str
    expectation: str
    requires: tuple[tuple[str, tuple[str, ...]], ...]
    sql: str


@dataclass
class Finding:
    group: str
    check_id: str
    severity: str
    status: str
    label: str
    observed: str
    expectation: str
    note: str = ""


def req(table: str, *columns: str) -> tuple[tuple[str, tuple[str, ...]], ...]:
    return ((table, tuple(columns)),)


def reqs(*items: tuple[str, tuple[str, ...]]) -> tuple[tuple[str, tuple[str, ...]], ...]:
    return tuple(items)


INVARIANTS: tuple[Invariant, ...] = (
    # Users and admin RBAC.
    Invariant("users.active_admin", "Users and RBAC", "critical", "Active administrator exists", "zero missing-admin markers", req("users", "role", "status"), "SELECT IF(EXISTS(SELECT 1 FROM users WHERE role = 'admin' AND status = 'active'), 0, 1) AS count"),
    Invariant("users.blank_username", "Users and RBAC", "critical", "Usernames are nonblank", "0 invalid rows", req("users", "username"), "SELECT COUNT(*) AS count FROM users WHERE TRIM(username) = ''"),
    Invariant("users.duplicate_username", "Users and RBAC", "critical", "Normalized usernames are unique", "0 duplicate groups", req("users", "username"), "SELECT COUNT(*) AS count FROM (SELECT LOWER(TRIM(username)) AS normalized_value FROM users GROUP BY LOWER(TRIM(username)) HAVING COUNT(*) > 1) AS duplicate_groups"),
    Invariant("users.duplicate_email", "Users and RBAC", "critical", "Normalized nonblank emails are unique", "0 duplicate groups", req("users", "email"), "SELECT COUNT(*) AS count FROM (SELECT LOWER(TRIM(email)) AS normalized_value FROM users WHERE email IS NOT NULL AND TRIM(email) <> '' GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1) AS duplicate_groups"),
    Invariant("users.duplicate_phone", "Users and RBAC", "critical", "Normalized nonblank phones are unique", "0 duplicate groups", req("users", "phone"), "SELECT COUNT(*) AS count FROM (SELECT TRIM(phone) AS normalized_value FROM users WHERE phone IS NOT NULL AND TRIM(phone) <> '' GROUP BY TRIM(phone) HAVING COUNT(*) > 1) AS duplicate_groups"),
    Invariant("users.invalid_state", "Users and RBAC", "critical", "User role and status values are valid", "0 invalid rows", req("users", "role", "status"), "SELECT COUNT(*) AS count FROM users WHERE role NOT IN ('admin', 'teacher', 'student') OR status NOT IN ('active', 'disabled')"),
    Invariant("users.orphan_profile", "Users and RBAC", "critical", "Profiles reference existing users", "0 orphan rows", reqs(("user_profiles", ("user_id",)), ("users", ("user_id",))), "SELECT COUNT(*) AS count FROM user_profiles p LEFT JOIN users u ON u.user_id = p.user_id WHERE u.user_id IS NULL"),
    Invariant("users.orphan_profile_class", "Users and RBAC", "critical", "Profile class links resolve", "0 orphan rows", reqs(("user_profiles", ("admin_class_id",)), ("admin_classes", ("admin_class_id",))), "SELECT COUNT(*) AS count FROM user_profiles p LEFT JOIN admin_classes c ON c.admin_class_id = p.admin_class_id WHERE p.admin_class_id IS NOT NULL AND c.admin_class_id IS NULL"),
    Invariant("rbac.orphan_user_role_user", "Users and RBAC", "critical", "Admin-role assignments reference users", "0 orphan rows", reqs(("admin_user_roles", ("user_id",)), ("users", ("user_id",))), "SELECT COUNT(*) AS count FROM admin_user_roles ur LEFT JOIN users u ON u.user_id = ur.user_id WHERE u.user_id IS NULL"),
    Invariant("rbac.orphan_user_role_role", "Users and RBAC", "critical", "Admin-role assignments reference roles", "0 orphan rows", reqs(("admin_user_roles", ("role_id",)), ("admin_roles", ("id",))), "SELECT COUNT(*) AS count FROM admin_user_roles ur LEFT JOIN admin_roles r ON r.id = ur.role_id WHERE r.id IS NULL"),
    Invariant("rbac.orphan_role_permission", "Users and RBAC", "critical", "Role-permission assignments resolve", "0 orphan rows", reqs(("admin_role_permissions", ("role_id", "permission_id")), ("admin_roles", ("id",)), ("admin_permissions", ("id",))), "SELECT COUNT(*) AS count FROM admin_role_permissions rp LEFT JOIN admin_roles r ON r.id = rp.role_id LEFT JOIN admin_permissions p ON p.id = rp.permission_id WHERE r.id IS NULL OR p.id IS NULL"),
    Invariant("rbac.role_identity", "Users and RBAC", "critical", "Role codes are present, normalized-unique, and valid", "0 invalid or duplicate groups", req("admin_roles", "role_code", "enabled"), "SELECT (SELECT COUNT(*) FROM admin_roles WHERE TRIM(role_code) = '' OR enabled NOT IN (0, 1)) + (SELECT COUNT(*) FROM (SELECT LOWER(TRIM(role_code)) AS normalized_value FROM admin_roles GROUP BY LOWER(TRIM(role_code)) HAVING COUNT(*) > 1) AS d) AS count"),
    Invariant("rbac.permission_identity", "Users and RBAC", "critical", "Permission keys are present, normalized-unique, and valid", "0 invalid or duplicate groups", req("admin_permissions", "permission_key", "sensitive"), "SELECT (SELECT COUNT(*) FROM admin_permissions WHERE TRIM(permission_key) = '' OR `sensitive` NOT IN (0, 1)) + (SELECT COUNT(*) FROM (SELECT LOWER(TRIM(permission_key)) AS normalized_value FROM admin_permissions GROUP BY LOWER(TRIM(permission_key)) HAVING COUNT(*) > 1) AS d) AS count"),
    Invariant("rbac.duplicate_assignments", "Users and RBAC", "critical", "RBAC assignments are unique", "0 duplicate groups", reqs(("admin_user_roles", ("user_id", "role_id")), ("admin_role_permissions", ("role_id", "permission_id"))), "SELECT (SELECT COUNT(*) FROM (SELECT user_id, role_id FROM admin_user_roles GROUP BY user_id, role_id HAVING COUNT(*) > 1) AS a) + (SELECT COUNT(*) FROM (SELECT role_id, permission_id FROM admin_role_permissions GROUP BY role_id, permission_id HAVING COUNT(*) > 1) AS b) AS count"),
    Invariant("rbac.admin_without_assignment", "Users and RBAC", "warning", "Active admins have an enabled, unexpired RBAC role", "0 uncovered admins", reqs(("users", ("user_id", "role", "status")), ("admin_user_roles", ("user_id", "role_id", "expires_at")), ("admin_roles", ("id", "enabled"))), "SELECT COUNT(*) AS count FROM users u WHERE u.role = 'admin' AND u.status = 'active' AND NOT EXISTS (SELECT 1 FROM admin_user_roles ur JOIN admin_roles r ON r.id = ur.role_id AND r.enabled = 1 WHERE ur.user_id = u.user_id AND (ur.expires_at IS NULL OR ur.expires_at > UTC_TIMESTAMP()))"),
    Invariant("rbac.disabled_role_assignment", "Users and RBAC", "warning", "Unexpired assignments do not target disabled roles", "0 disabled-role assignments", reqs(("admin_user_roles", ("role_id", "expires_at")), ("admin_roles", ("id", "enabled"))), "SELECT COUNT(*) AS count FROM admin_user_roles ur JOIN admin_roles r ON r.id = ur.role_id WHERE r.enabled = 0 AND (ur.expires_at IS NULL OR ur.expires_at > UTC_TIMESTAMP())"),
    Invariant("rbac.enabled_role_catalog", "Users and RBAC", "warning", "At least one admin role is enabled", "zero missing-catalog markers", req("admin_roles", "enabled"), "SELECT IF(EXISTS(SELECT 1 FROM admin_roles WHERE enabled = 1), 0, 1) AS count"),
    Invariant("rbac.permission_catalog", "Users and RBAC", "warning", "Admin permission catalog is populated", "zero missing-catalog markers", req("admin_permissions", "id"), "SELECT IF(EXISTS(SELECT 1 FROM admin_permissions), 0, 1) AS count"),

    # Courses and class topology.
    Invariant("courses.blank_identity", "Courses and classes", "critical", "Courses have names and codes", "0 invalid rows", req("courses", "course_name", "course_code"), "SELECT COUNT(*) AS count FROM courses WHERE TRIM(course_name) = '' OR TRIM(course_code) = ''"),
    Invariant("courses.duplicate_code", "Courses and classes", "critical", "Normalized course codes are unique", "0 duplicate groups", req("courses", "course_code"), "SELECT COUNT(*) AS count FROM (SELECT LOWER(TRIM(course_code)) AS normalized_value FROM courses GROUP BY LOWER(TRIM(course_code)) HAVING COUNT(*) > 1) AS duplicate_groups"),
    Invariant("courses.invalid_state", "Courses and classes", "critical", "Course status values are valid", "0 invalid rows", req("courses", "status"), "SELECT COUNT(*) AS count FROM courses WHERE status NOT IN ('active', 'archived')"),
    Invariant("courses.orphan_teacher_relation", "Courses and classes", "critical", "Course-teacher relations resolve", "0 orphan rows", reqs(("course_teacher_relations", ("course_id", "teacher_user_id")), ("courses", ("course_id",)), ("users", ("user_id",))), "SELECT COUNT(*) AS count FROM course_teacher_relations x LEFT JOIN courses c ON c.course_id = x.course_id LEFT JOIN users u ON u.user_id = x.teacher_user_id WHERE c.course_id IS NULL OR u.user_id IS NULL"),
    Invariant("courses.non_teacher_relation", "Courses and classes", "warning", "Course teachers have teacher/admin role", "0 semantic mismatches", reqs(("course_teacher_relations", ("teacher_user_id",)), ("users", ("user_id", "role"))), "SELECT COUNT(*) AS count FROM course_teacher_relations x JOIN users u ON u.user_id = x.teacher_user_id WHERE u.role NOT IN ('teacher', 'admin')"),
    Invariant("classes.orphan_teaching_class", "Courses and classes", "critical", "Teaching-class references resolve", "0 orphan rows", reqs(("teaching_classes", ("course_id", "course_offering_id", "teacher_user_id")), ("courses", ("course_id",)), ("course_offerings", ("course_offering_id",)), ("users", ("user_id",))), "SELECT COUNT(*) AS count FROM teaching_classes t LEFT JOIN courses c ON c.course_id = t.course_id LEFT JOIN course_offerings o ON o.course_offering_id = t.course_offering_id LEFT JOIN users u ON u.user_id = t.teacher_user_id WHERE c.course_id IS NULL OR (t.course_offering_id IS NOT NULL AND o.course_offering_id IS NULL) OR (t.teacher_user_id IS NOT NULL AND u.user_id IS NULL)"),
    Invariant("classes.non_teacher_primary", "Courses and classes", "warning", "Primary teaching-class teachers have teacher/admin role", "0 semantic mismatches", reqs(("teaching_classes", ("teacher_user_id",)), ("users", ("user_id", "role"))), "SELECT COUNT(*) AS count FROM teaching_classes t JOIN users u ON u.user_id = t.teacher_user_id WHERE u.role NOT IN ('teacher', 'admin')"),
    Invariant("classes.invalid_state", "Courses and classes", "warning", "Class status values use the supported lifecycle", "0 uncommon rows", reqs(("teaching_classes", ("status",)), ("admin_classes", ("status",))), "SELECT (SELECT COUNT(*) FROM teaching_classes WHERE status NOT IN ('active', 'archived', 'disabled')) + (SELECT COUNT(*) FROM admin_classes WHERE status NOT IN ('active', 'archived', 'disabled')) AS count"),
    Invariant("classes.orphan_admin_class", "Courses and classes", "critical", "Administrative-class references resolve", "0 orphan rows", reqs(("admin_classes", ("advisor_user_id", "college_id", "major_id")), ("users", ("user_id",)), ("colleges", ("college_id",)), ("majors", ("major_id",))), "SELECT COUNT(*) AS count FROM admin_classes a LEFT JOIN users u ON u.user_id = a.advisor_user_id LEFT JOIN colleges c ON c.college_id = a.college_id LEFT JOIN majors m ON m.major_id = a.major_id WHERE (a.advisor_user_id IS NOT NULL AND u.user_id IS NULL) OR (a.college_id IS NOT NULL AND c.college_id IS NULL) OR (a.major_id IS NOT NULL AND m.major_id IS NULL)"),
    Invariant("classes.non_teacher_advisor", "Courses and classes", "warning", "Class advisors have teacher/admin role", "0 semantic mismatches", reqs(("admin_classes", ("advisor_user_id",)), ("users", ("user_id", "role"))), "SELECT COUNT(*) AS count FROM admin_classes a JOIN users u ON u.user_id = a.advisor_user_id WHERE u.role NOT IN ('teacher', 'admin')"),
    Invariant("classes.orphan_links", "Courses and classes", "critical", "Teaching/admin-class links resolve", "0 orphan rows", reqs(("teaching_class_admin_classes", ("teaching_class_id", "admin_class_id")), ("teaching_classes", ("teaching_class_id",)), ("admin_classes", ("admin_class_id",))), "SELECT COUNT(*) AS count FROM teaching_class_admin_classes x LEFT JOIN teaching_classes t ON t.teaching_class_id = x.teaching_class_id LEFT JOIN admin_classes a ON a.admin_class_id = x.admin_class_id WHERE t.teaching_class_id IS NULL OR a.admin_class_id IS NULL"),
    Invariant("classes.orphan_enrollment", "Courses and classes", "critical", "Enrollment references resolve", "0 orphan rows", reqs(("student_course_enrollments", ("student_user_id", "course_id", "teaching_class_id")), ("users", ("user_id",)), ("courses", ("course_id",)), ("teaching_classes", ("teaching_class_id",))), "SELECT COUNT(*) AS count FROM student_course_enrollments e LEFT JOIN users u ON u.user_id = e.student_user_id LEFT JOIN courses c ON c.course_id = e.course_id LEFT JOIN teaching_classes t ON t.teaching_class_id = e.teaching_class_id WHERE u.user_id IS NULL OR c.course_id IS NULL OR t.teaching_class_id IS NULL"),
    Invariant("classes.enrollment_course_mismatch", "Courses and classes", "critical", "Enrollment course matches its teaching class", "0 inconsistent rows", reqs(("student_course_enrollments", ("course_id", "teaching_class_id")), ("teaching_classes", ("teaching_class_id", "course_id"))), "SELECT COUNT(*) AS count FROM student_course_enrollments e JOIN teaching_classes t ON t.teaching_class_id = e.teaching_class_id WHERE e.course_id <> t.course_id"),
    Invariant("classes.non_student_enrollment", "Courses and classes", "warning", "Enrolled users have student role", "0 semantic mismatches", reqs(("student_course_enrollments", ("student_user_id",)), ("users", ("user_id", "role"))), "SELECT COUNT(*) AS count FROM student_course_enrollments e JOIN users u ON u.user_id = e.student_user_id WHERE u.role <> 'student'"),
    Invariant("classes.duplicate_topology", "Courses and classes", "critical", "Class topology rows are unique", "0 duplicate groups", reqs(("teaching_class_admin_classes", ("teaching_class_id", "admin_class_id")), ("student_course_enrollments", ("student_user_id", "course_id", "teaching_class_id")), ("teaching_classes", ("course_id", "teaching_class_name")), ("admin_classes", ("class_name", "grade"))), "SELECT (SELECT COUNT(*) FROM (SELECT teaching_class_id, admin_class_id FROM teaching_class_admin_classes GROUP BY teaching_class_id, admin_class_id HAVING COUNT(*) > 1) AS a) + (SELECT COUNT(*) FROM (SELECT student_user_id, course_id, teaching_class_id FROM student_course_enrollments GROUP BY student_user_id, course_id, teaching_class_id HAVING COUNT(*) > 1) AS b) + (SELECT COUNT(*) FROM (SELECT course_id, LOWER(TRIM(teaching_class_name)) AS normalized_name FROM teaching_classes GROUP BY course_id, LOWER(TRIM(teaching_class_name)) HAVING COUNT(*) > 1) AS c) + (SELECT COUNT(*) FROM (SELECT LOWER(TRIM(class_name)) AS normalized_name, LOWER(TRIM(COALESCE(grade, ''))) AS normalized_grade FROM admin_classes GROUP BY LOWER(TRIM(class_name)), LOWER(TRIM(COALESCE(grade, ''))) HAVING COUNT(*) > 1) AS d) AS count"),

    # Notifications.
    Invariant("notifications.orphan_user", "Notifications", "critical", "Notification sender/receiver references resolve", "0 orphan rows", reqs(("notifications", ("receiver_user_id", "sender_user_id")), ("users", ("user_id",))), "SELECT COUNT(*) AS count FROM notifications n LEFT JOIN users r ON r.user_id = n.receiver_user_id LEFT JOIN users s ON s.user_id = n.sender_user_id WHERE r.user_id IS NULL OR (n.sender_user_id IS NOT NULL AND s.user_id IS NULL)"),
    Invariant("notifications.duplicate_idempotency", "Notifications", "critical", "Notification idempotency keys are unique", "0 duplicate groups", req("notifications", "idempotency_key"), "SELECT COUNT(*) AS count FROM (SELECT idempotency_key FROM notifications WHERE idempotency_key IS NOT NULL AND TRIM(idempotency_key) <> '' GROUP BY idempotency_key HAVING COUNT(*) > 1) AS duplicate_groups"),
    Invariant("notifications.blank_title", "Notifications", "critical", "Notification titles are nonblank", "0 invalid rows", req("notifications", "title"), "SELECT COUNT(*) AS count FROM notifications WHERE TRIM(title) = ''"),
    Invariant("notifications.read_state", "Notifications", "warning", "Read flags and timestamps agree", "0 inconsistent rows", req("notifications", "is_read", "read_at"), "SELECT COUNT(*) AS count FROM notifications WHERE (is_read = 1 AND read_at IS NULL) OR (is_read = 0 AND read_at IS NOT NULL)"),

    # Administrative audit log.
    Invariant("logs.orphan_user", "Operation logs", "critical", "Operation-log user references resolve", "0 orphan rows", reqs(("operation_logs", ("user_id",)), ("users", ("user_id",))), "SELECT COUNT(*) AS count FROM operation_logs l LEFT JOIN users u ON u.user_id = l.user_id WHERE l.user_id IS NOT NULL AND u.user_id IS NULL"),
    Invariant("logs.blank_operation", "Operation logs", "critical", "Operation types are nonblank", "0 invalid rows", req("operation_logs", "operation_type"), "SELECT COUNT(*) AS count FROM operation_logs WHERE TRIM(operation_type) = ''"),
    Invariant("logs.invalid_state", "Operation logs", "warning", "Action status values are recognized", "0 uncommon rows", req("operation_logs", "action_status"), "SELECT COUNT(*) AS count FROM operation_logs WHERE action_status NOT IN ('success', 'failed')"),
    Invariant("logs.failed_without_reason", "Operation logs", "warning", "Failed operations record a reason", "0 incomplete rows", req("operation_logs", "action_status", "failure_reason"), "SELECT COUNT(*) AS count FROM operation_logs WHERE action_status = 'failed' AND (failure_reason IS NULL OR TRIM(failure_reason) = '')"),

    # AI provider/model/agent configuration. Secret contents are never selected.
    Invariant("ai.provider_identity", "AI configuration", "critical", "AI provider codes are present and unique", "0 invalid or duplicate groups", req("ai_providers", "provider_code"), "SELECT (SELECT COUNT(*) FROM ai_providers WHERE TRIM(provider_code) = '') + (SELECT COUNT(*) FROM (SELECT LOWER(TRIM(provider_code)) AS normalized_value FROM ai_providers GROUP BY LOWER(TRIM(provider_code)) HAVING COUNT(*) > 1) AS d) AS count"),
    Invariant("ai.provider_state", "AI configuration", "warning", "Provider state values are recognized", "0 uncommon rows", req("ai_providers", "provider_type", "auth_type", "connection_status", "source_type", "enabled"), "SELECT COUNT(*) AS count FROM ai_providers WHERE provider_type NOT IN ('bailian', 'qwen', 'deepseek', 'spark', 'openai_compatible', 'dify', 'custom') OR auth_type NOT IN ('bearer', 'api_key_header', 'none') OR connection_status NOT IN ('unchecked', 'available', 'unavailable') OR source_type NOT IN ('database', 'environment', 'mixed') OR enabled NOT IN (0, 1)"),
    Invariant("ai.secret_tuple", "AI configuration", "critical", "Encrypted provider secret tuples are complete", "0 incomplete rows", req("ai_providers", "secret_ciphertext", "secret_iv", "secret_auth_tag"), "SELECT COUNT(*) AS count FROM ai_providers WHERE (secret_ciphertext IS NOT NULL OR secret_iv IS NOT NULL OR secret_auth_tag IS NOT NULL) AND (secret_ciphertext IS NULL OR secret_iv IS NULL OR secret_auth_tag IS NULL)"),
    Invariant("ai.secret_metadata", "AI configuration", "warning", "Provider secret metadata is structurally plausible", "0 suspicious rows", req("ai_providers", "secret_ciphertext", "secret_iv", "secret_auth_tag", "secret_last_four"), "SELECT COUNT(*) AS count FROM ai_providers WHERE (secret_ciphertext IS NOT NULL AND CHAR_LENGTH(secret_ciphertext) < 8) OR (secret_iv IS NOT NULL AND CHAR_LENGTH(secret_iv) < 8) OR (secret_auth_tag IS NOT NULL AND CHAR_LENGTH(secret_auth_tag) < 8) OR (secret_last_four IS NOT NULL AND CHAR_LENGTH(secret_last_four) > 8)"),
    Invariant("ai.encrypted_provider_secret_count", "AI configuration", "internal", "Encrypted provider secret count", "informational", req("ai_providers", "secret_ciphertext", "secret_iv", "secret_auth_tag"), "SELECT COUNT(*) AS count FROM ai_providers WHERE secret_ciphertext IS NOT NULL AND secret_iv IS NOT NULL AND secret_auth_tag IS NOT NULL"),
    Invariant("ai.model_orphan_provider", "AI configuration", "critical", "AI model provider references resolve", "0 orphan rows", reqs(("ai_model_configs", ("provider_id",)), ("ai_providers", ("id",))), "SELECT COUNT(*) AS count FROM ai_model_configs m LEFT JOIN ai_providers p ON p.id = m.provider_id WHERE m.provider_id IS NOT NULL AND p.id IS NULL"),
    Invariant("ai.model_identity", "AI configuration", "critical", "AI models have usable identifiers", "0 invalid rows", req("ai_model_configs", "provider", "model_name", "model_code", "provider_id"), "SELECT COUNT(*) AS count FROM ai_model_configs WHERE TRIM(provider) = '' OR TRIM(model_name) = '' OR (provider_id IS NOT NULL AND (model_code IS NULL OR TRIM(model_code) = ''))"),
    Invariant("ai.model_duplicate", "AI configuration", "critical", "Provider/model-code pairs are unique", "0 duplicate groups", req("ai_model_configs", "provider_id", "model_code"), "SELECT COUNT(*) AS count FROM (SELECT provider_id, LOWER(TRIM(model_code)) AS normalized_code FROM ai_model_configs WHERE provider_id IS NOT NULL AND model_code IS NOT NULL AND TRIM(model_code) <> '' GROUP BY provider_id, LOWER(TRIM(model_code)) HAVING COUNT(*) > 1) AS duplicate_groups"),
    Invariant("ai.model_state", "AI configuration", "warning", "Model type, usage, and flags are recognized", "0 uncommon rows", req("ai_model_configs", "model_type", "usage_type", "enabled", "is_default"), "SELECT COUNT(*) AS count FROM ai_model_configs WHERE model_type NOT IN ('chat', 'reasoning', 'embedding', 'rerank', 'vision', 'speech', 'image', 'workflow') OR usage_type NOT IN ('qa', 'summary', 'question_generation', 'grading', 'recommendation', 'embedding', 'safety') OR enabled NOT IN (0, 1) OR is_default NOT IN (0, 1)"),
    Invariant("ai.multiple_default_model", "AI configuration", "warning", "Each provider/model type has at most one enabled default", "0 ambiguous groups", req("ai_model_configs", "provider_id", "provider", "model_type", "enabled", "is_default"), "SELECT COUNT(*) AS count FROM (SELECT COALESCE(CAST(provider_id AS CHAR), CONCAT('legacy:', LOWER(TRIM(provider)))) AS provider_scope, model_type FROM ai_model_configs WHERE enabled = 1 AND is_default = 1 GROUP BY COALESCE(CAST(provider_id AS CHAR), CONCAT('legacy:', LOWER(TRIM(provider)))), model_type HAVING COUNT(*) > 1) AS duplicate_groups"),
    Invariant("ai.agent_orphan_binding", "AI configuration", "critical", "AI agent provider/model references resolve", "0 orphan rows", reqs(("ai_agent_configs", ("provider_id", "model_config_id")), ("ai_providers", ("id",)), ("ai_model_configs", ("ai_model_config_id",))), "SELECT COUNT(*) AS count FROM ai_agent_configs a LEFT JOIN ai_providers p ON p.id = a.provider_id LEFT JOIN ai_model_configs m ON m.ai_model_config_id = a.model_config_id WHERE (a.provider_id IS NOT NULL AND p.id IS NULL) OR (a.model_config_id IS NOT NULL AND m.ai_model_config_id IS NULL)"),
    Invariant("ai.agent_provider_mismatch", "AI configuration", "critical", "Agent and bound model use the same provider", "0 inconsistent rows", reqs(("ai_agent_configs", ("provider_id", "model_config_id")), ("ai_model_configs", ("ai_model_config_id", "provider_id"))), "SELECT COUNT(*) AS count FROM ai_agent_configs a JOIN ai_model_configs m ON m.ai_model_config_id = a.model_config_id WHERE a.provider_id IS NOT NULL AND m.provider_id IS NOT NULL AND a.provider_id <> m.provider_id"),
    Invariant("ai.agent_publish_identity", "AI configuration", "warning", "Published/enabled agents have stable keys", "0 incomplete rows", req("ai_agent_configs", "agent_key", "agent_name", "status", "enabled"), "SELECT COUNT(*) AS count FROM ai_agent_configs WHERE TRIM(agent_name) = '' OR ((status = 'published' OR enabled = 1) AND (agent_key IS NULL OR TRIM(agent_key) = ''))"),
    Invariant("ai.agent_state", "AI configuration", "warning", "Agent state and runtime values are recognized", "0 uncommon rows", req("ai_agent_configs", "status", "runtime_type"), "SELECT COUNT(*) AS count FROM ai_agent_configs WHERE status NOT IN ('draft', 'published', 'disabled', 'archived') OR runtime_type NOT IN ('langgraph', 'self', 'dify_workflow', 'dify_chatflow', 'model_direct')"),
    Invariant("ai.version_orphan", "AI configuration", "critical", "Agent versions reference existing agents", "0 orphan rows", reqs(("agent_versions", ("agent_config_id",)), ("ai_agent_configs", ("agent_config_id",))), "SELECT COUNT(*) AS count FROM agent_versions v LEFT JOIN ai_agent_configs a ON a.agent_config_id = v.agent_config_id WHERE a.agent_config_id IS NULL"),
    Invariant("ai.version_duplicate", "AI configuration", "critical", "Agent version numbers are unique per agent", "0 duplicate groups", req("agent_versions", "agent_config_id", "version_number"), "SELECT COUNT(*) AS count FROM (SELECT agent_config_id, version_number FROM agent_versions GROUP BY agent_config_id, version_number HAVING COUNT(*) > 1) AS duplicate_groups"),
    Invariant("ai.version_state", "AI configuration", "warning", "Agent-version states are recognized", "0 uncommon rows", req("agent_versions", "status"), "SELECT COUNT(*) AS count FROM agent_versions WHERE status NOT IN ('draft', 'published', 'disabled', 'archived')"),
)


EXPECTED_MODELS: dict[str, tuple[str, tuple[str, ...]]] = {
    "User": ("users", ("user_id", "username", "role", "status")),
    "UserProfile": ("user_profiles", ("user_id", "admin_class_id")),
    "AdminRole": ("admin_roles", ("role_code", "enabled")),
    "AdminPermission": ("admin_permissions", ("permission_key",)),
    "AdminRolePermission": ("admin_role_permissions", ("role_id", "permission_id")),
    "AdminUserRole": ("admin_user_roles", ("user_id", "role_id", "expires_at")),
    "Course": ("courses", ("course_id", "course_code", "status")),
    "CourseOffering": ("course_offerings", ("course_offering_id", "course_id")),
    "CourseTeacherRelation": ("course_teacher_relations", ("course_id", "teacher_user_id")),
    "TeachingClass": ("teaching_classes", ("teaching_class_id", "course_id", "status")),
    "AdminClass": ("admin_classes", ("admin_class_id", "class_name", "status")),
    "TeachingClassAdminClass": ("teaching_class_admin_classes", ("teaching_class_id", "admin_class_id")),
    "StudentCourseEnrollment": ("student_course_enrollments", ("student_user_id", "course_id", "teaching_class_id")),
    "Notification": ("notifications", ("receiver_user_id", "idempotency_key", "is_read")),
    "OperationLog": ("operation_logs", ("operation_type", "request_id", "action_status", "before_summary_json", "after_summary_json", "failure_reason")),
    "AiProvider": ("ai_providers", ("provider_code", "secret_ciphertext", "secret_iv", "secret_auth_tag", "source_type")),
    "AiModelConfig": ("ai_model_configs", ("provider_id", "model_code", "capabilities_json")),
    "AiAgentConfig": ("ai_agent_configs", ("agent_key", "provider_id", "model_config_id", "runtime_type", "status")),
    "AdminAgentVersion": ("agent_versions", ("agent_config_id", "version_number")),
    "AiRequestTrace": ("ai_request_traces", ("request_id", "trace_id", "status")),
    "AiTraceStep": ("ai_trace_steps", ("trace_id", "sequence_number", "status")),
    "AiRiskRule": ("ai_risk_rules", ("rule_key", "status", "enabled")),
    "AiRiskEvent": ("ai_risk_events", ("event_key", "risk_rule_id", "status")),
}


REQUIRED_DB_COLUMNS: dict[str, tuple[str, ...]] = {
    table: fields for table, fields in (value for value in EXPECTED_MODELS.values())
}
REQUIRED_DB_COLUMNS.update({
    "_prisma_migrations": ("migration_name", "checksum", "finished_at", "rolled_back_at", "applied_steps_count"),
    "colleges": ("college_id",),
    "majors": ("major_id",),
})


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run aggregate, SELECT-only admin DB integrity checks.",
    )
    parser.add_argument("--repo-root", type=Path, help="DisciMind repository root (default: detected from this script)")
    parser.add_argument("--output", type=Path, help="write Markdown to this path; omit to print Markdown to stdout")
    parser.add_argument("--timeout", type=int, default=45, help="per subprocess timeout in seconds (default: 45)")
    parser.add_argument("--strict-warnings", action="store_true", help="return exit 1 when warnings exist")
    return parser.parse_args(argv)


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key] = value
    return values


def effective_env(file_values: dict[str, str], key: str) -> str:
    return os.environ.get(key, file_values.get(key, "")).strip()


def bool_setting(file_values: dict[str, str], key: str, default: bool) -> str:
    raw = effective_env(file_values, key).lower()
    if not raw:
        return f"default ({'enabled' if default else 'disabled'})"
    return "enabled" if raw in {"1", "true", "yes", "on"} else "disabled"


def usable_encryption_key(raw: str) -> bool:
    if not raw:
        return False
    candidates = [raw.encode("utf-8")]
    try:
        candidates.insert(0, base64.b64decode(raw, validate=False))
    except Exception:
        pass
    return any(len(candidate) >= 32 for candidate in candidates)


def validate_invariant_sql() -> None:
    seen: set[str] = set()
    for item in INVARIANTS:
        if item.key in seen:
            raise RuntimeError(f"duplicate invariant key: {item.key}")
        seen.add(item.key)
        normalized = item.sql.strip()
        if not re.match(r"^SELECT\b", normalized, re.IGNORECASE):
            raise RuntimeError(f"non-SELECT invariant rejected: {item.key}")
        if FORBIDDEN_SQL.search(normalized) or ";" in normalized:
            raise RuntimeError(f"unsafe SQL token rejected: {item.key}")


def extract_model(schema: str, model_name: str) -> str | None:
    match = re.search(rf"(?ms)^model\s+{re.escape(model_name)}\s*\{{(.*?)^\}}", schema)
    return match.group(1) if match else None


def schema_findings(schema_path: Path) -> list[Finding]:
    if not schema_path.is_file():
        return [Finding("Schema readiness", "schema.file", "critical", "FAIL", "Prisma schema exists", "missing", "schema.prisma present")]
    schema = schema_path.read_text(encoding="utf-8", errors="replace")
    missing_models: list[str] = []
    bad_maps: list[str] = []
    missing_fields: list[str] = []
    for model_name, (table, fields) in EXPECTED_MODELS.items():
        block = extract_model(schema, model_name)
        if block is None:
            missing_models.append(model_name)
            continue
        mapped = re.search(r'@@map\("([^\"]+)"\)', block)
        if mapped is None or mapped.group(1) != table:
            bad_maps.append(f"{model_name}->{table}")
        for field in fields:
            if not re.search(rf"(?m)^\s*{re.escape(field)}\s+", block):
                missing_fields.append(f"{model_name}.{field}")
    findings = []
    for check_id, label, missing, expected in (
        ("schema.models", "Required Prisma models", missing_models, f"all {len(EXPECTED_MODELS)} models present"),
        ("schema.maps", "Required Prisma table mappings", bad_maps, "all model/table mappings match"),
        ("schema.fields", "Required Prisma fields", missing_fields, "all recovery-critical fields present"),
    ):
        findings.append(Finding("Schema readiness", check_id, "critical", "FAIL" if missing else "PASS", label, ", ".join(missing) if missing else "0 missing", expected))
    datasource_ok = bool(re.search(r"(?ms)^datasource\s+db\s*\{.*?provider\s*=\s*\"mysql\".*?^\}", schema))
    findings.append(Finding("Schema readiness", "schema.datasource", "critical", "PASS" if datasource_ok else "FAIL", "Prisma datasource is MySQL", "mysql" if datasource_ok else "not confirmed", "provider = mysql"))
    return findings


def prisma_validate(backend: Path, schema_path: Path, timeout: int) -> Finding:
    local_bin = backend / "node_modules" / ".bin" / ("prisma.cmd" if os.name == "nt" else "prisma")
    if local_bin.is_file():
        command = [str(local_bin), "validate", "--schema", str(schema_path)]
    else:
        npx = shutil.which("npx.cmd") or shutil.which("npx")
        if not npx:
            return Finding("Schema readiness", "schema.prisma_validate", "warning", "WARN", "Prisma schema validates", "Prisma CLI unavailable", "validation command succeeds")
        command = [npx, "--no-install", "prisma", "validate", "--schema", str(schema_path)]
    try:
        result = subprocess.run(command, cwd=backend, text=True, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return Finding("Schema readiness", "schema.prisma_validate", "critical", "FAIL", "Prisma schema validates", "command failed safely", "validation command succeeds")
    return Finding("Schema readiness", "schema.prisma_validate", "critical", "PASS" if result.returncode == 0 else "FAIL", "Prisma schema validates", "exit 0" if result.returncode == 0 else f"exit {result.returncode}", "validation command succeeds")


def node_bridge_source() -> str:
    payload = [
        {
            "key": item.key,
            "requires": [[table, list(columns)] for table, columns in item.requires],
            "sql": item.sql,
        }
        for item in INVARIANTS
    ]
    return f"""
'use strict';
const prisma = require('./src/config/prisma');
const marker = {json.dumps(MARKER)};
const specs = {json.dumps(payload, ensure_ascii=True)};
const safeCode = (error) => String(error?.code || error?.name || 'DB_ERROR').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'DB_ERROR';
const output = {{ ok: false, databaseSelected: false, tables: [], columns: {{}}, migrations: [], checks: {{}} }};
async function select(sql) {{ return prisma.$queryRawUnsafe(sql); }}
(async () => {{
  try {{
    await select('SELECT 1 AS connected');
    const dbRows = await select('SELECT DATABASE() AS selected_database');
    output.databaseSelected = Boolean(dbRows?.[0]?.selected_database);
    const tableRows = await select('SELECT TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME');
    output.tables = tableRows.map((row) => String(row.table_name));
    const columnRows = await select('SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION');
    for (const row of columnRows) {{
      const table = String(row.table_name);
      if (!output.columns[table]) output.columns[table] = [];
      output.columns[table].push(String(row.column_name));
    }}
    if (output.tables.includes('_prisma_migrations')) {{
      const rows = await select('SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back, applied_steps_count FROM `_prisma_migrations` ORDER BY migration_name, started_at');
      output.migrations = rows.map((row) => ({{
        migration_name: String(row.migration_name), checksum: String(row.checksum || ''),
        finished: Boolean(row.finished), rolled_back: Boolean(row.rolled_back),
        applied_steps_count: Number(row.applied_steps_count || 0),
      }}));
    }}
    for (const spec of specs) {{
      const missing = [];
      for (const [table, requiredColumns] of spec.requires) {{
        const available = new Set(output.columns[table] || []);
        if (!output.tables.includes(table)) missing.push(table);
        else for (const column of requiredColumns) if (!available.has(column)) missing.push(`${{table}}.${{column}}`);
      }}
      if (missing.length) {{ output.checks[spec.key] = {{ skipped: true, missing: [...new Set(missing)].sort() }}; continue; }}
      try {{
        const rows = await select(spec.sql);
        const value = Number(rows?.[0]?.count ?? 0);
        if (!Number.isFinite(value) || value < 0) throw Object.assign(new Error('invalid aggregate'), {{ code: 'INVALID_AGGREGATE' }});
        output.checks[spec.key] = {{ count: value }};
      }} catch (error) {{ output.checks[spec.key] = {{ errorCode: safeCode(error) }}; }}
    }}
    output.ok = true;
  }} catch (error) {{ output.errorCode = safeCode(error); }}
  finally {{ try {{ await prisma.$disconnect(); }} catch {{}} }}
  process.stdout.write(marker + JSON.stringify(output, (_key, value) => typeof value === 'bigint' ? value.toString() : value) + '\\n');
}})();
"""


def run_db_bridge(backend: Path, timeout: int) -> dict[str, Any]:
    node = shutil.which("node.exe") or shutil.which("node")
    if not node:
        raise RuntimeError("Node.js executable is unavailable")
    try:
        result = subprocess.run(
            [node, "-"], cwd=backend, input=node_bridge_source(), text=True,
            capture_output=True, timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("database probe timed out") from exc
    except OSError as exc:
        raise RuntimeError("database probe could not start") from exc
    marker_index = result.stdout.rfind(MARKER)
    if marker_index < 0:
        raise RuntimeError("database probe returned no integrity payload")
    raw = result.stdout[marker_index + len(MARKER):].splitlines()[0]
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("database probe returned an invalid integrity payload") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("database probe returned an unexpected payload")
    return payload


def db_structure_findings(payload: dict[str, Any]) -> list[Finding]:
    if not payload.get("ok"):
        code = re.sub(r"[^A-Za-z0-9_-]", "", str(payload.get("errorCode", "DB_ERROR")))[:64]
        return [Finding("Database readiness", "db.connectivity", "critical", "FAIL", "Database is reachable with the backend configuration", f"connection failed ({code or 'DB_ERROR'})", "SELECT-only connection succeeds")]
    findings = [
        Finding("Database readiness", "db.connectivity", "critical", "PASS", "Database is reachable with the backend configuration", "connected", "SELECT-only connection succeeds"),
        Finding("Database readiness", "db.selected", "critical", "PASS" if payload.get("databaseSelected") else "FAIL", "A database is selected", "selected" if payload.get("databaseSelected") else "not selected", "selected database present"),
    ]
    tables = set(map(str, payload.get("tables", [])))
    columns = {str(table): set(map(str, names)) for table, names in payload.get("columns", {}).items()}
    missing_tables = sorted(set(REQUIRED_DB_COLUMNS) - tables)
    missing_columns = sorted(
        f"{table}.{column}"
        for table, required in REQUIRED_DB_COLUMNS.items() if table in tables
        for column in required if column not in columns.get(table, set())
    )
    findings.append(Finding("Database readiness", "db.tables", "critical", "FAIL" if missing_tables else "PASS", "Required admin database tables", ", ".join(missing_tables) if missing_tables else "0 missing", f"all {len(REQUIRED_DB_COLUMNS)} required tables present"))
    findings.append(Finding("Database readiness", "db.columns", "critical", "FAIL" if missing_columns else "PASS", "Required admin database columns", ", ".join(missing_columns) if missing_columns else "0 missing", "all recovery-critical columns present"))
    return findings


def invariant_findings(payload: dict[str, Any]) -> tuple[list[Finding], int | None]:
    if not payload.get("ok"):
        return [], None
    results = payload.get("checks", {})
    findings: list[Finding] = []
    encrypted_secret_count: int | None = None
    for item in INVARIANTS:
        raw = results.get(item.key, {})
        if item.severity == "internal":
            if "count" in raw:
                encrypted_secret_count = int(raw["count"])
            continue
        if raw.get("skipped"):
            missing = ", ".join(map(str, raw.get("missing", [])))
            findings.append(Finding(item.group, item.key, item.severity, "SKIP", item.label, f"schema dependency unavailable: {missing}", item.expectation, "covered by database readiness failure"))
            continue
        if raw.get("errorCode"):
            code = re.sub(r"[^A-Za-z0-9_-]", "", str(raw["errorCode"]))[:64]
            findings.append(Finding(item.group, item.key, item.severity, "FAIL" if item.severity == "critical" else "WARN", item.label, f"aggregate query failed ({code or 'QUERY_ERROR'})", item.expectation))
            continue
        count = int(raw.get("count", 0))
        if count == 0:
            status = "PASS"
        else:
            status = "FAIL" if item.severity == "critical" else "WARN"
        findings.append(Finding(item.group, item.key, item.severity, status, item.label, str(count), item.expectation))
    return findings, encrypted_secret_count


def migration_files(repo_root: Path) -> tuple[dict[str, tuple[str, str, str, Path]], list[str]]:
    root = repo_root / "backend" / "prisma" / "migrations"
    files: dict[str, tuple[str, Path]] = {}
    missing_sql: list[str] = []
    if not root.is_dir():
        return files, ["migrations directory"]
    for child in sorted(root.iterdir(), key=lambda path: path.name):
        if not child.is_dir():
            continue
        sql_path = child / "migration.sql"
        if not sql_path.is_file():
            missing_sql.append(child.name)
            continue
        raw = sql_path.read_bytes()
        # Git may materialize SQL with CRLF on Windows even when it was applied
        # from LF bytes elsewhere.  Keep exact and both newline-only variants so
        # semantic content drift remains critical while EOL drift is a warning.
        lf = raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        crlf = lf.replace(b"\n", b"\r\n")
        files[child.name] = (
            hashlib.sha256(raw).hexdigest(),
            hashlib.sha256(lf).hexdigest(),
            hashlib.sha256(crlf).hexdigest(),
            sql_path,
        )
    return files, missing_sql


def tracked_migration_names(repo_root: Path) -> set[str] | None:
    git = shutil.which("git.exe") or shutil.which("git")
    if not git:
        return None
    result = subprocess.run(
        [git, "-C", str(repo_root), "ls-files", "--", "backend/prisma/migrations/*/migration.sql"],
        text=True, capture_output=True, check=False,
    )
    if result.returncode != 0:
        return None
    return {Path(line.strip()).parent.name for line in result.stdout.splitlines() if line.strip()}


def migration_findings(repo_root: Path, payload: dict[str, Any]) -> list[Finding]:
    files, missing_sql = migration_files(repo_root)
    findings = [Finding("Migration integrity", "migrations.files", "critical", "FAIL" if missing_sql else "PASS", "Migration directories contain migration.sql", ", ".join(missing_sql) if missing_sql else "0 missing", "every migration directory has SQL")]
    if not payload.get("ok") or "_prisma_migrations" not in set(payload.get("tables", [])):
        findings.append(Finding("Migration integrity", "migrations.database", "critical", "SKIP", "Filesystem and applied migrations agree", "migration history unavailable", "checksums and active histories match", "covered by database readiness failure"))
        return findings

    rows = payload.get("migrations", [])
    active: dict[str, list[dict[str, Any]]] = {}
    unfinished: list[str] = []
    rolled_back: list[str] = []
    for row in rows:
        name = str(row.get("migration_name", ""))
        if row.get("rolled_back"):
            rolled_back.append(name)
        elif row.get("finished"):
            active.setdefault(name, []).append(row)
        else:
            unfinished.append(name)
    missing_applied = sorted(set(files) - set(active))
    missing_file = sorted(set(active) - set(files))
    duplicate_active = sorted(name for name, entries in active.items() if len(entries) > 1)
    checksum_mismatch: list[str] = []
    newline_only_mismatch: list[str] = []
    for name, entries in active.items():
        if name not in files:
            continue
        raw_checksum, lf_checksum, crlf_checksum, _path = files[name]
        for entry in entries:
            recorded = str(entry.get("checksum", ""))
            if recorded == raw_checksum:
                continue
            if recorded in {lf_checksum, crlf_checksum}:
                newline_only_mismatch.append(name)
            else:
                checksum_mismatch.append(name)
    checksum_mismatch = sorted(set(checksum_mismatch))
    newline_only_mismatch = sorted(set(newline_only_mismatch))
    for check_id, label, values, expected in (
        ("migrations.unapplied", "Filesystem migrations are applied", missing_applied, "0 unapplied migrations"),
        ("migrations.missing_file", "Applied migrations exist on disk", missing_file, "0 DB-only active migrations"),
        ("migrations.checksum", "Applied migration checksums match", checksum_mismatch, "0 checksum mismatches"),
        ("migrations.unfinished", "No migration is left unfinished", sorted(unfinished), "0 unfinished migrations"),
        ("migrations.duplicate_active", "Migration names have one active application", duplicate_active, "0 duplicate active histories"),
    ):
        findings.append(Finding("Migration integrity", check_id, "critical", "FAIL" if values else "PASS", label, ", ".join(values) if values else "0", expected))
    findings.append(Finding("Migration integrity", "migrations.rolled_back", "warning", "WARN" if rolled_back else "PASS", "Rolled-back migration history", ", ".join(sorted(set(rolled_back))) if rolled_back else "0", "review any historical rollbacks"))
    findings.append(Finding("Migration integrity", "migrations.line_endings", "warning", "WARN" if newline_only_mismatch else "PASS", "Applied migration checksum differs only by line endings", ", ".join(newline_only_mismatch) if newline_only_mismatch else "0", "0 newline-only checksum differences"))

    tracked = tracked_migration_names(repo_root)
    if tracked is None:
        findings.append(Finding("Migration integrity", "migrations.version_control", "warning", "WARN", "Applied migration files are version-controlled", "Git tracking unavailable", "all active migration files tracked"))
    else:
        untracked_active = sorted(name for name in active if name in files and name not in tracked)
        findings.append(Finding("Migration integrity", "migrations.version_control", "warning", "WARN" if untracked_active else "PASS", "Applied migration files are version-controlled", ", ".join(untracked_active) if untracked_active else "0 untracked", "all active migration files tracked"))
    return findings


def environment_findings(file_values: dict[str, str], encrypted_secret_count: int | None) -> tuple[list[Finding], list[tuple[str, str]]]:
    get = lambda key: effective_env(file_values, key)
    database_configured = bool(get("DATABASE_URL") or (get("DATABASE_HOST") and get("DATABASE_NAME") and get("DATABASE_USER")))
    jwt = get("JWT_SECRET")
    jwt_placeholder = not jwt or jwt in {"discimind-dev-secret", "请在这里填写一个随机字符串作为JWT密钥"}
    encryption = get("AI_CONFIG_ENCRYPTION_KEY")
    encryption_usable = usable_encryption_key(encryption)
    env_rows = [
        ("Database configuration", "configured" if database_configured else "not confirmed"),
        ("JWT signing secret", "configured" if jwt and not jwt_placeholder else "missing or development placeholder"),
        ("AI encryption key", "configured and structurally usable" if encryption_usable else "missing or structurally unusable"),
        ("DB-backed AI config", bool_setting(file_values, "AI_CONFIG_DB_ENABLED", True)),
        ("AI environment fallback", bool_setting(file_values, "AI_CONFIG_ENV_FALLBACK_ENABLED", True)),
    ]
    findings = [
        Finding("Environment readiness", "env.database", "warning", "PASS" if database_configured else "WARN", "Database configuration is explicit", env_rows[0][1], "DATABASE_URL or split DB settings configured"),
        Finding("Environment readiness", "env.jwt", "warning", "WARN" if jwt_placeholder else "PASS", "JWT signing secret is not a development fallback", env_rows[1][1], "non-placeholder JWT secret configured"),
    ]
    if encrypted_secret_count is None:
        findings.append(Finding("Environment readiness", "env.ai_encryption", "warning", "WARN" if not encryption_usable else "PASS", "AI encryption key can service encrypted provider records", env_rows[2][1], "usable key configured", "encrypted-record count unavailable"))
    elif encrypted_secret_count > 0 and not encryption_usable:
        findings.append(Finding("Environment readiness", "env.ai_encryption", "critical", "FAIL", "AI encryption key can service encrypted provider records", f"key unusable; {encrypted_secret_count} encrypted provider record(s)", "usable key configured when encrypted records exist"))
    else:
        findings.append(Finding("Environment readiness", "env.ai_encryption", "warning", "PASS" if encryption_usable or encrypted_secret_count == 0 else "WARN", "AI encryption key can service encrypted provider records", env_rows[2][1], "usable key configured when encrypted records exist"))
    return findings, env_rows


def markdown_escape(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def render_markdown(findings: Iterable[Finding], environment_rows: list[tuple[str, str]]) -> str:
    ordered = list(findings)
    counts = {status: sum(1 for finding in ordered if finding.status == status) for status in ("PASS", "WARN", "FAIL", "SKIP")}
    outcome = "FAIL" if counts["FAIL"] else ("READY WITH WARNINGS" if counts["WARN"] else "READY")
    lines = [
        "# Admin DB Integrity Result",
        "",
        f"- **Outcome:** {outcome}",
        f"- **Checks:** {counts['PASS']} pass, {counts['WARN']} warning, {counts['FAIL']} failure, {counts['SKIP']} skipped",
        "- **Data handling:** aggregate counts and schema/migration metadata only; no row samples, credentials, tokens, hashes, or secret values are rendered.",
        "",
        "## Scope and safety",
        "",
        "This result was produced by `scripts/admin_db_integrity_check.py`. Its database bridge accepts only a fixed allow-list of `SELECT` statements, inspects `INFORMATION_SCHEMA`, and disconnects without calling any mutation API. Warnings do not change the default exit code; any critical failure returns exit code 1, and harness failure returns exit code 2.",
        "",
        "## Redacted environment readiness",
        "",
        "| Setting | Readiness (value withheld) |",
        "| --- | --- |",
    ]
    lines.extend(f"| {markdown_escape(name)} | {markdown_escape(status)} |" for name, status in environment_rows)
    group_order = ["Environment readiness", "Schema readiness", "Database readiness", "Migration integrity", "Users and RBAC", "Courses and classes", "Notifications", "Operation logs", "AI configuration"]
    for group in group_order:
        group_findings = [finding for finding in ordered if finding.group == group]
        if not group_findings:
            continue
        lines.extend([
            "",
            f"## {group}",
            "",
            "| Status | Severity | Check | Observed | Expected | ID |",
            "| --- | --- | --- | --- | --- | --- |",
        ])
        for finding in group_findings:
            observed = finding.observed + (f" ({finding.note})" if finding.note else "")
            lines.append(
                f"| {finding.status} | {finding.severity} | {markdown_escape(finding.label)} | "
                f"{markdown_escape(observed)} | {markdown_escape(finding.expectation)} | `{markdown_escape(finding.check_id)}` |"
            )
    lines.extend([
        "",
        "## Reproduce",
        "",
        "From the repository root:",
        "",
        "```powershell",
        "python scripts/admin_db_integrity_check.py --output docs/admin-db-integrity-result.md",
        "```",
        "",
        "Use `--strict-warnings` only when a warning must fail CI. The report is intentionally deterministic: it contains no run timestamp, row samples, or volatile connection details.",
        "",
    ])
    return "\n".join(lines)


def write_output(markdown: str, output: Path | None, repo_root: Path) -> None:
    if output is None:
        sys.stdout.write(markdown)
        return
    target = output if output.is_absolute() else repo_root / output
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(markdown, encoding="utf-8", newline="\n")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    repo_root = (args.repo_root or Path(__file__).resolve().parents[1]).resolve()
    backend = repo_root / "backend"
    schema_path = backend / "prisma" / "schema.prisma"
    if args.timeout < 1 or not backend.is_dir():
        sys.stderr.write("admin DB integrity harness: invalid repository root or timeout\n")
        return 2
    try:
        validate_invariant_sql()
        env_values = load_env_file(backend / ".env")
        base_findings = schema_findings(schema_path)
        base_findings.append(prisma_validate(backend, schema_path, args.timeout))
        payload = run_db_bridge(backend, args.timeout)
        structure = db_structure_findings(payload)
        invariants, encrypted_count = invariant_findings(payload)
        migrations = migration_findings(repo_root, payload)
        environment, env_rows = environment_findings(env_values, encrypted_count)
        findings = environment + base_findings + structure + migrations + invariants
        markdown = render_markdown(findings, env_rows)
        write_output(markdown, args.output, repo_root)
    except Exception as exc:
        safe_type = re.sub(r"[^A-Za-z0-9_]", "", type(exc).__name__) or "HarnessError"
        sys.stderr.write(f"admin DB integrity harness failed safely ({safe_type}); no database mutations were attempted\n")
        return 2
    failures = sum(finding.status == "FAIL" for finding in findings)
    warnings = sum(finding.status == "WARN" for finding in findings)
    if args.output is not None:
        sys.stdout.write(f"admin DB integrity: {failures} failure(s), {warnings} warning(s); report written\n")
    return 1 if failures or (args.strict_warnings and warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
