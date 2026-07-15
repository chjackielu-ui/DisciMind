#!/usr/bin/env python3
"""Validate fixed-overlay admin sidebar evidence from browser acceptance."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_WIDTHS = (1920, 1440, 1366, 1024)


def run(report_path: Path) -> dict:
    browser = json.loads(report_path.read_text(encoding="utf-8"))
    diagnostics = browser.get("diagnostics", {})
    checks: dict[str, bool] = {}
    evidence: dict[str, dict] = {}
    for width in REQUIRED_WIDTHS:
        key = next((name for name in diagnostics if name.startswith(f"admin_sidebar_{width}x")), None)
        row = diagnostics.get(key or "", {})
        delta = row.get("delta", {})
        expanded = row.get("expanded", {})
        collapsed = row.get("collapsed", {})
        passed = bool(row) and all(abs(float(delta.get(metric, 999))) <= 1 for metric in (
            "main_left", "main_width", "grid_width", "chart_width", "scroll_top",
        )) and delta.get("grid_rows") == 0
        passed = passed and 230 <= expanded.get("sidebar", {}).get("width", 0) <= 250
        passed = passed and 72 <= collapsed.get("sidebar", {}).get("width", 0) <= 80
        passed = passed and collapsed.get("scroll_width", 1) <= collapsed.get("client_width", 0) + 1
        checks[f"viewport_{width}"] = passed
        evidence[str(width)] = {"delta": delta, "expanded_sidebar": expanded.get("sidebar"), "collapsed_sidebar": collapsed.get("sidebar")}
    return {"schema": "sidebar-overlay-layout.v1", "passed": all(checks.values()), "checks": checks, "evidence": evidence}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser-report", type=Path, default=ROOT / "artifacts" / "cross-portal-rebuild" / "browser-acceptance.json")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "cross-portal-rebuild" / "sidebar-overlay-layout.json")
    args = parser.parse_args()
    result = run(args.browser_report.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
