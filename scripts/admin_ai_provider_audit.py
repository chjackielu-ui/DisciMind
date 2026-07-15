#!/usr/bin/env python3
"""Audit the Stage 2 provider, secret and model management contract without exposing secrets."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


MARKER = "__ADMIN_AI_PROVIDER_AUDIT__"
REQUIRED_OPERATIONS = [
    "testConnection", "listModels", "chat", "streamChat", "embed",
    "rerank", "healthCheck", "normalizeError", "getCapabilities",
]
REQUIRED_ENV = [
    "AI_CONFIG_DB_ENABLED", "AI_CONFIG_ENCRYPTION_KEY",
    "AI_CONFIG_ENV_FALLBACK_ENABLED", "AI_PROVIDER_HEALTHCHECK_TIMEOUT_MS",
    "AI_PROVIDER_CONFIG_CACHE_TTL_MS",
]
REQUIRED_ROUTES = [
    "GET /ai/providers", "POST /ai/providers", "GET /ai/providers/:id", "PUT /ai/providers/:id",
    "POST /ai/providers/:id/test", "POST /ai/providers/:id/enable", "POST /ai/providers/:id/disable",
    "POST /ai/providers/:id/replace-secret", "POST /ai/providers/:id/clear-secret",
    "GET /ai/models", "POST /ai/models", "GET /ai/models/:id", "PUT /ai/models/:id",
    "POST /ai/models/:id/test", "POST /ai/models/:id/enable", "POST /ai/models/:id/disable",
    "POST /ai/models/:id/set-default",
]

NODE_BRIDGE = r"""
const mysql = require('mysql2/promise');
const { getDatabaseConfig } = require('./src/config/database');
(async () => {
  const config = getDatabaseConfig();
  const connection = await mysql.createConnection(config);
  const [[providers], [invalidSources], [partialSecrets], [modelColumns], [orphans], [legacyModelSecrets]] = await Promise.all([
    connection.query('SELECT COUNT(*) AS count FROM ai_providers'),
    connection.query("SELECT COUNT(*) AS count FROM ai_providers WHERE source_type NOT IN ('database','environment','mixed')"),
    connection.query("SELECT COUNT(*) AS count FROM ai_providers WHERE (secret_ciphertext IS NULL) <> (secret_iv IS NULL) OR (secret_ciphertext IS NULL) <> (secret_auth_tag IS NULL)"),
    connection.query("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_model_configs' AND COLUMN_NAME IN ('supports_rerank','created_by','updated_by')"),
    connection.query('SELECT COUNT(*) AS count FROM ai_model_configs m LEFT JOIN ai_providers p ON p.id = m.provider_id WHERE m.provider_id IS NOT NULL AND p.id IS NULL'),
    connection.query('SELECT COUNT(*) AS count FROM ai_model_configs WHERE api_key_encrypted IS NOT NULL'),
  ]);
  await connection.end();
  console.log('__ADMIN_AI_PROVIDER_AUDIT__' + JSON.stringify({
    provider_count: Number(providers[0].count),
    invalid_source_count: Number(invalidSources[0].count),
    partial_secret_count: Number(partialSecrets[0].count),
    model_contract_columns: Number(modelColumns[0].count),
    orphan_model_count: Number(orphans[0].count),
    legacy_model_secret_count: Number(legacyModelSecrets[0].count),
  }));
})().catch((error) => { console.error(error?.message || error); process.exit(1); });
"""


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    observed: str
    expected: str


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def db_state(root: Path) -> dict[str, int]:
    completed = subprocess.run(
        ["node", "-e", NODE_BRIDGE], cwd=root / "backend", text=True,
        capture_output=True, timeout=45, check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "database audit failed").strip())
    line = next((item for item in completed.stdout.splitlines() if item.startswith(MARKER)), None)
    if not line:
        raise RuntimeError("database audit did not return its aggregate payload")
    return json.loads(line[len(MARKER):])


def route_signatures(source: str) -> set[str]:
    signatures: set[str] = set()
    for method, path in __import__("re").findall(r"router\.(get|post|put)\('([^']+)'", source):
        signatures.add(f"{method.upper()} {path}")
    return signatures


def build(root: Path) -> tuple[str, list[Check]]:
    adapter = read(root / "backend/src/modules/ai/provider.adapter.js")
    schemas = read(root / "backend/src/services/admin-ai-config.schemas.js")
    service = read(root / "backend/src/services/admin-ai-config.service.js")
    runtime = read(root / "backend/src/services/ai-provider-config.service.js")
    factory = read(root / "backend/src/modules/ai/provider.factory.js")
    core_ai = read(root / "backend/src/services/ai.service.js")
    routes = route_signatures(read(root / "backend/src/routes/admin.routes.js"))
    frontend = read(root / "frontend/src/pages/admin-ai-config.js")
    secret = read(root / "backend/src/services/admin-secret.service.js")
    schema = read(root / "backend/prisma/schema.prisma")
    env_text = read(root / ".env.example") + read(root / "backend/.env.example")
    state = db_state(root)

    provider_input = schemas.split("const providerInput", 1)[1].split("const providerUpdate", 1)[0]
    checks = [
        Check("统一适配器九项操作", all(operation in adapter for operation in REQUIRED_OPERATIONS), f"{sum(operation in adapter for operation in REQUIRED_OPERATIONS)}/9", "9/9"),
        Check("七类供应商", all(kind in schemas for kind in ["bailian", "qwen", "deepseek", "spark", "dify", "openai_compatible", "custom"]), "7" if all(kind in schemas for kind in ["bailian", "qwen", "deepseek", "spark", "dify", "openai_compatible", "custom"]) else "incomplete", "7"),
        Check("AES-256-GCM", "aes-256-gcm" in secret and "AI_CONFIG_ENCRYPTION_KEY" in secret, "implemented" if "aes-256-gcm" in secret else "missing", "implemented"),
        Check("通用配置不接收密钥", not any(field in provider_input for field in ["api_key:", "api_secret:", "app_id:", "workspace_id:"]), "separate" if "api_key:" not in provider_input else "mixed", "separate"),
        Check("独立密钥服务操作", "replaceProviderSecret" in service and "clearProviderSecret" in service, "replace + clear", "replace + clear"),
        Check("配置解析与缓存", "AI_PROVIDER_CONFIG_CACHE_TTL_MS" in runtime and "resolveProviderRuntime" in factory and "providerFactory.getProvider" in core_ai, "centralized", "centralized"),
        Check("完整管理 API", all(item in routes for item in REQUIRED_ROUTES), f"{sum(item in routes for item in REQUIRED_ROUTES)}/{len(REQUIRED_ROUTES)}", f"{len(REQUIRED_ROUTES)}/{len(REQUIRED_ROUTES)}"),
        Check("前端独立密钥交互", "openProviderSecret" in frontend and "confirmAdmin" in frontend and "localStorage" not in frontend, "replace + confirm clear; no localStorage", "replace + confirm clear; no localStorage"),
        Check("环境变量契约", all(env_text.count(name) >= 2 for name in REQUIRED_ENV), f"{sum(env_text.count(name) >= 2 for name in REQUIRED_ENV)}/5", "5/5"),
        Check("模型字段契约", all(field in schema for field in ["supports_rerank", "created_by", "updated_by"]), "3/3", "3/3"),
        Check("真实供应商基线", state["provider_count"] >= 5, str(state["provider_count"]), ">=5"),
        Check("供应商来源枚举", state["invalid_source_count"] == 0, str(state["invalid_source_count"]), "0 invalid"),
        Check("密文三元组完整", state["partial_secret_count"] == 0, str(state["partial_secret_count"]), "0 partial"),
        Check("数据库模型补全字段", state["model_contract_columns"] == 3, str(state["model_contract_columns"]), "3"),
        Check("模型供应商外键一致", state["orphan_model_count"] == 0, str(state["orphan_model_count"]), "0 orphan"),
        Check("旧模型表无密钥残留", state["legacy_model_secret_count"] == 0, str(state["legacy_model_secret_count"]), "0"),
    ]
    rows = ["# DisciMind AI 供应商与密钥配置中心审计", "", "| 检查 | 状态 | 观测 | 期望 |", "| --- | --- | --- | --- |"]
    rows.extend(f"| {item.name} | {'PASS' if item.ok else 'FAIL'} | {item.observed} | {item.expected} |" for item in checks)
    rows.extend(["", "## 安全说明", "", "- 数据库检查仅返回聚合计数，不读取或输出密文、密钥、连接串或业务行。", "- 前端与 API 只允许展示配置状态、来源、最后四位和更新时间。", ""])
    return "\n".join(rows), checks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, default=Path("docs/admin-ai-provider-audit-result.md"))
    args = parser.parse_args()
    root = args.root.resolve()
    report, checks = build(root)
    output = args.output if args.output.is_absolute() else root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(report, encoding="utf-8", newline="\n")
    failed = [item for item in checks if not item.ok]
    print(f"admin AI provider audit written: {output} ({len(checks) - len(failed)} pass, {len(failed)} fail)")
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"admin AI provider audit failed: {error}", file=sys.stderr)
        raise SystemExit(2)
