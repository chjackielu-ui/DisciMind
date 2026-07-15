-- Forward-only RBAC foundation for the existing administration center.
-- This migration keeps every existing user and grants an explicit built-in role
-- to active legacy administrators that do not yet have an assignment.

-- AddForeignKey
ALTER TABLE `admin_user_roles`
    ADD CONSTRAINT `admin_user_roles_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the six built-in roles.
INSERT INTO `admin_roles`
    (`role_code`, `name`, `description`, `built_in`, `enabled`, `created_at`, `updated_at`)
VALUES
    ('super_admin', '超级管理员', '平台内置全权限角色。', true, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('platform_admin', '平台管理员', '负责平台、用户、教学与 AI 运营，不包含密钥管理。', true, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('teaching_admin', '教学管理员', '负责教学、学习流、知识、干预、评测与教学资产。', true, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('ai_ops_admin', 'AI 运营管理员', '负责供应商、密钥、模型、Agent、评测与灰度发布。', true, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('security_auditor', '安全审计管理员', '负责安全风险确认、处置和审计，不具有密钥读取或替换权限。', true, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('read_only_auditor', '只读审计员', '可查看管理数据与审计证据，不可执行写操作。', true, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
    `name` = VALUES(`name`),
    `description` = VALUES(`description`),
    `built_in` = true,
    `enabled` = true,
    `updated_at` = CURRENT_TIMESTAMP(3);

-- Seed the permission catalog used by both API middleware and the admin UI.
INSERT INTO `admin_permissions`
    (`permission_key`, `module`, `name`, `description`, `sensitive`, `created_at`, `updated_at`)
VALUES
    ('admin.dashboard.view', 'dashboard', '查看管理驾驶舱', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.users.view', 'users', '查看用户', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.users.manage', 'users', '管理用户', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.teaching.view', 'teaching', '查看教学管理', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.teaching.manage', 'teaching', '管理教学业务', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.ai.providers.view', 'ai.providers', '查看 AI 供应商', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.ai.providers.manage', 'ai.providers', '管理 AI 供应商', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.ai.secrets.manage', 'ai.secrets', '管理 AI 密钥', NULL, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.ai.models.view', 'ai.models', '查看 AI 模型', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.ai.models.manage', 'ai.models', '管理 AI 模型', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.agents.view', 'agents', '查看 Agent', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.agents.manage', 'agents', '管理 Agent', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.agents.publish', 'agents', '发布和回滚 Agent', NULL, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.traces.view', 'traces', '查看 AI 证据链', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.workflows.view', 'workflows', '查看学习流治理', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.workflows.manage', 'workflows', '管理学习流治理', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.knowledge.view', 'knowledge', '查看知识治理', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.knowledge.manage', 'knowledge', '管理知识治理', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.interventions.view', 'interventions', '查看教学问题与干预', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.interventions.manage', 'interventions', '管理教学问题与干预', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.evaluations.view', 'evaluations', '查看 Agent 评测', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.evaluations.manage', 'evaluations', '管理 Agent 评测', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.experiments.view', 'experiments', '查看灰度实验', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.experiments.manage', 'experiments', '管理灰度实验', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.assets.view', 'assets', '查看教学资产', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.assets.manage', 'assets', '管理教学资产', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.risks.view', 'risks', '查看 AI 风险', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.risks.manage', 'risks', '处置 AI 风险', NULL, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.audit.view', 'audit', '查看审计日志', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.system.view', 'system', '查看系统配置', NULL, false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('admin.system.manage', 'system', '管理系统与权限', NULL, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
    `module` = VALUES(`module`),
    `name` = VALUES(`name`),
    `description` = VALUES(`description`),
    `sensitive` = VALUES(`sensitive`),
    `updated_at` = CURRENT_TIMESTAMP(3);

-- Seed the built-in role matrix without removing any pre-existing assignment.
INSERT INTO `admin_role_permissions`
    (`role_id`, `permission_id`, `granted_by`, `created_at`, `updated_at`)
SELECT
    r.`id`, p.`id`, NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `admin_roles` r
CROSS JOIN `admin_permissions` p
WHERE
    r.`role_code` = 'super_admin'
    OR (r.`role_code` = 'platform_admin' AND p.`permission_key` <> 'admin.ai.secrets.manage')
    OR (r.`role_code` = 'teaching_admin' AND p.`permission_key` IN (
        'admin.dashboard.view', 'admin.users.view', 'admin.teaching.view', 'admin.teaching.manage',
        'admin.traces.view', 'admin.workflows.view', 'admin.workflows.manage',
        'admin.knowledge.view', 'admin.knowledge.manage', 'admin.interventions.view',
        'admin.interventions.manage', 'admin.evaluations.view', 'admin.evaluations.manage',
        'admin.assets.view', 'admin.assets.manage', 'admin.audit.view'
    ))
    OR (r.`role_code` = 'ai_ops_admin' AND p.`permission_key` IN (
        'admin.dashboard.view', 'admin.ai.providers.view', 'admin.ai.providers.manage',
        'admin.ai.secrets.manage', 'admin.ai.models.view', 'admin.ai.models.manage',
        'admin.agents.view', 'admin.agents.manage', 'admin.agents.publish', 'admin.traces.view',
        'admin.workflows.view', 'admin.workflows.manage', 'admin.evaluations.view',
        'admin.evaluations.manage', 'admin.experiments.view', 'admin.experiments.manage',
        'admin.audit.view', 'admin.system.view'
    ))
    OR (r.`role_code` = 'security_auditor' AND p.`permission_key` IN (
        'admin.dashboard.view', 'admin.ai.providers.view', 'admin.ai.models.view',
        'admin.agents.view', 'admin.traces.view', 'admin.risks.view',
        'admin.risks.manage', 'admin.audit.view', 'admin.system.view'
    ))
    OR (r.`role_code` = 'read_only_auditor' AND p.`permission_key` LIKE '%.view')
ON DUPLICATE KEY UPDATE
    `updated_at` = CURRENT_TIMESTAMP(3);

-- Remove implicit legacy-admin fallback by giving uncovered active administrators
-- an explicit super_admin assignment during the transition.
INSERT INTO `admin_user_roles`
    (`user_id`, `role_id`, `granted_by`, `expires_at`, `created_at`, `updated_at`)
SELECT
    u.`user_id`, r.`id`, NULL, NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `users` u
JOIN `admin_roles` r ON r.`role_code` = 'super_admin' AND r.`enabled` = true
WHERE u.`role` = 'admin'
  AND u.`status` = 'active'
  AND NOT EXISTS (
      SELECT 1
      FROM `admin_user_roles` aur
      JOIN `admin_roles` existing_role ON existing_role.`id` = aur.`role_id`
      WHERE aur.`user_id` = u.`user_id`
        AND existing_role.`enabled` = true
        AND (aur.`expires_at` IS NULL OR aur.`expires_at` > CURRENT_TIMESTAMP(3))
  )
ON DUPLICATE KEY UPDATE
    `expires_at` = NULL,
    `updated_at` = CURRENT_TIMESTAMP(3);
