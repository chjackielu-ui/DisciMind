#!/usr/bin/env python3
"""Authenticated live-API lifecycle check for DisciMind learning flows.

The harness creates only one uniquely prefixed workflow, performs save/reload
and invalid-DAG checks, then permanently deletes it. Credentials are accepted
only through environment variables so they never appear in source or reports.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_API = "http://127.0.0.1:3000/api"
PREFIX = "CODEX-HARDENING-"


@dataclass(slots=True)
class Check:
    name: str
    passed: bool
    status: int | None
    duration_ms: int
    detail: str


class Harness:
    def __init__(self, base_url: str, account: str, password: str, timeout: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.account = account
        self.password = password
        self.timeout = timeout
        self.token: str | None = None
        self.marker = f"{PREFIX}{uuid.uuid4()}"
        self.template_id: int | None = None
        self.checks: list[Check] = []
        self.timings: list[int] = []
        self.cleanup: dict[str, Any] = {"attempted": False, "remaining": None}

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None, *, auth: bool = True) -> tuple[requests.Response, Any, int]:
        headers = {"Accept": "application/json", "User-Agent": "DisciMind-learning-flow-e2e/1.0"}
        if auth and self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        started = time.perf_counter()
        response = requests.request(
            method,
            f"{self.base_url}{path}",
            json=payload,
            headers=headers,
            timeout=self.timeout,
        )
        duration_ms = round((time.perf_counter() - started) * 1000)
        self.timings.append(duration_ms)
        try:
            body = response.json()
        except ValueError:
            body = None
        return response, body, duration_ms

    def record(self, name: str, condition: bool, response: requests.Response | None, duration_ms: int, detail: str) -> None:
        self.checks.append(Check(name, bool(condition), response.status_code if response else None, duration_ms, detail))
        if not condition:
            raise AssertionError(f"{name}: {detail}")

    @staticmethod
    def data(body: Any) -> Any:
        if not isinstance(body, dict) or body.get("code") != 0:
            raise AssertionError(f"unexpected response envelope: {json.dumps(body, ensure_ascii=False)[:500]}")
        return body.get("data")

    def run(self) -> None:
        response, body, elapsed = self.request("GET", "/health", auth=False)
        self.record("health", response.status_code == 200, response, elapsed, "backend health endpoint")

        response, _, elapsed = self.request("GET", "/learning-workflows/templates", auth=False)
        self.record("anonymous_rejected", response.status_code == 401, response, elapsed, "templates require authentication")

        response, body, elapsed = self.request(
            "POST", "/auth/login", {"account": self.account, "password": self.password}, auth=False
        )
        login_data = self.data(body) if response.status_code == 200 else None
        token = login_data.get("accessToken") if isinstance(login_data, dict) else None
        self.record("login", response.status_code == 200 and isinstance(token, str), response, elapsed, "test account authenticated")
        self.token = token

        response, body, elapsed = self.request("GET", "/student/courses")
        course_data = self.data(body)
        courses = course_data.get("list", []) if isinstance(course_data, dict) else []
        self.record("course_scope", response.status_code == 200 and bool(courses), response, elapsed, f"available_courses={len(courses)}")
        course_id = int(courses[0]["course_id"])

        response, body, elapsed = self.request("GET", f"/student/courses/{course_id}/knowledge-points")
        point_data = self.data(body)
        points = point_data.get("list", []) if isinstance(point_data, dict) else (point_data if isinstance(point_data, list) else [])
        self.record("knowledge_point_scope", response.status_code == 200 and bool(points), response, elapsed, f"available_points={len(points)}")
        point_id = int(points[0]["knowledge_point_id"])

        graph = {
            "entryNodeId": "gate",
            "nodes": [{
                "id": "gate", "type": "mastery_gate", "title": "掌握度判断",
                "config": {}, "position": {"x": 120, "y": 160},
            }],
            "edges": [],
        }
        settings = {
            "completion_mode": "flow_complete", "target_mastery": 80,
            "adjustment_mode": "strict_original", "estimated_minutes": 3,
        }
        response, body, elapsed = self.request("POST", "/learning-workflows/templates", {
            "title": self.marker, "description": "live API lifecycle fixture",
            "course_id": course_id, "knowledge_point_id": point_id,
            "graph_json": graph, "settings_json": settings,
        })
        created = self.data(body) if response.status_code == 200 else None
        self.template_id = int(created["template_id"]) if isinstance(created, dict) and created.get("template_id") else None
        self.record("create", response.status_code == 200 and self.template_id is not None, response, elapsed, f"template_id={self.template_id}")

        updated_graph = json.loads(json.dumps(graph))
        updated_graph["nodes"][0]["position"] = {"x": 360, "y": 240}
        response, body, elapsed = self.request("PUT", f"/learning-workflows/templates/{self.template_id}", {
            "title": f"{self.marker}-saved", "graph_json": updated_graph,
            "settings_json": settings, "change_summary": f"{self.marker}-position-save",
        })
        updated = self.data(body) if response.status_code == 200 else None
        position = updated.get("latestVersion", {}).get("graph_json", {}).get("nodes", [{}])[0].get("position") if isinstance(updated, dict) else None
        self.record("save_position", response.status_code == 200 and position == {"x": 360, "y": 240}, response, elapsed, f"position={position}")

        response, body, elapsed = self.request("GET", f"/learning-workflows/templates/{self.template_id}")
        reloaded = self.data(body) if response.status_code == 200 else None
        persisted = reloaded.get("latestVersion", {}).get("graph_json", {}).get("nodes", [{}])[0].get("position") if isinstance(reloaded, dict) else None
        self.record("reload_position", response.status_code == 200 and persisted == {"x": 360, "y": 240}, response, elapsed, f"position={persisted}")

        invalid_graph = json.loads(json.dumps(updated_graph))
        invalid_graph["edges"] = [{"id": "self", "source": "gate", "target": "gate", "condition": {"type": "always", "params": {}}}]
        response, body, elapsed = self.request("PUT", f"/learning-workflows/templates/{self.template_id}", {
            "graph_json": invalid_graph, "settings_json": settings,
        })
        message = body.get("message", "") if isinstance(body, dict) else ""
        self.record("reject_cycle", response.status_code == 400 and "循环路径" in message, response, elapsed, "self-loop rejected")

        response, body, elapsed = self.request("GET", f"/learning-workflows/templates/{self.template_id}/versions")
        versions = self.data(body) if response.status_code == 200 else None
        self.record("version_integrity", response.status_code == 200 and isinstance(versions, list) and len(versions) == 2, response, elapsed, f"versions={len(versions or [])}")

        response, body, elapsed = self.request("DELETE", f"/learning-workflows/templates/{self.template_id}")
        deleted = self.data(body) if response.status_code == 200 else None
        permanent = isinstance(deleted, dict) and deleted.get("deletedPermanently") == 1
        self.record("delete", response.status_code == 200 and permanent, response, elapsed, json.dumps(deleted, ensure_ascii=False))
        self.template_id = None

        response, _, elapsed = self.request("GET", f"/learning-workflows/templates?search={self.marker}")
        listed = response.json().get("data", {}).get("items", []) if response.status_code == 200 else []
        remaining = [item for item in listed if self.marker in str(item.get("title", ""))]
        self.cleanup = {"attempted": True, "remaining": len(remaining)}
        self.record("cleanup_verified", response.status_code == 200 and not remaining, response, elapsed, f"remaining={len(remaining)}")

    def cleanup_exact(self) -> None:
        if not self.token:
            return
        ids: set[int] = set()
        if self.template_id:
            ids.add(self.template_id)
        try:
            response, body, _ = self.request("GET", f"/learning-workflows/templates?search={self.marker}")
            if response.status_code == 200:
                items = self.data(body).get("items", [])
                ids.update(int(item["template_id"]) for item in items if self.marker in str(item.get("title", "")))
            for template_id in ids:
                self.request("DELETE", f"/learning-workflows/templates/{template_id}")
            response, body, _ = self.request("GET", f"/learning-workflows/templates?search={self.marker}")
            items = self.data(body).get("items", []) if response.status_code == 200 else []
            self.cleanup = {"attempted": True, "matched_ids": sorted(ids), "remaining": sum(self.marker in str(item.get("title", "")) for item in items)}
        except Exception as error:  # cleanup is reported but never hides the primary failure
            self.cleanup = {"attempted": True, "matched_ids": sorted(ids), "error": type(error).__name__}

    def report(self, error: Exception | None) -> dict[str, Any]:
        passed = error is None and all(check.passed for check in self.checks) and self.cleanup.get("remaining") == 0
        return {
            "schemaVersion": "learning-flow-api-e2e.v1",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "baseUrl": self.base_url,
            "marker": self.marker,
            "passed": passed,
            "checks": [asdict(check) for check in self.checks],
            "latencyMs": {
                "count": len(self.timings),
                "min": min(self.timings) if self.timings else None,
                "median": round(statistics.median(self.timings), 1) if self.timings else None,
                "max": max(self.timings) if self.timings else None,
            },
            "cleanup": self.cleanup,
            "error": None if error is None else {"type": type(error).__name__, "message": str(error)[:800]},
        }


def write_report(report: dict[str, Any], directory: Path) -> tuple[Path, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    json_path = directory / "learning-flow-api-e2e.json"
    md_path = directory / "learning-flow-api-e2e.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    rows = "\n".join(
        f"| {item['name']} | {'PASS' if item['passed'] else 'FAIL'} | {item['status']} | {item['duration_ms']} | {item['detail']} |"
        for item in report["checks"]
    )
    md_path.write_text(
        "# Learning Flow Live API E2E\n\n"
        f"- Result: **{'PASS' if report['passed'] else 'FAIL'}**\n"
        f"- Marker: `{report['marker']}`\n"
        f"- Cleanup: `{json.dumps(report['cleanup'], ensure_ascii=False)}`\n\n"
        "| Check | Result | HTTP | ms | Detail |\n|---|---:|---:|---:|---|\n"
        f"{rows}\n",
        encoding="utf-8",
    )
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("DISCIMIND_API_URL", DEFAULT_API))
    parser.add_argument("--account", default=os.environ.get("DISCIMIND_TEST_ACCOUNT"))
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--report-dir", type=Path, default=ROOT / "artifacts" / "hardening")
    args = parser.parse_args()
    password = os.environ.get("DISCIMIND_TEST_PASSWORD")
    if not args.account or not password:
        parser.error("set DISCIMIND_TEST_ACCOUNT and DISCIMIND_TEST_PASSWORD; credentials are never accepted in source or report files")

    harness = Harness(args.base_url, args.account, password, args.timeout)
    error: Exception | None = None
    try:
        harness.run()
    except Exception as caught:  # report the first failure after exact cleanup
        error = caught
    finally:
        harness.cleanup_exact()
    report = harness.report(error)
    json_path, md_path = write_report(report, args.report_dir)
    print(json.dumps({"passed": report["passed"], "checks": len(report["checks"]), "report": str(json_path), "summary": str(md_path)}, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
