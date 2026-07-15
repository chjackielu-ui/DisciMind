#!/usr/bin/env python3
"""Remove unrelated or destructive drift operations from an additive admin migration."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


UNRELATED_ALTER_TABLES = {
    "document_revisions",
    "editable_teaching_document_versions",
    "editable_teaching_documents",
    "student_learning_plans",
    "teacher_reminders",
}


def sanitize(sql: str) -> tuple[str, int]:
    chunks = re.split(r"(?<=;)\s*", sql)
    kept: list[str] = []
    removed = 0
    for chunk in chunks:
        if not chunk.strip():
            continue
        upper = chunk.upper()
        table_match = re.search(r"ALTER\s+TABLE\s+`([^`]+)`", chunk, flags=re.IGNORECASE)
        table = table_match.group(1) if table_match else None
        destructive = any(token in upper for token in (" DROP ", "DROP INDEX", "DROP FOREIGN KEY", "RENAME INDEX"))
        unrelated_alter = table in UNRELATED_ALTER_TABLES
        if destructive or unrelated_alter:
            removed += 1
            continue
        kept.append(chunk.strip())
    result = "-- Additive migration for the DisciMind admin management center.\n"
    result += "-- Existing tables, columns, indexes and foreign keys are never removed.\n\n"
    result += "\n\n".join(kept).strip() + "\n"
    return result, removed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("migration", type=Path)
    args = parser.parse_args()
    path = args.migration.resolve()
    try:
        original = path.read_text(encoding="utf-8")
        cleaned, removed = sanitize(original)
        if re.search(r"\b(?:DROP|TRUNCATE|DELETE\s+FROM|RENAME\s+INDEX)\b", cleaned, flags=re.IGNORECASE):
            raise ValueError("destructive SQL remained after sanitization")
        path.write_text(cleaned, encoding="utf-8", newline="\n")
        print(f"sanitized {path.name}: removed {removed} unrelated/destructive statements")
        return 0
    except Exception as exc:  # noqa: BLE001 - command-line boundary
        print(f"migration sanitization failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
