#!/usr/bin/env python3
"""Generate a static frontend -> API -> backend matrix for DisciMind admin routes.

The analyzer is intentionally read-only with respect to application source and data.  It
only writes the requested Markdown report.  A match means that method/path/controller
evidence exists in source; it is never reported as proof that the runtime or database
operation succeeds.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


HTTP_WRAPPERS = {
    "get": "GET",
    "post": "POST",
    "put": "PUT",
    "patch": "PATCH",
    "del": "DELETE",
    "upload": "POST",
}


@dataclass(frozen=True)
class SourceRef:
    path: Path
    line: int


@dataclass
class FrontendRoute:
    route: str
    renderer: str
    kind: str
    ref: SourceRef
    page: Path | None = None
    renderer_import_ref: SourceRef | None = None
    module_key: str | None = None


@dataclass
class ApiEndpoint:
    function: str
    module: Path
    ref: SourceRef
    method: str | None
    paths: list[str]
    parsed: bool


@dataclass
class ApiImport:
    function: str
    module: Path
    ref: SourceRef
    references: int
    endpoint: ApiEndpoint | None = None


@dataclass
class BackendRoute:
    method: str
    full_path: str
    route_path: str
    route_file: Path
    ref: SourceRef
    handler_alias: str | None
    handler_method: str | None
    controller_file: Path | None
    middleware: str
    base_auth: str
    permission: str | None


@dataclass
class BackendTrace:
    controller_ref: SourceRef | None = None
    service_calls: list[tuple[Path, str, SourceRef]] = field(default_factory=list)
    models: list[tuple[str, str, SourceRef, str]] = field(default_factory=list)


class AnalyzerError(RuntimeError):
    """Fatal source/layout error that makes a trustworthy report impossible."""


class Analyzer:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.router_file = self.root / "frontend/src/utils/router.js"
        self.app_file = self.root / "backend/src/app.js"
        self.schema_file = self.root / "backend/prisma/schema.prisma"
        self._texts: dict[Path, str] = {}
        self._api_cache: dict[tuple[Path, str], ApiEndpoint | None] = {}
        self._trace_cache: dict[tuple[Path, str], BackendTrace] = {}
        self.model_tables = self._parse_model_tables()
        self.governance_permissions: dict[str, str] = {}

    def require_file(self, path: Path) -> None:
        if not path.is_file():
            raise AnalyzerError(f"required source is missing: {path}")

    def read(self, path: Path) -> str:
        path = path.resolve()
        if path not in self._texts:
            self.require_file(path)
            self._texts[path] = path.read_text(encoding="utf-8")
        return self._texts[path]

    def rel(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self.root).as_posix()
        except ValueError:
            return str(path.resolve())

    @staticmethod
    def line_at(text: str, offset: int) -> int:
        return text.count("\n", 0, max(0, offset)) + 1

    def ref_text(self, ref: SourceRef | None) -> str:
        if not ref:
            return "未知"
        return f"`{self.rel(ref.path)}:{ref.line}`"

    @staticmethod
    def resolve_js(base_file: Path, specifier: str) -> Path:
        candidate = (base_file.parent / specifier).resolve()
        if candidate.is_file():
            return candidate
        # CommonJS modules use dotted stems such as ``auth.routes`` and
        # ``admin-dashboard.service``.  Path.with_suffix() would incorrectly
        # replace that semantic stem, so append .js instead.
        js_candidate = Path(f"{candidate}.js")
        if js_candidate.is_file():
            return js_candidate
        index_candidate = candidate / "index.js"
        return index_candidate if index_candidate.is_file() else js_candidate

    @staticmethod
    def split_import_names(raw: str) -> list[str]:
        names: list[str] = []
        for item in raw.replace("\n", " ").split(","):
            clean = re.sub(r"/\*.*?\*/", "", item).strip()
            if not clean:
                continue
            clean = re.split(r"\s+as\s+", clean, maxsplit=1)[-1].strip()
            if re.fullmatch(r"[A-Za-z_$][\w$]*", clean):
                names.append(clean)
        return names

    @staticmethod
    def join_url(prefix: str, suffix: str) -> str:
        return "/" + "/".join(part for part in (prefix + "/" + suffix).split("/") if part)

    def _parse_model_tables(self) -> dict[str, tuple[str, SourceRef]]:
        text = self.read(self.schema_file)
        result: dict[str, tuple[str, SourceRef]] = {}
        for match in re.finditer(r"(?ms)^model\s+(\w+)\s*\{(.*?)^\}", text):
            model, body = match.group(1), match.group(2)
            table_match = re.search(r"@@map\(\s*[\"']([^\"']+)[\"']\s*\)", body)
            table = table_match.group(1) if table_match else model
            ref = SourceRef(self.schema_file, self.line_at(text, match.start()))
            result[model.casefold()] = (table, ref)
        if not result:
            raise AnalyzerError(f"no Prisma models parsed from {self.schema_file}")
        return result

    def parse_frontend_routes(self) -> list[FrontendRoute]:
        text = self.read(self.router_file)
        renderer_imports: dict[str, tuple[Path, SourceRef]] = {}
        for match in re.finditer(
            r"import\s*\{(?P<names>.*?)\}\s*from\s*[\"'](?P<module>[^\"']+)[\"']",
            text,
            re.S,
        ):
            module = match.group("module")
            if "/pages/" not in module:
                continue
            page = self.resolve_js(self.router_file, module)
            ref = SourceRef(self.router_file, self.line_at(text, match.start()))
            for name in self.split_import_names(match.group("names")):
                renderer_imports[name] = (page, ref)

        routes: list[FrontendRoute] = []
        static_pattern = re.compile(
            r"(?m)^\s*[\"'](?P<route>/admin/[^\"']+)[\"']\s*:\s*\{\s*"
            r"render\s*:\s*(?P<renderer>[A-Za-z_$][\w$]*)\s*,"
        )
        for match in static_pattern.finditer(text):
            renderer = match.group("renderer")
            page_data = renderer_imports.get(renderer)
            routes.append(
                FrontendRoute(
                    route=match.group("route"),
                    renderer=renderer,
                    kind="static",
                    ref=SourceRef(self.router_file, self.line_at(text, match.start())),
                    page=page_data[0] if page_data else None,
                    renderer_import_ref=page_data[1] if page_data else None,
                )
            )

        dynamic_section = text[text.find("const dynamicRoutes") :]
        dynamic_offset = text.find("const dynamicRoutes")
        for block_match in re.finditer(r"(?ms)^\s*\{(.*?)^\s*\},?", dynamic_section):
            block = block_match.group(1)
            if "pattern:" not in block or "/admin/" not in block:
                continue
            comment = re.search(r"#(?P<route>/admin/[^\s]+)", block)
            renderer_match = re.search(r"render\s*:\s*([A-Za-z_$][\w$]*)", block)
            if not comment or not renderer_match:
                continue
            renderer = renderer_match.group(1)
            page_data = renderer_imports.get(renderer)
            start = dynamic_offset + block_match.start()
            routes.append(
                FrontendRoute(
                    route=comment.group("route"),
                    renderer=renderer,
                    kind="dynamic",
                    ref=SourceRef(self.router_file, self.line_at(text, start)),
                    page=page_data[0] if page_data else None,
                    renderer_import_ref=page_data[1] if page_data else None,
                )
            )

        routes.sort(key=lambda item: item.ref.line)
        if not routes:
            raise AnalyzerError("no frontend /admin routes were parsed")
        unresolved = [route for route in routes if not route.page or not route.page.is_file()]
        if unresolved:
            names = ", ".join(f"{route.route} -> {route.renderer}" for route in unresolved)
            raise AnalyzerError(f"admin renderer imports could not be resolved: {names}")

        for route in routes:
            if route.page and route.page.name == "admin-governance.js":
                page_text = self.read(route.page)
                function = self.find_function(page_text, route.renderer)
                if function:
                    body, _, _ = function
                    module_match = re.search(r"renderGovernancePage\(\s*app\s*,\s*[\"']([^\"']+)[\"']", body)
                    if module_match:
                        route.module_key = module_match.group(1)
                if not route.module_key:
                    renderer_match = re.search(
                        rf"export\s+const\s+{re.escape(route.renderer)}\s*=\s*governanceRenderer\(\s*[\"']([^\"']+)[\"']",
                        page_text,
                    )
                    if renderer_match:
                        route.module_key = renderer_match.group(1)
        return routes

    def parse_page_api_imports(self, page: Path) -> list[ApiImport]:
        text = self.read(page)
        imports: list[ApiImport] = []
        pattern = re.compile(
            r"import\s*\{(?P<names>[^}]*)\}\s*from\s*[\"'](?P<module>[^\"']+)[\"']",
            re.S,
        )
        for match in pattern.finditer(text):
            specifier = match.group("module")
            if "/api/" not in specifier and not specifier.startswith("../api/"):
                continue
            module = self.resolve_js(page, specifier)
            ref = SourceRef(page, self.line_at(text, match.start()))
            for name in self.split_import_names(match.group("names")):
                endpoint = self.parse_api_endpoint(module, name)
                # API modules also export constants and normalization helpers.  The
                # matrix is specifically about imported request functions.
                if endpoint is None:
                    continue
                imports.append(
                    ApiImport(
                        function=name,
                        module=module,
                        ref=ref,
                        references=len(re.findall(rf"\b{re.escape(name)}\b", text)),
                        endpoint=endpoint,
                    )
                )
        return imports

    def find_function(self, text: str, name: str) -> tuple[str, int, int] | None:
        declaration = re.search(
            rf"\b(?:export\s+)?(?:async\s+)?function\s+{re.escape(name)}\s*\([^)]*\)\s*\{{",
            text,
            re.S,
        )
        if declaration:
            line = self.line_at(text, declaration.start())
            brace = declaration.end() - 1
            end = self.matching_brace(text, brace)
            return text[declaration.start() : (end + 1 if end is not None else len(text))], line, declaration.start()

        arrow = re.search(
            rf"\b(?:export\s+)?const\s+{re.escape(name)}\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>",
            text,
            re.S,
        )
        if arrow:
            line = self.line_at(text, arrow.start())
            cursor = arrow.end()
            while cursor < len(text) and text[cursor].isspace() and text[cursor] != "\n":
                cursor += 1
            if cursor < len(text) and text[cursor] == "{":
                end = self.matching_brace(text, cursor)
                return text[arrow.start() : (end + 1 if end is not None else len(text))], line, arrow.start()
            end = text.find("\n", cursor)
            return text[arrow.start() : (end if end >= 0 else len(text))], line, arrow.start()

        # Controllers often wrap handlers as ``const x = action(() => service.y())``.
        # Capture the complete assignment statement so service tracing stays endpoint-
        # specific instead of falling back to the whole controller file.
        assignment = re.search(rf"\b(?:export\s+)?const\s+{re.escape(name)}\s*=", text)
        if assignment:
            line = self.line_at(text, assignment.start())
            end = self.statement_end(text, assignment.end())
            return text[assignment.start() : end], line, assignment.start()
        return None

    @staticmethod
    def statement_end(text: str, start: int) -> int:
        depths = {"(": 0, "[": 0, "{": 0}
        pairs = {")": "(", "]": "[", "}": "{"}
        quote: str | None = None
        escaped = False
        line_comment = False
        block_comment = False
        index = start
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
            if char in ("'", '"', "`"):
                quote = char
            elif char in depths:
                depths[char] += 1
            elif char in pairs:
                opening = pairs[char]
                depths[opening] = max(0, depths[opening] - 1)
            elif char == ";" and not any(depths.values()):
                return index + 1
            index += 1
        newline = text.find("\n", start)
        return newline if newline >= 0 else len(text)

    @staticmethod
    def matching_brace(text: str, start: int) -> int | None:
        depth = 0
        quote: str | None = None
        escaped = False
        line_comment = False
        block_comment = False
        index = start
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
            if char in ("'", '"', "`"):
                quote = char
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return index
            index += 1
        return None

    @staticmethod
    def expand_template_path(raw: str) -> list[str]:
        ternary = re.search(
            r"\$\{[^{}?]+\?\s*[\"']([^\"']+)[\"']\s*:\s*[\"']([^\"']+)[\"']\s*\}",
            raw,
        )
        if ternary:
            results: list[str] = []
            for choice in ternary.groups():
                next_raw = raw[: ternary.start()] + choice + raw[ternary.end() :]
                results.extend(Analyzer.expand_template_path(next_raw))
            return results

        def replace_placeholder(match: re.Match[str]) -> str:
            expression = match.group(1).strip()
            identifiers = re.findall(r"[A-Za-z_$][\w$]*", expression)
            name = identifiers[-1] if identifiers else "param"
            return f":{name}"

        return [re.sub(r"\$\{([^{}]+)\}", replace_placeholder, raw)]

    def parse_api_endpoint(self, module: Path, name: str) -> ApiEndpoint | None:
        key = (module.resolve(), name)
        if key in self._api_cache:
            return self._api_cache[key]
        if not module.is_file():
            self._api_cache[key] = None
            return None
        text = self.read(module)
        callable_export = re.search(
            rf"\bexport\s+(?:async\s+)?function\s+{re.escape(name)}\s*\(|"
            rf"\bexport\s+const\s+{re.escape(name)}\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>",
            text,
            re.S,
        )
        if not callable_export:
            self._api_cache[key] = None
            return None
        function = self.find_function(text, name)
        if not function:
            self._api_cache[key] = None
            return None
        body, line, _ = function
        calls = list(
            re.finditer(
                r"\b(get|post|put|patch|del|upload|request)\s*\(\s*([`\"'])(.*?)\2",
                body,
                re.S,
            )
        )
        if not calls:
            endpoint = ApiEndpoint(name, module, SourceRef(module, line), None, [], False)
            self._api_cache[key] = endpoint
            return endpoint
        call = calls[0]
        wrapper, raw_path = call.group(1), call.group(3)
        method = HTTP_WRAPPERS.get(wrapper)
        if wrapper == "request":
            method_match = re.search(r"method\s*:\s*[\"']([A-Za-z]+)[\"']", body[call.end() :])
            method = method_match.group(1).upper() if method_match else None
        paths = self.expand_template_path(raw_path)
        endpoint = ApiEndpoint(name, module, SourceRef(module, line), method, paths, bool(method and paths))
        self._api_cache[key] = endpoint
        return endpoint

    def parse_backend_routes(self) -> list[BackendRoute]:
        app_text = self.read(self.app_file)
        requires: dict[str, Path] = {}
        for match in re.finditer(
            r"const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*[\"']([^\"']+)[\"']\s*\)",
            app_text,
        ):
            requires[match.group(1)] = self.resolve_js(self.app_file, match.group(2))

        mounts: list[tuple[str, Path]] = []
        for match in re.finditer(
            r"app\.use\(\s*[\"'](?P<prefix>/api/[^\"']*)[\"']\s*,\s*(?P<alias>[A-Za-z_$][\w$]*)\s*\)",
            app_text,
        ):
            if not (match.group("prefix").startswith("/api/admin") or match.group("prefix").startswith("/api/auth")):
                continue
            route_file = requires.get(match.group("alias"))
            if route_file and route_file.is_file():
                mounts.append((match.group("prefix"), route_file))

        routes: list[BackendRoute] = []
        for prefix, route_file in mounts:
            text = self.read(route_file)
            controller_imports: dict[str, Path] = {}
            for match in re.finditer(
                r"const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*[\"']([^\"']+)[\"']\s*\)",
                text,
            ):
                target = self.resolve_js(route_file, match.group(2))
                if "controller" in target.name:
                    controller_imports[match.group(1)] = target

            use_lines = [line for line in text.splitlines() if "router.use(" in line]
            base_bits: list[str] = []
            if any(re.search(r"\bauth(?:Middleware)?\b", line) for line in use_lines):
                base_bits.append("authenticated")
            if any(re.search(r"roles?|roleMiddleware", line) and "admin" in line for line in use_lines):
                base_bits.append("role=admin")
            base_auth = " + ".join(base_bits)

            route_pattern = re.compile(
                r"(?m)^\s*router\.(get|post|put|patch|delete)\(\s*[\"']([^\"']+)[\"']\s*,\s*(.*?)\);\s*$"
            )
            for match in route_pattern.finditer(text):
                method = "DELETE" if match.group(1) == "delete" else match.group(1).upper()
                tail = match.group(3)
                handlers = list(re.finditer(r"([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)", tail))
                handler_alias = handlers[-1].group(1) if handlers else None
                handler_method = handlers[-1].group(2) if handlers else None
                permission_match = re.search(r"requireAdminPermission\(\s*[\"']([^\"']+)[\"']", tail)
                permission = permission_match.group(1) if permission_match else None
                if "requireGovernancePermission" in tail:
                    permission = "dynamic:requireGovernancePermission"
                inline_auth = "authenticated" if re.search(r"\bauth(?:Middleware)?\b", tail) else ""
                auth = base_auth
                if inline_auth and inline_auth not in auth:
                    auth = f"{auth} + {inline_auth}" if auth else inline_auth
                if not auth:
                    auth = "no auth middleware evidence"
                route_path = match.group(2)
                routes.append(
                    BackendRoute(
                        method=method,
                        full_path=self.join_url(prefix, route_path),
                        route_path=route_path,
                        route_file=route_file,
                        ref=SourceRef(route_file, self.line_at(text, match.start())),
                        handler_alias=handler_alias,
                        handler_method=handler_method,
                        controller_file=controller_imports.get(handler_alias or ""),
                        middleware=tail,
                        base_auth=auth,
                        permission=permission,
                    )
                )

            if route_file.name == "admin.routes.js":
                object_match = re.search(r"const\s+governancePermission\s*=\s*\{(.*?)\};", text, re.S)
                if object_match:
                    for pair in re.finditer(
                        r"(?:[\"'](?P<quoted>[\w-]+)[\"']|(?P<plain>[A-Za-z_$][\w$-]*))\s*:\s*[\"'](?P<permission>[^\"']+)[\"']",
                        object_match.group(1),
                    ):
                        key = pair.group("quoted") or pair.group("plain")
                        self.governance_permissions[key] = pair.group("permission")

        if not routes:
            raise AnalyzerError("no mounted backend routes were parsed from backend/src/app.js")
        return routes

    @staticmethod
    def comparable_path(path: str) -> list[str]:
        if path.startswith("/api/"):
            path = path[4:]
        return [segment for segment in path.split("/") if segment]

    @classmethod
    def paths_match(cls, frontend_path: str, backend_path: str) -> bool:
        left, right = cls.comparable_path(frontend_path), cls.comparable_path(backend_path)
        if len(left) != len(right):
            return False
        for first, second in zip(left, right):
            if first.startswith(":") or second.startswith(":"):
                continue
            if first != second:
                return False
        return True

    def match_backend(self, method: str | None, path: str, routes: list[BackendRoute]) -> BackendRoute | None:
        if not method:
            return None
        matches = [route for route in routes if route.method == method and self.paths_match(path, route.full_path)]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            # Prefer the most literal route when aliases/mounts overlap.
            return max(matches, key=lambda item: sum(not part.startswith(":") for part in self.comparable_path(item.full_path)))
        return None

    def backend_permission(self, route: BackendRoute, frontend_path: str) -> str:
        permission = route.permission
        if permission == "dynamic:requireGovernancePermission":
            match = re.search(r"/admin/governance/([^/:]+)", frontend_path)
            module = match.group(1) if match else None
            permission = self.governance_permissions.get(module or "", "dynamic permission unresolved")
        permission_text = f"permission={permission}" if permission else "no fine-grained route middleware found"
        return f"{route.base_auth}; {permission_text}"

    def trace_backend(self, route: BackendRoute) -> BackendTrace:
        if not route.controller_file or not route.handler_method:
            return BackendTrace()
        cache_key = (route.controller_file.resolve(), route.handler_method)
        if cache_key in self._trace_cache:
            return self._trace_cache[cache_key]
        controller_text = self.read(route.controller_file)
        controller_function = self.find_function(controller_text, route.handler_method)
        if controller_function:
            controller_body, controller_line, _ = controller_function
        else:
            controller_body, controller_line = controller_text, 1
        trace = BackendTrace(controller_ref=SourceRef(route.controller_file, controller_line))

        imports: dict[str, Path] = {}
        for match in re.finditer(
            r"const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*[\"']([^\"']+)[\"']\s*\)",
            controller_text,
        ):
            target = self.resolve_js(route.controller_file, match.group(2))
            if "service" in target.name and target.is_file():
                imports[match.group(1)] = target

        for alias, service_file in imports.items():
            for call in re.finditer(rf"\b{re.escape(alias)}\.([A-Za-z_$][\w$]*)\s*\(", controller_body):
                service_method = call.group(1)
                service_text = self.read(service_file)
                service_function = self.find_function(service_text, service_method)
                service_line = service_function[1] if service_function else 1
                service_ref = SourceRef(service_file, service_line)
                if (service_file, service_method, service_ref) not in trace.service_calls:
                    trace.service_calls.append((service_file, service_method, service_ref))
                models = self.models_for_service(service_file, service_method)
                for model, evidence, confidence in models:
                    table, schema_ref = self.lookup_table(model)
                    row = (model, table, evidence or schema_ref, confidence)
                    if not any(existing[0].casefold() == model.casefold() for existing in trace.models):
                        trace.models.append(row)

        if not trace.models:
            for match in re.finditer(r"\b(?:prisma|prismaClient|tx)\.([A-Za-z_$][\w$]*)", controller_body):
                model = match.group(1)
                if model.startswith("$"):
                    continue
                line = controller_line + controller_body.count("\n", 0, match.start())
                table, _ = self.lookup_table(model)
                trace.models.append((model, table, SourceRef(route.controller_file, line), "controller-direct"))
        self._trace_cache[cache_key] = trace
        return trace

    def lookup_table(self, prisma_accessor: str) -> tuple[str, SourceRef]:
        candidates = [prisma_accessor.casefold(), (prisma_accessor[:1].upper() + prisma_accessor[1:]).casefold()]
        for candidate in candidates:
            if candidate in self.model_tables:
                return self.model_tables[candidate]
        return "unknown table", SourceRef(self.schema_file, 1)

    def service_functions(self, text: str) -> dict[str, tuple[str, int]]:
        functions: dict[str, tuple[str, int]] = {}
        for match in re.finditer(r"\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", text):
            name = match.group(1)
            function = self.find_function(text, name)
            if function:
                functions[name] = (function[0], function[1])
        return functions

    def models_for_service(self, service_file: Path, method: str) -> list[tuple[str, SourceRef, str]]:
        text = self.read(service_file)
        functions = self.service_functions(text)
        queue = [method]
        visited: set[str] = set()
        results: list[tuple[str, SourceRef, str]] = []
        while queue and len(visited) < 40:
            name = queue.pop(0)
            if name in visited or name not in functions:
                continue
            visited.add(name)
            body, base_line = functions[name]
            for match in re.finditer(r"\b(?:prisma|prismaClient|tx)\.([A-Za-z_$][\w$]*)", body):
                model = match.group(1)
                if model.startswith("$"):
                    continue
                ref = SourceRef(service_file, base_line + body.count("\n", 0, match.start()))
                item = (model, ref, "function-call-chain")
                if not any(existing[0].casefold() == model.casefold() for existing in results):
                    results.append(item)
            for helper in functions:
                if helper not in visited and re.search(rf"\b{re.escape(helper)}\s*\(", body):
                    queue.append(helper)

        if results:
            return results
        # Dispatch maps and ORM aliases can defeat lightweight call tracing.  File-wide
        # evidence is useful, but explicitly lower confidence so the report cannot imply
        # that every listed table is touched by this endpoint.
        for match in re.finditer(r"\b(?:prisma|prismaClient|tx)\.([A-Za-z_$][\w$]*)", text):
            model = match.group(1)
            if model.startswith("$"):
                continue
            ref = SourceRef(service_file, self.line_at(text, match.start()))
            item = (model, ref, "service-file-wide-likely")
            if not any(existing[0].casefold() == model.casefold() for existing in results):
                results.append(item)
        return results

    def page_flags(self, page: Path) -> dict[str, str]:
        text = self.read(page)
        native: list[tuple[str, int]] = []
        for match in re.finditer(r"<(button|select|input|textarea|table)\b", text, re.I):
            native.append((match.group(1).lower(), self.line_at(text, match.start())))
        native_counts = {tag: sum(1 for item, _ in native if item == tag) for tag in sorted({item for item, _ in native})}
        native_refs = ", ".join(f"{tag}@{line}" for tag, line in native[:5])
        native_text = (
            f"native tags {native_counts}; examples {self.rel(page)}:{native_refs}"
            if native
            else "no native form/table tags found in page source"
        )

        hardcoded: list[tuple[str, int]] = []
        markers = [
            (r"Math\.random\s*\(", "Math.random"),
            (r"\bmock(?:ed|data)?\b", "mock marker"),
            (r"成功率\s*98%|成功率\s*99%", "fixed success-rate text"),
            (r"\bFAKE\b|伪造数据", "fake-data marker"),
        ]
        for pattern, label in markers:
            for match in re.finditer(pattern, text, re.I):
                hardcoded.append((label, self.line_at(text, match.start())))
        hardcoded_text = (
            "explicit markers: " + ", ".join(f"{label}@{line}" for label, line in hardcoded[:8])
            if hardcoded
            else "no explicit Math.random/mock/fixed-stat marker found (not proof of real data)"
        )

        catch_lines = [self.line_at(text, match.start()) for match in re.finditer(r"\bcatch\b", text)]
        error_markers = [
            self.line_at(text, match.start())
            for match in re.finditer(r"admin-error|error-state|is-error|btn-retry|重新加载|notifyAdmin\([^\n]*true", text)
        ]
        if catch_lines or error_markers:
            error_text = (
                f"catch={len(catch_lines)} at {catch_lines[:5]}; explicit error/retry markers={len(error_markers)} at {error_markers[:5]}"
            )
        else:
            error_text = "no catch or explicit error/retry marker found; needs review/runtime verification"
        return {"native": native_text, "hardcoded": hardcoded_text, "error": error_text}

    @staticmethod
    def md(value: object) -> str:
        return str(value).replace("|", "\\|").replace("\n", " ")

    @staticmethod
    def limit(items: Iterable[str], maximum: int = 8) -> str:
        values = list(dict.fromkeys(items))
        if not values:
            return "未知 / 无静态证据"
        if len(values) <= maximum:
            return "; ".join(values)
        return "; ".join(values[:maximum]) + f"; +{len(values) - maximum} more"

    def render_report(self) -> str:
        frontend_routes = self.parse_frontend_routes()
        backend_routes = self.parse_backend_routes()
        imported_by_page = {route.page: self.parse_page_api_imports(route.page) for route in frontend_routes if route.page}
        renderer_usage: dict[Path, list[str]] = {}
        for route in frontend_routes:
            if route.page:
                renderer_usage.setdefault(route.page, []).append(route.route)

        total_api_rows = 0
        matched_api_rows = 0
        unparsed_api_symbols = 0
        unmatched: list[str] = []
        route_sections: list[str] = []
        summary_rows: list[str] = []

        for route in frontend_routes:
            assert route.page is not None
            flags = self.page_flags(route.page)
            imports = imported_by_page.get(route.page, [])
            api_rows: list[str] = []
            route_endpoint_count = 0
            route_match_count = 0
            route_unparsed_count = 0
            permission_values: list[str] = []

            for api_import in imports:
                endpoint = api_import.endpoint
                used = "used" if api_import.references > 1 else "import-only/needs review"
                if not endpoint or not endpoint.parsed:
                    route_unparsed_count += 1
                    unparsed_api_symbols += 1
                    api_rows.append(
                        "| "
                        + " | ".join(
                            self.md(item)
                            for item in (
                                f"{api_import.function} ({used}) {self.ref_text(api_import.ref)}",
                                "unknown / parser found no request wrapper",
                                "UNMATCHED",
                                "unknown",
                                "unknown",
                                "unknown",
                                "needs manual/runtime verification",
                            )
                        )
                        + " |"
                    )
                    unmatched.append(f"{route.route}: {api_import.function} has no parsed endpoint")
                    continue

                paths = endpoint.paths or ["unknown"]
                for raw_path in paths:
                    path = raw_path
                    if route.module_key:
                        path = path.replace(":module", route.module_key)
                    backend = self.match_backend(endpoint.method, path, backend_routes)
                    route_endpoint_count += 1
                    total_api_rows += 1
                    if backend:
                        route_match_count += 1
                        matched_api_rows += 1
                        trace = self.trace_backend(backend)
                        permission = self.backend_permission(backend, path)
                        permission_values.append(permission)
                        backend_text = f"{backend.method} {backend.full_path} {self.ref_text(backend.ref)}"
                        controller_text = (
                            f"{backend.handler_alias}.{backend.handler_method} {self.ref_text(trace.controller_ref)}"
                            if backend.handler_method
                            else "unknown"
                        )
                        service_text = self.limit(
                            f"{self.rel(file)}:{method} {self.ref_text(ref)}" for file, method, ref in trace.service_calls
                        )
                        model_text = self.limit(
                            f"{model} -> {table} ({confidence}; {self.ref_text(ref)})"
                            for model, table, ref, confidence in trace.models
                        )
                        conclusion = "static method/path/mount match; runtime + response + DB behavior unverified"
                    else:
                        permission = "unknown"
                        backend_text = "UNMATCHED"
                        controller_text = service_text = model_text = "unknown"
                        conclusion = "missing static backend match; investigate before runtime test"
                        unmatched.append(f"{route.route}: {endpoint.method} {path} ({api_import.function})")
                    api_label = f"{self.rel(endpoint.module)}:{endpoint.function} ({used}) {self.ref_text(endpoint.ref)}"
                    api_rows.append(
                        "| "
                        + " | ".join(
                            self.md(item)
                            for item in (
                                api_label,
                                f"{endpoint.method or 'UNKNOWN'} {path}",
                                backend_text,
                                controller_text,
                                service_text,
                                model_text,
                                f"{permission}; {conclusion}",
                            )
                        )
                        + " |"
                    )

            if route_unparsed_count:
                closure = (
                    f"partial static coverage: {route_match_count}/{route_endpoint_count} parsed variants matched; "
                    f"{route_unparsed_count} imported request symbols unresolved"
                )
            elif route_endpoint_count and route_endpoint_count == route_match_count:
                closure = f"candidate {route_match_count}/{route_endpoint_count}; runtime unverified"
            elif route_endpoint_count:
                closure = f"partial {route_match_count}/{route_endpoint_count}; investigate unmatched"
            else:
                closure = "unknown: no parsed request endpoint"
            shared = renderer_usage.get(route.page, [])
            shared_text = f"shared by {', '.join(shared)}" if len(shared) > 1 else "dedicated page"
            renderer_text = f"{route.renderer} -> {self.rel(route.page)} ({shared_text})"
            auth_summary = self.limit(permission_values, 3) if permission_values else "frontend role=admin; backend unknown until API match"
            summary_rows.append(
                "| "
                + " | ".join(
                    self.md(item)
                    for item in (
                        route.route,
                        route.kind,
                        renderer_text,
                        len(imports),
                        closure,
                        auth_summary,
                        self.ref_text(route.ref),
                    )
                )
                + " |"
            )

            if not api_rows:
                api_rows.append("| none parsed | unknown | UNMATCHED | unknown | unknown | unknown | runtime verification required |")
            route_sections.extend(
                [
                    f"## `{route.route}`",
                    "",
                    f"- Frontend route: **{route.kind}**, renderer `{route.renderer}`; evidence {self.ref_text(route.ref)}.",
                    f"- Page: `{self.rel(route.page)}`; renderer import evidence {self.ref_text(route.renderer_import_ref)}; {shared_text}.",
                    f"- Static closure status: **{closure}**. This is not a runtime pass.",
                    f"- Hardcoded/mock scan: {flags['hardcoded']}.",
                    f"- Native-control scan: {flags['native']}. Native tags may be styled; this flag does not claim browser-default rendering.",
                    f"- Error handling scan: {flags['error']}.",
                    "",
                    "| Imported API function | Frontend request | Mounted backend route | Controller | Service | Likely Prisma model/table | Auth, permission, status |",
                    "|---|---|---|---|---|---|---|",
                    *api_rows,
                    "",
                ]
            )

        shared_notes = [
            f"- `{self.rel(page)}` is shared by: " + ", ".join(f"`{route}`" for route in routes)
            for page, routes in sorted(renderer_usage.items(), key=lambda item: self.rel(item[0]))
            if len(routes) > 1
        ]
        unmatched_lines = [f"- {item}" for item in dict.fromkeys(unmatched)] or ["- None found by the static matcher."]
        dynamic_count = sum(route.kind == "dynamic" for route in frontend_routes)

        return "\n".join(
            [
                "# Admin Route / API / Database Static Matrix",
                "",
                "Generated deterministically by `python scripts/admin_route_api_matrix.py` from the current source tree.",
                "",
                "> Scope: static evidence only. A route marked as a candidate has a matching frontend request method/path and a mounted backend route. It still requires a restarted current backend, a real admin session, database assertions, Network/Console inspection, and browser behavior verification. Unknown data is deliberately reported as unknown.",
                "",
                "## Coverage summary",
                "",
                f"- Frontend admin routes: **{len(frontend_routes)}** ({len(frontend_routes) - dynamic_count} static, {dynamic_count} dynamic).",
                f"- Parsed frontend request variants: **{total_api_rows}**; mounted backend matches: **{matched_api_rows}**; unmatched: **{total_api_rows - matched_api_rows}**.",
                f"- Imported API symbols whose request wrapper could not be parsed: **{unparsed_api_symbols}** (listed for manual review).",
                f"- Mounted backend route records scanned: **{len(backend_routes)}**.",
                f"- Prisma model/table map entries scanned: **{len(self.model_tables)}**.",
                "- Frontend guards declare `roles: ['admin']` for every route below; backend auth/role/permission evidence is reported per API row.",
                "",
                "| Frontend route | Kind | Renderer / page | Imported API functions | Static closure | Auth / permission summary | Route evidence |",
                "|---|---|---|---:|---|---|---|",
                *summary_rows,
                "",
                "## Shared expansion pages",
                "",
                *(shared_notes or ["- No shared admin page modules detected."]),
                "",
                "The shared-page entries are not independent implementations: governance expansion routes reuse `admin-governance.js`, while agent/environment entries reuse `admin-ai-config.js`. Their generic API paths are specialized with the route module key where static evidence allows it.",
                "",
                "## Unmatched / manual-review queue",
                "",
                *unmatched_lines,
                "",
                "## Interpretation limits",
                "",
                "- Static matching does not send HTTP requests, authenticate, execute controller/service code, or query/mutate the database.",
                "- Prisma models marked `service-file-wide-likely` are conservative file-level evidence when lightweight call-graph tracing cannot follow a dispatch map; they are not claimed as endpoint-specific writes.",
                "- Imported API functions are page-module evidence. Shared pages can branch by route/tab at runtime, so browser Network inspection must confirm which imported functions actually execute for each route.",
                "- Native HTML tags are counted even when project classes style them. Computed-style and visual-regression checks remain required to detect default-control regression.",
                "- The hardcoded/mock scan only flags explicit high-signal markers; absence of a marker is not proof that every displayed value originates in the database.",
                "",
                *route_sections,
            ]
        ).rstrip() + "\n"


def parse_args() -> argparse.Namespace:
    script = Path(__file__).resolve()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=script.parent.parent)
    parser.add_argument("--output", type=Path, default=script.parent.parent / "docs/admin-route-api-matrix.md")
    parser.add_argument(
        "--check",
        action="store_true",
        help="do not write; exit 1 when the existing report differs from generated output",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        analyzer = Analyzer(args.repo_root)
        report = analyzer.render_report()
        output = args.output.resolve()
        if args.check:
            if not output.is_file():
                print(f"[stale] report does not exist: {output}", file=sys.stderr)
                return 1
            if output.read_text(encoding="utf-8") != report:
                print(f"[stale] report differs from current source: {output}", file=sys.stderr)
                return 1
            print(f"[ok] report is current: {output}")
            return 0
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(report, encoding="utf-8", newline="\n")
        route_count = len(re.findall(r"(?m)^## `/admin/", report))
        print(f"[ok] wrote {output} with {route_count} admin route sections")
        return 0
    except (AnalyzerError, OSError, UnicodeError, re.error) as error:
        print(f"[fatal] {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
