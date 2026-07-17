#!/usr/bin/env python3
"""Authenticated API acceptance for the shared task and message center.

The fixture rows are created and removed by a narrow Prisma helper. Existing
notifications and task state are never modified; read-all is exercised only on
the empty ``student_b`` baseline account after adding one isolated fixture row.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE_URL = "http://localhost:3000/api"
TEST_PASSWORD = os.environ.get("DISCIMIND_TEST_PASSWORD")
SECONDARY_STUDENT_ACCOUNT = os.environ.get("DISCIMIND_TEST_SECONDARY_STUDENT_ACCOUNT")
FEED_KEYS = {
    "id", "item_type", "title", "summary", "status", "unread", "priority",
    "created_at", "source_type", "source_id", "action_type", "action_url", "role_scope",
}


@dataclass
class Report:
    marker: str
    checks: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    fixture_cleanup: dict[str, Any] | None = None

    def check(self, check_id: str, condition: bool, detail: str) -> None:
        self.checks.append({"id": check_id, "passed": bool(condition), "detail": detail})
        if not condition:
            self.errors.append(f"{check_id}: {detail}")


class Api:
    def __init__(self, base_url: str, token: str | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token

    def request(self, method: str, path: str, *, expected: int = 200, **kwargs: Any) -> requests.Response:
        headers = dict(kwargs.pop("headers", {}))
        headers.setdefault("Accept", "application/json")
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        response = requests.request(method, f"{self.base_url}{path}", headers=headers, timeout=12, **kwargs)
        if response.status_code != expected:
            raise AssertionError(f"{method} {path}: expected {expected}, got {response.status_code}: {response.text[:500]}")
        return response

    def data(self, method: str, path: str, *, expected: int = 200, **kwargs: Any) -> Any:
        payload = self.request(method, path, expected=expected, **kwargs).json()
        if expected < 400 and not payload.get("success"):
            raise AssertionError(f"{method} {path}: unsuccessful envelope: {payload}")
        return payload.get("data")


def fixture(command: str, marker: str) -> dict[str, Any]:
    completed = subprocess.run(
        ["node", str(ROOT / "scripts" / "cross_portal_test_fixture.js"), command, marker],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if completed.returncode:
        raise RuntimeError(f"fixture {command} failed: {completed.stderr.strip() or completed.stdout.strip()}")
    return json.loads(completed.stdout.strip())


def login(base_url: str, username: str) -> tuple[Api, dict[str, Any]]:
    data = Api(base_url).data("POST", "/auth/login", json={"account": username, "password": TEST_PASSWORD})
    token = data.get("token") or data.get("accessToken")
    if not token:
        raise AssertionError(f"login response for {username} has no access token")
    return Api(base_url, token), data["user"]


def validate_feed_rows(report: Report, check_prefix: str, rows: list[dict[str, Any]], role: str) -> None:
    missing = sorted({key for row in rows for key in FEED_KEYS - set(row)})
    wrong_roles = sorted({str(row.get("role_scope")) for row in rows if row.get("role_scope") != role})
    report.check(f"{check_prefix}.contract", not missing, f"missing keys={missing or 'none'}")
    report.check(f"{check_prefix}.role_scope", not wrong_roles, f"unexpected scopes={wrong_roles or 'none'}")


def run(base_url: str, report_path: Path) -> int:
    if not TEST_PASSWORD or not SECONDARY_STUDENT_ACCOUNT:
        raise RuntimeError("DISCIMIND_TEST_PASSWORD and DISCIMIND_TEST_SECONDARY_STUDENT_ACCOUNT are required")
    marker = f"uwc{int(time.time() * 1000)}"
    report = Report(marker=marker)
    fixture_rows: dict[str, dict[str, Any]] = {}
    clients: dict[str, Api] = {}
    cleanup_done = False
    try:
        setup = fixture("unified-setup", marker)
        fixture_rows = {row["username"]: row for row in setup["notifications"]}
        for username in fixture_rows:
            client, user = login(base_url, username)
            clients[username] = client
            report.check(f"login.{username}.role", user["role"] == fixture_rows[username]["role"], f"role={user['role']}")

        for username, row in fixture_rows.items():
            role = row["role"]
            client = clients[username]
            summary = client.data("GET", "/work-center/summary")
            validate_feed_rows(report, f"summary.{username}.tasks", summary["tasks"], role)
            validate_feed_rows(report, f"summary.{username}.messages", summary["messages"], role)
            report.check(
                f"summary.{username}.fixture_visible",
                any(item["id"] == row["notification_id"] for item in summary["messages"]),
                f"fixture notification={row['notification_id']}",
            )
            report.check(f"summary.{username}.counts", summary["unread_message_count"] >= 1, f"unread={summary['unread_message_count']}")

            messages = client.data("GET", "/work-center/messages?notification_type=system_notice&is_read=false&page_size=50")
            ids = {item["id"] for item in messages["list"]}
            foreign = {item["notification_id"] for name, item in fixture_rows.items() if name != username}
            report.check(f"messages.{username}.owned", row["notification_id"] in ids, f"ids={sorted(ids)}")
            report.check(f"messages.{username}.isolated", ids.isdisjoint(foreign), f"foreign intersection={sorted(ids & foreign)}")
            validate_feed_rows(report, f"messages.{username}", messages["list"], role)

            feed = client.data("GET", "/work-center/feed?limit=40")
            validate_feed_rows(report, f"feed.{username}", feed["list"], role)
            report.check(f"feed.{username}.fixture_visible", any(item["id"] == row["notification_id"] and item["item_type"] == "message" for item in feed["list"]), "fixture is present in aggregated feed")

            tasks = client.data("GET", "/work-center/tasks?page=1&page_size=20")
            validate_feed_rows(report, f"tasks.{username}", tasks["list"], role)

        usernames = list(fixture_rows)
        for index, username in enumerate(usernames):
            foreign = fixture_rows[usernames[(index + 1) % len(usernames)]]["notification_id"]
            clients[username].request("GET", f"/work-center/messages/{foreign}", expected=404)
            report.check(f"detail.{username}.cross_user_404", True, f"foreign notification={foreign}")

        primary_usernames = [next(row["username"] for row in fixture_rows.values() if row["role"] == role) for role in ("admin", "teacher", "student")]
        for username in primary_usernames:
            client = clients[username]
            notification_id = fixture_rows[username]["notification_id"]
            before = client.data("GET", "/work-center/summary")["unread_message_count"]
            detail = client.data("GET", f"/work-center/messages/{notification_id}")
            report.check(f"detail.{username}.content", marker in detail["title"] and detail["unread"], f"title={detail['title']}")
            client.data("POST", f"/work-center/messages/{notification_id}/read")
            after_detail = client.data("GET", f"/work-center/messages/{notification_id}")
            after = client.data("GET", "/work-center/summary")["unread_message_count"]
            report.check(f"read.{username}.state", after_detail["status"] == "read" and not after_detail["unread"], f"status={after_detail['status']}")
            report.check(f"read.{username}.count", after == before - 1, f"before={before}, after={after}")

        student_b = clients[SECONDARY_STUDENT_ACCOUNT]
        read_all = student_b.data("POST", "/work-center/messages/read-all")
        report.check("read_all.student_b.isolated", read_all["updated_count"] == 1, f"updated_count={read_all['updated_count']}")
        report.check("read_all.student_b.count", student_b.data("GET", "/work-center/summary")["unread_message_count"] == 0, "unread count returned to zero")

        cleanup = fixture("unified-cleanup", marker)
        cleanup_done = True
        report.fixture_cleanup = cleanup
        report.check("cleanup.notification_count", cleanup["deleted_notifications"] == len(fixture_rows), f"deleted={cleanup['deleted_notifications']}")
        for username, row in fixture_rows.items():
            clients[username].request("GET", f"/work-center/messages/{row['notification_id']}", expected=404)
        report.check("cleanup.no_fixture_visible", True, "all fixture message detail routes return 404 after hard cleanup")
    except Exception as error:  # noqa: BLE001 - acceptance harness must record all failures
        report.errors.append(str(error))
    finally:
        if not cleanup_done:
            try:
                report.fixture_cleanup = fixture("unified-cleanup", marker)
            except Exception as cleanup_error:  # noqa: BLE001
                report.errors.append(f"cleanup failed: {cleanup_error}")
        report_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema": "unified-center-api-acceptance.v1",
            "generated_at_epoch": time.time(),
            "base_url": base_url,
            "marker": marker,
            "passed": not report.errors,
            "checks": report.checks,
            "errors": report.errors,
            "fixture_cleanup": report.fixture_cleanup,
        }
        report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        passed = sum(1 for item in report.checks if item["passed"])
        print(f"unified center API: {passed}/{len(report.checks)} checks passed")
        print(f"report: {report_path}")
        if report.errors:
            print("errors:")
            for error in report.errors:
                print(f"- {error}")
    return 1 if report.errors else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--report", type=Path, default=ROOT / "artifacts" / "cross-portal-rebuild" / "unified-center-api.json")
    args = parser.parse_args()
    return run(args.base_url, args.report.resolve())


if __name__ == "__main__":
    sys.exit(main())
