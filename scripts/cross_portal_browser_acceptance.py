#!/usr/bin/env python3
"""Real-browser cross-portal acceptance at the required desktop breakpoints."""

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
from playwright.sync_api import Browser, Page, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts" / "cross-portal-rebuild"
DEFAULT_FRONTEND = "http://localhost:5173"
DEFAULT_API = "http://localhost:3000/api"
PASSWORD = "123456"
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
VIEWPORTS = ((1920, 1080), (1440, 900), (1366, 768), (1024, 768))
ROUTES = {
    "admin": "#/admin/dashboard",
    "teacher": "#/teacher/dashboard",
    "student": "#/student/dashboard",
}
ACCOUNTS = {
    "admin": "admin_demo",
    "teacher": "teacher_demo",
    "student": "student_demo",
}


@dataclass
class Acceptance:
    marker: str
    checks: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    diagnostics: dict[str, Any] = field(default_factory=dict)
    screenshots: list[str] = field(default_factory=list)
    cleanup: dict[str, Any] | None = None

    def check(self, check_id: str, condition: bool, detail: Any) -> None:
        row = {"id": check_id, "passed": bool(condition), "detail": detail}
        self.checks.append(row)
        if not condition:
            self.errors.append(f"{check_id}: {detail}")


def api_login(api_url: str, username: str) -> dict[str, Any]:
    response = requests.post(f"{api_url}/auth/login", json={"account": username, "password": PASSWORD}, timeout=12)
    response.raise_for_status()
    data = response.json()["data"]
    return {
        "token": data.get("token") or data.get("accessToken"),
        "session_id": data.get("sessionId"),
        "user": data["user"],
    }


def auth_page(page: Page, frontend_url: str, auth: dict[str, Any], route: str) -> None:
    page.goto(f"{frontend_url}/#/login", wait_until="domcontentloaded", timeout=20_000)
    page.evaluate(
        """auth => {
          sessionStorage.setItem('discimind_access_token', auth.token);
          sessionStorage.setItem('discimind_user', JSON.stringify(auth.user));
          sessionStorage.setItem('discimind_session_id', String(auth.session_id));
          sessionStorage.setItem('discimind_session_authenticated', 'true');
          sessionStorage.setItem('discimind_last_activity_at', String(Date.now()));
        }""",
        auth,
    )
    page.goto(f"{frontend_url}/{route}", wait_until="domcontentloaded", timeout=20_000)
    page.wait_for_selector("#student-main", state="attached", timeout=20_000)
    page.wait_for_selector("#unified-work-center", state="attached", timeout=20_000)


def rect(page: Page, selector: str) -> dict[str, float] | None:
    return page.locator(selector).evaluate(
        "el => { const r=el.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; }"
    ) if page.locator(selector).count() == 1 else None


def take(page: Page, acceptance: Acceptance, name: str) -> None:
    path = ARTIFACTS / name
    page.screenshot(path=str(path), full_page=False)
    acceptance.screenshots.append(path.relative_to(ROOT).as_posix())


def dashboard_metrics(page: Page) -> dict[str, Any]:
    return page.evaluate(
        """() => {
          const q=s=>document.querySelector(s), box=e=>{const r=e?.getBoundingClientRect();return r?{left:r.left,top:r.top,width:r.width,height:r.height}:null};
          const grid=q('.admin-dashboard-grid');
          const menu=q('#sidebar-menu-wrap');
          return {
            main:box(q('#student-main')),
            grid:box(grid),
            chart:box(q('.admin-dashboard-trend-card')),
            sidebar:box(q('#student-sidebar')),
            sidebar_class:q('#student-sidebar')?.className || '',
            scroll_top:document.scrollingElement?.scrollTop || 0,
            scroll_width:document.documentElement.scrollWidth,
            client_width:document.documentElement.clientWidth,
            grid_rows:grid ? new Set([...grid.children].map(el=>Math.round(el.getBoundingClientRect().top))).size : null,
            menu_overflow_y:menu ? getComputedStyle(menu).overflowY : null,
            menu_scroll_height:menu?.scrollHeight || 0,
            menu_client_height:menu?.clientHeight || 0,
          };
        }"""
    )


