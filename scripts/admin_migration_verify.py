#!/usr/bin/env python3
"""Verify the current migration state and replay all migrations in an isolated empty database."""

from __future__ import annotations

import argparse
import json
import re
import secrets
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


MARKER = "__ADMIN_MIGRATION_VERIFY_JSON__"
TEMP_PREFIX = "discimind_admin_verify_"
NODE_BRIDGE = r"""
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mysql = require('mysql2/promise');
const { getDatabaseConfig } = require('./src/config/database');

const databaseName = process.argv[1];
if (!/^discimind_admin_verify_[a-f0-9]{12}$/.test(databaseName || '')) {
  throw new Error('refusing unsafe temporary database name');
}

(async () => {
  const config = getDatabaseConfig();
  const connection = await mysql.createConnection({
    host: config.host, port: config.port, user: config.user, password: config.password,
    multipleStatements: false,
  });
  let payload = null;
  let failure = null;
  let created = false;
  try {
    await connection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    const url = new URL('mysql://localhost');
    url.username = config.user;
    url.password = config.password;
    url.hostname = config.host;
    url.port = String(config.port);
    url.pathname = `/${databaseName}`;
    const cli = path.resolve('node_modules/prisma/build/index.js');
    const deployed = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url.toString() },
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (deployed.error || deployed.status !== 0) {
      const details = String(deployed.stderr || deployed.stdout || deployed.error?.message || 'migration deploy failed')
        .split(/\r?\n/).filter(Boolean).slice(-4).join(' | ');
      throw new Error(details);
    }
    await connection.changeUser({ database: databaseName });
    const [[migrations], [failed], [tables], [roles], [permissions], [userFk], [modelColumns]] = await Promise.all([
      connection.query("SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"),
      connection.query("SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NULL OR logs IS NOT NULL"),
      connection.query("SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"),
      connection.query("SELECT COUNT(*) AS count FROM admin_roles WHERE built_in = 1"),
      connection.query("SELECT COUNT(*) AS count FROM admin_permissions"),
      connection.query("SELECT COUNT(*) AS count FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_user_roles' AND CONSTRAINT_NAME = 'admin_user_roles_user_id_fkey'"),
      connection.query("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_model_configs' AND COLUMN_NAME IN ('supports_rerank', 'created_by', 'updated_by')"),
    ]);
    payload = {
      applied_migrations: Number(migrations[0].count),
      failed_migrations: Number(failed[0].count),
      table_count: Number(tables[0].count),
      built_in_roles: Number(roles[0].count),
      permissions: Number(permissions[0].count),
      user_fk_count: Number(userFk[0].count),
      provider_model_columns: Number(modelColumns[0].count),
    };
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (created) {
        await connection.query('USE information_schema');
        await connection.query(`DROP DATABASE \`${databaseName}\``);
      }
    } catch (cleanupError) {
      failure = failure || cleanupError;
    }
    await connection.end();
  }
  if (failure) throw failure;
  console.log('__ADMIN_MIGRATION_VERIFY_JSON__' + JSON.stringify({ ...payload, isolated_database_removed: true }));
})().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
"""


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    observed: str
    expected: str


def run(command: list[str], cwd: Path, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        check=False,
    )


def replay_empty_database(root: Path) -> dict:
    temp_name = TEMP_PREFIX + secrets.token_hex(6)
    if not re.fullmatch(r"discimind_admin_verify_[a-f0-9]{12}", temp_name):
        raise RuntimeError("temporary database safety check failed")
    completed = run(["node", "-e", NODE_BRIDGE, temp_name], root / "backend", timeout=210)
    if completed.returncode != 0:
        details = completed.stdout.strip().splitlines()[-4:]
        raise RuntimeError(" | ".join(details) or "isolated migration replay failed")
    marker_line = next((line for line in completed.stdout.splitlines() if line.startswith(MARKER)), None)
    if not marker_line:
        raise RuntimeError("isolated migration replay did not return its aggregate payload")
    return json.loads(marker_line[len(MARKER):])


