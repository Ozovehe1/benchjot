#!/usr/bin/env python3
"""End-to-end smoke test against a deployed Benchjot.

    pip install playwright && python -m playwright install chromium
    BASE_URL=https://benchjot.vercel.app E2E_EMAIL=you+e2e@example.com E2E_PASSWORD=... \
        python scripts/e2e_smoke.py            # both phases
    E2E_ONLY=m ... / E2E_ONLY=d ...             # one phase (each signs in itself)

Phone (390px): landing page, create account from it, quiet first state,
new note, write, add code, mobile symbol row, reload persists, preview,
upload files (text accepted, binary rejected), search code, delete.
Desktop (1280px): new from file, language behaviour (indent, comment toggle,
completion), settings + dark mode.
Run (phone, E2E_ONLY=r): Python/JS/TS runs, error line, Stop, lint + autofix,
numpy via Pyodide packages, PWA manifest + service worker + offline reload. KEEP_ONE=1 leaves the desktop note behind
for the RLS check. Screenshots go to ./screenshots.
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
ONLY = os.environ.get("E2E_ONLY", "")


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
    expect(page.get_by_role("status", name="Save status")).to_have_text("Saved", timeout=15000)


def editor_text(page, i=0):
    """Exact editor text (tabs kept), one line per .cm-line."""
    return page.locator(".cm-content").nth(i).evaluate("e => Array.from(e.querySelectorAll('.cm-line')).map(l => l.textContent).join('\\n')")


def sign_in(page):
    page.goto(f"{BASE}/login")
    page.get_by_label("Email").fill(EMAIL)
    page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    expect(page).not_to_have_url(re.compile(r"/login"), timeout=10000)


def phone(browser, errors):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, ignore_https_errors=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))

    # Landing page for signed-out visitors
    page.goto(f"{BASE}/")
    expect(page).to_have_url(f"{BASE}/")
    expect(page.get_by_text("Notes and code, nothing else.")).to_be_visible()
    page.screenshot(path=f"{SHOTS}/m-00-landing.png")
    page.get_by_role("link", name="Create account").click()
    expect(page.get_by_role("button", name="Create account")).to_be_visible()
    page.screenshot(path=f"{SHOTS}/m-01-signup.png")
    page.get_by_label("Email").fill(EMAIL)
    page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("button", name="Create account").click()
    expect(page).to_have_url(f"{BASE}/", timeout=10000)
    step("landing page; account created from it")

    # Quiet first state on home
    expect(page.get_by_label("Search")).to_be_visible()
    expect(page.get_by_role("button", name="New entry")).to_be_visible(timeout=10000)
    expect(page.get_by_role("button", name="Upload file")).to_be_visible()
    expect(page.locator("ul a")).to_have_count(0)
    page.screenshot(path=f"{SHOTS}/m-02-first-state.png")
    step("new account lands on home with a quiet first state")

    token = f"zqm{int(time.time())}"
    title = "Warmup schedule"
    page.get_by_role("button", name="New entry").click()
    expect(page).to_have_url(re.compile(r"/n/[0-9a-f-]+"), timeout=15000)
    url = page.url
    page.get_by_label("Title").fill(title)
    page.get_by_label("Note").fill("## Idea\nWarm up for **500** steps, then hold.\n\n- try 1000 too")
    wait_saved(page)
    step("note written")

    # Code + mobile symbol row
    page.get_by_role("button", name="Add code").click()
    editor = page.locator(".cm-content").first
    expect(editor).to_be_visible(timeout=15000)
    attrs = editor.evaluate("e => [e.getAttribute('autocapitalize'), e.getAttribute('autocorrect'), e.getAttribute('autocomplete'), e.getAttribute('spellcheck')]")
    assert attrs == ["off", "off", "off", "false"], attrs
    editor.tap()
    keys = page.get_by_role("toolbar", name="Code keys")
    expect(keys).to_be_visible(timeout=5000)
    page.keyboard.insert_text(f"import torch\n\ndef lr_{token}(step, warmup=500):\n    return min(1.0, step / warmup)\n")
    expect(page.get_by_label("Language of code 1")).to_have_value("python", timeout=5000)  # detected from the code
    expect(keys.get_by_role("button").nth(1)).to_have_text(":")  # Python keys first
    keys.get_by_role("button", name="Tab").tap()
    keys.get_by_role("button", name="Insert _").tap()
    keys.get_by_role("button", name="Insert (").tap()
    assert "    _()" in editor_text(page), editor_text(page)  # Tab = 4 spaces; ( auto-closes
    page.screenshot(path=f"{SHOTS}/m-03-code-keys.png")
    keys.get_by_role("button", name="Undo").tap()
    page.get_by_label("Title").tap()
    expect(keys).to_be_hidden()
    wait_saved(page)
    step("code typed; language auto-detected; symbol row shows on focus, inserts at cursor, hides on blur")

    page.reload()
    expect(page.get_by_label("Title")).to_have_value(title, timeout=15000)
    expect(page.get_by_label("Note")).to_have_value(re.compile("Warm up for"))
    expect(page.locator(".cm-content").first).to_contain_text(f"lr_{token}", timeout=15000)
    expect(page.get_by_label("Language of code 1")).to_have_value("python")
    step("persisted after reload")

    page.get_by_role("button", name="Preview").click()
    expect(page.get_by_role("heading", name="Idea")).to_be_visible()
    page.get_by_role("button", name="Edit").click()

    # Upload: one text file accepted, one binary rejected
    page.get_by_label("Upload file").set_input_files([
        {"name": "eval.sql", "mimeType": "text/plain", "buffer": b"SELECT run, acc FROM results;\n"},
        {"name": "plot.png", "mimeType": "image/png", "buffer": b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"},
    ])
    expect(page.get_by_text("plot.png isn\u2019t a text file.")).to_be_visible(timeout=10000)
    expect(page.get_by_text("eval.sql")).to_be_visible(timeout=10000)
    expect(page.get_by_label("Language of code 2")).to_have_value("sql")
    page.screenshot(path=f"{SHOTS}/m-04-entry.png", full_page=True)
    step("upload: text file becomes a SQL block with its name; binary rejected")

    page.get_by_role("link", name="All notes").click()
    page.get_by_label("Search").fill(token)
    expect(page.get_by_role("link", name=re.compile(title))).to_be_visible(timeout=10000)
    page.get_by_label("Search").fill("nothingmatchesthis")
    expect(page.get_by_text("Nothing matches.")).to_be_visible(timeout=10000)
    page.get_by_label("Search").fill("")
    page.screenshot(path=f"{SHOTS}/m-05-list.png")
    step("search finds a word that is only in the code")

    page.goto(url)
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Delete note").click()
    expect(page).to_have_url(f"{BASE}/", timeout=10000)
    expect(page.get_by_role("link", name=re.compile(title))).to_have_count(0)
    step("deleted")
    ctx.close()


def desktop(browser, errors):
    ctx = browser.new_context(viewport={"width": 1280, "height": 860}, ignore_https_errors=True)
    d = ctx.new_page()
    d.on("pageerror", lambda e: errors.append(str(e)))
    sign_in(d)

    def new_project(name):
        d.once("dialog", lambda dlg: dlg.accept(name))
        d.get_by_role("button", name="New project").click()
        link = d.get_by_role("list", name="Projects").get_by_role("link", name=name)
        expect(link).to_be_visible(timeout=10000)
        return link

    # Projects: create, delete
    new_project("Scratch").click()
    expect(d.get_by_role("heading", name="Scratch")).to_be_visible(timeout=10000)
    d.once("dialog", lambda dlg: dlg.accept())
    d.get_by_role("button", name="Delete", exact=True).click()
    expect(d).to_have_url(f"{BASE}/", timeout=10000)
    expect(d.get_by_role("link", name="Scratch")).to_have_count(0)
    new_project("ViT ablations").click()
    expect(d.get_by_role("heading", name="ViT ablations")).to_be_visible(timeout=10000)
    project_url = d.url
    d.screenshot(path=f"{SHOTS}/d-00-project-empty.png")
    step("project created and deleted from the list")

    # New from file inside the project files it there
    d.get_by_label("New from file").set_input_files([{"name": "utils.ts", "mimeType": "text/plain", "buffer": b"export const clamp = (x: number) => Math.min(1, x);\n"}])
    expect(d).to_have_url(re.compile(r"/n/[0-9a-f-]+"), timeout=15000)
    expect(d.get_by_label("Title")).to_have_value("utils.ts")
    expect(d.get_by_label("Language of code 1")).to_have_value("typescript", timeout=10000)
    expect(d.get_by_label("Project")).to_have_value(re.compile(r"^[0-9a-f-]{36}$"))
    expect(d.get_by_role("link", name="ViT ablations")).to_be_visible()
    step("new from file inside a project: filed there, titled with the filename, TypeScript from the extension")

    # Move out (unfiled) and back in with the Project select
    entry_url = d.url
    d.get_by_label("Project").select_option(label="None")
    d.goto(f"{BASE}/")
    expect(d.get_by_role("list", name="Notes").get_by_role("link", name=re.compile("utils.ts"))).to_be_visible(timeout=10000)
    d.goto(project_url)
    expect(d.get_by_role("button", name="New entry")).to_be_visible(timeout=10000)
    d.goto(entry_url)
    d.get_by_label("Project").select_option(label="ViT ablations")
    d.goto(project_url)
    expect(d.get_by_role("list", name="Notes").get_by_role("link", name=re.compile("utils.ts"))).to_be_visible(timeout=10000)
    d.once("dialog", lambda dlg: dlg.accept("ViT runs"))
    d.get_by_role("button", name="Rename").click()
    expect(d.get_by_role("heading", name="ViT runs")).to_be_visible(timeout=10000)
    d.screenshot(path=f"{SHOTS}/d-00-project.png")
    d.goto(entry_url)
    step("moved unfiled and back via the Project select; project renamed")

    # Language behaviour: indent unit, comment toggle, completion
    expect(d.get_by_label("Language of code 1")).to_be_visible(timeout=10000)

    def new_block(lang):
        n = d.locator("select[aria-label^='Language of code']").count()
        d.get_by_role("button", name="Add code").click()
        expect(d.locator(".cm-content")).to_have_count(n + 1, timeout=10000)
        d.get_by_label(f"Language of code {n + 1}").select_option(lang)
        d.locator(".cm-content").nth(n).click()
        return n

    i = new_block("python")
    d.keyboard.type("def f(x):")
    d.keyboard.press("Enter")
    d.keyboard.type("return x")
    d.keyboard.press("Control+/")
    assert editor_text(d, i).split("\n")[1] == "    # return x", repr(editor_text(d, i))
    i = new_block("go")
    d.keyboard.type("func f() {")
    d.keyboard.press("Enter")
    d.keyboard.type("x")
    d.keyboard.press("Control+/")
    assert editor_text(d, i).split("\n")[1] == "\t// x", repr(editor_text(d, i))
    i = new_block("sql")
    d.keyboard.type("sel")
    expect(d.locator(".cm-tooltip-autocomplete").get_by_text("select", exact=True)).to_have_count(1, timeout=5000)
    d.wait_for_timeout(300)  # CodeMirror ignores Enter for ~75 ms after the list opens
    d.keyboard.press("Enter")
    d.keyboard.type(" 1")
    d.keyboard.press("Control+/")
    assert "-- select 1" in editor_text(d, i), repr(editor_text(d, i))
    wait_saved(d)
    d.screenshot(path=f"{SHOTS}/d-01-languages.png", full_page=True)
    step("language changes indent (4 spaces / tab), comment token (# // --) and completion")

    d.goto(f"{BASE}/settings")
    expect(d.get_by_text(EMAIL)).to_be_visible(timeout=10000)
    d.screenshot(path=f"{SHOTS}/d-02-settings.png")
    d.get_by_role("radio", name="Dark").click()
    d.goto(f"{BASE}/")
    expect(d.get_by_role("link", name="ViT runs")).to_be_visible(timeout=10000)
    d.screenshot(path=f"{SHOTS}/d-03-list-dark.png")
    d.goto(entry_url)
    expect(d.locator(".cm-content").first).to_be_visible(timeout=15000)
    d.screenshot(path=f"{SHOTS}/d-04-entry-dark.png", full_page=True)
    step("settings + dark mode")

    if not KEEP_ONE:
        d.once("dialog", lambda dlg: dlg.accept())
        d.get_by_role("button", name="Delete note").click()
        expect(d).not_to_have_url(entry_url, timeout=10000)
    ctx.close()


def run_phase(browser, errors):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, ignore_https_errors=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    sign_in(page)
    page.get_by_role("button", name="New", exact=True).click()
    expect(page).to_have_url(re.compile(r"/n/[0-9a-f-]+"), timeout=15000)
    page.get_by_label("Title").fill("Run checks")
    status = lambda: page.get_by_role("status", name="Run status")
    output = lambda: page.get_by_role("region", name="Output")

    def block(lang, code):
        n = page.locator("select[aria-label^='Language of code']").count()
        page.get_by_role("button", name="Add code").click()
        sel = page.get_by_label(f"Language of code {n + 1}")
        expect(sel).to_be_visible(timeout=10000)
        sel.select_option(lang)
        ed = page.locator(".cm-content").nth(n)
        expect(ed).to_be_visible(timeout=10000)
        ed.click()
        page.keyboard.insert_text(code)
        return n

    # Python: output, error mapped to a line
    block("python", "def f(x):\n    return 1 / x\n\nprint('hello', 6 * 7)\nf(0)\n")
    page.get_by_role("button", name="Run", exact=True).click()
    expect(status()).to_have_text(re.compile(r"Error on line 2"), timeout=90000)
    expect(output()).to_contain_text("hello 42")
    expect(output()).to_contain_text("ZeroDivisionError")
    expect(page.locator(".cm-errorLine")).to_have_text("    return 1 / x")
    page.screenshot(path=f"{SHOTS}/r-01-python-error.png", full_page=True)
    step("Python runs (Pyodide), output shown, error mapped to line 2 and highlighted")

    # Stop a runaway Python loop
    page.get_by_role("button", name="Clear").click()
    page.locator(".cm-content").first.click()
    page.keyboard.press("Control+a")
    page.keyboard.insert_text("while True:\n    pass\n")
    page.get_by_role("button", name="Run", exact=True).click()
    page.get_by_role("button", name="Stop").click(timeout=20000)
    expect(status()).to_have_text(re.compile("Stopped"), timeout=10000)
    step("Stop ends a runaway Python run")

    # Lint + autofix (Ruff)
    page.locator(".cm-content").first.click()
    page.keyboard.press("Control+a")
    page.keyboard.insert_text("import os\nimport sys\nprint(sys.version)\n")
    expect(page.locator(".cm-lintRange-warning").first).to_be_visible(timeout=60000)
    page.get_by_role("button", name="Autofix").click()
    expect(page.locator(".cm-content").first).not_to_contain_text("import os", timeout=10000)
    expect(page.locator(".cm-content").first).to_contain_text("import sys")
    step("Ruff lint underlines an unused import; Autofix removes it")

    # numpy through loadPackagesFromImports
    page.locator(".cm-content").first.click()
    page.keyboard.press("Control+a")
    page.keyboard.insert_text("import numpy as np\nprint(np.arange(4).sum())\n")
    page.get_by_role("button", name="Run", exact=True).click()
    expect(status()).to_have_text(re.compile(r"^\d+\.\d+ s$"), timeout=120000)
    expect(output()).to_contain_text("6")
    step("numpy loads on demand and runs")

    # JavaScript and TypeScript
    page.get_by_role("button", name="Clear").click()
    j = block("javascript", "const xs = [1, 2, 3]\nconsole.log(xs.map(x => x * 2))\nnull.foo\n")
    page.get_by_role("button", name="Run", exact=True).nth(1).click()
    expect(status()).to_have_text(re.compile(r"Error on line 3"), timeout=20000)
    expect(output()).to_contain_text("[2,4,6]")
    step("JavaScript runs in a worker; error mapped to line 3")
    page.get_by_role("button", name="Clear").click()
    page.locator(".cm-content").nth(j).click()
    page.keyboard.press("Control+a")
    page.keyboard.insert_text("let n = 0\nwhile (true) { n++ }\n")
    page.get_by_role("button", name="Run", exact=True).nth(1).click()
    page.get_by_role("button", name="Stop").click(timeout=10000)
    expect(status()).to_have_text(re.compile("Stopped"), timeout=10000)
    page.get_by_role("button", name="Clear").click()
    t = block("typescript", "interface P { lr: number }\nconst p: P = { lr: 0.001 }\nconsole.log(`lr=${p.lr}`)\n")
    page.get_by_role("button", name="Run", exact=True).nth(2).click()
    expect(output()).to_contain_text("lr=0.001", timeout=20000)
    page.locator(".cm-content").nth(t).click()
    page.keyboard.press("Control+End")
    page.keyboard.insert_text("const bad: number = ;\n")
    expect(page.locator(".cm-lintRange-error").first).to_be_visible(timeout=10000)
    wait_saved(page)
    page.screenshot(path=f"{SHOTS}/r-02-js-ts.png", full_page=True)
    step("TypeScript transpiles and runs; Stop ends a runaway JS loop; TS syntax error underlined")

    # PWA: manifest, service worker, offline reload
    entry = page.url
    m = page.request.get(f"{BASE}/manifest.webmanifest")
    assert m.ok and m.json()["display"] == "standalone", m.status
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.reload()
    page.wait_for_timeout(1500)
    ctx.set_offline(True)
    page.goto(f"{BASE}/offline-check-{int(time.time())}", wait_until="domcontentloaded")
    expect(page.get_by_text("You\u2019re offline")).to_be_visible(timeout=10000)
    page.goto(entry, wait_until="domcontentloaded")
    expect(page.get_by_role("link", name="All notes")).to_be_visible(timeout=10000)  # cached page shell
    page.screenshot(path=f"{SHOTS}/r-03-offline.png")
    ctx.set_offline(False)
    step("PWA: manifest, service worker, offline fallback and cached page")

    page.goto(entry)
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Delete note").click()
    expect(page).to_have_url(f"{BASE}/", timeout=10000)
    ctx.close()


def main():
    os.makedirs(SHOTS, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = launch(p)
        only = set(ONLY.split(",")) if ONLY else {"m", "d", "r"}
        if "m" in only:
            phone(browser, errors)
        if "d" in only:
            desktop(browser, errors)
        if "r" in only:
            run_phase(browser, errors)
        browser.close()
    if errors:
        print("Page errors:", *errors, sep="\n  ")
        sys.exit(1)
    print("E2E OK")


if __name__ == "__main__":
    main()