def test_admin_sidebar(page: Page, acceptance: Acceptance, width: int, height: int) -> None:
    pin = page.locator("#sidebar-pin-btn")
    if pin.count() != 1:
        acceptance.check(f"admin.{width}.sidebar.pin", False, "pin control missing")
        return
    page.mouse.move(width - 40, height - 40)
    if pin.get_attribute("aria-pressed") != "true":
        pin.click()
    page.mouse.move(width - 40, height - 40)
    page.wait_for_timeout(180)
    page.evaluate("window.scrollTo(0, Math.min(300, document.documentElement.scrollHeight - innerHeight))")
    page.wait_for_timeout(220)
    expanded = dashboard_metrics(page)
    pin.click()
    page.mouse.move(width - 40, height - 40)
    page.wait_for_timeout(220)
    collapsed = dashboard_metrics(page)
    delta = {
        "main_left": round(collapsed["main"]["left"] - expanded["main"]["left"], 3),
        "main_width": round(collapsed["main"]["width"] - expanded["main"]["width"], 3),
        "grid_width": round(collapsed["grid"]["width"] - expanded["grid"]["width"], 3),
        "chart_width": round(collapsed["chart"]["width"] - expanded["chart"]["width"], 3),
        "scroll_top": round(collapsed["scroll_top"] - expanded["scroll_top"], 3),
        "grid_rows": collapsed["grid_rows"] - expanded["grid_rows"],
    }
    acceptance.diagnostics[f"admin_sidebar_{width}x{height}"] = {"expanded": expanded, "collapsed": collapsed, "delta": delta}
    acceptance.check(f"admin.{width}.sidebar.fixed_geometry", all(abs(delta[key]) <= 1 for key in ("main_left", "main_width", "grid_width", "chart_width")), delta)
    acceptance.check(f"admin.{width}.sidebar.scroll_stable", abs(delta["scroll_top"]) <= 1, delta)
    acceptance.check(f"admin.{width}.sidebar.grid_stable", delta["grid_rows"] == 0, delta)
    acceptance.check(f"admin.{width}.sidebar.widths", 72 <= collapsed["sidebar"]["width"] <= 80 and 230 <= expanded["sidebar"]["width"] <= 250, {"collapsed": collapsed["sidebar"]["width"], "expanded": expanded["sidebar"]["width"]})
    acceptance.check(f"admin.{width}.sidebar.viewport", collapsed["sidebar"]["top"] >= 0 and collapsed["sidebar"]["height"] <= height, collapsed["sidebar"])
    acceptance.check(f"admin.{width}.sidebar.internal_scroll", collapsed["menu_overflow_y"] in {"auto", "scroll"}, {"overflow_y": collapsed["menu_overflow_y"], "scroll_height": collapsed["menu_scroll_height"], "client_height": collapsed["menu_client_height"]})
    page.evaluate("window.scrollTo(0, 0)")


def drag_trigger(page: Page, x: float, y: float) -> None:
    trigger = page.locator("#unified-center-trigger")
    box = trigger.bounding_box()
    if not box:
        raise AssertionError("unified work center trigger has no layout box")
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(x, y, steps=8)
    page.mouse.up()
    page.wait_for_timeout(80)


def test_unified_center(page: Page, acceptance: Acceptance, role: str, width: int, height: int, expanded_ui: bool) -> None:
    duplicate_selectors = ",".join((".global-task-center", ".student-notification-center", ".teacher-task-island", ".teacher-notification-island", "#teacher-ai-float"))
    acceptance.check(f"{role}.{width}.center.single", page.locator("#unified-work-center").count() == 1, "one shared work center root")
    acceptance.check(f"{role}.{width}.center.no_legacy", page.locator(duplicate_selectors).count() == 0, "legacy floating roots absent")
    acceptance.check(f"{role}.{width}.ai_role", (page.locator("#student-ai-float").count() == 1) == (role == "student"), f"student_ai_count={page.locator('#student-ai-float').count()}")
    trigger = page.locator("#unified-center-trigger")
    acceptance.check(f"{role}.{width}.center.aria", trigger.get_attribute("aria-label") == "打开任务与消息中心", trigger.get_attribute("aria-label"))

    drag_trigger(page, 2, 2)
    left = rect(page, "#unified-center-trigger")
    acceptance.check(f"{role}.{width}.center.clamp_left_top", bool(left) and left["left"] >= 17 and left["top"] >= 17, left)
    drag_trigger(page, width - 2, height - 2)
    bottom = rect(page, "#unified-center-trigger")
    acceptance.check(f"{role}.{width}.center.clamp_right_bottom", bool(bottom) and bottom["right"] <= width - 17 and bottom["bottom"] <= height - 17, bottom)
    stored = page.evaluate("role => localStorage.getItem(`discimind.workCenterPosition.${JSON.parse(sessionStorage.getItem('discimind_user')).user_id}.${role}`)", role)
    acceptance.check(f"{role}.{width}.center.position_saved", bool(stored), stored)

    trigger.click()
    page.wait_for_timeout(100)
    panel = rect(page, "#unified-center-panel")
    acceptance.check(f"{role}.{width}.center.panel_in_view", bool(panel) and panel["left"] >= 0 and panel["right"] <= width + 1 and panel["top"] >= 0 and panel["bottom"] <= height + 1, panel)
    trigger.click()
    drag_trigger(page, width - 30, 92)

    if expanded_ui:
        trigger.click()
        page.wait_for_selector("#unified-center-panel", state="visible", timeout=5_000)
        current_hash = page.evaluate("location.hash")
        messages_tab = page.locator('[data-center-tab="messages"]')
        if messages_tab.count() == 1:
            messages_tab.click()
        view_all = page.locator("#unified-view-all-messages")
        if view_all.count() == 1 and view_all.is_visible():
            view_all.click()
            page.wait_for_timeout(100)
            acceptance.check(f"{role}.{width}.center.view_all_inline", page.locator("#unified-message-tools").is_visible() and page.evaluate("location.hash") == current_hash, "filters visible and route unchanged")
        fixture_rows = page.locator("[data-message-id]").filter(has_text=acceptance.marker)
        row_count = fixture_rows.count()
        if row_count == 1:
            fixture_rows.click()
            page.wait_for_selector("#unified-message-modal", state="visible", timeout=5_000)
            acceptance.check(f"{role}.{width}.center.detail_modal", page.locator("#unified-message-modal").is_visible() and page.evaluate("location.hash") == current_hash, "message detail modal opened without navigation")
            page.locator("#unified-message-close").click()


