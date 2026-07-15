#!/usr/bin/env python3
"""Audit the admin RBAC catalog, assignments, route guards and frontend gates."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


MARKER = "__ADMIN_RBAC_AUDIT_JSON__"
NODE_BRIDGE = r"""
const prisma = require('./src/config/prisma');
const { ROLE_DEFINITIONS, PERMISSION_DEFINITIONS } = require('./src/services/admin-permission.catalog');
(async () => {
  const now = new Date();
  const [roles, permissions, activeAdmins, uncoveredAdmins, userFk] = await Promise.all([
    prisma.adminRole.findMany({
      where: { built_in: true },
      orderBy: { role_code: 'asc' },
      include: { role_permissions: { include: { permission: true } } },
    }),
    prisma.adminPermission.findMany({ orderBy: { permission_key: 'asc' } }),
    prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } }),
    prisma.user.count({
      where: {
        role: 'ADMIN', status: 'ACTIVE',
        admin_role_assignments: { none: { role: { enabled: true }, OR: [{ expires_at: null }, { expires_at: { gt: now } }] } },
      },
    }),
    prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_user_roles' AND CONSTRAINT_NAME = 'admin_user_roles_user_id_fkey'"),
  ]);
  const payload = {
    expected_roles: ROLE_DEFINITIONS.map((role) => ({ code: role.code, permissions: [...role.permissions].sort() })),
    expected_permissions: PERMISSION_DEFINITIONS.map((permission) => permission.key).sort(),
    actual_roles: roles.map((role) => ({
      code: role.role_code,
      permissions: role.role_permissions.map((item) => item.permission.permission_key).sort(),
    })),
    actual_permissions: permissions.map((permission) => permission.permission_key),
    active_admins: activeAdmins,
    uncovered_admins: uncoveredAdmins,
    user_fk_count: Number(userFk[0]?.count || 0),
  };
  console.log('__ADMIN_RBAC_AUDIT_JSON__' + JSON.stringify(payload));
  await prisma.$disconnect();
})().catch(async (error) => {
  console.error(error?.message || error);
  await prisma.$disconnect();
  process.exit(1);
});
"""


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    observed: str
    expected: str


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def run_database_audit(root: Path) -> dict:
    completed = subprocess.run(
        ["node", "-e", NODE_BRIDGE],
        cwd=root / "backend",
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=60,
        check=False,
    )
    if completed.returncode != 0:
        message = completed.stderr.strip().splitlines()[-1:] or ["Node bridge failed"]
        raise RuntimeError(message[0])
    marker_line = next((line for line in completed.stdout.splitlines() if line.startswith(MARKER)), None)
    if not marker_line:
        raise RuntimeError("RBAC database bridge did not return its aggregate payload")
    return json.loads(marker_line[len(MARKER):])


def backend_route_checks(root: Path, known: set[str]) -> tuple[list[str], list[str], int]:
    paths = [
        root / "backend/src/routes/admin.routes.js",
        root / "backend/src/modules/agent-review/agent-review.routes.js",
    ]
    unguarded: list[str] = []
    unknown: list[str] = []
    route_count = 0
    route_pattern = re.compile(r"router\.(get|post|put|patch|delete)\(\s*(['\"])(.*?)\2\s*,([\s\S]*?)\);", re.I)
    permission_pattern = re.compile(r"requireAdminPermission\(\s*(['\"])(.*?)\1\s*\)")
    for path in paths:
        text = read(path)
        for method, _, route, handlers in route_pattern.findall(text):
            route_count += 1
            keys = [match[1] for match in permission_pattern.findall(handlers)]
            unknown.extend(f"{method.upper()} {route}: {key}" for key in keys if key not in known)
            guarded = bool(keys) or "requireGovernancePermission(" in handlers
            if not guarded and route != "/rbac/me":
                unguarded.append(f"{method.upper()} {route}")
    return sorted(unguarded), sorted(unknown), route_count


def frontend_gate_checks(root: Path, known: set[str]) -> tuple[list[str], list[str], int]:
    router_text = read(root / "frontend/src/utils/router.js")
    menu_text = read(root / "frontend/src/utils/admin-menu.js")
    route_pattern = re.compile(r"['\"](/admin[^'\"]*)['\"]\s*:\s*\{([^\n}]*)\}")
    permission_value_pattern = re.compile(
        r"\bpermission\s*:\s*(\[[^\]]*\]|['\"][^'\"]+['\"])",
    )
    quoted_key_pattern = re.compile(r"['\"]([^'\"]+)['\"]")

    def permission_keys(source: str) -> list[str]:
        return [
            key
            for value in permission_value_pattern.findall(source)
            for key in quoted_key_pattern.findall(value)
        ]

    missing: list[str] = []
    unknown: list[str] = []
    count = 0
    for route, body in route_pattern.findall(router_text):
        count += 1
        keys = permission_keys(body)
        if not keys:
            if route != "/admin/profile":
                missing.append(route)
            continue
        unknown.extend(f"{route}: {key}" for key in keys if key not in known)
    if "pattern: /^\\/admin\\/courses\\/" in router_text and "permission: 'admin.teaching.view'" not in router_text:
        missing.append("/admin/courses/:course_id")
    for key in permission_keys(menu_text):
        if key not in known:
            unknown.append(f"menu: {key}")
    return sorted(set(missing)), sorted(set(unknown)), count


def cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def build_report(root: Path) -> tuple[str, list[Check]]:
    payload = run_database_audit(root)
    expected_roles = {item["code"]: item["permissions"] for item in payload["expected_roles"]}
    actual_roles = {item["code"]: item["permissions"] for item in payload["actual_roles"]}
    known = set(payload["expected_permissions"])
    unguarded, backend_unknown, backend_route_count = backend_route_checks(root, known)
    frontend_missing, frontend_unknown, frontend_route_count = frontend_gate_checks(root, known)

    matrix_mismatches = [
        code for code, expected in expected_roles.items()
        if actual_roles.get(code) != expected
    ]
    checks = [
        Check("内置角色目录", set(actual_roles) == set(expected_roles), str(len(actual_roles)), "6 个且代码完全匹配"),
        Check("权限目录", payload["actual_permissions"] == payload["expected_permissions"], str(len(payload["actual_permissions"])), "31 项且键完全匹配"),
        Check("角色权限矩阵", not matrix_mismatches, ", ".join(matrix_mismatches) or "无差异", "六个角色与代码目录完全一致"),
        Check("活跃管理员显式授权", payload["uncovered_admins"] == 0, f"未授权 {payload['uncovered_admins']} / 活跃 {payload['active_admins']}", "0 名未授权"),
        Check("管理员角色用户外键", payload["user_fk_count"] == 1, str(payload["user_fk_count"]), "1"),
        Check("后端管理路由权限中间件", not unguarded, ", ".join(unguarded) or f"{backend_route_count} 条均受保护", "除 /rbac/me 外全部受细粒度权限保护"),
        Check("后端权限键", not backend_unknown, ", ".join(backend_unknown) or "全部来自目录", "0 个未知键"),
        Check("前端管理路由门禁", not frontend_missing, ", ".join(frontend_missing) or f"{frontend_route_count} 条均已声明", "除个人信息外全部声明权限"),
        Check("前端权限键", not frontend_unknown, ", ".join(frontend_unknown) or "全部来自目录", "0 个未知键"),
    ]
    lines = [
        "# DisciMind 管理端 RBAC 审计结果", "",
        "> 由 `python scripts/admin_rbac_audit.py --output docs/admin-rbac-audit-result.md` 生成。", "",
        "## 结论", "",
        "| 检查 | 状态 | 观测 | 期望 |", "| --- | --- | --- | --- |",
    ]
    for check in checks:
        lines.append(f"| {cell(check.name)} | {'PASS' if check.ok else 'FAIL'} | {cell(check.observed)} | {cell(check.expected)} |")
    lines.extend(["", "## 角色矩阵", "", "| 角色代码 | 权限数 | 数据库状态 |", "| --- | ---: | --- |"])
    for code, expected in expected_roles.items():
        lines.append(f"| `{code}` | {len(expected)} | {'一致' if actual_roles.get(code) == expected else '不一致'} |")
    lines.extend([
        "", "## 审计边界", "",
        "- 数据库桥接只读取角色代码、权限键和聚合数量，不读取密钥、令牌或用户明细。",
        "- `/admin/rbac/me` 仅依赖登录身份，用于获取当前显式权限；其余管理路由必须同时经过管理员角色和细粒度权限校验。",
        "- 前端门禁用于体验与导航裁剪，后端权限中间件仍是最终安全边界。", "",
    ])
    return "\n".join(lines), checks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, default=Path("docs/admin-rbac-audit-result.md"))
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        report, checks = build_report(root)
        output = args.output if args.output.is_absolute() else root / args.output
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(report + "\n", encoding="utf-8")
        failed = [check.name for check in checks if not check.ok]
        print(f"admin RBAC audit written: {output} ({len(checks) - len(failed)} pass, {len(failed)} fail)")
        if failed:
            print("failed checks: " + ", ".join(failed), file=sys.stderr)
            return 1
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(f"admin RBAC audit failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
