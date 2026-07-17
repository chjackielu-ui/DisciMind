#!/usr/bin/env python3
"""Audit the DisciMind admin implementation without modifying repository data."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


SKIP_PARTS = {"node_modules", "dist", "coverage", ".git", "storage", "tmp"}
TEXT_SUFFIXES = {".js", ".ts", ".css", ".html", ".prisma", ".sql", ".md"}


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="replace")


def iter_source_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if any(part in SKIP_PARTS for part in path.parts):
            continue
        yield path


def scan(root: Path) -> dict:
    frontend = root / "frontend" / "src"
    backend = root / "backend" / "src"
    schema_path = root / "backend" / "prisma" / "schema.prisma"
    if not frontend.exists() or not backend.exists() or not schema_path.exists():
        raise FileNotFoundError("expected frontend/src, backend/src and backend/prisma/schema.prisma")

    schema = read_text(schema_path)
    admin_pages = sorted((frontend / "pages").glob("admin-*.js"))
    admin_routes = read_text(backend / "routes" / "admin.routes.js")
    router_text = read_text(frontend / "utils" / "router.js")
    findings = {
        "admin_pages": [str(p.relative_to(root)).replace("\\", "/") for p in admin_pages],
        "prisma_models": re.findall(r"^model\s+(\w+)\s*\{", schema, flags=re.MULTILINE),
        "backend_admin_routes": re.findall(
            r"router\.(get|post|put|patch|delete)\(['\"]([^'\"]+)", admin_routes
        ),
        "frontend_admin_routes": sorted(set(re.findall(r"['\"](/admin/[^'\"]+)['\"]\s*:", router_text))),
        "risks": [],
    }

    patterns = {
        "emoji": re.compile(r"[\U0001F300-\U0001FAFF]"),
        "random_data": re.compile(r"Math\.random\s*\("),
        "native_dialog": re.compile(r"\b(?:alert|prompt|confirm)\s*\("),
        "mock_markers": re.compile(r"\bmock\b|PLACEHOLDER_DATA|开发中", re.IGNORECASE),
        "inline_style": re.compile(r"style\s*=\s*['\"]"),
    }
    for path in iter_source_files(root):
        text = read_text(path)
        relative = str(path.relative_to(root)).replace("\\", "/")
        for risk, pattern in patterns.items():
            matches = list(pattern.finditer(text))
            if matches:
                findings["risks"].append({"type": risk, "file": relative, "count": len(matches)})

    findings["summary"] = {
        "admin_page_count": len(findings["admin_pages"]),
        "prisma_model_count": len(findings["prisma_models"]),
        "backend_admin_route_count": len(findings["backend_admin_routes"]),
        "frontend_admin_route_count": len(findings["frontend_admin_routes"]),
        "risk_file_count": len({item["file"] for item in findings["risks"]}),
    }
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, help="optional JSON report path")
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        findings = scan(root)
        payload = json.dumps(findings, ensure_ascii=False, indent=2)
        if args.output:
            output = args.output if args.output.is_absolute() else root / args.output
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(payload + "\n", encoding="utf-8")
        print(json.dumps(findings["summary"], ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001 - command-line boundary
        print(f"admin repo audit failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