def create_course_fixture(api_url: str, auths: dict[str, dict[str, Any]], marker: str) -> dict[str, Any]:
    student_headers = {"Authorization": f"Bearer {auths['student']['token']}"}
    teacher_headers = {"Authorization": f"Bearer {auths['teacher']['token']}"}
    courses = requests.get(f"{api_url}/student/courses", headers=student_headers, timeout=12).json()["data"]["list"]
    course = courses[0]
    course_id = int(course["course_id"])
    class_id = int(course["teaching_class_id"])
    filename = f"浏览器课程文件-{marker}.txt"
    content = f"browser course fixture {marker}\n".encode()
    path = f"{api_url}/courses/{course_id}/teaching-classes/{class_id}/files"
    response = requests.post(path, headers=teacher_headers, files={"file": (filename, content, "text/plain")}, data={
        "title": f"浏览器课程文件-{marker}",
        "description": "用于三端课程文件视觉与消息联动验收",
        "category": "reference",
        "publish_now": "true",
    }, timeout=20)
    response.raise_for_status()
    file_id = int(response.json()["data"]["file"]["file_id"])
    return {"course_id": course_id, "class_id": class_id, "file_id": file_id, "title": f"浏览器课程文件-{marker}"}


def cleanup_course_fixture(marker: str) -> dict[str, Any]:
    completed = subprocess.run(
        ["node", str(ROOT / "scripts" / "cross_portal_test_fixture.js"), "course-cleanup", marker],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=False,
    )
    if completed.returncode:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip())
    return json.loads(completed.stdout.strip())


def test_course_pages(browser: Browser, acceptance: Acceptance, frontend_url: str, auths: dict[str, dict[str, Any]], fixture: dict[str, Any]) -> None:
    route_map = {
        "teacher": f"#/teacher/courses/{fixture['course_id']}?tab=files&classId={fixture['class_id']}&fileId={fixture['file_id']}",
        "admin": f"#/admin/courses/{fixture['course_id']}?tab=files&classId={fixture['class_id']}&fileId={fixture['file_id']}",
        "student": f"#/student/courses/{fixture['course_id']}?tab=files&fileId={fixture['file_id']}",
    }
    for role, route in route_map.items():
        context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        page = context.new_page()
        console_errors: list[str] = []
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        auth_page(page, frontend_url, auths[role], route)
        page.wait_for_selector("#course-files-panel", state="visible", timeout=20_000)
        page.wait_for_selector(f'[data-course-file-id="{fixture["file_id"]}"]', state="visible", timeout=20_000)
        acceptance.check(f"course.{role}.fixture_visible", page.get_by_text(fixture["title"], exact=True).count() == 1, fixture)
        manage_count = page.locator("#course-file-upload-open").count()
        acceptance.check(f"course.{role}.manage_dom", (manage_count == 1) == (role in {"teacher", "admin"}), f"upload_count={manage_count}")
        acceptance.check(f"course.{role}.no_horizontal_overflow", page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), {"scroll_width": page.evaluate("document.documentElement.scrollWidth"), "client_width": page.evaluate("document.documentElement.clientWidth")})
        acceptance.check(f"course.{role}.console", not console_errors, console_errors)
        take(page, acceptance, f"course-files-{role}-1440x900.png")
        context.close()


