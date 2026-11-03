#!/usr/bin/env python3
"""E2E for Pro server runs (Modal) and Fix (Groq) against a deployed Benchjot.

    FREE_EMAIL=... FREE_PASSWORD=... PRO_EMAIL=... PRO_PASSWORD=... \
        BASE_URL=https://benchjot.vercel.app python scripts/e2e_server.py

Both accounts must exist; the Pro one needs profiles.plan = 'pro' (set by SQL,
users can't set it). Free: the gate shows and /api/run answers 403.
Pro: Python with a pip package on the server, a broken C program on the server,
Fix proposes a minimal diff, Accept, and the fixed C runs. Screenshots go to ./screenshots.
"""
import os
import re
import sys

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from e2e_smoke import BASE, SHOTS, launch, step  # noqa: E402

SERVER_TIMEOUT = 240_000  # first run may build the image

PY = "# pip: tabulate\nfrom tabulate import tabulate\nimport numpy as np\nprint(tabulate([[p, round(float(np.mean(r)), 1)] for p, r in {0.1: [91.8, 92.4, 92.1], 0.3: [90.9, 90.7, 91.1]}.items()], headers=['dropout', 'acc']))\n"
C_BROKEN = '#include <stdio.h>\n\nint main(void) {\n    int n = 21\n    printf("answer %d\\n", n * 2);\n    return 0;\n}\n'


def sign_in(page, email, password):
    page.goto(f"{BASE}/login")
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill(password)
    page.get_by_role("button", name="Sign in").click()
    expect(page).not_to_have_url(re.compile(r"/login"), timeout=15000)


def new_code_block(page, language, code, title):
    page.goto(f"{BASE}/")
    page.get_by_role("button", name="New note").click()
    expect(page).to_have_url(re.compile(r"/n/[0-9a-f-]+"), timeout=15000)
    page.get_by_label("Title").fill(title)
    page.get_by_role("button", name="Add code").click()
    page.get_by_label("Language of code 1").select_option(language)
    editor = page.locator(".cm-content").first
    expect(editor).to_be_visible(timeout=15000)
    editor.click()
    page.keyboard.insert_text(code)
    page.get_by_label("Title").click()
    expect(page.get_by_role("status", name="Save status")).to_have_text("Saved", timeout=15000)


def phone(browser):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, ignore_https_errors=True)
    return ctx, ctx.new_page()


def free_user(browser):
    ctx, page = phone(browser)
    sign_in(page, os.environ["FREE_EMAIL"], os.environ["FREE_PASSWORD"])
    new_code_block(page, "c", C_BROKEN, "Free gate")
    expect(page.get_by_text("Server runs · Pro")).to_be_visible(timeout=10000)
    expect(page.get_by_role("button", name="Run on server")).to_have_count(0)
    page.screenshot(path=f"{SHOTS}/s-01-free-gate.png")
    res = page.request.post(f"{BASE}/api/run", data={"language": "c", "code": C_BROKEN})
    assert res.status == 403, (res.status, res.text())
    step("free user: one-line Pro note, no server button, /api/run answers 403")
    ctx.close()


def pro_user(browser):
    ctx, page = phone(browser)
    page.on("dialog", lambda d: d.accept())
    sign_in(page, os.environ["PRO_EMAIL"], os.environ["PRO_PASSWORD"])

    new_code_block(page, "python", PY, "Server Python")
    page.get_by_role("button", name="Run on server").click()
    out = page.get_by_role("region", name="Output")
    expect(out).to_contain_text("92.1", timeout=SERVER_TIMEOUT)
    expect(out).to_contain_text("dropout")
    page.screenshot(path=f"{SHOTS}/s-02-pro-python.png", full_page=True)
    step("pro: Python with a pip package runs on the server")

    new_code_block(page, "c", C_BROKEN, "Server C")
    page.get_by_role("button", name="Run on server").click()
    expect(page.get_by_role("status", name="Run status")).to_contain_text("Error on line", timeout=SERVER_TIMEOUT)
    step("pro: broken C fails on the server with its line")

    page.get_by_role("button", name="Fix").click()
    diff = page.get_by_role("region", name="Proposed fix")
    expect(diff).to_be_visible(timeout=60000)
    expect(diff.locator('[data-kind="add"]')).to_contain_text("int n = 21;")
    assert diff.locator('[data-kind="same"]').count() <= 4, "diff should be minimal"
    page.screenshot(path=f"{SHOTS}/s-03-fix-diff.png", full_page=True)
    page.get_by_role("button", name="Accept fix").click()
    expect(diff).to_be_hidden()
    expect(page.locator(".cm-content").first).to_contain_text("int n = 21;")
    page.get_by_role("button", name="Run on server").click()
    expect(page.get_by_role("region", name="Output")).to_contain_text("answer 42", timeout=SERVER_TIMEOUT)
    page.screenshot(path=f"{SHOTS}/s-04-fixed-c.png", full_page=True)
    step("pro: Fix shows a minimal diff, Accept applies it, fixed C runs")
    ctx.close()


if __name__ == "__main__":
    os.makedirs(SHOTS, exist_ok=True)
    with sync_playwright() as p:
        b = launch(p)
        if os.environ.get("E2E_ONLY") != "pro":
            free_user(b)
        if os.environ.get("E2E_ONLY") != "free":
            pro_user(b)
        b.close()
    print("server E2E passed")
