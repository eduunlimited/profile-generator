from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def _parse_host_port_user_pass(raw: str) -> dict[str, str] | None:
    parts = raw.split(":")
    if len(parts) < 4:
        return None
    host, port_s, username = parts[0], parts[1], parts[2]
    password = ":".join(parts[3:])
    if not host or not port_s.isdigit() or not username:
        return None
    return {
        "server": f"http://{host}:{int(port_s)}",
        "username": username,
        "password": password,
    }


def parse_proxy_server(server: str) -> dict[str, str]:
    raw = server.strip()
    if not raw or raw.lower() in {"none", "direct"}:
        raise ValueError(f"Invalid proxy server URL: {server}")

    if "://" not in raw and "@" not in raw:
        colon_form = _parse_host_port_user_pass(raw)
        if colon_form:
            return colon_form

    if "://" not in raw:
        raw = "http://" + raw
    parsed = urlparse(raw)
    try:
        port = parsed.port
    except ValueError as exc:
        netloc = parsed.netloc
        colon_form = _parse_host_port_user_pass(netloc)
        if colon_form:
            if parsed.scheme and parsed.scheme != "http":
                colon_form["server"] = colon_form["server"].replace(
                    "http://", f"{parsed.scheme}://", 1
                )
            return colon_form
        raise ValueError(f"Invalid proxy server URL: {server}") from exc

    if not parsed.hostname or not port:
        raise ValueError(f"Invalid proxy server URL: {server}")
    proxy: dict[str, str] = {"server": f"{parsed.scheme}://{parsed.hostname}:{port}"}
    if parsed.username:
        proxy["username"] = parsed.username
    if parsed.password:
        proxy["password"] = parsed.password
    return proxy


def mask_proxy(server: str) -> str:
    if not server or server.strip().lower() in {"none", "direct"}:
        return "direct"
    try:
        parsed_proxy = parse_proxy_server(server)
        return parsed_proxy["server"].split("://", 1)[-1]
    except Exception:
        return "***"


def load_fingerprint(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    # Ignore legacy Chrome fingerprint.json from the old launcher.
    if "userAgent" in data or "user_agent" in data:
        return None
    return data


def save_fingerprint(path: Path, fingerprint: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(fingerprint, indent=2), encoding="utf-8")


def build_camoufox_kwargs(
    *,
    proxy_server: str | None,
    locale: str | None,
    timezone: str | None,
    storage_state_path: Path | None,
    fingerprint: dict[str, Any] | None = None,
    geoip: bool = True,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "headless": False,
        "humanize": True,
        "firefox_user_prefs": {
            "browser.tabs.closeWindowWithLastTab": True,
            "browser.sessionstore.resume_from_crash": False,
            "browser.startup.page": 0,
            "browser.tabs.warnOnClose": False,
            "browser.tabs.warnOnCloseOtherTabs": False,
            "browser.link.open_newwindow.disabled": True,
        },
    }
    config: dict[str, Any] = {}
    if timezone:
        config["timezone"] = timezone
    if config:
        kwargs["config"] = config
    if geoip and proxy_server:
        kwargs["geoip"] = True
    if proxy_server and proxy_server.strip().lower() not in {"", "none", "direct"}:
        kwargs["proxy"] = parse_proxy_server(proxy_server)
    if locale:
        kwargs["locale"] = locale
    if fingerprint:
        kwargs["fingerprint"] = fingerprint
    # storage_state is applied when creating the Playwright context, not here.
    _ = storage_state_path
    return kwargs


def summarize_fingerprint(fingerprint: dict[str, Any] | None, timezone: str | None) -> str:
    if not fingerprint:
        tz = timezone or "default timezone"
        return f"Camoufox · {tz} · fingerprint pending"
    navigator = fingerprint.get("navigator") if isinstance(fingerprint.get("navigator"), dict) else {}
    user_agent = navigator.get("userAgent") or fingerprint.get("userAgent") or "Firefox UA"
    browser = "Firefox UA"
    if "Chrome" in str(user_agent):
        browser = "Chrome UA"
    screen = fingerprint.get("screen") if isinstance(fingerprint.get("screen"), dict) else {}
    width = screen.get("width") or fingerprint.get("windowWidth") or "?"
    height = screen.get("height") or fingerprint.get("windowHeight") or "?"
    tz = timezone or fingerprint.get("timezone") or "?"
    return f"{width}x{height} · {tz} · {browser}"
