#!/usr/bin/env python3
"""Generate a reproducible, read-only audit of the DisciMind admin surface.

The script never changes application or database data. Its only optional write is
the requested Markdown report. It intentionally uses conservative regular
expressions: findings are evidence for review, not claims that every match is a
bug.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


SOURCE_SUFFIXES = {".js", ".ts", ".css", ".scss", ".less", ".prisma"}
SKIP_PARTS = {"node_modules", "dist", "coverage", ".git", "storage", "tmp"}


@dataclass(frozen=True)
class Match:
    file: str
    line: int
    text: str


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="replace")


def relative(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def source_files(root: Path, base: Path) -> Iterable[Path]:
    if not base.exists():
        return
    for path in base.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SOURCE_SUFFIXES:
            continue
        if any(part in SKIP_PARTS for part in path.parts):
            continue
        yield path


def line_matches(root: Path, paths: Iterable[Path], pattern: re.Pattern[str]) -> list[Match]:
    results: list[Match] = []
    for path in paths:
        for line_number, line in enumerate(read_text(path).splitlines(), start=1):
            if pattern.search(line):
                results.append(Match(relative(root, path), line_number, line.strip()[:300]))
    return results


def extract_frontend_routes(router_path: Path) -> list[tuple[str, str]]:
    text = read_text(router_path)
    routes: list[tuple[str, str]] = []
    for route, renderer in re.findall(
        r"['\"](/admin(?:/[^'\"]*)?)['\"]\s*:\s*\{\s*render\s*:\s*([A-Za-z_$][\w$]*)",
        text,
    ):
        routes.append((route, renderer))
    for route, renderer in re.findall(
        r"['\"](/admin(?:/[^'\"]*)?)['\"]\s*:\s*([A-Za-z_$][\w$]*)", text
    ):
        routes.append((route, renderer))
    if re.search(r"pattern:\s*/\^\\/admin\\/courses\\/", text) and "render: renderAdminCourseDetail" in text:
        routes.append(("/admin/courses/:course_id", "renderAdminCourseDetail"))
    # Dynamic checks use explicit path expressions rather than the static map.
    for line in text.splitlines():
        if "/admin/" not in line:
            continue
        for route in re.findall(r"['\"](/admin/[^'\"]+)['\"]", line):
            if not any(item[0] == route for item in routes):
                routes.append((route, "dynamic/guard reference"))
    return sorted(set(routes))


def extract_backend_routes(route_path: Path) -> list[tuple[str, str, str]]:
    text = read_text(route_path)
    routes: list[tuple[str, str, str]] = []
    pattern = re.compile(
        r"router\.(get|post|put|patch|delete)\(\s*['\"]([^'\"]+)['\"]\s*,([\s\S]*?)\);",
        re.IGNORECASE,
    )
    for method, route, handlers in pattern.findall(text):
        compact = " ".join(handlers.split())
        routes.append((method.upper(), f"/api/admin{route}", compact[-240:]))
    return routes


def extract_frontend_api(api_path: Path) -> list[tuple[str, str, str]]:
    text = read_text(api_path)
    calls: list[tuple[str, str, str]] = []
    function_pattern = re.compile(
        r"export\s+function\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}", re.MULTILINE
    )
    arrow_pattern = re.compile(
        r"export\s+const\s+(\w+)\s*=.*?=>\s*(get|post|put|patch|del)\(\s*([`'\"])(.*?)\3",
        re.MULTILINE,
    )
    request_pattern = re.compile(r"\b(get|post|put|patch|del)\(\s*([`'\"])(.*?)\2")
    for name, body in function_pattern.findall(text):
        found = request_pattern.search(body)
        if found:
            method = {"get": "GET", "post": "POST", "put": "PUT", "patch": "PATCH", "del": "DELETE"}[found.group(1)]
            calls.append((name, method, found.group(3)))
    for name, verb, _, route in arrow_pattern.findall(text):
        method = {"get": "GET", "post": "POST", "put": "PUT", "patch": "PATCH", "del": "DELETE"}[verb]
        calls.append((name, method, route))
    return sorted(set(calls))


def normalize_route(route: str) -> str:
    route = re.sub(r"\$\{[^}]+\}", ":param", route)
    route = re.sub(r":[A-Za-z_][\w-]*", ":param", route)
    return route.rstrip("/") or "/"


def table(headers: list[str], rows: Iterable[Iterable[object]]) -> list[str]:
    rendered = [f"| {' | '.join(headers)} |", f"| {' | '.join('---' for _ in headers)} |"]
    for row in rows:
        cells = [str(value).replace("|", "\\|").replace("\n", " ") for value in row]
        rendered.append(f"| {' | '.join(cells)} |")
    return rendered


def bullets(matches: list[Match], limit: int | None = None) -> list[str]:
    selected = matches if limit is None else matches[:limit]
    lines = [f"- `{item.file}:{item.line}` — `{item.text.replace('`', "'")}`" for item in selected]
    if limit is not None and len(matches) > limit:
        lines.append(f"- 其余 {len(matches) - limit} 处匹配已省略；可直接运行脚本或使用 `rg` 复核。")
    return lines or ["- 未发现匹配。"]


def build_report(root: Path) -> str:
    frontend = root / "frontend" / "src"
    backend = root / "backend" / "src"
    router_path = frontend / "utils" / "router.js"
    api_path = frontend / "api" / "admin.js"
    backend_routes_path = backend / "routes" / "admin.routes.js"
    app_path = backend / "app.js"
    required = [frontend, backend, router_path, api_path, backend_routes_path, app_path]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError(f"missing required paths: {', '.join(missing)}")

    admin_pages = sorted((frontend / "pages").glob("admin-*.js"))
    admin_styles = sorted((frontend / "styles").glob("*admin*.css"))
    main_text = read_text(frontend / "main.js")
    active_admin_styles = [
        path for path in admin_styles
        if path.name == "admin.css" or path.name in main_text
    ]
    backend_admin_files = sorted(
        path for folder in (backend / "controllers", backend / "services", backend / "routes")
        for path in folder.glob("*admin*.js")
    )
    shared_layout_candidates = sorted(
        path for path in source_files(root, frontend)
        if re.search(r"(?:layout|sidebar|header|dashboard|menu|ui|component)", path.name, re.IGNORECASE)
        and "admin" not in path.name.lower()
    )
    all_admin_sources = [*admin_pages, *active_admin_styles, *backend_admin_files, api_path, backend_routes_path]

    frontend_routes = extract_frontend_routes(router_path)
    backend_routes = extract_backend_routes(backend_routes_path)
    frontend_calls = extract_frontend_api(api_path)

    backend_keys = {(method, normalize_route(path)) for method, path, _ in backend_routes}
    call_rows = []
    for name, method, route in frontend_calls:
        full = f"/api{route}" if route.startswith("/admin") else route
        mounted = (method, normalize_route(full)) in backend_keys
        call_rows.append((name, method, route, "已匹配" if mounted else "需人工核对"))

    native = line_matches(
        root,
        admin_pages,
        re.compile(r"<(?:button|select|input|textarea|table|dialog|progress)\b", re.IGNORECASE),
    )
    inline_styles = line_matches(root, admin_pages, re.compile(r"\bstyle\s*=", re.IGNORECASE))
    default_control_risks = line_matches(
        root,
        admin_pages,
        re.compile(r"<(?:button|select|input|textarea|table)\b(?![^>]*\bclass\s*=)", re.IGNORECASE),
    )
    undefined_risks = line_matches(
        root,
        admin_pages,
        re.compile(r"\b(?:data|result|response|state|system|metrics|health|service_health)\.[A-Za-z_$][\w$]*"),
    )
    silent_fallbacks = line_matches(
        root,
        [*admin_pages, *backend_admin_files],
        re.compile(
            r"catch\s*\([^)]*\)?\s*=>\s*\(\{[^\n]*(?:\[\]|\{\})|catch\s*\{[^\n]*(?:return\s+(?:\[\]|\{\})|\.list\s*=\s*\[\])|\.catch\(\(\)\s*=>\s*\(\{",
            re.IGNORECASE,
        ),
    )
    mock_markers = line_matches(
        root,
        all_admin_sources,
        re.compile(r"Math\.random\s*\(|\bmock(?:ed|data)?\b|开发中", re.IGNORECASE),
    )
    hardcoded_stats = line_matches(
        root,
        admin_pages,
        re.compile(
            r"<(?:div|span|strong|p)(?![^>]*\bid\s*=)[^>]*(?:metric|stat|count|value)[^>]*>\s*(?:\d+(?:\.\d+)?%?|['\"]\d+(?:\.\d+)?%?['\"])",
            re.IGNORECASE,
        ),
    )
    dialogs = line_matches(root, admin_pages, re.compile(r"\b(?:window\.)?(?:alert|confirm|prompt)\s*\("))
    emojis = line_matches(root, admin_pages, re.compile(r"[\U0001F300-\U0001FAFF]"))
    catches = line_matches(root, [*admin_pages, *backend_admin_files], re.compile(r"\bcatch\b"))

    mount_text = read_text(app_path)
    admin_mounts = re.findall(r"app\.use\(\s*['\"]([^'\"]*admin[^'\"]*)['\"]\s*,\s*([^\)]+)\)", mount_text)
    dashboard_overall = line_matches(
        root,
        [*admin_pages, *backend_admin_files],
        re.compile(r"\boverall\b"),
    )
    response_layers = line_matches(
        root,
        admin_pages,
        re.compile(r"\b(?:result|response|res)\.data(?:\.data|\.result)?\b"),
    )

    lines: list[str] = [
        "# DisciMind 管理端紧急审计结果",
        "",
        "> 由 `python scripts/admin_emergency_audit.py --output docs/admin-emergency-audit-result.md` 生成。",
        "> 本报告是静态证据清单；接口 2xx、鉴权、数据库结果和浏览器渲染仍需真实运行验证。",
        "",
        "## 摘要",
        "",
        *table(
            ["项目", "数量"],
            [
                ("管理端页面", len(admin_pages)),
                ("前端管理端路由引用", len(frontend_routes)),
                ("前端 Admin API 方法", len(frontend_calls)),
                ("后端 `/api/admin` 路由", len(backend_routes)),
                ("管理端样式文件", len(admin_styles)),
                ("当前入口实际加载的管理端样式", len(active_admin_styles)),
                ("管理端后端 Controller/Service/Route 文件", len(backend_admin_files)),
                ("原生控件标签", len(native)),
                ("无 class 控件风险", len(default_control_risks)),
                ("内联样式", len(inline_styles)),
                ("静默空数据回退", len(silent_fallbacks)),
                ("Mock/随机/开发中标记", len(mock_markers)),
                ("硬编码统计展示候选", len(hardcoded_stats)),
                ("原生对话框调用", len(dialogs)),
                ("Emoji", len(emojis)),
            ],
        ),
        "",
        "## 管理端前端路由",
        "",
        *table(["路由/引用", "渲染函数或来源"], frontend_routes),
        "",
        "## 管理端页面",
        "",
        *[f"- `{relative(root, path)}`" for path in admin_pages],
        "",
        "## 管理端前端 API 与后端字面路径匹配",
        "",
        *table(["前端方法", "HTTP", "前端路径", "静态匹配"], call_rows),
        "",
        "## 已挂载的后端管理路由",
        "",
        *table(["HTTP", "完整路径", "中间件/处理器"], backend_routes),
        "",
        "### 主应用挂载证据",
        "",
        *([f"- `{prefix}` → `{handler.strip()}`" for prefix, handler in admin_mounts] or ["- 未发现管理端挂载。"]),
        "",
        "## 管理端 CSS、主题与共享布局候选",
        "",
        "### 管理端样式",
        "",
        *[f"- `{relative(root, path)}` — {'入口已加载' if path in active_admin_styles else '未被入口加载（保留文件）'}" for path in admin_styles],
        "",
        "### 学生端/教师端共享候选",
        "",
        *[f"- `{relative(root, path)}`" for path in shared_layout_candidates],
        "",
        "## `/admin/dashboard` 的 `overall` 契约证据",
        "",
        *bullets(dashboard_overall),
        "",
        "### 前端响应解包证据",
        "",
        *bullets(response_layers),
        "",
        "## 原生控件和样式退化风险",
        "",
        "### 未带 class 的控件",
        "",
        *bullets(default_control_risks),
        "",
        "### 所有原生控件标签（前 120 处）",
        "",
        *bullets(native, 120),
        "",
        "### 内联样式（前 120 处）",
        "",
        *bullets(inline_styles, 120),
        "",
        "## 错误掩盖与硬编码风险",
        "",
        "### 静默空数组/空对象回退",
        "",
        *bullets(silent_fallbacks),
        "",
        "### Mock、随机或“开发中”标记",
        "",
        *bullets(mock_markers),
        "",
        "### 硬编码统计展示候选",
        "",
        *bullets(hardcoded_stats),
        "",
        "### 原生 alert/confirm/prompt",
        "",
        *bullets(dialogs),
        "",
        "### Emoji",
        "",
        *bullets(emojis),
        "",
        "### 全部 catch 位置（前 160 处，需人工区分正常处理与静默吞错）",
        "",
        *bullets(catches, 160),
        "",
        "## 可能访问未定义属性的位置（前 160 处）",
        "",
        *bullets(undefined_risks, 160),
        "",
        "## 审计边界",
        "",
        "- 动态模板 URL、Controller 到 Service、Service 到 Prisma 表的完整映射由 `scripts/admin_route_api_matrix.py` 进一步生成并人工核对。",
        "- 正确的 HTTP 状态码、JWT/管理员权限、真实数据库数据、按钮副作用与局部错误状态必须通过 API 和浏览器实测确认。",
        "- 原生 HTML 标签本身不是缺陷；没有统一 class、计算样式为浏览器默认或绕过公共交互组件时才构成退化。",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, default=Path("docs/admin-emergency-audit-result.md"))
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        report = build_report(root)
        output = args.output if args.output.is_absolute() else root / args.output
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(report + "\n", encoding="utf-8")
        print(f"admin emergency audit written: {output}")
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(f"admin emergency audit failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