def run(frontend_url: str, api_url: str, report_path: Path) -> int:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    marker = f"browser{int(time.time() * 1000)}"
    acceptance = Acceptance(marker=marker)
    auths: dict[str, dict[str, Any]] = {}
    fixture: dict[str, Any] | None = None
    try:
        auths = {role: api_login(api_url, username) for role, username in ACCOUNTS.items()}
        fixture = create_course_fixture(api_url, auths, marker)
        if not CHROME.exists():
            raise RuntimeError(f"Chrome executable not found: {CHROME}")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(CHROME), headless=True, args=["--disable-gpu"])
            for role, route in ROUTES.items():
                for width, height in VIEWPORTS:
                    context = browser.new_context(viewport={"width": width, "height": height}, reduced_motion="reduce")
                    page = context.new_page()
                    console_errors: list[str] = []
                    page_errors: list[str] = []
                    failed_api: list[str] = []
                    requests_seen: list[str] = []
                    page.on("console", lambda message, bucket=console_errors: bucket.append(message.text) if message.type == "error" else None)
                    page.on("pageerror", lambda error, bucket=page_errors: bucket.append(str(error)))
                    page.on("request", lambda request, bucket=requests_seen: bucket.append(request.url))
                    page.on("response", lambda response, bucket=failed_api: bucket.append(f"{response.status} {response.url}") if response.status >= 400 and "/api/" in response.url else None)
                    auth_page(page, frontend_url, auths[role], route)
                    page.wait_for_timeout(500)
                    if role == "admin":
                        page.wait_for_selector(".admin-dashboard-grid", state="visible", timeout=20_000)
                        test_admin_sidebar(page, acceptance, width, height)
                    test_unified_center(page, acceptance, role, width, height, expanded_ui=width == 1440)
                    trigger_overlaps = page.evaluate(
                        """() => { const trigger=document.querySelector('#unified-center-trigger'); if(!trigger)return ['missing trigger']; const a=trigger.getBoundingClientRect(); return [...document.querySelectorAll('#student-main button:not([disabled]),#student-main a[href],.home-identity,.teacher-summary-card,#student-ai-float .ai-float-main')].filter(el=>el.offsetParent!==null).filter(el=>{const b=el.getBoundingClientRect();return a.left<b.right+1&&a.right>b.left-1&&a.top<b.bottom+1&&a.bottom>b.top-1}).map(el=>el.id||el.className||el.tagName).slice(0,10); }"""
                    )
                    acceptance.check(f"{role}.{width}.center.no_control_overlap", not trigger_overlaps, trigger_overlaps)
                    overflow = page.evaluate("({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth})")
                    acceptance.check(f"{role}.{width}.layout.no_horizontal_overflow", overflow["scrollWidth"] <= overflow["clientWidth"] + 1, overflow)
                    prohibited = [url for url in requests_seen if role != "student" and ("/api/ai-chat/" in url or "/api/student/ai" in url or "/api/teacher/ai/conversations" in url)]
                    acceptance.check(f"{role}.{width}.ai.no_forbidden_requests", not prohibited, prohibited)
                    acceptance.check(f"{role}.{width}.browser.console", not console_errors and not page_errors, {"console": console_errors, "page": page_errors})
                    acceptance.check(f"{role}.{width}.browser.api_status", not failed_api, failed_api)
                    take(page, acceptance, f"{role}-dashboard-{width}x{height}.png")
                    context.close()
            test_course_pages(browser, acceptance, frontend_url, auths, fixture)
            browser.close()
    except Exception as error:  # noqa: BLE001
        acceptance.errors.append(str(error))
    finally:
        try:
            acceptance.cleanup = cleanup_course_fixture(marker)
            acceptance.check("browser_fixture.cleanup", acceptance.cleanup.get("deleted_documents", 0) == (1 if fixture else 0), acceptance.cleanup)
        except Exception as cleanup_error:  # noqa: BLE001
            acceptance.errors.append(f"cleanup failed: {cleanup_error}")
        payload = {
            "schema": "cross-portal-browser-acceptance.v1",
            "generated_at_epoch": time.time(),
            "frontend_url": frontend_url,
            "api_url": api_url,
            "marker": marker,
            "passed": not acceptance.errors,
            "checks": acceptance.checks,
            "errors": acceptance.errors,
            "diagnostics": acceptance.diagnostics,
            "screenshots": acceptance.screenshots,
            "cleanup": acceptance.cleanup,
        }
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        passed = sum(1 for item in acceptance.checks if item["passed"])
        print(f"cross-portal browser: {passed}/{len(acceptance.checks)} checks passed")
        print(f"screenshots: {len(acceptance.screenshots)}")
        print(f"report: {report_path}")
        if acceptance.errors:
            print("errors:")
            for error in acceptance.errors:
                print(f"- {error}")
    return 1 if acceptance.errors else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--frontend-url", default=DEFAULT_FRONTEND)
    parser.add_argument("--api-url", default=DEFAULT_API)
    parser.add_argument("--report", type=Path, default=ARTIFACTS / "browser-acceptance.json")
    args = parser.parse_args()
    return run(args.frontend_url.rstrip("/"), args.api_url.rstrip("/"), args.report.resolve())


if __name__ == "__main__":
    sys.exit(main())
