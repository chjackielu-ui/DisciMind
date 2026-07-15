#!/usr/bin/env python3
"""End-to-end permission and lifecycle acceptance for course files."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[1]
STORAGE_ROOT = ROOT / "storage" / "course-files"
DEFAULT_BASE_URL = "http://localhost:3000/api"
PASSWORD = "123456"


@dataclass
class Report:
    marker: str
    checks: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    cleanup: dict[str, Any] | None = None

    def check(self, check_id: str, condition: bool, detail: str) -> None:
        self.checks.append({"id": check_id, "passed": bool(condition), "detail": detail})
        if not condition:
            self.errors.append(f"{check_id}: {detail}")


class Api:
    def __init__(self, base_url: str, token: str | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token

    def request(self, method: str, path: str, *, expected: int | tuple[int, ...] = 200, **kwargs: Any) -> requests.Response:
        headers = dict(kwargs.pop("headers", {}))
        headers.setdefault("Accept", "application/json")
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        response = requests.request(method, f"{self.base_url}{path}", headers=headers, timeout=30, **kwargs)
        statuses = (expected,) if isinstance(expected, int) else expected
        if response.status_code not in statuses:
            raise AssertionError(f"{method} {path}: expected {statuses}, got {response.status_code}: {response.text[:500]}")
        return response

    def data(self, method: str, path: str, *, expected: int | tuple[int, ...] = 200, **kwargs: Any) -> Any:
        response = self.request(method, path, expected=expected, **kwargs)
        payload = response.json()
        if response.status_code < 400 and not payload.get("success"):
            raise AssertionError(f"{method} {path}: unsuccessful envelope: {payload}")
        return payload.get("data")


def login(base_url: str, username: str, password: str = PASSWORD) -> tuple[Api, dict[str, Any]]:
    data = Api(base_url).data("POST", "/auth/login", json={"account": username, "password": password})
    token = data.get("token") or data.get("accessToken")
    if not token:
        raise AssertionError(f"login response for {username} has no token")
    return Api(base_url, token), data["user"]


def cleanup_fixture(marker: str, username: str) -> dict[str, Any]:
    completed = subprocess.run(
        ["node", str(ROOT / "scripts" / "cross_portal_test_fixture.js"), "course-cleanup", marker, username],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if completed.returncode:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip())
    return json.loads(completed.stdout.strip())


def storage_snapshot() -> set[str]:
    if not STORAGE_ROOT.exists():
        return set()
    return {item.name for item in STORAGE_ROOT.iterdir() if item.is_file()}


def find_fixture_message(client: Api, file_id: int) -> tuple[dict[str, Any] | None, int]:
    data = client.data("GET", "/work-center/messages?notification_type=resource_shared&page_size=50")
    matches = [item for item in data["list"] if int(item.get("source_id") or -1) == file_id]
    return (matches[0] if matches else None), len(matches)


def run(base_url: str, report_path: Path) -> int:
    marker = f"cf{int(time.time() * 1000)}"
    temp_username = f"teacher_{marker}"[:50]
    title = f"课程文件验收-{marker}"
    filename = f"跨端课程文件验收-{marker}.txt"
    content = f"DisciMind course file acceptance {marker}\n".encode("utf-8")
    report = Report(marker=marker)
    before_storage = storage_snapshot()
    cleanup_done = False
    file_id: int | None = None
    try:
        admin, admin_user = login(base_url, "admin_demo")
        teacher, teacher_user = login(base_url, "teacher_demo")
        student, student_user = login(base_url, "student_demo")
        student_b, _ = login(base_url, "student_b")
        report.check("accounts.roles", [admin_user["role"], teacher_user["role"], student_user["role"]] == ["admin", "teacher", "student"], "admin/teacher/student roles authenticated")

        student_courses = student.data("GET", "/student/courses")["list"]
        if not student_courses:
            raise AssertionError("student_demo has no active course fixture")
        course_id = int(student_courses[0]["course_id"])
        class_id = int(student_courses[0]["teaching_class_id"])
        teacher_classes = teacher.data("GET", f"/teacher/courses/{course_id}/teaching-classes")["list"]
        report.check("fixture.student_class", any(int(item["teaching_class_id"]) == class_id for item in teacher_classes), f"course={course_id}, class={class_id}")

        teacher_courses = teacher.data("GET", "/teacher/courses")["list"]
        mismatch_course = next((int(item["course_id"]) for item in teacher_courses if int(item["course_id"]) != course_id), None)
        if mismatch_course is None:
            raise AssertionError("a second course is required for mismatch validation")
        mismatch_class = int(teacher.data("GET", f"/teacher/courses/{mismatch_course}/teaching-classes")["list"][0]["teaching_class_id"])

        created = admin.data("POST", "/admin/users", json={
            "username": temp_username,
            "password": PASSWORD,
            "role": "teacher",
            "real_name": "课程文件越权验收教师",
            "teacher_no": marker,
        })
        report.check("fixture.temp_teacher_created", created["username"] == temp_username and created["role"] == "teacher", f"user_id={created['user_id']}")
        outsider, _ = login(base_url, temp_username)

        file_path = f"/courses/{course_id}/teaching-classes/{class_id}/files"
        multipart = {"file": (filename, content, "text/plain")}
        fields = {"title": title, "description": "发布给当前教学班的真实验收文件", "category": "courseware", "publish_now": "false"}

        outsider.request("POST", file_path, expected=403, files=multipart, data=fields)
        report.check("permission.non_responsible_teacher_upload", True, "non-responsible teacher rejected before persistence")
        student.request("POST", file_path, expected=403, files=multipart, data=fields)
        report.check("permission.student_upload", True, "student upload rejected by backend role middleware")
        teacher.request("POST", f"/courses/{course_id}/teaching-classes/{mismatch_class}/files", expected=400, files=multipart, data=fields)
        report.check("permission.course_class_mismatch", True, f"course={course_id}, mismatched_class={mismatch_class}")

        pre_invalid_storage = storage_snapshot()
        teacher.request("POST", file_path, expected=400, files={"file": (f"bad-{marker}.exe", b"MZ", "application/octet-stream")}, data=fields)
        report.check("security.extension_mime", storage_snapshot() == pre_invalid_storage, "unsupported extension/MIME rejected without orphan file")
        teacher.request("POST", file_path, expected=400, files={"file": (f"spoof-{marker}.pdf", b"not a real pdf", "application/pdf")}, data=fields)
        report.check("security.magic_bytes", storage_snapshot() == pre_invalid_storage, "spoofed PDF MIME rejected by content signature without orphan file")
        oversized = b"x" * (30 * 1024 * 1024 + 1)
        teacher.request("POST", file_path, expected=400, files={"file": (f"large-{marker}.txt", oversized, "text/plain")}, data=fields)
        report.check("security.size_limit", storage_snapshot() == pre_invalid_storage, "30MB limit rejected without orphan file")
        del oversized

        uploaded = teacher.data("POST", file_path, expected=201, files=multipart, data=fields)
        file_record = uploaded["file"]
        file_id = int(file_record["file_id"])
        report.check("upload.metadata", file_record["status"] == "draft" and file_record["checksum"] and file_record["size_bytes"] == len(content), f"file_id={file_id}, status={file_record['status']}")
        report.check("upload.storage_isolated", len(storage_snapshot() - pre_invalid_storage) == 1, f"new physical files={sorted(storage_snapshot() - pre_invalid_storage)}")

        duplicate = teacher.data("POST", file_path, expected=200, files=multipart, data=fields)
        report.check("upload.deduplication", duplicate["duplicate"] and int(duplicate["file"]["file_id"]) == file_id, "same checksum/uploader/course/class reuses the record")

        teacher_list = teacher.data("GET", file_path)["list"]
        admin_list = admin.data("GET", file_path)["list"]
        student_list = student.data("GET", file_path)["list"]
        report.check("draft.teacher_admin_visible", any(item["file_id"] == file_id for item in teacher_list) and any(item["file_id"] == file_id for item in admin_list), "draft is visible to authorized teacher and admin")
        report.check("draft.student_hidden", all(item["file_id"] != file_id for item in student_list), "draft is not visible to enrolled student")
        student.request("GET", f"{file_path}/{file_id}/download", expected=404)
        report.check("draft.student_download_blocked", True, "draft cannot be downloaded by student")

        teacher.data("PATCH", f"{file_path}/{file_id}", json={"title": f"{title}-已编辑", "description": "编辑后的课程文件说明", "category": "reading"})
        teacher.request("PATCH", f"{file_path}/{file_id}", expected=400, json={"category": "invalid-category"})
        student.request("PATCH", f"{file_path}/{file_id}", expected=403, json={"title": "越权编辑"})
        report.check("edit.validation_and_rbac", True, "teacher edit persisted; invalid category and student edit rejected")

        published = teacher.data("POST", f"{file_path}/{file_id}/publish")["file"]
        report.check("publish.state", published["status"] == "active" and published["recipient_count"] >= 1, f"recipients={published['recipient_count']}")
        published_student_list = student.data("GET", f"{file_path}?category=reading&keyword={marker}")["list"]
        student_file = next((item for item in published_student_list if item["file_id"] == file_id), None)
        report.check("publish.student_visible", bool(student_file) and student_file["is_unread"], f"file={student_file}")

        student_b.request("GET", file_path, expected=403)
        student_b.request("GET", f"{file_path}/{file_id}/download", expected=403)
        report.check("permission.cross_class_student", True, "student without active enrollment cannot list or download")
        student.request("POST", f"{file_path}/{file_id}/publish", expected=403)
        student.request("POST", f"{file_path}/{file_id}/unpublish", expected=403)
        student.request("DELETE", f"{file_path}/{file_id}", expected=403)
        report.check("permission.student_mutations", True, "publish, unpublish and delete all return 403")

        teacher_download = teacher.request("GET", f"{file_path}/{file_id}/download")
        report.check("download.teacher", teacher_download.content == content, f"bytes={len(teacher_download.content)}")
        student_download = student.request("GET", f"{file_path}/{file_id}/download")
        disposition = student_download.headers.get("Content-Disposition", "")
        report.check("download.student_controlled", student_download.content == content and "filename*=UTF-8''" in disposition and "%E8%B7%A8" in disposition, disposition)
        downloaded_record = next(item for item in student.data("GET", file_path)["list"] if item["file_id"] == file_id)
        report.check("download.tracking", downloaded_record["is_downloaded"] and downloaded_record["downloaded_count"] >= 1, f"downloaded_count={downloaded_record['downloaded_count']}")

        message, message_count = find_fixture_message(student, file_id)
        report.check("notification.single", message_count == 1 and message is not None, f"matching messages={message_count}")
        if not message:
            raise AssertionError("published course file did not create a work-center notification")
        detail = student.data("GET", f"/work-center/messages/{message['id']}")
        report.check("notification.detail", detail["action_type"] == "course_file" and detail["related"]["file"]["document_id"] == file_id, f"action_url={detail['action_url']}")

        teacher.data("POST", f"{file_path}/{file_id}/unpublish")
        report.check("unpublish.student_hidden", all(item["file_id"] != file_id for item in student.data("GET", file_path)["list"]), "unpublished file disappears from student list")
        student.request("GET", f"{file_path}/{file_id}/download", expected=404)
        teacher.data("POST", f"{file_path}/{file_id}/publish")
        _, republished_message_count = find_fixture_message(student, file_id)
        report.check("publish.notification_idempotent", republished_message_count == 1, f"matching messages after republish={republished_message_count}")

        teacher.data("DELETE", f"{file_path}/{file_id}")
        report.check("delete.soft_hidden", all(item["file_id"] != file_id for item in student.data("GET", file_path)["list"]), "soft-deleted file is hidden")
        student.request("GET", f"{file_path}/{file_id}/download", expected=404)

        cleanup = cleanup_fixture(marker, temp_username)
        cleanup_done = True
        report.cleanup = cleanup
        report.check("cleanup.database", cleanup["deleted_documents"] == 1 and cleanup["deleted_users"] == 1, json.dumps(cleanup, ensure_ascii=False))
        report.check("cleanup.storage", storage_snapshot() == before_storage, f"remaining delta={sorted(storage_snapshot() - before_storage)}")
    except Exception as error:  # noqa: BLE001
        report.errors.append(str(error))
    finally:
        if not cleanup_done:
            try:
                report.cleanup = cleanup_fixture(marker, temp_username)
            except Exception as cleanup_error:  # noqa: BLE001
                report.errors.append(f"cleanup failed: {cleanup_error}")
        report_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema": "course-file-permission-acceptance.v1",
            "generated_at_epoch": time.time(),
            "base_url": base_url,
            "marker": marker,
            "passed": not report.errors,
            "checks": report.checks,
            "errors": report.errors,
            "cleanup": report.cleanup,
        }
        report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        passed = sum(1 for item in report.checks if item["passed"])
        print(f"course file permission API: {passed}/{len(report.checks)} checks passed")
        print(f"report: {report_path}")
        if report.errors:
            print("errors:")
            for error in report.errors:
                print(f"- {error}")
    return 1 if report.errors else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--report", type=Path, default=ROOT / "artifacts" / "cross-portal-rebuild" / "course-file-permission.json")
    args = parser.parse_args()
    return run(args.base_url, args.report.resolve())


if __name__ == "__main__":
    sys.exit(main())
