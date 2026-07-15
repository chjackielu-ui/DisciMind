const { z } = require('zod');

const roleAssignmentInput = z.object({
  role_codes: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

const rolePermissionInput = z.object({
  permission_keys: z.array(z.string().trim().min(1).max(120)).min(1).max(64),
}).strict();

module.exports = { roleAssignmentInput, rolePermissionInput };
