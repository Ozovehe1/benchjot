#!/usr/bin/env python3
"""E2E: a code block's latest run survives leaving the note and reloading.

    E2E_EMAIL=... E2E_PASSWORD=... BASE_URL=https://benchjot.vercel.app \
        [SERVER=1 | E2E_ONLY=server] python scripts/e2e_last_run.py

Phone (390px). Browser: run Python (prints, then fails on line 2), leave the
note in-app, come back, reload: output and error line are still there. Edit
the code: "Output from an earlier version" shows, and still shows after a
reload. Clear, reload: the output stays gone. SERVER=1 (account must be Pro):
the same for "Run on server". Screenshots go to ./screenshots.
"""
import os
import re
import sys

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from e2e_smoke import BASE, SHOTS, launch, sign_in, step, wait_saved  # noqa: E402

STALE = "Output from an earlier version"


def saved_run(page, action, timeout=90_000):
    """Does `action` and waits for the PATCH that stores (or clears) last_run."""
    with page.expect_response(
        lambda r: "/rest/v1/snippets" in r.url and r.request.method == "PATCH" and "last_run" in (r.request.post_data or ""),
        timeout=timeout,
    ) as resp:
        action()
    assert resp.value.ok, (resp.value.status, resp.value.text())


def check(page, label, code, run_button, expected, status_re, timeout):
    page.goto(f"{BASE}/")
    page.get_by_role("button", name="New note").click()
    expect(page).to_have_url(re.compile(r"/n/[0-9a-f-]+"), timeout=15000)
    note_url = page.url
    page.get_by_label("Title").fill(f"Last run {label}")
    page.get_by_role("button", name="Add code").click()
    page.get_by_label("Language of code 1").select_option("python")
    editor = page.locator(".cm-content").first
    expect(editor).to_be_visible(timeout=15000)
    editor.click()
    page.keyboard.insert_text(code)
    page.get_by_label("Title").click()
    wait_saved(page)

    output = lambda: page.get_by_role("region", name="Output")
    status = lambda: page.get_by_role("status", name="Run status")

    saved_run(page, lambda: page.get_by_role("button", name=run_button, exact=True).click(), timeout)
    expect(output()).to_contain_text(expected)
    expect(status()).to_have_text(status_re)
    step(f"{label}: run finished and was saved")

    # Leave in-app, come back from the list.
    page.get_by_role("link", name="All notes").click()
    expect(page).not_to_have_url(note_url, timeout=15000)
    page.get_by_role("link", name=re.compile(f"Last run {label}")).first.click()
    expect(page).to_have_url(note_url, timeout=15000)
    expect(output()).to_contain_text(expected, timeout=15000)
    expect(status()).to_have_text(status_re)
    # Leave the site entirely, then come back and reload.
    page.goto("about:blank")
    page.goto(note_url)
    page.reload()
    expect(output()).to_contain_text(expected, timeout=20000)
    expect(status()).to_have_text(status_re)
    expect(page.get_by_text(STALE)).to_have_count(0)
    page.screenshot(path=f"{SHOTS}/lr-{label}-1-reopened.png", full_page=True)
    step(f"{label}: output and status back after leaving, returning and reloading; not marked stale")

    editor = page.locator(".cm-content").first
    editor.click()
    page.keyboard.press("Control+End")
    page.keyboard.insert_text("\n# edited\n")
    expect(page.get_by_text(STALE)).to_be_visible(timeout=5000)
    wait_saved(page)
    page.reload()
    expect(output()).to_contain_text(expected, timeout=20000)
    expect(page.get_by_text(STALE)).to_be_visible(timeout=10000)
    page.screenshot(path=f"{SHOTS}/lr-{label}-2-stale.png", full_page=True)
    step(f"{label}: editing marks it '{STALE}', still marked after reload")

    saved_run(page, lambda: output().get_by_role("button", name="Clear").click(), 15000)
    expect(output()).to_have_count(0)
    page.reload()
    expect(page.locator(".cm-content").first).to_be_visible(timeout=20000)
    page.wait_for_timeout(1500)
    expect(output()).to_have_count(0)
    page.screenshot(path=f"{SHOTS}/lr-{label}-3-cleared.png", full_page=True)
    step(f"{label}: Clear removes it, stays gone after reload")


def main():
    os.makedirs(SHOTS, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = launch(p)
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, ignore_https_errors=True)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        sign_in(page)
        if os.environ.get("E2E_ONLY") != "server":
            check(page, "browser", "print('persist', 6 * 7)\n1 / 0\n", "Run", "persist 42", re.compile(r"Error on line 2"), 120_000)
        if os.environ.get("SERVER") == "1" or os.environ.get("E2E_ONLY") == "server":
            check(page, "server", "import sys\nprint('server', sys.version_info[0])\n", "Run on server", "server 3", re.compile(r"^\d+\.\d\d s$"), 240_000)
        browser.close()
    assert not errors, errors
    print("last-run E2E passed")


if __name__ == "__main__":
    main()