def tracked(root: Path, path: Path) -> bool:
    relative = path.relative_to(root).as_posix()
    completed = run(["git", "ls-files", "--error-unmatch", "--", relative], root)
    return completed.returncode == 0


def cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def build_report(root: Path) -> tuple[str, list[Check]]:
    migration_files = sorted((root / "backend/prisma/migrations").glob("*/migration.sql"))
    current = run(["npx.cmd" if sys.platform == "win32" else "npx", "prisma", "migrate", "status"], root / "backend")
    payload = replay_empty_database(root)
    required = [
        root / "backend/prisma/migrations/20260715030000_admin_management_rebuild/migration.sql",
        root / "backend/prisma/migrations/20260715090000_admin_rbac_foundation/migration.sql",
        root / "backend/prisma/migrations/20260715091000_reconcile_portable_migration_checksum/migration.sql",
        root / "backend/prisma/migrations/20260715092000_admin_provider_model_completion/migration.sql",
    ]
    tracked_required = sum(1 for path in required if path.is_file() and tracked(root, path))
    checks = [
        Check("当前数据库迁移状态", current.returncode == 0, "up to date" if current.returncode == 0 else current.stdout.strip().splitlines()[-1], "全部已应用"),
        Check("迁移目录完整", len(migration_files) > 0, str(len(migration_files)), "至少 1 条"),
        Check("管理端迁移纳入版本控制", tracked_required == len(required), f"{tracked_required}/{len(required)}", "4/4"),
        Check("空库迁移重放", payload["applied_migrations"] == len(migration_files), str(payload["applied_migrations"]), str(len(migration_files))),
        Check("空库失败迁移", payload["failed_migrations"] == 0, str(payload["failed_migrations"]), "0"),
        Check("空库 schema 已创建", payload["table_count"] > 1, str(payload["table_count"]), "> 1"),
        Check("空库 RBAC 角色", payload["built_in_roles"] == 6, str(payload["built_in_roles"]), "6"),
        Check("空库 RBAC 权限", payload["permissions"] == 31, str(payload["permissions"]), "31"),
        Check("空库管理员用户外键", payload["user_fk_count"] == 1, str(payload["user_fk_count"]), "1"),
        Check("供应商模型补全字段", payload["provider_model_columns"] == 3, str(payload["provider_model_columns"]), "3"),
        Check("临时数据库清理", payload["isolated_database_removed"] is True, str(payload["isolated_database_removed"]), "True"),
    ]
    lines = [
        "# DisciMind 管理端迁移验证结果", "",
        "> 由 `python scripts/admin_migration_verify.py --output docs/admin-migration-verify-result.md` 生成。", "",
        "| 检查 | 状态 | 观测 | 期望 |", "| --- | --- | --- | --- |",
    ]
    for check in checks:
        lines.append(f"| {cell(check.name)} | {'PASS' if check.ok else 'FAIL'} | {cell(check.observed)} | {cell(check.expected)} |")
    lines.extend([
        "", "## 安全边界", "",
        "- 脚本只创建名称匹配 `discimind_admin_verify_<12 位十六进制>` 的临时数据库，并在验证结束后删除该临时库。",
        "- 当前 `discimind` 数据库仅执行 `prisma migrate status`，不会被重建、清空或回滚。",
        "- 报告不输出数据库连接串、用户名、密码或任何业务行明细。", "",
    ])
    return "\n".join(lines), checks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, default=Path("docs/admin-migration-verify-result.md"))
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        report, checks = build_report(root)
        output = args.output if args.output.is_absolute() else root / args.output
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(report + "\n", encoding="utf-8")
        failed = [check.name for check in checks if not check.ok]
        print(f"admin migration verification written: {output} ({len(checks) - len(failed)} pass, {len(failed)} fail)")
        if failed:
            print("failed checks: " + ", ".join(failed), file=sys.stderr)
            return 1
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(f"admin migration verification failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
