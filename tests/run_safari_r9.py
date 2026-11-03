#!/usr/bin/env python3
"""Safari R9 smoke runner using the local WebDriver protocol only.

Prerequisites:
- Safari Settings > Developer > Allow remote automation enabled.
- `safaridriver -p 4444` and a local static server on 127.0.0.1:8766.

This runner never calls the production API and never connects to a database.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request


WEBDRIVER = "http://127.0.0.1:4444"
SITE = "http://127.0.0.1:8766"


def request(method: str, path: str, payload: dict | None = None, timeout: int = 20):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        WEBDRIVER + path,
        data=body,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            decoded = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"WebDriver {method} {path} failed: {exc.code} {detail}") from None
    value = decoded.get("value")
    if isinstance(value, dict) and value.get("error"):
        raise RuntimeError(f"WebDriver {method} {path} failed: {value}")
    return value


def execute(session_id: str, script: str):
    return request(
        "POST",
        f"/session/{session_id}/execute/sync",
        {"script": script, "args": []},
    )


def navigate(session_id: str, url: str):
    request("POST", f"/session/{session_id}/url", {"url": url}, timeout=30)


def resize(session_id: str, width: int, height: int):
    request(
        "POST",
        f"/session/{session_id}/window/rect",
        {"x": 0, "y": 0, "width": width, "height": height},
    )
    time.sleep(0.5)


def wait_for(session_id: str, script: str, timeout: float = 60):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        last = execute(session_id, script)
        if last:
            return last
        time.sleep(0.25)
    raise TimeoutError(f"Safari condition timed out; last={last!r}")


def main() -> int:
    session = request(
        "POST",
        "/session",
        {"capabilities": {"alwaysMatch": {"browserName": "safari"}}},
        timeout=30,
    )
    session_id = session["sessionId"]
    report: dict[str, object] = {
        "browser": session.get("capabilities", {}).get("browserVersion", "Safari"),
    }
    try:
        navigate(session_id, SITE + "/tests/index.html")
        summary = wait_for(
            session_id,
            "return document.querySelector('.summary') && document.querySelector('.summary').textContent;",
        )
        failures = execute(
            session_id,
            "return Array.from(document.querySelectorAll('.test.fail')).map(function(el){"
            "return {name:el.textContent, error:el.nextElementSibling && el.nextElementSibling.textContent};});",
        )
        baseline = execute(
            session_id,
            "return window.__R8_50MB_BASELINE__ || null;",
        )
        r9_evidence = execute(
            session_id,
            "return Array.from(document.querySelectorAll('.suite')).filter(function(s){"
            "return /^R9\\./.test((s.querySelector('.suite-name')||{}).textContent||'');})"
            ".map(function(s){return {suite:s.querySelector('.suite-name').textContent,"
            "tests:Array.from(s.querySelectorAll('.test.pass')).map(function(t){return t.textContent;})};});",
        )
        report["test_suite"] = {
            "summary": summary,
            "failures": failures,
            "baseline": baseline,
            "r9_evidence": r9_evidence,
        }
        if failures:
            raise AssertionError(f"Safari test failures: {failures}")

        resize(session_id, 1280, 900)
        navigate(session_id, SITE + "/index.html")
        wait_for(session_id, "return typeof Storage !== 'undefined' && typeof UIHorse !== 'undefined';")
        desktop = execute(
            session_id,
            "return {"
            "title:document.title, storageVersion:Storage.DB_VERSION, "
            "stallions:document.querySelector('#result-count') && document.querySelector('#result-count').textContent, "
            "overflow:document.documentElement.scrollWidth-innerWidth, "
            "press:!!document.querySelector('a[href=\"press/\"]'), "
            "modules:[typeof UIHorse,typeof UIRaces,typeof UIPedigree,typeof UITimeline,typeof UISimulate]"
            "};",
        )
        assert desktop["storageVersion"] == 5
        assert desktop["overflow"] == 0
        assert all(value == "object" for value in desktop["modules"])
        report["desktop"] = desktop

        responsive = {}
        for width, height in ((320, 720), (375, 812), (768, 1024)):
            resize(session_id, width, height)
            time.sleep(0.2)
            check = execute(
                session_id,
                "return {viewport:[innerWidth,innerHeight],"
                "rootOverflow:document.documentElement.scrollWidth-innerWidth,"
                "bodyOverflow:document.body.scrollWidth-innerWidth,"
                "navVisible:getComputedStyle(document.querySelector('nav')).display!=='none',"
                "searchVisible:getComputedStyle(document.querySelector('#search-input')).display!=='none'};",
            )
            assert check["rootOverflow"] <= 0, (width, check)
            assert check["bodyOverflow"] <= 0, (width, check)
            assert check["navVisible"] and check["searchVisible"]
            responsive[str(width)] = check
        report["responsive"] = responsive

        resize(session_id, 1280, 900)
        navigate(session_id, SITE + "/press/")
        wait_for(session_id, "return typeof PressEditor !== 'undefined' && typeof PressExport !== 'undefined';")
        press = execute(
            session_id,
            "return {title:document.title,overflow:document.documentElement.scrollWidth-innerWidth,"
            "localOnly:document.querySelector('#press-local-only').textContent,"
            "editor:typeof PressEditor,storage:typeof PressStorage,render:typeof PressRender,"
            "png:typeof PressExport.exportPNG,pdf:typeof PressExport.exportPDF,"
            "json:!!document.querySelector('#btn-export-json')};",
        )
        assert press["overflow"] == 0
        assert press["editor"] == press["storage"] == press["render"] == "object"
        assert press["png"] == press["pdf"] == "function"
        assert press["json"]
        report["press"] = press

        print(json.dumps({"status": "passed", **report}, ensure_ascii=False))
        return 0
    finally:
        try:
            request("DELETE", f"/session/{session_id}")
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
