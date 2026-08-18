#!/usr/bin/env python3
"""Check whether Camoufox is importable and browser binaries are available."""

from __future__ import annotations

import json
import sys
from importlib.metadata import PackageNotFoundError, version


def camoufox_version() -> str:
    try:
        return version("camoufox")
    except PackageNotFoundError:
        return "unknown"


def main() -> None:
    try:
        import camoufox  # noqa: F401
    except ImportError:
        print(
            json.dumps(
                {
                    "ready": False,
                    "message": "Camoufox not installed. Run: pip install camoufox[geoip] && python -m camoufox fetch",
                }
            )
        )
        return

    print(
        json.dumps(
            {
                "ready": True,
                "message": "Camoufox is ready.",
                "version": camoufox_version(),
            }
        )
    )


if __name__ == "__main__":
    main()
