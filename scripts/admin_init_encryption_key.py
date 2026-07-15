#!/usr/bin/env python3
"""Initialize a local AI_CONFIG_ENCRYPTION_KEY without printing the secret."""

from __future__ import annotations

import argparse
import base64
import secrets
import sys
from pathlib import Path


KEY_NAME = "AI_CONFIG_ENCRYPTION_KEY"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(__file__).resolve().parents[1] / "backend" / ".env")
    args = parser.parse_args()
    path = args.env_file.resolve()
    try:
        lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
        for line in lines:
            if line.startswith(f"{KEY_NAME}=") and line.partition("=")[2].strip():
                print(f"{KEY_NAME} already configured; no change made")
                return 0
        value = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii")
        replaced = False
        output: list[str] = []
        for line in lines:
            if line.startswith(f"{KEY_NAME}="):
                output.append(f"{KEY_NAME}={value}")
                replaced = True
            else:
                output.append(line)
        if not replaced:
            output.extend([
                "",
                "# Local authenticated-encryption master key; never commit this file.",
                f"{KEY_NAME}={value}",
            ])
        path.write_text("\n".join(output).rstrip() + "\n", encoding="utf-8", newline="\n")
        print(f"initialized {KEY_NAME} in {path.name}; value was not displayed")
        return 0
    except Exception as exc:  # noqa: BLE001 - command-line boundary
        print(f"failed to initialize encryption key: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
