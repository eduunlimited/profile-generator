#!/usr/bin/env python3
"""Launch a headed Camoufox session for one account. Reads JSON from stdin, prints JSON to stdout."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from contextlib import suppress
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from camoufox_factory import (
    build_camoufox_kwargs,
    load_fingerprint,
    mask_proxy,
    save_fingerprint,
    summarize_fingerprint,
)
from playwright.async_api import PlaywrightContextManager


def _mark_session_running(session_dir: Path, account_id: str) -> None:
    marker = session_dir / "session-running.json"
    marker.write_text(
        json.dumps({"accountId": account_id, "pid": os.getpid()}),
        encoding="utf-8",
    )


def _clear_session_running(session_dir: Path) -> None:
    with suppress(Exception):
        (session_dir / "session-running.json").unlink()


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _fail(message: str, *, code: int = 1) -> None:
    _emit({"ok": False, "error": message})
    raise SystemExit(code)


def _friendly_error(exc: BaseException) -> str:
    message = str(exc).strip()
    name = exc.__class__.__name__
    if name == "InvalidIP" or "Failed to get IP address" in message:
        return (
            "Could not reach the proxy for geo lookup. Check that the proxy host/port/credentials "
            "are correct, the proxy is online, or click refresh to assign a different proxy."
        )
    if "unexpected keyword argument" in message:
        return f"Camoufox launch misconfigured: {message}"
    if "Invalid proxy server URL" in message:
        return message
    if message:
        return message
    return f"Camoufox launch failed ({name})."


async def _create_session_context(browser: Any, storage_state_path: Path) -> Any:
    for existing in list(browser.contexts):
        with suppress(Exception):
            await existing.close()

    if storage_state_path.exists():
        return await browser.new_context(storage_state=str(storage_state_path))

    return await browser.new_context()


async def _wait_for_user_close(browser: Any, context: Any) -> None:
    closed = asyncio.Event()

    def mark_closed(*_args: Any) -> None:
        closed.set()

    browser.on("disconnected", mark_closed)

    async def close_blank_page(page: Any) -> None:
        for _ in range(8):
            if closed.is_set():
                return
            with suppress(Exception):
                if page.is_closed():
                    return
                url = page.url
                if url in ("about:blank", "about:home", "about:newtab"):
                    await page.close()
                    return
            await asyncio.sleep(0.05)

    context.on("page", lambda page: asyncio.create_task(close_blank_page(page)))

    while browser.is_connected() and not closed.is_set():
        open_pages = [page for page in context.pages if not page.is_closed()]
        if not open_pages:
            return
        try:
            await asyncio.wait_for(closed.wait(), timeout=0.15)
            return
        except asyncio.TimeoutError:
            continue


async def _shutdown_camoufox(cm: Any, browser: Any, context: Any) -> None:
    with suppress(Exception):
        await context.close()
    with suppress(Exception):
        if browser.is_connected():
            await browser.close()
    cm.browser = None
    with suppress(Exception):
        await PlaywrightContextManager.__aexit__(cm, None, None, None)


async def _load_start_url(page: Any, start_url: str) -> None:
    if not start_url or start_url == "about:blank":
        return
    with suppress(Exception):
        await page.goto(start_url, wait_until="domcontentloaded", timeout=120_000)


async def run_session(request: dict[str, Any]) -> dict[str, Any]:
    try:
        from camoufox.async_api import AsyncCamoufox
    except ImportError:
        _fail(
            "Camoufox is not installed. Run: pip install camoufox[geoip] && python -m camoufox fetch"
        )

    account_id = str(request.get("accountId") or "").strip()
    session_dir = Path(str(request.get("sessionDir") or "").strip())
    if not account_id or not session_dir:
        _fail("accountId and sessionDir are required.")

    session_dir.mkdir(parents=True, exist_ok=True)
    fingerprint_path = session_dir / "fingerprint.json"
    storage_state_path = session_dir / "storage_state.json"

    proxy_server = (request.get("proxyServer") or "").strip() or None
    start_url = (request.get("startUrl") or "").strip() or "about:blank"
    timezone = (request.get("timezone") or "").strip() or None
    locale = (request.get("locale") or "en-US").strip() or "en-US"

    fingerprint = load_fingerprint(fingerprint_path)
    kwargs = build_camoufox_kwargs(
        proxy_server=proxy_server,
        locale=locale,
        timezone=timezone,
        storage_state_path=storage_state_path,
        fingerprint=fingerprint,
        geoip=bool(proxy_server),
    )

    cm = AsyncCamoufox(**kwargs)
    browser = await cm.__aenter__()
    saved_fingerprint = fingerprint
    cookies_persisted = False
    load_task: asyncio.Task[None] | None = None
    shutdown_done = False

    try:
        context = await _create_session_context(browser, storage_state_path)
        page = context.pages[0] if context.pages else await context.new_page()

        generated = getattr(browser, "fingerprint", None) or kwargs.get("fingerprint")
        if generated and not fingerprint_path.exists():
            save_fingerprint(fingerprint_path, generated)
            saved_fingerprint = generated

        _emit(
            {
                "ok": True,
                "started": True,
                "sessionId": account_id,
                "accountId": account_id,
                "browserExecutable": "camoufox",
                "sessionDataDir": str(session_dir),
                "fingerprintPath": str(fingerprint_path),
                "proxyLabel": mask_proxy(proxy_server) if proxy_server else None,
                "fingerprintSummary": summarize_fingerprint(saved_fingerprint, timezone),
                "startUrl": start_url if start_url != "about:blank" else request.get("startUrl"),
                "cookiesPersisted": False,
            }
        )
        _mark_session_running(session_dir, account_id)

        load_task = asyncio.create_task(_load_start_url(page, start_url))
        await _wait_for_user_close(browser, context)

        if load_task:
            load_task.cancel()
            with suppress(asyncio.CancelledError):
                await load_task

        with suppress(Exception):
            await context.storage_state(path=str(storage_state_path))
        cookies_persisted = storage_state_path.exists()

        await _shutdown_camoufox(cm, browser, context)
        shutdown_done = True
    finally:
        _clear_session_running(session_dir)
        if load_task and not load_task.done():
            load_task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await load_task
        if not shutdown_done:
            with suppress(Exception):
                await _shutdown_camoufox(cm, browser, context)

    return {
        "ok": True,
        "started": False,
        "sessionId": account_id,
        "accountId": account_id,
        "browserExecutable": "camoufox",
        "sessionDataDir": str(session_dir),
        "fingerprintPath": str(fingerprint_path),
        "proxyLabel": mask_proxy(proxy_server) if proxy_server else None,
        "fingerprintSummary": summarize_fingerprint(saved_fingerprint, timezone),
        "startUrl": start_url if start_url != "about:blank" else request.get("startUrl"),
        "cookiesPersisted": cookies_persisted,
    }


async def main_async(request: dict[str, Any]) -> None:
    try:
        await run_session(request)
    except SystemExit:
        raise
    except Exception as exc:
        _fail(_friendly_error(exc))


def main() -> None:
    parser = argparse.ArgumentParser(description="Launch Camoufox browser session")
    parser.add_argument("--request", help="JSON request payload")
    args = parser.parse_args()

    raw = args.request
    if not raw:
        raw = sys.stdin.read()
    if not raw.strip():
        _fail("Missing JSON request payload.")

    try:
        request = json.loads(raw)
    except json.JSONDecodeError as exc:
        _fail(f"Invalid JSON request: {exc}")

    try:
        asyncio.run(main_async(request))
    except SystemExit:
        raise
    except Exception as exc:
        _fail(_friendly_error(exc))


if __name__ == "__main__":
    main()
