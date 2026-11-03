#!/usr/bin/env python3
"""End-to-end smoke test against a deployed Benchjot.

    pip install playwright && python -m playwright install chromium
    BASE_URL=https://benchjot.vercel.app E2E_EMAIL=you+e2e@example.com E2E_PASSWORD=... \
        python scripts/e2e_smoke.py

Phone (390px) then desktop (1280px): sign up / in, create a note, write the
note, add code, reload and check both persisted, search for a word that only
appears in the code, delete the note. Leaves one note with code behind when
KEEP_ONE=1 (for the RLS check). Screenshots go to ./screenshots.
"""
import os
import re
import sys
import time
import urllib.parse as up

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3000").rstrip("/")
EMAIL = os.environ["E2E_EMAIL"]
PASSWORD = os.environ["E2E_PASSWORD"]
SHOTS = os.environ.get("SHOTS_DIR", "screenshots")
KEEP_ONE = os.environ.get("KEEP_ONE") == "1"


def launch(p):
    kw = {}
    proxy = os.environ.get("HTTPS_PROXY")
    if proxy:  # sandbox egress
        u = up.urlparse(proxy)
        kw["proxy"] = {"server": f"{u.scheme}://{u.hostname}:{u.port}", "username": up.unquote(u.username or ""), "password": up.unquote(u.password or "")}
    return p.chromium.launch(**kw)


def step(name):
    print(f"  ✓ {name}", flush=True)


def wait_saved(page):
    expect(page.get_by_role("status")).to_have_text("Saved", timeout=15000)


def sign_in(page, tag):
    page.goto(f"{BASE}/")
    expect(page).to_have_url(re.compile(r"/login"))
    page.screenshot(path=f"{SHOTS}/{tag}-01-login.png")
    page.get_by_role("button", name="Create an account").click()
    page.get_by_label("Email").fill(EMAIL)
    page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("button", name="Create account").click()
    try:
        expect(page).not_to_have_url(re.compile(r"/login"), timeout=8000)
    except AssertionError:
        page.get_by_role("button", name="I have an account").click()
        page.get_by_role("button", name="Sign in").click()
        expect(page).not_to_have_url(re.compile(r"/login"), timeout=10000)
    step(f"{tag}: signed in")


def flow(page, tag, delete=True):
    token = f"zq{tag}{int(time.time())}"
    title = f"Warmup schedule {tag}"
    code = f"import torch\n\ndef lr_{token}(step, warmup=500):\n    # linear warmup\n    return min(1.0, step / warmup)\n"
    page.screenshot(path=f"{SHOTS}/{tag}-02-list.png")

    page.get_by_role("button", name="New").click()
    expect(page).to_have_url(re.compile(r"/n/[0-9a-f-]+"), timeout=15000)
    url = page.url
    page.get_by_label("Title").fill(title)
    page.get_by_label("Note").fill("## Idea\nWarm up for **500** steps, then hold.\n\n- try 1000 too")
    wait_saved(page)
    step(f"{tag}: note written")

    page.get_by_role("button", name="Add code").click()
    editor = page.locator(".cm-content").first
    expect(editor).to_be_visible(timeout=15000)
    editor.click()
    page.keyboard.insert_text(code)
    wait_saved(page)
    page.screenshot(path=f"{SHOTS}/{tag}-03-entry.png", full_page=True)
    step(f"{tag}: code added")

    page.reload()
    expect(page.get_by_label("Title")).to_have_value(title, timeout=15000)
    expect(page.get_by_label("Note")).to_have_value(re.compile("Warm up for"))
    expect(page.locator(".cm-content").first).to_contain_text(f"lr_{token}", timeout=15000)
    step(f"{tag}: persisted after reload")

    page.get_by_role("button", name="Preview").click()
    expect(page.get_by_role("heading", name="Idea")).to_be_visible()
    page.screenshot(path=f"{SHOTS}/{tag}-04-preview.png", full_page=True)
    page.get_by_role("button", name="Edit").click()

    page.get_by_role("link", name="All notes").click()
    page.get_by_label("Search").fill(token)
    expect(page.get_by_role("link", name=re.compile(title))).to_be_visible(timeout=10000)
    page.get_by_label("Search").fill("nothingmatchesthis")
    expect(page.get_by_text("Nothing matches.")).to_be_visible(timeout=10000)
    page.get_by_label("Search").fill("")
    step(f"{tag}: search finds a word that is only in the code")
    page.screenshot(path=f"{SHOTS}/{tag}-05-list-filled.png")

    if delete:
        page.goto(url)
        page.once("dialog", lambda d: d.accept())
        page.get_by_role("button", name="Delete note").click()
        expect(page).to_have_url(re.compile(r"/$"), timeout=10000)
        expect(page.get_by_role("link", name=re.compile(title))).to_have_count(0)
        step(f"{tag}: deleted")


def main():
    os.makedirs(SHOTS, exist_ok=True)
    with sync_playwright() as p:
        browser = launch(p)
        errors = []

        phone = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, ignore_https_errors=True)
        page = phone.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        sign_in(page, "m")
        flow(page, "m")

        desk = browser.new_context(viewport={"width": 1280, "height": 860}, storage_state=phone.storage_state(), ignore_https_errors=True)
        d = desk.new_page()
        d.on("pageerror", lambda e: errors.append(str(e)))
        d.goto(f"{BASE}/")
        flow(d, "d", delete=not KEEP_ONE)
        d.goto(f"{BASE}/settings")
        expect(d.get_by_text(EMAIL)).to_be_visible(timeout=10000)
        d.screenshot(path=f"{SHOTS}/d-06-settings.png")
        d.get_by_role("radio", name="Dark").click()
        d.goto(f"{BASE}/")
        expect(d.locator("ul a").first.or_(d.get_by_text("No notes yet."))).to_be_visible(timeout=10000)
        d.screenshot(path=f"{SHOTS}/d-07-list-dark.png")
        if KEEP_ONE:
            d.locator("ul a").first.click()
            expect(d.locator(".cm-content").first).to_be_visible(timeout=15000)
            d.screenshot(path=f"{SHOTS}/d-08-entry-dark.png")
        step("dark theme from settings")

        if errors:
            print("Page errors:", *errors, sep="\n  ")
            sys.exit(1)
        browser.close()
        print("E2E OK")


if __name__ == "__main__":
    main()
