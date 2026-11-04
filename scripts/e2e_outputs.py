#!/usr/bin/env python3
"""E2E: rich run outputs (figures, tables, interactive charts) on a phone.

    E2E_EMAIL=... E2E_PASSWORD=... BASE_URL=http://localhost:3000 python scripts/e2e_outputs.py

Throwaway account. Runs one Python block that makes a matplotlib figure, a pandas
table, a Plotly, an Altair and a Bokeh chart, plus a PIL image. Checks: every output
shows under the block in order, survives a reload (stored in Storage), opens on its
own page, the figure downloads as PNG / JPG / WebP / SVG / PDF, the table as CSV, the
Plotly chart is interactive (hover label) and downloads as PNG and SVG, the run as a
zip, and Clear removes it. Screenshots go to ./screenshots (dark and light).
"""
import io
import os
import re
import sys
import zipfile
import urllib.parse as up

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3000").rstrip("/")
EMAIL = os.environ["E2E_EMAIL"]
PASSWORD = os.environ["E2E_PASSWORD"]
SHOTS = os.environ.get("SHOTS_DIR", "screenshots")
CODE = """import matplotlib.pyplot as plt
import pandas as pd
import plotly.express as px
import altair as alt
from bokeh.plotting import figure, show
from PIL import Image

df = pd.DataFrame({"epoch": [1, 2, 3, 4], "loss": [0.9, 0.6, 0.5, 0.45]})
plt.plot(df.epoch, df.loss)
plt.title("Loss")
plt.show()
display(df)
px.line(df, x="epoch", y="loss", title="Plotly loss").show()
alt.Chart(df).mark_line().encode(x="epoch", y="loss").show()
p = figure(title="Bokeh loss")
p.line(df.epoch, df.loss)
show(p)
display(Image.new("RGB", (32, 16), (40, 120, 200)))
print("done")
"""
LABELS = ["Figure", "Table", "Plotly chart", "Vega-Lite chart", "Bokeh chart", "Image"]


def step(name):
    print(f"  ✓ {name}", flush=True)


def launch(p):
    kw = {"args": ["--no-sandbox"]}
    if os.environ.get("CHROMIUM"):
        kw["executable_path"] = os.environ["CHROMIUM"]
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        u = up.urlparse(proxy)
        kw["proxy"] = {"server": f"{u.scheme}://{u.hostname}:{u.port}", "username": up.unquote(u.username or ""), "password": up.unquote(u.password or ""), "bypass": "localhost,127.0.0.1"}
    return p.chromium.launch(**kw)


# E2E_CAPTURE_DOWNLOADS=1: read each saved blob in the page instead of through the
# browser's download manager (for headless shells where downloads don't land).
CAPTURE = os.environ.get("E2E_CAPTURE_DOWNLOADS") == "1"
CAPTURE_JS = """
window.__downloads = [];
const click = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  if (!this.download || !this.href.startsWith("blob:")) return click.call(this);
  const name = this.download;
  window.__downloads.push(fetch(this.href).then(r => r.arrayBuffer()).then(b => {
    let s = ""; const u = new Uint8Array(b);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return [name, btoa(s)];
  }));
};
"""


def download(page, action):
    if CAPTURE:
        import base64
        n = page.evaluate("window.__downloads.length")
        action()
        page.wait_for_function(f"window.__downloads.length > {n}", timeout=60_000)
        name, b64 = page.evaluate(f"window.__downloads[{n}]")
        return name, base64.b64decode(b64)
    with page.expect_download(timeout=60_000) as d:
        action()
    data = open(d.value.path(), "rb").read()
    return d.value.suggested_filename, data


