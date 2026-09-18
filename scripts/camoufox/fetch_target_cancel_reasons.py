#!/usr/bin/env python3
"""Fetch Target guest_order_aggregations cancel_reason_text using a logged-in session.

Tries saved Camoufox cookies first. If Target returns 401/403, opens Camoufox and
signs in with the account email + email OTP (written to otp-code.txt by the app).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import ssl
import subprocess
import sys
import time
from contextlib import suppress
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import ProxyHandler, Request, build_opener

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

if sys.platform == "win32":
    _CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    _popen_init = subprocess.Popen.__init__

    def _hidden_popen_init(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        kwargs["creationflags"] = int(kwargs.get("creationflags") or 0) | _CREATE_NO_WINDOW
        _popen_init(self, *args, **kwargs)

    subprocess.Popen.__init__ = _hidden_popen_init  # type: ignore[method-assign]

from camoufox_factory import (  # noqa: E402
    build_camoufox_kwargs,
    load_fingerprint,
    parse_proxy_server,
    save_fingerprint,
)

from playwright.async_api import PlaywrightContextManager  # noqa: E402

TARGET_API_KEY = "f5e5f35b610d54dff3f3c9087c837f479f22686e"
TARGET_ORDER_URL = (
    "https://api.target.com/guest_order_aggregations/v1/{order_id}?key=" + TARGET_API_KEY
)
TARGET_LOGIN_URL = "https://www.target.com/login"
OTP_FILENAME = "otp-code.txt"
OTP_WAIT_SECS = 180
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0"
)

REASON_KEYS = ("cancel_reason_text", "cancelReasonText", "cancel_reason", "cancelReason")


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _fail(message: str, *, extra: dict[str, Any] | None = None, code: int = 1) -> None:
    payload = {"event": "result", "ok": False, "error": message, "orders": []}
    if extra:
        payload.update(extra)
    _emit(payload)
    raise SystemExit(code)


def _status(message: str) -> None:
    _emit({"event": "status", "message": message})


def _extract_reasons(value: Any) -> list[str]:
    found: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, child in node.items():
                if key in REASON_KEYS and isinstance(child, str) and child.strip():
                    found.append(child.strip())
                else:
                    walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(value)
    # Prefer the longer / more specific Target copy first.
    unique: list[str] = []
    for reason in found:
        if reason not in unique:
            unique.append(reason)
    unique.sort(key=len, reverse=True)
    return unique


def _target_cookie_header(storage_state_path: Path) -> str:
    if not storage_state_path.exists():
        return ""
    try:
        data = json.loads(storage_state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    cookies = data.get("cookies") if isinstance(data, dict) else None
    if not isinstance(cookies, list):
        return ""
    parts: list[str] = []
    for cookie in cookies:
        if not isinstance(cookie, dict):
            continue
        domain = str(cookie.get("domain") or "")
        name = str(cookie.get("name") or "")
        value = cookie.get("value")
        if "target.com" not in domain or not name or value is None:
            continue
        parts.append(f"{name}={value}")
    return "; ".join(parts)


def _proxy_url(proxy_server: str | None) -> str | None:
    if not proxy_server or proxy_server.strip().lower() in {"", "none", "direct"}:
        return None
    parsed = parse_proxy_server(proxy_server)
    server = parsed["server"]
    username = parsed.get("username")
    password = parsed.get("password")
    if not username:
        return server
    pieces = urlparse(server)
    auth = quote(username, safe="")
    if password:
        auth = f"{auth}:{quote(password, safe='')}"
    return f"{pieces.scheme}://{auth}@{pieces.hostname}:{pieces.port}"


def _opener(proxy_server: str | None):
    proxy = _proxy_url(proxy_server)
    handlers = []
    if proxy:
        handlers.append(ProxyHandler({"http": proxy, "https": proxy}))
    return build_opener(*handlers)


def _request_headers(cookie_header: str) -> dict[str, str]:
    headers = {
        "Accept": "application/json,text/plain,*/*",
        "Origin": "https://www.target.com",
        "Referer": "https://www.target.com/",
        "User-Agent": USER_AGENT,
    }
    if cookie_header:
        headers["Cookie"] = cookie_header
    return headers


def _parse_api_body(body: str, http_status: int) -> dict[str, Any]:
    text = body.strip()
    if not text:
        return {"httpStatus": http_status, "error": "Empty Target response."}
    if text[:1] in "<":
        return {"httpStatus": http_status, "needsLogin": True, "error": "Target returned a login page."}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {"httpStatus": http_status, "error": "Target response was not JSON."}
    reasons = _extract_reasons(parsed)
    return {
        "httpStatus": http_status,
        "cancelReason": reasons[0] if reasons else None,
        "needsLogin": False,
    }


def fetch_order_http(order_id: str, cookie_header: str, proxy_server: str | None) -> dict[str, Any]:
    url = TARGET_ORDER_URL.format(order_id=order_id)
    request = Request(url, headers=_request_headers(cookie_header))
    try:
        with _opener(proxy_server).open(request, timeout=30) as response:
            body = response.read().decode("utf-8", "replace")
            parsed = _parse_api_body(body, getattr(response, "status", 200) or 200)
            parsed["orderId"] = order_id
            return parsed
    except HTTPError as error:
        body = error.read().decode("utf-8", "replace") if error.fp else ""
        parsed = _parse_api_body(body, error.code)
        parsed["orderId"] = order_id
        parsed["needsLogin"] = parsed.get("needsLogin") or error.code in {401, 403}
        parsed["error"] = parsed.get("error") or f"HTTP {error.code}"
        return parsed
    except (URLError, TimeoutError, ssl.SSLError, OSError) as error:
        return {"orderId": order_id, "error": str(error), "needsLogin": False}


def fetch_orders_http(
    order_ids: list[str], cookie_header: str, proxy_server: str | None
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for index, order_id in enumerate(order_ids, start=1):
        _status(f"Checking Target order {order_id} ({index}/{len(order_ids)})")
        results.append(fetch_order_http(order_id, cookie_header, proxy_server))
    return results


def _otp_path(session_dir: Path) -> Path:
    return session_dir / OTP_FILENAME


def _clear_otp(session_dir: Path) -> None:
    with suppress(OSError):
        _otp_path(session_dir).unlink()


def _wait_for_otp(session_dir: Path, timeout: int = OTP_WAIT_SECS) -> str:
    path = _otp_path(session_dir)
    deadline = time.time() + timeout
    while time.time() < deadline:
        if path.exists():
            code = path.read_text(encoding="utf-8").strip()
            if 4 <= len(code) <= 8 and code.isdigit():
                with suppress(OSError):
                    path.unlink()
                return code
        time.sleep(0.4)
    raise TimeoutError("Timed out waiting for the Target email sign-in code.")


def _locator_candidates(page: Any, selectors: list[str]):
    for selector in selectors:
        locator = page.locator(selector).first
        yield selector, locator


async def _pages_and_frames(page: Any) -> list[Any]:
    frames: list[Any] = [page]
    with suppress(Exception):
        frames.extend(page.frames)
    return frames


async def _click_first(root: Any, selectors: list[str], timeout: int = 8000) -> bool:
    deadline = time.time() + timeout / 1000
    while time.time() < deadline:
        for target in await _pages_and_frames(root):
            for _selector, locator in _locator_candidates(target, selectors):
                with suppress(Exception):
                    if await locator.count() and await locator.is_visible():
                        await locator.click(timeout=2000)
                        return True
        await root.wait_for_timeout(250)
    return False


async def _is_visible_first(root: Any, selectors: list[str]) -> bool:
    for target in await _pages_and_frames(root):
        for _selector, locator in _locator_candidates(target, selectors):
            with suppress(Exception):
                if await locator.count() and await locator.is_visible():
                    return True
    return False


async def _fill_first(root: Any, selectors: list[str], value: str, timeout: int = 12000) -> bool:
    deadline = time.time() + timeout / 1000
    while time.time() < deadline:
        for target in await _pages_and_frames(root):
            for _selector, locator in _locator_candidates(target, selectors):
                with suppress(Exception):
                    if await locator.count() and await locator.is_visible():
                        await locator.fill(value, timeout=2000)
                        return True
        await root.wait_for_timeout(250)
    return False


async def _is_signed_in(page: Any, context: Any) -> bool:
    with suppress(Exception):
        cookies = await context.cookies("https://www.target.com")
        names = {str(cookie.get("name") or "") for cookie in cookies}
        if {"accessToken", "idToken", "access_token"} & names:
            return True
    with suppress(Exception):
        if await page.locator('a:has-text("Sign out"), button:has-text("Sign out")').count():
            return True
    with suppress(Exception):
        url = page.url.lower()
        if "login" not in url and "/account" in url:
            return True
    return False


async def _login_with_otp(page: Any, context: Any, email: str, session_dir: Path) -> None:
    _status("Opening Target sign-in")
    await page.goto(TARGET_LOGIN_URL, wait_until="domcontentloaded", timeout=90_000)
    await page.wait_for_timeout(800)

    if await _is_signed_in(page, context):
        _status("Target session is already signed in")
        return

    _status(f"Entering Target email {email}")
    filled = await _fill_first(
        page,
        [
            'input[type="email"]',
            "input#username",
            'input[name="username"]',
            'input[autocomplete="username"]',
            'input[name="email"]',
        ],
        email,
    )
    if not filled:
        raise RuntimeError(
            "Could not find Target's email field. Sign in once in Sessions, then retry."
        )

    await _click_first(
        page,
        [
            'button:has-text("Continue")',
            'button:has-text("Next")',
            'button[type="submit"]',
            'button:has-text("Sign in")',
        ],
    )
    await page.wait_for_timeout(1200)

    _status("Requesting a Target email sign-in code")
    otp_clicked = await _click_first(
        page,
        [
            'button:has-text("Get a sign-in code")',
            'button:has-text("Email me a code")',
            'button:has-text("Send a sign-in code")',
            'button:has-text("Use a one-time code")',
            'button:has-text("Send code")',
            'a:has-text("Get a sign-in code")',
            'a:has-text("sign-in code")',
            'button:has-text("Email")',
            'label:has-text("Email")',
        ],
        timeout=6000,
    )
    code_selectors = [
        'input[autocomplete="one-time-code"]',
        'input[name="code"]',
        'input[name="otp"]',
        'input[inputmode="numeric"]',
        'input[type="tel"]',
        'input[id*="code" i]',
    ]
    code_ready = await _is_visible_first(page, code_selectors)
    if not otp_clicked and not code_ready:
        raise RuntimeError(
            "Target did not offer an email sign-in code. Sign in once from Sessions, then retry."
        )

    _emit({"event": "need_otp", "email": email})
    _status("Waiting for the Target email code")
    code = await asyncio.to_thread(_wait_for_otp, session_dir)

    filled_code = await _fill_first(
        page,
        code_selectors,
        code,
        timeout=20000,
    )
    if not filled_code:
        raise RuntimeError("Could not find Target's code field after the email OTP arrived.")

    await _click_first(
        page,
        [
            'button:has-text("Verify")',
            'button:has-text("Continue")',
            'button:has-text("Submit")',
            'button:has-text("Sign in")',
            'button[type="submit"]',
        ],
    )
    await page.wait_for_timeout(2500)
    with suppress(Exception):
        await page.goto("https://www.target.com/account", wait_until="domcontentloaded", timeout=60_000)
    if not await _is_signed_in(page, context):
        raise RuntimeError("Target sign-in did not complete after the email code.")


async def _create_session_context(browser: Any, storage_state_path: Path) -> Any:
    for existing in list(browser.contexts):
        with suppress(Exception):
            await existing.close()
    if storage_state_path.exists():
        return await browser.new_context(storage_state=str(storage_state_path))
    return await browser.new_context()


async def _shutdown_camoufox(cm: Any, browser: Any, context: Any) -> None:
    with suppress(Exception):
        await context.storage_state()
    with suppress(Exception):
        await context.close()
    with suppress(Exception):
        if browser.is_connected():
            await browser.close()
    cm.browser = None
    with suppress(Exception):
        await PlaywrightContextManager.__aexit__(cm, None, None, None)


async def fetch_orders_in_browser(context: Any, order_ids: list[str]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for index, order_id in enumerate(order_ids, start=1):
        _status(f"Checking Target order {order_id} ({index}/{len(order_ids)})")
        url = TARGET_ORDER_URL.format(order_id=order_id)
        try:
            response = await context.request.get(
                url,
                headers=_request_headers(""),
                timeout=30000,
            )
            body = await response.text()
            parsed = _parse_api_body(body, response.status)
            parsed["orderId"] = order_id
            parsed["needsLogin"] = parsed.get("needsLogin") or response.status in {401, 403}
            results.append(parsed)
        except Exception as error:  # noqa: BLE001
            results.append({"orderId": order_id, "error": str(error)})
    return results


async def run(request: dict[str, Any]) -> None:
    email = str(request.get("email") or "").strip()
    session_dir = Path(str(request.get("sessionDir") or "").strip())
    order_ids = [
        str(order_id).strip()
        for order_id in (request.get("orderIds") or [])
        if str(order_id).strip()
    ]
    if not email or not session_dir or not order_ids:
        _fail("email, sessionDir, and orderIds are required.")

    session_dir.mkdir(parents=True, exist_ok=True)
    _clear_otp(session_dir)
    storage_state_path = session_dir / "storage_state.json"
    fingerprint_path = session_dir / "fingerprint.json"
    proxy_server = (request.get("proxyServer") or "").strip() or None
    allow_login = bool(request.get("allowLogin", True))
    timezone = (request.get("timezone") or "").strip() or None
    locale = (request.get("locale") or "en-US").strip() or "en-US"

    cookie_header = _target_cookie_header(storage_state_path)
    results: list[dict[str, Any]] = []
    used_login = False

    if cookie_header:
        _status("Trying saved Target cookies")
        results = fetch_orders_http(order_ids, cookie_header, proxy_server)
        if not any(item.get("needsLogin") for item in results):
            _emit(
                {
                    "event": "result",
                    "ok": True,
                    "loggedIn": True,
                    "usedLogin": False,
                    "orders": results,
                }
            )
            return

    if not allow_login:
        _emit(
            {
                "event": "result",
                "ok": False,
                "needsLogin": True,
                "loggedIn": False,
                "error": "Saved Target cookies expired. Close the open session or allow auto sign-in.",
                "orders": results,
            }
        )
        return

    try:
        from camoufox.async_api import AsyncCamoufox
    except ImportError:
        _fail("Camoufox is not installed. Run: pip install camoufox[geoip] && python -m camoufox fetch")

    _status("Opening Camoufox to sign in to Target")
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
    context = await _create_session_context(browser, storage_state_path)
    page = context.pages[0] if context.pages else await context.new_page()
    shutdown_done = False
    try:
        generated = getattr(browser, "fingerprint", None) or kwargs.get("fingerprint")
        if generated and not fingerprint_path.exists():
            save_fingerprint(fingerprint_path, generated)

        await _login_with_otp(page, context, email, session_dir)
        used_login = True
        await context.storage_state(path=str(storage_state_path))
        results = await fetch_orders_in_browser(context, order_ids)
        await context.storage_state(path=str(storage_state_path))
        await _shutdown_camoufox(cm, browser, context)
        shutdown_done = True
    finally:
        _clear_otp(session_dir)
        if not shutdown_done:
            with suppress(Exception):
                await context.storage_state(path=str(storage_state_path))
            with suppress(Exception):
                await _shutdown_camoufox(cm, browser, context)

    _emit(
        {
            "event": "result",
            "ok": not any(item.get("needsLogin") for item in results),
            "loggedIn": True,
            "usedLogin": used_login,
            "orders": results,
        }
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Target cancel reasons")
    parser.add_argument("--request", help="JSON request payload")
    args = parser.parse_args()
    raw = args.request or sys.stdin.read()
    if not raw.strip():
        _fail("Missing JSON request payload.")
    try:
        request = json.loads(raw)
    except json.JSONDecodeError as error:
        _fail(f"Invalid JSON request: {error}")
    try:
        asyncio.run(run(request))
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001
        _fail(str(error).strip() or error.__class__.__name__)


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    main()
