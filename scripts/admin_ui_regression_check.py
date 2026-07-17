#!/usr/bin/env python3
"""Deterministic static UI regression checks for the admin recovery surface.

The harness intentionally uses only Python's standard library.  It verifies the
source contracts that protect the restored shared dashboard shell and reports
legacy markup debt separately from release-blocking failures.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "src"
ROUTER_FILE = FRONTEND / "utils" / "router.js"
MAIN_FILE = FRONTEND / "main.js"
DASHBOARD_LAYOUT_FILE = FRONTEND / "utils" / "dashboard.js"
ADMIN_API_FILE = FRONTEND / "api" / "admin.js"
ADMIN_UI_FILE = FRONTEND / "utils" / "admin-ui.js"
ADMIN_MENU_FILE = FRONTEND / "utils" / "admin-menu.js"
ADMIN_CSS_FILE = FRONTEND / "styles" / "admin.css"
SHARED_DASHBOARD_CSS_FILE = FRONTEND / "styles" / "dashboard.css"
DEFAULT_REPORT = ROOT / "docs" / "admin-ui-regression-result.md"

PASS = "PASS"
WARN = "WARN"
FAIL = "FAIL"


@dataclass(frozen=True)
class ImportBinding:
    imported: str
    local: str
    source: str
    resolved: Path


@dataclass(frozen=True)
class RouteInfo:
    route: str
    route_type: str
    renderer: str
    auth: bool
    roles: tuple[str, ...]
    line: int


@dataclass
class CheckResult:
    key: str
    title: str
    status: str
    summary: str
    details: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Finding:
    category: str
    path: str
    line: int
    excerpt: str


def relative(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def one_line(value: str, limit: int = 120) -> str:
    compact = re.sub(r"\s+", " ", value).strip().replace("|", "\\|")
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def parse_named_imports(router_text: str) -> dict[str, ImportBinding]:
    bindings: dict[str, ImportBinding] = {}
    pattern = re.compile(
        r"import\s*\{(?P<names>.*?)\}\s*from\s*['\"](?P<source>[^'\"]+)['\"]",
        re.DOTALL,
    )
    for match in pattern.finditer(router_text):
        source = match.group("source")
        resolved = (ROUTER_FILE.parent / source).resolve()
        for raw_name in match.group("names").split(","):
            cleaned = re.sub(r"//[^\n]*", "", raw_name).strip()
            if not cleaned:
                continue
            alias = re.fullmatch(
                r"(?P<imported>[A-Za-z_$][\w$]*)(?:\s+as\s+(?P<local>[A-Za-z_$][\w$]*))?",
                cleaned,
            )
            if not alias:
                continue
            imported = alias.group("imported")
            local = alias.group("local") or imported
            bindings[local] = ImportBinding(imported, local, source, resolved)
    return bindings


def parse_roles(config: str) -> tuple[str, ...]:
    match = re.search(r"roles\s*:\s*\[(?P<roles>[^]]*)]", config)
    if not match:
        return ()
    return tuple(re.findall(r"['\"]([^'\"]+)['\"]", match.group("roles")))


def regex_route_to_template(pattern_text: str, param_names: list[str]) -> str:
    value = pattern_text.strip()
    value = re.sub(r"^\^", "", value)
    value = re.sub(r"\$$", "", value)
    value = value.replace(r"\/", "/")
    value = value.replace(r"\-", "-")
    capture = re.compile(r"\((?:\\d\+|\.\+|\[\^?[^]]+\]\+|[^()]*)\)")
    index = 0

    def replace_capture(_: re.Match[str]) -> str:
        nonlocal index
        name = param_names[index] if index < len(param_names) else f"param_{index + 1}"
        index += 1
        return f":{name}"

    value = capture.sub(replace_capture, value)
    value = value.replace("\\", "")
    return value


def parse_admin_routes(router_text: str) -> list[RouteInfo]:
    routes: list[RouteInfo] = []
    static_start = router_text.find("const staticRoutes")
    dynamic_start = router_text.find("const dynamicRoutes")
    if static_start < 0 or dynamic_start < 0:
        return routes

    static_text = router_text[static_start:dynamic_start]
    static_pattern = re.compile(
        r"(?m)^\s*['\"](?P<route>/admin/[^'\"]+)['\"]\s*:\s*\{(?P<config>[^\n}]*)\}",
    )
    for match in static_pattern.finditer(static_text):
        config = match.group("config")
        renderer = re.search(r"render\s*:\s*([A-Za-z_$][\w$]*)", config)
        if not renderer:
            continue
        routes.append(
            RouteInfo(
                route=match.group("route"),
                route_type="static",
                renderer=renderer.group(1),
                auth=bool(re.search(r"auth\s*:\s*true", config)),
                roles=parse_roles(config),
                line=line_number(router_text, static_start + match.start()),
            )
        )

    lines = router_text[dynamic_start:].splitlines()
    base_line = router_text[:dynamic_start].count("\n") + 1
    block: list[str] | None = None
    block_line = 0
    for offset, line in enumerate(lines):
        if block is None and re.match(r"^\s{2}\{\s*$", line):
            block = [line]
            block_line = base_line + offset
            continue
        if block is None:
            continue
        block.append(line)
        if not re.match(r"^\s{2}\},?\s*$", line):
            continue
        block_text = "\n".join(block)
        block = None
        if not re.search(r"pattern\s*:\s*/\^\\/admin\\/", block_text):
            continue
        renderer = re.search(r"render\s*:\s*([A-Za-z_$][\w$]*)", block_text)
        pattern_match = re.search(r"pattern\s*:\s*/(?P<pattern>\^.*?\$)/", block_text)
        if not renderer or not pattern_match:
            continue
        comment_route = re.search(r"#(?P<route>/admin/[^\s]+)", block_text)
        param_match = re.search(r"paramNames\s*:\s*\[(?P<params>[^]]*)]", block_text)
        params = re.findall(r"['\"]([^'\"]+)['\"]", param_match.group("params")) if param_match else []
        route = (
            comment_route.group("route")
            if comment_route
            else regex_route_to_template(pattern_match.group("pattern"), params)
        )
        routes.append(
            RouteInfo(
                route=route,
                route_type="dynamic",
                renderer=renderer.group(1),
                auth=bool(re.search(r"auth\s*:\s*true", block_text)),
                roles=parse_roles(block_text),
                line=block_line,
            )
        )
    return sorted(routes, key=lambda item: (item.route, item.route_type, item.renderer))


def module_exports(text: str, imported_name: str) -> bool:
    direct = re.compile(
        rf"\bexport\s+(?:(?:async|default)\s+)*(?:function|class|const|let|var)\s+{re.escape(imported_name)}\b"
    )
    if direct.search(text):
        return True
    for match in re.finditer(r"\bexport\s*\{(?P<names>[^}]*)\}", text, re.DOTALL):
        for raw_name in match.group("names").split(","):
            exported = re.sub(r"\s+as\s+[A-Za-z_$][\w$]*", "", raw_name).strip()
            if exported == imported_name:
                return True
    return False


def make_route_checks(
    routes: list[RouteInfo], bindings: dict[str, ImportBinding]
) -> tuple[list[CheckResult], dict[str, tuple[ImportBinding, bool]]]:
    results: list[CheckResult] = []
    resolved: dict[str, tuple[ImportBinding, bool]] = {}
    duplicate_routes = sorted(route for route, count in Counter(item.route for item in routes).items() if count > 1)
    required = {
        "/admin/dashboard",
        "/admin/users",
        "/admin/courses",
        "/admin/courses/:course_id",
        "/admin/classes",
        "/admin/knowledge",
        "/admin/logs",
        "/admin/notifications",
        "/admin/ai-config",
        "/admin/profile",
        "/admin/agent-reviews",
    }
    missing_required = sorted(required - {item.route for item in routes})
    discovery_details = [
        f"Discovered {sum(item.route_type == 'static' for item in routes)} static and "
        f"{sum(item.route_type == 'dynamic' for item in routes)} dynamic admin routes."
    ]
    if missing_required:
        discovery_details.append("Missing required routes: " + ", ".join(f"`{item}`" for item in missing_required))
    if duplicate_routes:
        discovery_details.append("Duplicate routes: " + ", ".join(f"`{item}`" for item in duplicate_routes))
    route_discovery_ok = bool(routes) and not missing_required and not duplicate_routes
    results.append(
        CheckResult(
            "routes.discovery",
            "Admin route discovery",
            PASS if route_discovery_ok else FAIL,
            "Every required static and dynamic admin route is discoverable."
            if route_discovery_ok
            else "The admin route table is incomplete or ambiguous.",
            discovery_details,
        )
    )

    guard_failures = [item for item in routes if not item.auth or "admin" not in item.roles]
    results.append(
        CheckResult(
            "routes.guards",
            "Admin route guards",
            PASS if not guard_failures else FAIL,
            "All discovered admin routes require authentication and the admin role."
            if not guard_failures
            else f"{len(guard_failures)} route(s) have incomplete admin guards.",
            [f"`{item.route}` at `{relative(ROUTER_FILE)}:{item.line}`" for item in guard_failures],
        )
    )

    import_failures: list[str] = []
    for renderer in sorted({item.renderer for item in routes}):
        binding = bindings.get(renderer)
        if not binding:
            import_failures.append(f"`{renderer}` is not a named import in `{relative(ROUTER_FILE)}`.")
            continue
        exists = binding.resolved.is_file()
        exported = exists and module_exports(read_text(binding.resolved), binding.imported)
        resolved[renderer] = (binding, exported)
        if not exists:
            import_failures.append(f"`{renderer}` resolves to missing `{relative(binding.resolved)}`.")
        elif not exported:
            import_failures.append(
                f"`{binding.imported}` is not exported by `{relative(binding.resolved)}` for `{renderer}`."
            )
    results.append(
        CheckResult(
            "routes.renderers",
            "Route renderer imports and exports",
            PASS if not import_failures else FAIL,
            f"All {len({item.renderer for item in routes})} unique route renderers resolve to exported functions."
            if not import_failures
            else f"{len(import_failures)} renderer import/export contract(s) are broken.",
            import_failures,
        )
    )
    return results, resolved


def make_shared_shell_checks(page_files: Iterable[Path]) -> list[CheckResult]:
    main_text = read_text(MAIN_FILE)
    layout_text = read_text(DASHBOARD_LAYOUT_FILE)
    route_page_files = sorted(set(page_files), key=relative)
    failures: list[str] = []

    if not re.search(r"import\s+['\"]\./styles/admin\.css['\"]", main_text):
        failures.append("`frontend/src/main.js` does not import the scoped admin stylesheet.")
    if re.search(r"import[^\n]*admin-v2(?:\.css)?['\"]", main_text, re.IGNORECASE):
        failures.append("`frontend/src/main.js` still imports `admin-v2.css`.")
    if re.search(r"admin-layout|renderAdminLayout|DisciMind\s+Console", layout_text, re.IGNORECASE):
        failures.append("The active shared dashboard utility still dispatches to the custom Console shell.")
    required_layout_tokens = [
        "student-dashboard-wrapper${roleClass}",
        "role-admin",
        "student-sidebar",
        "student-main",
    ]
    for token in required_layout_tokens:
        if token not in layout_text:
            failures.append(f"Shared dashboard layout is missing `{token}`.")

    for page in route_page_files:
        text = read_text(page)
        if "renderDashboardLayout" not in text and "renderAdminPage" not in text:
            failures.append(f"`{relative(page)}` does not render through the shared dashboard shell.")
        if re.search(r"from\s*['\"][^'\"]*admin-layout\.js['\"]", text):
            failures.append(f"`{relative(page)}` imports the custom admin layout.")
        if "DisciMind Console" in text or "DisciMind Console" in text:
            failures.append(f"`{relative(page)}` contains the retired Console brand.")

    return [
        CheckResult(
            "shell.shared-layout",
            "Restored shared dashboard shell",
            PASS if not failures else FAIL,
            "Admin pages use the student/teacher shared dashboard structure with scoped purple tokens."
            if not failures
            else f"{len(failures)} custom-shell regression(s) were found.",
            failures
            or [
                "`frontend/src/main.js` imports `admin.css` and has no active `admin-v2.css` import.",
                "Every routed admin page module calls `renderDashboardLayout` or `renderAdminPage`.",
                "The shared wrapper emits `student-dashboard-wrapper role-admin` for administrators.",
            ],
        )
    ]


def make_dashboard_contract_checks() -> list[CheckResult]:
    api_text = read_text(ADMIN_API_FILE)
    page_path = FRONTEND / "pages" / "admin-dashboard.js"
    page_text = read_text(page_path)
    failures: list[str] = []

    api_requirements = {
        "fixed contract version": r"ADMIN_DASHBOARD_CONTRACT_VERSION\s*=\s*['\"]admin-dashboard\.v1['\"]",
        "exported normalization boundary": r"export\s+function\s+normalizeAdminDashboardData\s*\(",
        "normalized API response": r"data\s*:\s*normalizeAdminDashboardData\s*\(\s*result\.data\s*\)",
        "explicit legacy contract error": r"LEGACY_DASHBOARD_CONTRACT",
        "degraded compatibility state": r"legacyContract[\s\S]{0,400}degraded",
    }
    for label, pattern in api_requirements.items():
        if not re.search(pattern, api_text, re.DOTALL):
            failures.append(f"API boundary is missing {label}.")
    for field_name in ("summary", "system_status", "service_health", "recent_events", "module_errors"):
        if not re.search(rf"\b{re.escape(field_name)}\s*:", api_text):
            failures.append(f"Dashboard normalization does not emit `{field_name}`.")

    page_requirements = {
        "v1 version import": r"ADMIN_DASHBOARD_CONTRACT_VERSION",
        "contract guard": r"function\s+assertDashboardContract\s*\(",
        "guard invocation before rendering": r"function\s+renderDashboard\s*\([^)]*\)\s*\{\s*assertDashboardContract\s*\(",
        "summary guard": r"!data\.summary",
        "system status guard": r"!data\.system_status",
        "service array guard": r"Array\.isArray\s*\(\s*data\.service_health\.services\s*\)",
        "module error guard": r"Array\.isArray\s*\(\s*data\.module_errors\s*\)",
        "recent event guard": r"Array\.isArray\s*\(\s*data\.recent_events\s*\)",
    }
    for label, pattern in page_requirements.items():
        if not re.search(pattern, page_text, re.DOTALL):
            failures.append(f"Dashboard page is missing {label}.")

    return [
        CheckResult(
            "dashboard.contract-v1",
            "Dashboard v1 normalization and guard",
            PASS if not failures else FAIL,
            "Dashboard data is normalized at the API boundary and structurally guarded before use."
            if not failures
            else f"{len(failures)} dashboard v1 contract protection(s) are missing.",
            failures
            or [
                "Contract: `admin-dashboard.v1`.",
                "Required structures: `summary`, `system_status`, `service_health.services`, `module_errors`, and `recent_events`.",
                "Legacy responses are explicitly degraded instead of being presented as healthy.",
            ],
        )
    ]


def find_matching(text: str, open_index: int, opener: str, closer: str) -> int | None:
    depth = 0
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = False
    index = open_index
    while index < len(text):
        char = text[index]
        nxt = text[index + 1] if index + 1 < len(text) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
            index += 1
            continue
        if block_comment:
            if char == "*" and nxt == "/":
                block_comment = False
                index += 2
            else:
                index += 1
            continue
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue
        if char == "/" and nxt == "/":
            line_comment = True
            index += 2
            continue
        if char == "/" and nxt == "*":
            block_comment = True
            index += 2
            continue
        if char in "'\"`":
            quote = char
            index += 1
            continue
        if char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return index
        index += 1
    return None


def catch_to_empty_offsets(text: str) -> list[int]:
    offsets: set[int] = set()
    returned_empty = re.compile(
        r"\breturn\s+(?:\[\s*\]|\{\s*\}|\(?\s*\{[\s\S]{0,320}?\b(?:list|items|rows|data)\s*:\s*\[\s*\])"
    )
    arrow_empty = re.compile(
        r"=>\s*(?:\(\s*)?(?:\[\s*\]|\{\s*\}|\{[\s\S]{0,260}?\b(?:list|items|rows|data)\s*:\s*\[\s*\])"
    )

    for match in re.finditer(r"\.catch\s*\(", text):
        open_index = text.find("(", match.start())
        close_index = find_matching(text, open_index, "(", ")")
        if close_index is None:
            continue
        body = text[open_index + 1 : close_index]
        if returned_empty.search(body) or arrow_empty.search(body):
            offsets.add(match.start())

    for match in re.finditer(r"\bcatch\s*(?:\([^)]*\))?\s*\{", text):
        open_index = text.find("{", match.start())
        close_index = find_matching(text, open_index, "{", "}")
        if close_index is None:
            continue
        body = text[open_index + 1 : close_index]
        if returned_empty.search(body):
            offsets.add(match.start())
    return sorted(offsets)


def source_findings(paths: Iterable[Path]) -> list[Finding]:
    patterns = [
        (
            "native dialog",
            re.compile(r"(?<![\w$])(?:window\.)?(?:alert|confirm|prompt)\s*\("),
        ),
        ("Math.random", re.compile(r"\bMath\.random\s*\(")),
        (
            "mock data identifier",
            re.compile(
                r"\b(?:mock(?:_?data)?|fake_?data|dummy_?data|sample_?data|fixture(?:s)?)\b",
                re.IGNORECASE,
            ),
        ),
    ]
    findings: list[Finding] = []
    for path in sorted(set(paths), key=relative):
        text = read_text(path)
        for category, pattern in patterns:
            for match in pattern.finditer(text):
                start = text.rfind("\n", 0, match.start()) + 1
                end = text.find("\n", match.end())
                if end < 0:
                    end = len(text)
                findings.append(
                    Finding(category, relative(path), line_number(text, match.start()), one_line(text[start:end]))
                )
        for offset in catch_to_empty_offsets(text):
            start = text.rfind("\n", 0, offset) + 1
            end = text.find("\n", offset)
            if end < 0:
                end = len(text)
            findings.append(
                Finding("catch-to-empty", relative(path), line_number(text, offset), one_line(text[start:end]))
            )
    return sorted(findings, key=lambda item: (item.path, item.line, item.category, item.excerpt))


def make_source_integrity_checks(paths: Iterable[Path]) -> list[CheckResult]:
    findings = source_findings(paths)
    details = [
        f"`{item.path}:{item.line}` — {item.category}: `{item.excerpt}`" for item in findings
    ]
    return [
        CheckResult(
            "sources.no-silent-fakes",
            "Active admin source integrity",
            PASS if not findings else FAIL,
            "No native dialogs, random/mock data, or catch-to-empty fallbacks are present in active admin sources."
            if not findings
            else f"{len(findings)} prohibited active-source pattern(s) were found.",
            details,
        )
    ]


def make_responsive_checks() -> list[CheckResult]:
    admin_css = read_text(ADMIN_CSS_FILE)
    shared_css = read_text(SHARED_DASHBOARD_CSS_FILE)
    failures: list[str] = []
    mobile_match = re.search(r"@media\s*\(max-width:\s*768px\)\s*\{", shared_css)
    mobile_css = ""
    if mobile_match:
        mobile_open = shared_css.find("{", mobile_match.start())
        mobile_close = find_matching(shared_css, mobile_open, "{", "}")
        if mobile_close is not None:
            mobile_css = shared_css[mobile_open + 1 : mobile_close]
    requirements = [
        ("scoped admin wrapper", admin_css, r"\.student-dashboard-wrapper\.role-admin\s*\{"),
        ("desktop breakpoint", admin_css, r"@media\s*\(min-width:\s*769px\)"),
        (
            "expanded fixed-overlay sidebar width",
            admin_css,
            r"\.student-dashboard-wrapper\.role-admin\s*>\s*\.student-sidebar\.expanded[\s\S]{0,180}?width:\s*var\(--stu-sidebar-expanded\)",
        ),
        (
            "collapsed fixed-overlay sidebar width",
            admin_css,
            r"\.student-dashboard-wrapper\.role-admin\s*>\s*\.student-sidebar\.collapsed:not\(:hover\)[\s\S]{0,160}?width:\s*var\(--stu-sidebar-collapsed\)",
        ),
        (
            "fixed overlay sidebar",
            admin_css,
            r"\.student-dashboard-wrapper\.role-admin\s*>\s*\.student-sidebar[\s\S]{0,220}?position:\s*fixed",
        ),
        (
            "invariant main-content geometry",
            admin_css,
            r"\.student-dashboard-wrapper\.role-admin\s*>\s*\.student-main,[\s\S]{0,220}?\.student-dashboard-wrapper\.role-admin\.sidebar-collapsed\s*>\s*\.student-main[\s\S]{0,260}?width:\s*100%",
        ),
        (
            "shrink-safe main column",
            admin_css,
            r"\.student-dashboard-wrapper\.role-admin[\s\S]{0,900}?\.student-main[\s\S]{0,260}?min-width:\s*0",
        ),
        ("horizontal overflow protection", admin_css, r"overflow-x:\s*(?:clip|hidden)"),
        ("tablet refinement", admin_css, r"@media\s*\(max-width:\s*900px\)"),
        ("small-screen refinement", admin_css, r"@media\s*\(max-width:\s*(?:720|600)px\)"),
        ("shared mobile breakpoint", shared_css, r"@media\s*\(max-width:\s*768px\)"),
        (
            "fixed shared sidebar base",
            shared_css,
            r"\.student-sidebar\s*\{[^}]{0,420}?position:\s*fixed",
        ),
        (
            "shared mobile sidebar geometry",
            mobile_css,
            r"\.student-sidebar\s*\{[^}]*bottom:[^;]+;[^}]*height:\s*var\(--stu-mobile-nav-height\)",
        ),
        (
            "mobile main-content clearance",
            mobile_css,
            r"\.student-main\s*\{[^}]*padding:[^;]*var\(--stu-mobile-nav-height\)",
        ),
    ]
    for label, text, pattern in requirements:
        if not re.search(pattern, text, re.DOTALL):
            failures.append(f"CSS is missing {label}.")
    return [
        CheckResult(
            "styles.responsive-shell",
            "Responsive shared-shell invariants",
            PASS if not failures else FAIL,
            "Desktop, tablet, and mobile layout selectors prevent sidebar overlap and horizontal overflow."
            if not failures
            else f"{len(failures)} responsive layout invariant(s) are missing.",
            failures
            or [
                "Desktop: 769px and wider uses a fixed overlay sidebar while main-content geometry stays invariant.",
                "Tablet: admin refinements are present at 900px.",
                "Mobile: the shared 768px bottom-navigation layout and content clearance remain active.",
            ],
        )
    ]


def make_state_checks() -> list[CheckResult]:
    page_requirements = {
        "dashboard": (
            FRONTEND / "pages" / "admin-dashboard.js",
            {
                "loading": [r"admin-dashboard-skeleton", r"dashboardSkeleton\(\)"],
                "error": [r"error-state", r"catch\s*\(error\)"],
                "empty": [r"empty-state", r"暂无(?:最近管理操作|可展示的服务检测记录)"],
                "retry": [r"admin-dashboard-retry", r"addEventListener\s*\(\s*['\"]click['\"]\s*,\s*loadDashboard"],
            },
        ),
        "notifications": (
            FRONTEND / "pages" / "admin-notifications.js",
            {
                "loading": [r"state\.loading", r"loading-state"],
                "error": [r"state\.error", r"error-state"],
                "empty": [r"empty-state", r"没有通知记录"],
                "retry": [r"admin-notifications-retry", r"addEventListener\s*\(\s*['\"]click['\"]\s*,\s*loadData"],
            },
        ),
    }
    failures: list[str] = []
    evidence: list[str] = []
    for page_name, (path, states) in page_requirements.items():
        text = read_text(path)
        passed_states: list[str] = []
        for state_name, patterns in states.items():
            missing = [pattern for pattern in patterns if not re.search(pattern, text, re.DOTALL)]
            if missing:
                failures.append(f"`{page_name}` lacks explicit `{state_name}` evidence.")
            else:
                passed_states.append(state_name)
        evidence.append(f"`{page_name}`: {', '.join(passed_states) if passed_states else 'no verified states'}.")
    return [
        CheckResult(
            "pages.async-states",
            "Dashboard and notification async states",
            PASS if not failures else FAIL,
            "Dashboard and notifications expose loading, error, empty, and retry behavior."
            if not failures
            else f"{len(failures)} required page state(s) are missing.",
            failures or evidence,
        )
    ]


def markup_warning_inventory(paths: Iterable[Path]) -> tuple[list[CheckResult], list[Finding], list[Finding]]:
    control_pattern = re.compile(r"<(button|input|select|textarea|table|form|a)\b(?P<attrs>[^>]*)>", re.IGNORECASE)
    style_pattern = re.compile(r"\bstyle\s*=", re.IGNORECASE)
    unclassed: list[Finding] = []
    inline_styles: list[Finding] = []
    for path in sorted(set(paths), key=relative):
        text = read_text(path)
        for match in control_pattern.finditer(text):
            attrs = match.group("attrs")
            if re.search(r"\bclass\s*=", attrs, re.IGNORECASE):
                continue
            start = text.rfind("\n", 0, match.start()) + 1
            end = text.find("\n", match.end())
            if end < 0:
                end = len(text)
            unclassed.append(
                Finding(
                    f"unclassed <{match.group(1).lower()}>",
                    relative(path),
                    line_number(text, match.start()),
                    one_line(text[start:end]),
                )
            )
        for match in style_pattern.finditer(text):
            start = text.rfind("\n", 0, match.start()) + 1
            end = text.find("\n", match.end())
            if end < 0:
                end = len(text)
            inline_styles.append(
                Finding(
                    "inline style",
                    relative(path),
                    line_number(text, match.start()),
                    one_line(text[start:end]),
                )
            )
    unclassed.sort(key=lambda item: (item.path, item.line, item.category, item.excerpt))
    inline_styles.sort(key=lambda item: (item.path, item.line, item.excerpt))
    results = [
        CheckResult(
            "markup.unclassed-controls",
            "Native controls without classes",
            WARN if unclassed else PASS,
            f"{len(unclassed)} legacy native control(s) lack a class; retained as migration warnings."
            if unclassed
            else "Every detected native control has an explicit class.",
        ),
        CheckResult(
            "markup.inline-styles",
            "Inline style attributes",
            WARN if inline_styles else PASS,
            f"{len(inline_styles)} inline style attribute(s) remain; retained as migration warnings."
            if inline_styles
            else "No inline style attributes were detected in routed admin page modules.",
        ),
    ]
    return results, unclassed, inline_styles


def counts_by_path(findings: Iterable[Finding]) -> list[tuple[str, int]]:
    return sorted(Counter(item.path for item in findings).items())


def render_inventory(title: str, findings: list[Finding]) -> list[str]:
    lines = [f"### {title}", ""]
    if not findings:
        lines.extend(["No findings.", ""])
        return lines
    lines.extend([
        f"Total: **{len(findings)}**. Counts remain warnings and do not conceal critical failures.",
        "",
        "| File | Count |",
        "|---|---:|",
    ])
    for path, count in counts_by_path(findings):
        lines.append(f"| `{path}` | {count} |")
    lines.extend(["", "First 20 deterministic findings:", ""])
    for item in findings[:20]:
        lines.append(f"- `{item.path}:{item.line}` — {item.category}: `{item.excerpt}`")
    if len(findings) > 20:
        lines.append(f"- … {len(findings) - 20} additional finding(s) are represented in the per-file counts above.")
    lines.append("")
    return lines


def route_status(route: RouteInfo, resolved: dict[str, tuple[ImportBinding, bool]]) -> tuple[str, str]:
    binding_info = resolved.get(route.renderer)
    if not binding_info:
        return FAIL, "unresolved"
    binding, exported = binding_info
    if not binding.resolved.is_file() or not exported or not route.auth or "admin" not in route.roles:
        return FAIL, relative(binding.resolved)
    return PASS, relative(binding.resolved)


def render_report(
    routes: list[RouteInfo],
    resolved: dict[str, tuple[ImportBinding, bool]],
    results: list[CheckResult],
    active_paths: list[Path],
    unclassed: list[Finding],
    inline_styles: list[Finding],
) -> str:
    status_counts = Counter(item.status for item in results)
    overall = FAIL if status_counts[FAIL] else WARN if status_counts[WARN] else PASS
    lines = [
        "# 管理端静态 UI 回归结果",
        "",
        "> 该文件由 `python scripts/admin_ui_regression_check.py` 确定性生成；不包含时间戳、随机值或运行时凭据。",
        "",
        "## 结论",
        "",
        f"**{overall}** — {status_counts[PASS]} 项通过，{status_counts[WARN]} 项警告，{status_counts[FAIL]} 项失败。",
        "",
        "`FAIL` 是发布阻断项；`WARN` 仅记录尚未迁移的遗留标记，不会被误报为关键失败。该检查是静态回归门禁，不能替代真实登录、网络面板与多分辨率浏览器验收。",
        "",
        "## 路由覆盖",
        "",
        f"发现 **{len(routes)}** 条管理端路由（{sum(item.route_type == 'static' for item in routes)} 条静态，{sum(item.route_type == 'dynamic' for item in routes)} 条动态）。",
        "",
        "| Route | Kind | Renderer | Module | Guard | Status |",
        "|---|---|---|---|---|---|",
    ]
    for route in routes:
        status, module = route_status(route, resolved)
        guard = "auth + admin" if route.auth and "admin" in route.roles else "incomplete"
        lines.append(
            f"| `{route.route}` | {route.route_type} | `{route.renderer}` | `{module}` | {guard} | {status} |"
        )

    lines.extend(["", "## 检查项", ""])
    for result in results:
        lines.extend([
            f"### {result.status} `{result.key}` — {result.title}",
            "",
            result.summary,
            "",
        ])
        for detail in result.details:
            lines.append(f"- {detail}")
        if result.details:
            lines.append("")

    lines.extend(["## 遗留标记清单", ""])
    lines.extend(render_inventory("无 class 的原生控件（WARN）", unclassed))
    lines.extend(render_inventory("内联 style 属性（WARN）", inline_styles))

    lines.extend([
        "## 活跃源码扫描范围",
        "",
        "禁止模式扫描覆盖全部路由实际引用的管理页面，以及管理端 API、菜单和 UI 辅助模块：",
        "",
    ])
    for path in active_paths:
        lines.append(f"- `{relative(path)}`")
    lines.extend([
        "",
        "## 复现",
        "",
        "```powershell",
        "python scripts/admin_ui_regression_check.py",
        "python scripts/admin_ui_regression_check.py --check",
        "```",
        "",
        "默认命令重写本报告；`--check` 不写文件，并在报告过期时返回非零。任一关键检查失败时，两种模式都会返回非零。",
        "",
    ])
    return "\n".join(lines)


def validate_required_files() -> list[CheckResult]:
    required = [
        ROUTER_FILE,
        MAIN_FILE,
        DASHBOARD_LAYOUT_FILE,
        ADMIN_API_FILE,
        ADMIN_UI_FILE,
        ADMIN_MENU_FILE,
        ADMIN_CSS_FILE,
        SHARED_DASHBOARD_CSS_FILE,
        FRONTEND / "pages" / "admin-dashboard.js",
        FRONTEND / "pages" / "admin-notifications.js",
    ]
    missing = [relative(path) for path in required if not path.is_file()]
    return [
        CheckResult(
            "inputs.required-files",
            "Required regression inputs",
            PASS if not missing else FAIL,
            "All required router, shell, page, API, and stylesheet sources exist."
            if not missing
            else f"{len(missing)} required input file(s) are missing.",
            [f"Missing `{path}`." for path in missing],
        )
    ]


def run(output: Path, check_only: bool) -> int:
    initial_results = validate_required_files()
    if any(item.status == FAIL for item in initial_results):
        routes: list[RouteInfo] = []
        resolved: dict[str, tuple[ImportBinding, bool]] = {}
        active_paths: list[Path] = []
        results = initial_results
        unclassed: list[Finding] = []
        inline_styles: list[Finding] = []
    else:
        router_text = read_text(ROUTER_FILE)
        routes = parse_admin_routes(router_text)
        bindings = parse_named_imports(router_text)
        route_results, resolved = make_route_checks(routes, bindings)
        page_files = sorted(
            {
                binding.resolved
                for binding, exported in resolved.values()
                if binding.resolved.is_file() and exported and binding.resolved.parent == FRONTEND / "pages"
            },
            key=relative,
        )
        active_paths = sorted(
            set(page_files) | {ADMIN_API_FILE, ADMIN_UI_FILE, ADMIN_MENU_FILE},
            key=relative,
        )
        warning_results, unclassed, inline_styles = markup_warning_inventory(page_files + [ADMIN_UI_FILE])
        results = (
            initial_results
            + route_results
            + make_shared_shell_checks(page_files)
            + make_dashboard_contract_checks()
            + make_source_integrity_checks(active_paths)
            + make_responsive_checks()
            + make_state_checks()
            + warning_results
        )

    report = render_report(routes, resolved, results, active_paths, unclassed, inline_styles)
    critical_failed = any(item.status == FAIL for item in results)
    stale = False
    if check_only:
        current = output.read_text(encoding="utf-8") if output.is_file() else None
        stale = current != report
        if stale:
            print(f"STALE {relative(output)}")
        else:
            print(f"CURRENT {relative(output)}")
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(report, encoding="utf-8", newline="\n")
        print(f"WROTE {relative(output)}")

    counts = Counter(item.status for item in results)
    print(
        f"RESULT pass={counts[PASS]} warn={counts[WARN]} fail={counts[FAIL]} "
        f"routes={len(routes)} unclassed={len(unclassed)} inline_styles={len(inline_styles)}"
    )
    if critical_failed:
        return 1
    if stale:
        return 2
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_REPORT,
        help="Markdown report path (default: docs/admin-ui-regression-result.md)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Do not write; fail when the deterministic report is missing or stale.",
    )
    args = parser.parse_args()
    output = args.output if args.output.is_absolute() else (ROOT / args.output)
    return run(output.resolve(), args.check)


if __name__ == "__main__":
    sys.exit(main())
