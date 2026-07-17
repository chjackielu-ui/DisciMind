#!/usr/bin/env python3
"""Safe authenticated smoke harness for the DisciMind admin API.

The default run authenticates and performs GET-only contract checks.  Mutation
routes are touched only with ``--allow-writes`` and only with payloads that the
server must reject before persistence, because the current notification API has
no deletion route that could provide reliable cleanup after a successful send.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


REPORT_SCHEMA_VERSION = "admin-api-smoke.v1"
DEFAULT_BASE_URL = "http://localhost:3000/api"
DEFAULT_ACCOUNT = os.environ.get("ADMIN_SMOKE_ACCOUNT")
DEFAULT_PASSWORD = os.environ.get("ADMIN_SMOKE_PASSWORD")

# Exact normalized key names only.  Fields such as total_tokens and
# secret_configured are metadata and intentionally do not match this set.
SENSITIVE_KEY_NAMES = frozenset(
    {
        "apikey",
        "authorization",
        "password",
        "passwordhash",
        "refreshtoken",
        "secret",
        "secretauthtag",
        "secretciphertext",
        "secretiv",
        "token",
        "accesstoken",
    }
)

Validator = Callable[[Any], tuple[list[str], list[str], dict[str, Any]]]


@dataclass(slots=True)
class HttpResult:
    status: int | None
    body: Any
    duration_ms: int
    transport_error: str | None = None


@dataclass(frozen=True, slots=True)
class CheckSpec:
    check_id: str
    name: str
    path: str
    validator: Validator
    required: bool = True
    category: str = "base"


def positive_timeout(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("timeout must be a number") from error
    if not math.isfinite(parsed) or parsed <= 0:
        raise argparse.ArgumentTypeError("timeout must be greater than zero")
    return parsed


def normalize_base_url(value: str) -> str:
    candidate = value.strip().rstrip("/")
    parsed = urllib.parse.urlsplit(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("base URL must be an absolute http(s) URL")
    if parsed.username or parsed.password:
        raise ValueError("base URL must not contain embedded credentials")
    if parsed.query or parsed.fragment:
        raise ValueError("base URL must not contain a query string or fragment")
    return candidate


def request_json(
    url: str,
    *,
    timeout: float,
    method: str = "GET",
    token: str | None = None,
    payload: dict[str, Any] | None = None,
) -> HttpResult:
    body = None
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": f"DisciMind-admin-smoke/{REPORT_SCHEMA_VERSION}",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read()
        status = error.code
    except (urllib.error.URLError, TimeoutError, OSError):
        return HttpResult(
            status=None,
            body=None,
            duration_ms=round((time.monotonic() - started) * 1000),
            transport_error="connection_or_timeout_error",
        )

    duration_ms = round((time.monotonic() - started) * 1000)
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return HttpResult(
            status=status,
            body=None,
            duration_ms=duration_ms,
            transport_error="response_was_not_json",
        )
    return HttpResult(status=status, body=decoded, duration_ms=duration_ms)


def extract_access_token(login_body: Any) -> str | None:
    """Read the current camelCase token while retaining legacy compatibility."""
    if not isinstance(login_body, dict):
        return None
    data = login_body.get("data")
    containers = [data, login_body]
    for container in containers:
        if not isinstance(container, dict):
            continue
        for key in ("accessToken", "access_token", "token"):
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def normalized_key(value: Any) -> str:
    return "".join(character for character in str(value).lower() if character.isalnum())


def sensitive_key_paths(value: Any, path: str = "$") -> list[str]:
    matches: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if normalized_key(key) in SENSITIVE_KEY_NAMES:
                matches.append(child_path)
            else:
                matches.extend(sensitive_key_paths(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            matches.extend(sensitive_key_paths(child, f"{path}[{index}]"))
    return matches


def is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def success_envelope(body: Any) -> tuple[list[str], Any]:
    issues: list[str] = []
    if not isinstance(body, dict):
        return ["response_body_not_object"], None
    if body.get("success") is not True:
        issues.append("success_flag_not_true")
    if body.get("code") != 0:
        issues.append("business_code_not_zero")
    if not isinstance(body.get("message"), str):
        issues.append("message_not_string")
    if "data" not in body:
        issues.append("data_field_missing")
    return issues, body.get("data")


def validate_paginated(data: Any) -> tuple[list[str], list[str], dict[str, Any]]:
    issues: list[str] = []
    observed: dict[str, Any] = {}
    if not isinstance(data, dict):
        return ["data_not_object"], [], observed
    if not isinstance(data.get("list"), list):
        issues.append("list_not_array")
    else:
        observed["list_count"] = len(data["list"])
    if not is_finite_number(data.get("total")) or data["total"] < 0:
        issues.append("total_not_nonnegative_number")
    else:
        observed["total"] = data["total"]
    for field in ("page", "page_size"):
        if not is_finite_number(data.get(field)) or data[field] < 1:
            issues.append(f"{field}_not_positive_number")
        else:
            observed[field] = data[field]
    return issues, [], observed


def item_schema_issues(items: Any, required_fields: tuple[str, ...]) -> tuple[list[str], int]:
    issues: list[str] = []
    validated = 0
    if not isinstance(items, list):
        return issues, validated
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            issues.append(f"item_{index}_not_object")
            continue
        validated += 1
        for field in required_fields:
            if field not in item:
                issues.append(f"item_{index}_{field}_missing")
    return issues, validated


def paginated_validator(*required_item_fields: str) -> Validator:
    fields = tuple(required_item_fields)

    def validate(data: Any) -> tuple[list[str], list[str], dict[str, Any]]:
        issues, warnings, observed = validate_paginated(data)
        if isinstance(data, dict):
            item_issues, validated = item_schema_issues(data.get("list"), fields)
            issues.extend(item_issues)
            observed["items_schema_validated"] = validated
        return issues, warnings, observed

    return validate


def validate_dashboard(data: Any) -> tuple[list[str], list[str], dict[str, Any]]:
    issues: list[str] = []
    warnings: list[str] = []
    observed: dict[str, Any] = {}
    if not isinstance(data, dict):
        return ["data_not_object"], warnings, observed
    if data.get("contract_version") != "admin-dashboard.v1":
        issues.append("dashboard_contract_version_mismatch")
    else:
        observed["contract_version"] = data["contract_version"]

    summary = data.get("summary")
    summary_fields = (
        "user_count",
        "student_count",
        "teacher_count",
        "admin_count",
        "course_count",
        "admin_class_count",
        "teaching_class_count",
        "class_count",
        "knowledge_document_count",
        "ai_call_count_today",
        "pending_review_document_count",
        "pending_agent_review_count",
        "pending_agent_report_count",
        "unread_notification_count",
    )
    if not isinstance(summary, dict):
        issues.append("summary_not_object")
    else:
        for field in summary_fields:
            if not is_finite_number(summary.get(field)) or summary[field] < 0:
                issues.append(f"summary_{field}_not_nonnegative_number")
        observed["summary_field_count"] = sum(field in summary for field in summary_fields)

    trend = data.get("trend")
    if not isinstance(trend, list) or len(trend) != 14:
        issues.append("dashboard_trend_not_14_day_array")
    else:
        trend_fields = ("ai_calls", "ai_successes", "total_tokens", "learning_sessions", "completed_sessions")
        for index, row in enumerate(trend):
            if not isinstance(row, dict) or not isinstance(row.get("date"), str):
                issues.append(f"dashboard_trend_{index}_invalid")
                continue
            for field in trend_fields:
                if not is_finite_number(row.get(field)) or row[field] < 0:
                    issues.append(f"dashboard_trend_{index}_{field}_not_nonnegative_number")
        observed["trend_days"] = len(trend)

    distributions = data.get("distributions")
    distribution_fields = ("users", "classes", "knowledge_reviews")
    if not isinstance(distributions, dict):
        issues.append("dashboard_distributions_not_object")
    else:
        for field in distribution_fields:
            rows = distributions.get(field)
            if not isinstance(rows, list) or not rows:
                issues.append(f"dashboard_distribution_{field}_not_nonempty_array")
                continue
            for index, row in enumerate(rows):
                if (
                    not isinstance(row, dict)
                    or not isinstance(row.get("key"), str)
                    or not isinstance(row.get("label"), str)
                    or not is_finite_number(row.get("value"))
                    or row["value"] < 0
                ):
                    issues.append(f"dashboard_distribution_{field}_{index}_invalid")
        observed["distribution_count"] = len(distribution_fields)

    review_flow = data.get("review_flow")
    review_fields = {
        "knowledge_documents": ("pending", "approved", "rejected"),
        "agent_versions": ("pending", "approved", "rejected"),
        "reports": ("pending", "resolved"),
    }
    if not isinstance(review_flow, dict):
        issues.append("dashboard_review_flow_not_object")
    else:
        for field, statuses in review_fields.items():
            group = review_flow.get(field)
            if not isinstance(group, dict):
                issues.append(f"dashboard_review_flow_{field}_not_object")
                continue
            for status in statuses:
                if not is_finite_number(group.get(status)) or group[status] < 0:
                    issues.append(f"dashboard_review_flow_{field}_{status}_not_nonnegative_number")
        observed["review_flow_count"] = len(review_fields)

    metrics = data.get("metrics")
    if not isinstance(metrics, dict) or not isinstance(metrics.get("sample_status"), dict):
        issues.append("dashboard_sample_status_not_object")
    else:
        sample_status = metrics["sample_status"]
        for field in ("ai", "learning", "knowledge", "review"):
            if sample_status.get(field) not in ("sufficient", "insufficient_data"):
                issues.append(f"dashboard_sample_status_{field}_invalid")

    system_status = data.get("system_status")
    if not isinstance(system_status, dict):
        issues.append("system_status_not_object")
    else:
        for field in ("overall", "database"):
            if not isinstance(system_status.get(field), str) or not system_status[field]:
                issues.append(f"system_status_{field}_missing")
        observed["system_overall"] = system_status.get("overall")

    service_health = data.get("service_health")
    if not isinstance(service_health, dict):
        issues.append("service_health_not_object")
    else:
        if not isinstance(service_health.get("overall"), str) or not service_health["overall"]:
            issues.append("service_health_overall_missing")
        if not isinstance(service_health.get("services"), list):
            issues.append("service_health_services_not_array")
        else:
            observed["service_count"] = len(service_health["services"])

    module_errors = data.get("module_errors")
    if not isinstance(module_errors, list):
        issues.append("module_errors_not_array")
    else:
        observed["module_error_count"] = len(module_errors)
        if module_errors:
            warnings.append("dashboard_reports_optional_module_errors")
    if not isinstance(data.get("recent_events"), list):
        issues.append("recent_events_not_array")
    return issues, warnings, observed


def validate_collection(data: Any) -> tuple[list[str], list[str], dict[str, Any]]:
    if not isinstance(data, list):
        return ["data_not_array"], [], {}
    return [], [], {"item_count": len(data)}


def collection_validator(*required_item_fields: str) -> Validator:
    fields = tuple(required_item_fields)

    def validate(data: Any) -> tuple[list[str], list[str], dict[str, Any]]:
        issues, warnings, observed = validate_collection(data)
        item_issues, validated = item_schema_issues(data, fields)
        issues.extend(item_issues)
        observed["items_schema_validated"] = validated
        return issues, warnings, observed

    return validate


def validate_environment(data: Any) -> tuple[list[str], list[str], dict[str, Any]]:
    issues: list[str] = []
    observed: dict[str, Any] = {}
    if not isinstance(data, dict):
        return ["data_not_object"], [], observed
    required_components = ("database", "ai_encryption", "providers")
    for field in required_components:
        if not isinstance(data.get(field), dict):
            issues.append(f"environment_{field}_not_object")
    database = data.get("database")
    if isinstance(database, dict):
        for field in ("configured", "available"):
            if not isinstance(database.get(field), bool):
                issues.append(f"environment_database_{field}_not_boolean")
    observed["component_count"] = len([value for value in data.values() if isinstance(value, dict)])
    return issues, [], observed


def governance_validator(required_field: str) -> Validator:
    def validate(data: Any) -> tuple[list[str], list[str], dict[str, Any]]:
        if not isinstance(data, dict):
            return ["data_not_object"], [], {}
        issues = [] if required_field in data else [f"governance_{required_field}_missing"]
        return issues, [], {"field_count": len(data)}

    return validate


def make_check(
    *,
    check_id: str,
    name: str,
    method: str,
    path: str,
    required: bool,
    category: str,
    result: HttpResult,
    validator: Validator | None = None,
    expected_statuses: tuple[int, ...] = (200,),
    allow_missing_route: bool = False,
) -> dict[str, Any]:
    check: dict[str, Any] = {
        "id": check_id,
        "name": name,
        "category": category,
        "required": required,
        "method": method,
        "path": path,
        "status": result.status,
        "duration_ms": result.duration_ms,
        "outcome": "failed",
        "issues": [],
        "warnings": [],
        "observed": {},
    }
    if allow_missing_route and result.status == 404:
        check["outcome"] = "skipped"
        check["issues"].append("route_not_available")
        return check
    if result.transport_error:
        check["issues"].append(result.transport_error)
        return check
    if result.status not in expected_statuses:
        check["issues"].append(f"unexpected_http_status_{result.status}")
        return check

    envelope_issues, data = success_envelope(result.body)
    check["issues"].extend(envelope_issues)
    if not envelope_issues and validator is not None:
        validation_issues, warnings, observed = validator(data)
        check["issues"].extend(validation_issues)
        check["warnings"].extend(warnings)
        check["observed"] = observed

    leaked_paths = sensitive_key_paths(data)
    if leaked_paths:
        check["issues"].append("sensitive_fields_present")
        # Only schema paths are retained; response values are never emitted.
        check["observed"]["sensitive_field_paths"] = leaked_paths

    if not check["issues"]:
        check["outcome"] = "passed"
    return check


def run_get_check(base_url: str, token: str, timeout: float, spec: CheckSpec) -> dict[str, Any]:
    result = request_json(f"{base_url}{spec.path}", timeout=timeout, token=token)
    return make_check(
        check_id=spec.check_id,
        name=spec.name,
        method="GET",
        path=spec.path,
        required=spec.required,
        category=spec.category,
        result=result,
        validator=spec.validator,
        allow_missing_route=not spec.required,
    )


def validate_unauthorized(result: HttpResult) -> dict[str, Any]:
    issues: list[str] = []
    if result.transport_error:
        issues.append(result.transport_error)
    elif result.status != 401:
        issues.append(f"unexpected_http_status_{result.status}")
    elif not isinstance(result.body, dict) or not is_finite_number(result.body.get("code")):
        issues.append("unauthorized_envelope_invalid")
    return {
        "id": "auth.unauthorized_boundary",
        "name": "Unauthorized dashboard boundary",
        "category": "auth",
        "required": True,
        "method": "GET",
        "path": "/admin/dashboard",
        "status": result.status,
        "duration_ms": result.duration_ms,
        "outcome": "passed" if not issues else "failed",
        "issues": issues,
        "warnings": [],
        "observed": {},
    }


def validate_login(result: HttpResult) -> tuple[dict[str, Any], str | None]:
    issues: list[str] = []
    observed: dict[str, Any] = {}
    token = None
    if result.transport_error:
        issues.append(result.transport_error)
    elif result.status != 200:
        issues.append(f"unexpected_http_status_{result.status}")
    else:
        envelope_issues, data = success_envelope(result.body)
        issues.extend(envelope_issues)
        token = extract_access_token(result.body)
        if token is None:
            issues.append("access_token_missing")
        if not isinstance(data, dict) or not isinstance(data.get("user"), dict):
            issues.append("authenticated_user_missing")
        else:
            role = str(data["user"].get("role") or "").lower()
            if role != "admin":
                issues.append("authenticated_user_not_admin")
            observed["admin_role_confirmed"] = role == "admin"
    check = {
        "id": "auth.login",
        "name": "Admin login",
        "category": "auth",
        "required": True,
        "method": "POST",
        "path": "/auth/login",
        "status": result.status,
        "duration_ms": result.duration_ms,
        "outcome": "passed" if not issues else "failed",
        "issues": issues,
        "warnings": [],
        "observed": observed,
    }
    return check, token


def validate_expected_rejection(result: HttpResult) -> tuple[list[str], dict[str, Any]]:
    issues: list[str] = []
    if result.transport_error:
        return [result.transport_error], {}
    if result.status not in (400, 422):
        issues.append(f"unexpected_http_status_{result.status}")
    body = result.body
    if not isinstance(body, dict):
        issues.append("response_body_not_object")
    else:
        if body.get("success") is not False:
            issues.append("success_flag_not_false")
        if body.get("code") == 0 or not is_finite_number(body.get("code")):
            issues.append("error_business_code_invalid")
        if not isinstance(body.get("message"), str):
            issues.append("message_not_string")
    if issues:
        return issues, {"persistence": "unknown", "cleanup": "not_applicable_to_failed_guard_check"}
    return issues, {"persistence": "rejected_before_database_write", "cleanup": "not_required"}


def run_guarded_write_checks(base_url: str, token: str, timeout: float) -> list[dict[str, Any]]:
    # Both requests are rejected by controller/service validation before any
    # transaction starts.  A successful broadcast is deliberately not attempted:
    # the public API currently has no DELETE endpoint for deterministic cleanup.
    cases = [
        (
            "notifications.create_validation",
            "Notification create validation guard",
            "POST",
            "/admin/notifications",
            {},
        ),
        (
            "notifications.read_validation",
            "Notification read mutation validation guard",
            "PUT",
            "/admin/notifications/0/read",
            {},
        ),
    ]
    checks: list[dict[str, Any]] = []
    for check_id, name, method, path, payload in cases:
        result = request_json(
            f"{base_url}{path}",
            timeout=timeout,
            method=method,
            token=token,
            payload=payload,
        )
        issues, observed = validate_expected_rejection(result)
        outcome = "skipped" if result.status == 404 else "passed" if not issues else "failed"
        if result.status == 404:
            issues = ["route_not_available"]
        checks.append(
            {
                "id": check_id,
                "name": name,
                "category": "guarded_write",
                "required": False,
                "method": method,
                "path": path,
                "status": result.status,
                "duration_ms": result.duration_ms,
                "outcome": outcome,
                "issues": issues,
                "warnings": [],
                "observed": observed,
            }
        )
    return checks


def summarize(checks: list[dict[str, Any]], *, allow_writes: bool) -> dict[str, Any]:
    required_failed = [check for check in checks if check["required"] and check["outcome"] != "passed"]
    optional_failed = [check for check in checks if not check["required"] and check["outcome"] == "failed"]
    skipped = [check for check in checks if check["outcome"] == "skipped"]
    warned = [check for check in checks if check["warnings"]]
    passed = [check for check in checks if check["outcome"] == "passed"]
    if required_failed:
        result = "failed"
    elif optional_failed:
        result = "passed_with_optional_failures"
    elif warned:
        result = "passed_with_warnings"
    else:
        result = "passed"
    return {
        "result": result,
        "mode": "guarded-write" if allow_writes else "read-only",
        "total": len(checks),
        "passed": len(passed),
        "required_failed": len(required_failed),
        "optional_failed": len(optional_failed),
        "skipped": len(skipped),
        "warnings": len(warned),
        "exit_code": 1 if required_failed else 0,
    }


def markdown_summary(report: dict[str, Any], output: str | None) -> str:
    summary = report["summary"]
    lines = [
        f"### Admin API smoke: {summary['result'].upper()}",
        f"- Mode: {summary['mode']}",
        f"- Checks: {summary['passed']}/{summary['total']} passed; "
        f"{summary['required_failed']} required failed; {summary['optional_failed']} optional failed; "
        f"{summary['skipped']} skipped",
    ]
    failed = [check for check in report["checks"] if check["outcome"] == "failed"]
    for check in failed:
        scope = "required" if check["required"] else "optional"
        issues = ", ".join(check["issues"]) or "unknown_failure"
        lines.append(f"- [{scope}] {check['name']}: {issues}")
    for check in report["checks"]:
        if check["outcome"] == "skipped":
            lines.append(f"- [skipped] {check['name']}: route_not_available")
        elif check["warnings"]:
            lines.append(f"- [warning] {check['name']}: {', '.join(check['warnings'])}")
    if output and output != "-":
        lines.append("- JSON report written to the requested output path.")
    if summary["mode"] == "guarded-write":
        lines.append("- Notification write routes were validation-tested only; no persistent records required cleanup.")
    return "\n".join(lines)


def atomic_write_json(path_value: str, serialized: str) -> None:
    target = Path(path_value).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(f"{serialized}\n", encoding="utf-8")
        os.replace(temporary, target)
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        default=os.environ.get("ADMIN_SMOKE_BASE_URL", DEFAULT_BASE_URL),
        help="API root, normally ending in /api (env: ADMIN_SMOKE_BASE_URL)",
    )
    parser.add_argument(
        "--account",
        default=os.environ.get("ADMIN_SMOKE_ACCOUNT", DEFAULT_ACCOUNT),
        help="admin login account (env: ADMIN_SMOKE_ACCOUNT)",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("ADMIN_SMOKE_PASSWORD", DEFAULT_PASSWORD),
        help="admin login password (prefer env: ADMIN_SMOKE_PASSWORD)",
    )
    parser.add_argument("--timeout", type=positive_timeout, default=15.0, help="per-request timeout in seconds")
    parser.add_argument("--output", help="optional path for an atomic JSON report; use '-' for stdout only")
    parser.add_argument(
        "--allow-writes",
        action="store_true",
        help="also validate notification POST/PUT guards; no persistent notification is created",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.account or not args.password:
        parser.error("ADMIN_SMOKE_ACCOUNT and ADMIN_SMOKE_PASSWORD environment variables are required")
    try:
        base_url = normalize_base_url(args.base_url)
    except ValueError as error:
        parser.error(str(error))

    checks: list[dict[str, Any]] = []
    unauthorized = request_json(f"{base_url}/admin/dashboard", timeout=args.timeout)
    checks.append(validate_unauthorized(unauthorized))

    login_result = request_json(
        f"{base_url}/auth/login",
        timeout=args.timeout,
        method="POST",
        payload={"account": args.account, "password": args.password},
    )
    login_check, token = validate_login(login_result)
    checks.append(login_check)

    if login_check["outcome"] == "passed" and token:
        page = "?page=1&page_size=2"
        base_specs = [
            CheckSpec("dashboard", "Dashboard", "/admin/dashboard", validate_dashboard),
            CheckSpec("users", "Users", f"/admin/users{page}", paginated_validator("user_id", "username", "role", "status")),
            CheckSpec("courses", "Courses", f"/admin/courses{page}", paginated_validator("course_id", "course_name", "course_code", "status")),
            CheckSpec("admin_classes", "Admin classes", f"/admin/admin-classes{page}", paginated_validator("admin_class_id", "class_name", "student_count")),
            CheckSpec("knowledge_documents", "Knowledge documents", f"/admin/knowledge-documents{page}", paginated_validator("document_id", "title", "parse_status", "review_status")),
            CheckSpec("operation_logs", "Operation logs", f"/admin/operation-logs{page}", paginated_validator("operation_log_id", "operation_type", "created_at")),
            CheckSpec("notifications", "Notifications", f"/admin/notifications{page}", paginated_validator("notification_id", "notification_type", "title", "is_read")),
        ]
        optional_specs = [
            CheckSpec("ai.legacy_models", "Legacy AI model configs", "/admin/ai-model-configs", collection_validator("id", "model_code", "display_name", "enabled"), False, "optional_ai"),
            CheckSpec("ai.call_logs", "AI call logs", f"/admin/ai-call-logs{page}", paginated_validator("ai_call_log_id", "status", "created_at"), False, "optional_ai"),
            CheckSpec("ai.providers", "AI providers", "/admin/ai/providers", collection_validator("id", "provider_code", "display_name", "connection_status"), False, "optional_ai"),
            CheckSpec("ai.models", "AI models", "/admin/ai/models", collection_validator("id", "model_code", "display_name", "enabled"), False, "optional_ai"),
            CheckSpec("ai.agents", "AI agents", "/admin/agents", collection_validator("id", "agent_key", "name", "status"), False, "optional_ai"),
            CheckSpec("environment", "Environment status", "/admin/system/environment-status", validate_environment, False, "optional_ai"),
            CheckSpec("traces", "AI traces", f"/admin/traces{page}", paginated_validator("id", "request_id", "status"), False, "optional_governance"),
            CheckSpec(
                "governance.learning",
                "Learning-flow governance",
                "/admin/governance/learning-flows/overview",
                governance_validator("total_flows"),
                False,
                "optional_governance",
            ),
            CheckSpec(
                "governance.knowledge",
                "Knowledge-health governance",
                "/admin/governance/knowledge-health/overview",
                governance_validator("document_count"),
                False,
                "optional_governance",
            ),
            CheckSpec(
                "governance.teaching",
                "Teaching-issue governance",
                "/admin/governance/teaching-issues/overview",
                governance_validator("open_issue_count"),
                False,
                "optional_governance",
            ),
            CheckSpec(
                "governance.evaluations",
                "Agent-evaluation governance",
                "/admin/governance/evaluations/overview",
                governance_validator("evaluation_set_count"),
                False,
                "optional_governance",
            ),
            CheckSpec(
                "governance.experiments",
                "Experiment governance",
                "/admin/governance/experiments/overview",
                governance_validator("experiment_count"),
                False,
                "optional_governance",
            ),
            CheckSpec(
                "governance.digital_twin",
                "Digital-twin governance",
                "/admin/governance/digital-twin/overview",
                governance_validator("teaching_class_count"),
                False,
                "optional_governance",
            ),
            CheckSpec(
                "governance.assets",
                "Teaching-asset governance",
                "/admin/governance/assets/overview",
                governance_validator("asset_count"),
                False,
                "optional_governance",
            ),
            CheckSpec(
                "governance.strategy_profiles",
                "Strategy-profile governance",
                "/admin/governance/strategy-profiles/overview",
                governance_validator("profile_count"),
                False,
                "optional_governance",
            ),
            CheckSpec(
                "governance.risks",
                "Risk governance",
                "/admin/governance/risks/overview",
                governance_validator("open_event_count"),
                False,
                "optional_governance",
            ),
        ]
        checks.extend(run_get_check(base_url, token, args.timeout, spec) for spec in base_specs)
        checks.extend(run_get_check(base_url, token, args.timeout, spec) for spec in optional_specs)
        if args.allow_writes:
            checks.extend(run_guarded_write_checks(base_url, token, args.timeout))

    summary = summarize(checks, allow_writes=args.allow_writes)
    report: dict[str, Any] = {
        "schema_version": REPORT_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "target": {"base_url": base_url},
        "summary": summary,
        "checks": checks,
    }
    if login_check["outcome"] != "passed":
        report["aborted_reason"] = "authentication_failed"
    if args.allow_writes:
        report["write_policy"] = {
            "successful_mutation_payloads_sent": False,
            "cleanup_strategy": "pre_persistence_validation_rejection",
            "reason": "notification API has no deterministic delete cleanup route",
        }

    serialized = json.dumps(report, ensure_ascii=False, indent=2)
    output_failed = False
    if args.output and args.output != "-":
        try:
            atomic_write_json(args.output, serialized)
        except OSError:
            # Do not echo exception text: paths can contain sensitive host details.
            output_failed = True
            report["output_error"] = "report_write_failed"
            report["summary"]["result"] = "failed_to_write_output"
            report["summary"]["exit_code"] = 1
            serialized = json.dumps(report, ensure_ascii=False, indent=2)
            print("Unable to write the requested JSON report.", file=sys.stderr)

    print(serialized)
    print(markdown_summary(report, args.output), file=sys.stderr)
    return 1 if output_failed else summary["exit_code"]


if __name__ == "__main__":
    raise SystemExit(main())