def main():
    os.makedirs(SHOTS, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        b = launch(p)
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True)
        if CAPTURE:
            ctx.add_init_script(CAPTURE_JS)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{BASE}/login")
        page.get_by_label("Email").fill(EMAIL)
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        expect(page).not_to_have_url(re.compile(r"/login"), timeout=15000)
        step("signed in")

        page.get_by_role("button", name="New note").click()
        expect(page).to_have_url(re.compile(r"/n/[0-9a-f-]+"), timeout=15000)
        note_url = page.url
        page.get_by_label("Title").fill("Outputs e2e")
        page.get_by_role("button", name="Add code").click()
        editor = page.locator(".cm-content").first
        expect(editor).to_be_visible(timeout=15000)
        editor.click()
        page.keyboard.insert_text(CODE)
        page.get_by_label("Title").click()
        expect(page.get_by_role("status", name="Save status")).to_have_text("Saved", timeout=15000)

        with page.expect_response(
            lambda r: "/rest/v1/snippets" in r.url and r.request.method == "PATCH" and '"outputs"' in (r.request.post_data or ""),
            timeout=240_000,
        ) as resp:
            page.get_by_role("button", name="Run", exact=True).click()
        assert resp.value.ok, (resp.value.status, resp.value.text())
        expect(page.get_by_role("region", name="Output")).to_contain_text("done")
        step("ran: outputs uploaded and the run saved with them")

        section = page.get_by_role("region", name="Figures and tables")
        links = section.get_by_role("link")
        expect(links).to_have_count(len(LABELS), timeout=30_000)
        for i, label in enumerate(LABELS):
            expect(links.nth(i)).to_contain_text(label)
        expect(section.locator("img").first).to_be_visible()
        expect(section.locator("table")).to_contain_text("loss")
        expect(section.locator(".main-svg").first).to_be_visible(timeout=60_000)  # Plotly inline
        expect(section.locator(".vega-embed")).to_be_visible(timeout=60_000)
        page.screenshot(path=f"{SHOTS}/outputs-inline.png", full_page=True)
        step(f"inline, in order: {', '.join(LABELS)}")

        page.reload()
        expect(page.get_by_role("region", name="Figures and tables").get_by_role("link")).to_have_count(len(LABELS), timeout=30_000)
        img = page.get_by_role("region", name="Figures and tables").locator("img").first
        expect(img).to_be_visible(timeout=30_000)
        page.wait_for_function("img => img.complete && img.naturalWidth > 0", arg=img.element_handle(), timeout=30_000)
        step("outputs survive a reload (signed Storage URLs)")

        # Figure viewer: zoomable image + every format
        page.get_by_role("link", name=re.compile(r"^Open Figure 1")).click()
        expect(page).to_have_url(re.compile(r"/out/[0-9a-f-]+/0$"))
        expect(page.get_by_role("img", name="Loss")).to_be_visible(timeout=30_000)
        fmts = page.get_by_label("Download format").locator("option").all_inner_texts()
        assert fmts == ["PNG", "JPG", "WebP", "SVG", "PDF"], fmts
        sigs = {"PNG": b"\x89PNG", "JPG": b"\xff\xd8\xff", "WebP": b"RIFF", "SVG": b"<?xml", "PDF": b"%PDF"}
        for f in fmts:
            page.get_by_label("Download format").select_option(label=f)
            name, data = download(page, lambda: page.get_by_role("button", name="Download", exact=True).click())
            assert data.startswith(sigs[f]), (f, data[:8])
            assert name.endswith("-1." + {"JPG": "jpg", "WebP": "webp"}.get(f, f.lower())), name
        box = page.get_by_label("Pinch or scroll to zoom, drag to move, double-tap to reset")
        bb = box.bounding_box()
        page.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
        page.mouse.wheel(0, -400)
        t = page.get_by_role("img", name="Loss").evaluate("e => e.style.transform")
        assert "scale(" in t and "scale(1)" not in t, t
        page.screenshot(path=f"{SHOTS}/outputs-figure-viewer.png")
        step("figure page: zooms; downloads PNG, JPG, WebP, SVG, PDF (checked by file signature)")

        page.get_by_role("link", name="Next output").click()
        expect(page).to_have_url(re.compile(r"/1$"))
        assert page.get_by_label("Download format").locator("option").all_inner_texts() == ["CSV"]
        name, data = download(page, lambda: page.get_by_role("button", name="Download", exact=True).click())
        assert data.decode().splitlines()[0] == ",epoch,loss", data[:40]
        step("table page: CSV download")

        page.get_by_role("link", name="Next output").click()
        expect(page).to_have_url(re.compile(r"/2$"))
        plot = page.locator(".js-plotly-plot")
        expect(plot).to_be_visible(timeout=60_000)
        page.wait_for_timeout(1000)
        # tap a data point (epoch 2, loss 0.6): Plotly shows its value label
        x, y = page.evaluate("""() => {
            const gd = document.querySelector('.js-plotly-plot'), L = gd._fullLayout;
            const r = gd.querySelector('.nsewdrag').getBoundingClientRect();
            return [r.left + L.xaxis.l2p(2), r.top + L.yaxis.l2p(0.6)];
        }""")
        page.mouse.move(x, y)
        page.touchscreen.tap(x, y)
        expect(page.locator(".hoverlayer .hovertext").first).to_be_visible(timeout=5000)
        expect(page.locator(".hoverlayer .hovertext").first).to_contain_text("0.6")
        page.screenshot(path=f"{SHOTS}/outputs-plotly-viewer.png")
        assert page.get_by_label("Download format").locator("option").all_inner_texts() == ["PNG", "JPG", "WebP", "SVG", "PDF", "JSON"]
        for f, sig in (("PNG", b"\x89PNG"), ("JPG", b"\xff\xd8\xff"), ("SVG", b"<svg"), ("PDF", b"%PDF"), ("JSON", b"{")):
            page.get_by_label("Download format").select_option(label=f)
            _, data = download(page, lambda: page.get_by_role("button", name="Download", exact=True).click())
            assert data.lstrip()[: len(sig)] == sig, (f, data[:20])
        step("Plotly page: interactive (hover label), downloads PNG, JPG, SVG, PDF and the spec")

        page.get_by_role("link", name="Next output").click()
        expect(page.locator(".vega-embed")).to_be_visible(timeout=60_000)
        page.get_by_label("Download format").select_option(label="SVG")
        _, data = download(page, lambda: page.get_by_role("button", name="Download", exact=True).click())
        assert b"<svg" in data[:200], data[:80]
        page.get_by_label("Download format").select_option(label="PDF")
        _, data = download(page, lambda: page.get_by_role("button", name="Download", exact=True).click())
        assert data.startswith(b"%PDF"), data[:8]
        step("Vega-Lite page: drawn, SVG and PDF download")

        page.get_by_role("link", name="Next output").click()
        page.wait_for_timeout(4000)
        page.screenshot(path=f"{SHOTS}/outputs-bokeh-viewer.png")
        page.get_by_label("Download format").select_option(label="PNG")
        _, data = download(page, lambda: page.get_by_role("button", name="Download", exact=True).click())
        assert data.startswith(b"\x89PNG"), data[:8]
        page.get_by_label("Download format").select_option(label="PDF")
        _, data = download(page, lambda: page.get_by_role("button", name="Download", exact=True).click())
        assert data.startswith(b"%PDF"), data[:8]
        step("Bokeh page: drawn, PNG and PDF download")

        page.goto(note_url)
        name, data = download(page, lambda: page.get_by_role("button", name="Download the run as a zip").click())
        names = zipfile.ZipFile(io.BytesIO(data)).namelist()
        assert "stdout.txt" in names and "outputs/manifest.json" in names and "outputs/0.pdf" in names, names
        step(f"run zip: {len(names)} files")

        page.evaluate("localStorage.setItem('theme', 'light')")
        page.reload()
        expect(page.get_by_role("region", name="Figures and tables").locator(".main-svg").first).to_be_visible(timeout=60_000)
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{SHOTS}/outputs-inline-light.png", full_page=True)
        page.evaluate("localStorage.setItem('theme', 'dark')")
        page.reload()
        step("light mode screenshot")

        page.get_by_role("button", name="Clear").click()
        expect(page.get_by_role("region", name="Figures and tables")).to_have_count(0)
        page.wait_for_timeout(2000)
        page.reload()
        expect(page.get_by_role("region", name="Figures and tables")).to_have_count(0, timeout=15000)
        step("Clear removes the outputs for good")
        b.close()
    if errors:
        print("page errors:", *errors, sep="\n  ")
    print("e2e_outputs: all passed")


if __name__ == "__main__":
    sys.exit(main())
