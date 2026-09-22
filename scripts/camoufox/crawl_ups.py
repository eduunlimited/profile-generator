#!/usr/bin/env python3
"""Crawl UPS tracking in a real browser.

UPS blocks raw HTTP to GetStatus; the public track page still exposes the
estimated arrival date in page text and JSON responses.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import subprocess
import sys
from contextlib import suppress
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

if sys.platform == "win32":
    _CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    _popen_init = subprocess.Popen.__init__

    def _hidden_popen_init(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        kwargs["creationflags"] = int(kwargs.get("creationflags") or 0) | _CREATE_NO_WINDOW
        _popen_init(self, *args, **kwargs)

    subprocess.Popen.__init__ = _hidden_popen_init  # type: ignore[method-assign]

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
READY_ARRIVE = re.compile(r"estimated\s+to\s+arrive", re.I)
READY_JSON = re.compile(
    r'"(?:displayEstDeliveryDt|estDeliveryDt|scheduledDeliveryDate|scheduledDeliveryDay|edtDate)"\s*:\s*"[^"]+"',
    re.I,
)
READY_DELIVERED = re.compile(r"delivered(?:\s+on)?[:\s]", re.I)


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _tracking_from_url(url: str) -> str:
    raw = (url or "").strip()
    parsed = urlparse(raw)
    query = parse_qs(parsed.query)
    for key in ("tracknum", "trackNums", "InquiryNumber"):
        values = query.get(key) or []
        if values:
            return re.sub(r"[\s-]+", "", unquote(values[0])).upper()
    match = re.search(r"1Z[A-Z0-9]{16}", raw, re.I)
    return match.group(0).upper() if match else ""


def _is_ready(text: str) -> bool:
    return bool(READY_ARRIVE.search(text) or READY_JSON.search(text) or READY_DELIVERED.search(text))


async def _attach_status(page: Any, bodies: list[str], ready: asyncio.Event) -> None:
    async def on_response(response: Any) -> None:
        url = str(response.url or "")
        if not re.search(r"/track/api/Track/GetStatus", url, re.I):
            return
        if response.status != 200:
            return
        try:
            text = await response.text()
        except Exception:
            return
        if not text or len(text) < 40:
            return
        bodies.append(text)
        if _is_ready(text):
            ready.set()

    page.on("response", lambda response: asyncio.create_task(on_response(response)))


async def _wait_ready(page: Any, ready: asyncio.Event) -> None:
    for _ in range(12):
        if ready.is_set():
            return
        try:
            visible = await page.evaluate("() => document.body?.innerText ?? ''")
        except Exception:
            visible = ""
        if visible and _is_ready(visible):
            ready.set()
            return
        try:
            await asyncio.wait_for(ready.wait(), timeout=1)
            return
        except asyncio.TimeoutError:
            continue


async def _crawl_with_page(page: Any, url: str, tracking: str) -> dict[str, Any]:
    bodies: list[str] = []
    ready = asyncio.Event()
    await _attach_status(page, bodies, ready)
    await page.goto(url, wait_until="domcontentloaded", timeout=45000)
    await _wait_ready(page, ready)
    try:
        visible = await page.evaluate("() => document.body?.innerText ?? ''")
    except Exception:
        visible = ""
    prefix = f"TRACK: {tracking}" if tracking else ""
    text = "\n".join(part for part in (prefix, "\n".join(bodies), visible) if part)
    return {"status": 200, "text": text[:250_000]}


async def _try_chromium(url: str, tracking: str) -> dict[str, Any] | None:
    try:
        from playwright.async_api import async_playwright
    except Exception:
        return None

    playwright = await async_playwright().start()
    browser = None
    try:
        for channel in ("chrome", "msedge"):
            try:
                browser = await playwright.chromium.launch(
                    channel=channel,
                    headless=True,
                    args=["--disable-blink-features=AutomationControlled", "--no-first-run"],
                )
                break
            except Exception:
                browser = None
        if browser is None:
            try:
                browser = await playwright.chromium.launch(
                    headless=True,
                    args=["--disable-blink-features=AutomationControlled", "--no-first-run"],
                )
            except Exception:
                return None
        page = await browser.new_page(locale="en-US", user_agent=USER_AGENT)
        try:
            return await _crawl_with_page(page, url, tracking)
        finally:
            with suppress(Exception):
                await page.close()
    finally:
        if browser is not None:
            with suppress(Exception):
                await browser.close()
        with suppress(Exception):
            await playwright.stop()


async def _try_camoufox(url: str, tracking: str) -> dict[str, Any] | None:
    try:
        from camoufox.async_api import AsyncCamoufox
        from camoufox_factory import build_camoufox_kwargs
        from playwright.async_api import PlaywrightContextManager
    except Exception:
        return None

    kwargs = build_camoufox_kwargs(
        proxy_server=None,
        locale="en-US",
        timezone=None,
        storage_state_path=None,
        geoip=False,
    )
    kwargs["headless"] = True
    kwargs["humanize"] = False
    cm = AsyncCamoufox(**kwargs)
    browser = await cm.__aenter__()
    context = None
    page = None
    try:
        context = await browser.new_context()
        page = context.pages[0] if context.pages else await context.new_page()
        return await _crawl_with_page(page, url, tracking)
    finally:
        if page is not None:
            with suppress(Exception):
                await page.close()
        if context is not None:
            with suppress(Exception):
                await context.close()
        cm.browser = None
        with suppress(Exception):
            await PlaywrightContextManager.__aexit__(cm, None, None, None)


async def crawl(url: str) -> dict[str, Any]:
    tracking = _tracking_from_url(url)
    if not tracking:
        return {"status": 0, "text": ""}
    page_url = f"https://www.ups.com/track?tracknum={tracking}&loc=en_US"
    crawled = await _try_chromium(page_url, tracking)
    if crawled and crawled.get("text"):
        return crawled
    crawled = await _try_camoufox(page_url, tracking)
    if crawled and crawled.get("text"):
        return crawled
    return crawled or {"status": 0, "text": ""}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    try:
        payload = json.loads(args.request)
    except json.JSONDecodeError as error:
        _emit({"status": 0, "text": "", "error": f"Invalid crawl request: {error}"})
        return
    url = str(payload.get("url") or "").strip()
    if not url:
        _emit({"status": 0, "text": "", "error": "Missing UPS track URL."})
        return
    try:
        result = asyncio.run(crawl(url))
    except Exception as error:
        _emit({"status": 0, "text": "", "error": str(error)})
        return
    _emit(result)


if __name__ == "__main__":
    main()
