#!/usr/bin/env python3
"""Static and runtime audit for the real-data compact admin dashboard."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run(browser_report: Path) -> dict:
    page = (ROOT / "frontend" / "src" / "pages" / "admin-dashboard.js").read_text(encoding="utf-8")
    service = (ROOT / "backend" / "src" / "services" / "admin-dashboard.service.js").read_text(encoding="utf-8")
    css = (ROOT / "frontend" / "src" / "styles" / "admin.css").read_text(encoding="utf-8")
    browser = json.loads(browser_report.read_text(encoding="utf-8"))
    admin_runtime = [item for item in browser.get("checks", []) if item["id"].startswith("admin.")]
    modules = {
        "14_day_trend": "最近 14 天活动趋势" in page,
        "role_and_class_composition": "用户与班级构成" in page,
        "course_class_ranking": "course_class_ranking" in page and "course_class_ranking" in service,
        "review_flows": "审核流概览" in page,
        "provider_health": "AI 供应商健康矩阵" in page,
        "ai_reliability": "AI 调用可靠性" in page and "ai_failure_reasons" in service,
        "recent_operations": "最近管理操作" in page,
        "frequent_events": "frequent_admin_events" in page and "frequent_admin_events" in service,
        "compact_todos": "待办事项" in page,
        "system_health": "系统与服务状态" in page,
        "skeleton": "admin-dashboard-skeleton" in page,
        "number_animation": "animateDashboardNumbers" in page and "requestAnimationFrame" in page,
        "banner_particles": "admin-banner-particle" in page and "prefers-reduced-motion" in css,
        "twelve_column_grid": "grid-template-columns:repeat(12" in css.replace(" ", ""),
        "runtime_admin_checks": bool(admin_runtime) and all(item["passed"] for item in admin_runtime),
    }
    return {"schema": "dashboard-visualization-audit.v1", "passed": all(modules.values()), "checks": modules, "runtime_check_count": len(admin_runtime)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser-report", type=Path, default=ROOT / "artifacts" / "cross-portal-rebuild" / "browser-acceptance.json")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "cross-portal-rebuild" / "dashboard-visualization.json")
    args = parser.parse_args()
    result = run(args.browser_report.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
