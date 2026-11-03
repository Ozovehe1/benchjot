#!/usr/bin/env python3
"""End-to-end smoke test against a deployed Benchjot.

    pip install playwright && python -m playwright install chromium
    BASE_URL=https://benchjot.vercel.app E2E_EMAIL=you+e2e@example.com E2E_PASSWORD=... \
        python scripts/e2e_smoke.py

Signs up (or signs in), creates an experiment, saves a snippet, reloads and
checks it persisted, edits notes, checks version history, logs two runs,
compares them, searches code, exports Markdown, and takes screenshots
(390px phone + 1280px desktop) into ./screenshots.
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
TOKEN = f"cosine_warmup_{int(time.time())}"
CODE = f"""import torch

def {TOKEN}(step, warmup=500, total=10_000):
    if step < warmup:
        return step / warmup
    progress = (step - warmup) / (total - warmup)
    return 0.5 * (1 + torch.cos(torch.tensor(progress * 3.14159)))
"""


def launch(p):
    kw = {}
    proxy = os.environ.get("HTTPS_PROXY")
    if proxy:  # sandbox egress
        u = up.urlparse(proxy)
        kw["proxy"] = {
            "server": f"{u.scheme}://{u.hostname}:{u.port}",
            "username": up.unquote(u.username or ""),
            "password": up.unquote(u.password or ""),
        }
    return p.chromium.launch(**kw)


def step(name):
    print(f"  ✓ {name}", flush=True)


def type_code(page, text):
    editor = page.locator(".cm-content").first
    editor.click()
    page.keyboard.press("Control+A")
    page.keyboard.press("Delete")
    # insertText avoids auto-indent mangling the snippet
    page.keyboard.insert_text(text)


def wait_saved(page):
    expect(page.get_by_role("button", name=re.compile("Saved"))).to_be_visible(timeout=15000)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    with sync_playwright() as p:
        browser = launch(p)
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, ignore_https_errors=True, accept_downloads=True)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(f"{BASE}/")
        expect(page).to_have_url(re.compile(r"/login"))
        page.screenshot(path=f"{SHOTS}/m-01-login.png")
        page.get_by_role("tab", name="Create account").click()
        page.get_by_label("Email").fill(EMAIL)
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Create account").last.click()
        try:
            expect(page).not_to_have_url(re.compile(r"/login"), timeout=8000)
        except AssertionError:
            if page.get_by_text("already registered").count():
                page.get_by_role("tab", name="Sign in").click()
                page.get_by_role("button", name="Sign in").last.click()
                expect(page).not_to_have_url(re.compile(r"/login"), timeout=10000)
            else:
                raise
        step("signed up / in")
        expect(page.get_by_text("Log your first experiment").or_(page.get_by_role("heading", name="Experiments"))).to_be_visible()
        page.screenshot(path=f"{SHOTS}/m-02-empty.png")

        # project
        page.goto(f"{BASE}/projects")
        page.get_by_role("button", name="New project").first.click()
        page.get_by_label("Name").fill("Efficient attention")
        page.get_by_label("Description").fill("Can linear attention match softmax on small ViTs?")
        page.get_by_role("button", name="Create project").click()
        expect(page).to_have_url(re.compile(r"/projects/[0-9a-f-]+"))
        step("project created")

        # experiment
        page.get_by_role("button", name="New experiment in this project").click()
        page.get_by_label("Title").fill("Warmup + cosine LR on ViT-Tiny")
        page.get_by_label("Hypothesis").fill("500 warmup steps stabilise early training and improve val acc by ~1pt.")
        page.get_by_role("button", name="Create experiment").click()
        expect(page).to_have_url(re.compile(r"/e/[0-9a-f-]+\?tab=code"), timeout=15000)
        exp_url = page.url.split("?")[0]
        step("experiment created")

        page.get_by_role("button", name="Add snippet").first.click()
        expect(page.locator(".cm-content")).to_be_visible(timeout=15000)
        type_code(page, CODE)
        wait_saved(page)
        page.reload()
        expect(page.locator(".cm-content").first).to_contain_text(TOKEN, timeout=15000)
        step("snippet saved and persisted after reload")
        page.screenshot(path=f"{SHOTS}/m-03-code.png", full_page=True)

        # second edit -> history shows a diff
        page.locator(".cm-content").first.click()
        page.keyboard.press("Control+End")
        page.keyboard.insert_text("\n# TODO: try linear decay\n")
        wait_saved(page)
        page.get_by_role("button", name="Version history").first.click()
        expect(page.get_by_role("option").first).to_be_visible()
        expect(page.get_by_label("Diff").or_(page.get_by_text("Same as the current code"))).to_be_visible()
        page.screenshot(path=f"{SHOTS}/m-04-history.png")
        page.keyboard.press("Escape")
        step("version history + diff")

        # notes
        page.goto(f"{exp_url}?tab=notes")
        page.get_by_role("radio", name="Running").click()
        tag = page.get_by_label("Add tag")
        tag.fill("vit")
        tag.press("Enter")
        tag.fill("lr-schedule")
        tag.press("Enter")
        page.get_by_role("tab", name="write").click()
        page.get_by_label("Notes (Markdown)").fill("## Result\nVal acc **+0.8pt**. Loss $\\mathcal{L} = -\\sum y \\log \\hat y$.")
        wait_saved(page)
        page.get_by_role("tab", name="preview").click()
        expect(page.locator(".katex").first).to_be_visible()
        page.screenshot(path=f"{SHOTS}/m-05-notes.png", full_page=True)
        step("notes, status, tags, KaTeX")

        # runs
        page.goto(f"{exp_url}?tab=runs")
        for name, lr, acc in [("baseline lr=1e-3", "1e-3", "71.2"), ("warmup500 lr=1e-3", "1e-3", "72.0")]:
            page.get_by_role("button", name=re.compile("Log (a )?run")).first.click()
            page.get_by_label("Name").fill(name)
            page.get_by_label("Parameters key 1").fill("lr")
            page.get_by_label("Parameters value 1").fill(lr)
            page.get_by_label("Metrics key 1").fill("val_acc")
            page.get_by_label("Metrics value 1").fill(acc)
            page.get_by_label("Environment value 4").fill("42")
            page.get_by_role("button", name="Log run").last.click()
            expect(page.get_by_text(name)).to_be_visible(timeout=10000)
        page.screenshot(path=f"{SHOTS}/m-06-runs.png", full_page=True)
        page.get_by_role("button", name="Compare").click()
        page.get_by_role("button", name=re.compile("baseline")).click()
        page.get_by_role("button", name=re.compile("warmup500")).click()
        expect(page).to_have_url(re.compile(r"/compare\?a="), timeout=10000)
        expect(page.get_by_text("+0.8")).to_be_visible()
        page.screenshot(path=f"{SHOTS}/m-07-compare.png", full_page=True)
        step("runs logged and compared")

        # search by code token
        page.goto(f"{BASE}/")
        page.get_by_label("Search experiments").fill(TOKEN[:20])
        expect(page.get_by_role("link", name=re.compile("Warmup \\+ cosine"))).to_be_visible(timeout=10000)
        page.get_by_label("Search experiments").fill("")
        page.screenshot(path=f"{SHOTS}/m-08-list.png")
        step("full-text search finds code")

        # fork + export
        page.goto(exp_url)
        page.get_by_role("button", name="More actions").click()
        with page.expect_download() as dl:
            page.get_by_role("button", name=re.compile("Export as Markdown")).click()
        md = open(dl.value.path(), encoding="utf-8").read()
        assert TOKEN in md and "| val_acc |" in md, "export missing content"
        step("markdown export")
        page.goto(exp_url)
        page.get_by_role("button", name="More actions").click()
        page.get_by_role("button", name=re.compile("Fork experiment")).click()
        page.wait_for_url(lambda u: "/e/" in u and u.split("?")[0] != exp_url, timeout=10000)
        expect(page.get_by_text("(fork)").first).to_be_visible()
        step("fork")

        # desktop
        desk = browser.new_context(viewport={"width": 1280, "height": 860}, storage_state=ctx.storage_state(), ignore_https_errors=True)
        d = desk.new_page()
        d.goto(f"{BASE}/")
        expect(d.get_by_role("link", name=re.compile("Warmup \\+ cosine")).first).to_be_visible(timeout=15000)
        d.screenshot(path=f"{SHOTS}/d-01-list.png")
        d.goto(f"{exp_url}?tab=code")
        expect(d.locator(".cm-content").first).to_contain_text(TOKEN, timeout=15000)
        d.screenshot(path=f"{SHOTS}/d-02-code.png")
        d.keyboard.press("Control+k")
        expect(d.get_by_placeholder("Search experiments, code, tags…")).to_be_visible()
        d.screenshot(path=f"{SHOTS}/d-03-palette.png")
        d.keyboard.press("Escape")
        d.evaluate("document.documentElement.classList.replace('dark','light')")
        d.goto(f"{exp_url}?tab=notes")
        d.get_by_role("button", name="Switch to light mode").click()
        d.wait_for_timeout(400)
        d.screenshot(path=f"{SHOTS}/d-04-notes-light.png")
        step("desktop views + Ctrl+K + light mode")

        if errors:
            print("Page errors:", *errors, sep="\n  ")
            sys.exit(1)
        browser.close()
        print("E2E OK")


if __name__ == "__main__":
    main()
