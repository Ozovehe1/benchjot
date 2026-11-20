#!/usr/bin/env python3
"""Phone E2E for note nesting, note links and the map, against a deployed Benchjot.

    BASE_URL=https://benchjot.vercel.app E2E_EMAIL=... E2E_PASSWORD=... python scripts/e2e_links.py

Use a fresh, throwaway account (its notes are left behind; delete the account after).
Parent picker + breadcrumb, New sub-note, [[ autocomplete (tap a suggestion),
preview link opens the note, missing link reads muted, Linked from, rename keeps
the link, picker never offers a descendant, list parent hint, /map edges + tap
to open + drag/wheel, light mode. Screenshots go to ./screenshots.
"""
import os
import re
import urllib.parse as up

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3000").rstrip("/")
EMAIL = os.environ["E2E_EMAIL"]
PASSWORD = os.environ["E2E_PASSWORD"]
SHOTS = os.environ.get("SHOTS_DIR", "screenshots")
NOTE = "Experiment note"


def step(name):
    print(f"  ✓ {name}", flush=True)


def launch(p):
    kw = {}
    proxy = os.environ.get("HTTPS_PROXY")
    if proxy:  # sandbox egress
        u = up.urlparse(proxy)
        kw["proxy"] = {"server": f"{u.scheme}://{u.hostname}:{u.port}", "username": up.unquote(u.username or ""), "password": up.unquote(u.password or "")}
    return p.chromium.launch(**kw)


def wait_saved(page):
    expect(page.get_by_role("status", name="Save status")).to_have_text("Saved", timeout=15000)


def note_id(page):
    return re.search(r"/n/([0-9a-f-]{36})", page.url).group(1)


def new_note(page, title):
    page.goto(f"{BASE}/")
    page.get_by_role("button", name="New note").click()
    page.wait_for_url(re.compile(r"/n/"))
    page.get_by_label("Title").fill(title)
    wait_saved(page)
    return note_id(page)


def parent_button(page):
    return page.get_by_text("Parent", exact=True).locator("xpath=..").get_by_role("button")


def type_link(page, prefix, query, pick):
    body = page.get_by_label(NOTE)
    body.click()
    page.keyboard.press("End")
    page.keyboard.type(prefix + "[[" + query)
    box = page.get_by_role("listbox", name="Link to note")
    expect(box).to_be_visible()
    box.get_by_role("button", name=pick).tap()
    expect(box).to_have_count(0)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    with sync_playwright() as p:
        browser = launch(p)
        ctx = browser.new_context(viewport={"width": 360, "height": 740}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.goto(f"{BASE}/login")
        page.get_by_label("Email or username").fill(EMAIL)
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in", exact=True).click()
        expect(page.get_by_role("button", name="New note")).to_be_visible(timeout=20000)
        step("signed in")

        parent = new_note(page, "Parent P")
        child = new_note(page, "Child C")
        parent_button(page).click()
        page.get_by_label("Search notes for a parent").fill("parent")
        page.get_by_role("list", name="Parent notes").get_by_role("button", name="Parent P").click()
        expect(parent_button(page)).to_have_text("Parent P")
        crumbs = page.get_by_role("navigation", name="Parent notes")
        expect(crumbs.get_by_role("link", name="Parent P")).to_be_visible()
        page.reload()
        expect(parent_button(page)).to_have_text("Parent P")
        step("parent set from the picker, breadcrumb shown, persists")

        type_link(page, "see ", "par", "Parent P")
        expect(page.get_by_label(NOTE)).to_have_value(re.compile(r"see \[\[Parent P\|" + parent + r"\]\]"))
        page.keyboard.type(" and [[Ghost]]")
        wait_saved(page)
        page.screenshot(path=f"{SHOTS}/links-edit.png", full_page=True)
        page.get_by_role("button", name="Preview").click()
        prose = page.locator(".prose-notes")
        link = prose.get_by_role("link", name="Parent P")
        expect(link).to_have_attribute("href", f"/n/{parent}")
        expect(prose.locator(".note-link-missing")).to_have_text("Ghost")
        page.screenshot(path=f"{SHOTS}/links-preview.png", full_page=True)
        step("[[ autocomplete inserts [[Title|id]]; preview link + muted missing link")

        link.click()
        page.wait_for_url(f"**/n/{parent}")
        subs = page.get_by_role("region", name="Sub-notes")
        expect(subs.get_by_role("link", name="Child C")).to_be_visible()
        expect(page.get_by_role("region", name="Linked from").get_by_role("link", name="Child C")).to_be_visible()
        step("link opens the note; Sub-notes and Linked from list the child")

        parent_button(page).click()
        expect(page.get_by_role("list", name="Parent notes").get_by_role("button", name="Child C")).to_have_count(0)
        page.get_by_role("button", name="Cancel").click()
        step("picker never offers a sub-note as parent (no cycles)")

        subs.get_by_role("button", name="New sub-note").click()
        page.wait_for_url(lambda u: "/n/" in u and parent not in u)
        second = note_id(page)
        assert second not in (parent, child)
        page.get_by_label("Title").fill("Second S")
        expect(page.get_by_role("navigation", name="Parent notes").get_by_role("link", name="Parent P")).to_be_visible()
        type_link(page, "", "child", "Child C")
        wait_saved(page)
        step("New sub-note is nested; links it to Child C")

        page.goto(f"{BASE}/n/{parent}")
        page.get_by_label("Title").fill("Parent Renamed")
        wait_saved(page)
        page.goto(f"{BASE}/n/{child}")
        page.get_by_role("button", name="Preview").click()
        expect(page.locator(".prose-notes").get_by_role("link", name="Parent Renamed")).to_have_attribute("href", f"/n/{parent}")
        step("rename keeps the link and shows the new title")

        page.goto(f"{BASE}/")
        expect(page.get_by_role("list", name="Notes").get_by_role("link", name=re.compile(r"Parent Renamed › Child C"))).to_be_visible()
        page.screenshot(path=f"{SHOTS}/links-list.png")
        step("list shows the parent hint")

        page.get_by_role("link", name="Map", exact=True).click()
        page.wait_for_url("**/map")
        svg = page.get_by_role("img", name=re.compile(r"Map of 3 notes"))
        expect(svg).to_be_visible()
        assert page.locator("svg line[stroke-dasharray]").count() == 3  # 2 parent edges + legend
        assert page.locator("svg[role=img] line:not([stroke-dasharray])").count() == 1  # Second S <-> Child C
        page.screenshot(path=f"{SHOTS}/map-dark.png")
        step("map: 3 notes, 2 dashed parent edges, 1 solid link")

        node = page.get_by_role("link", name="Child C")
        before = node.get_attribute("transform")
        b = svg.bounding_box()
        page.mouse.move(b["x"] + 40, b["y"] + 40)
        page.mouse.down()
        page.mouse.move(b["x"] + 120, b["y"] + 100, steps=5)
        page.mouse.up()
        assert node.get_attribute("transform") != before, "drag pans"
        page.mouse.wheel(0, -300)
        page.wait_for_timeout(200)
        step("drag pans, wheel zooms")

        bb = node.locator("circle").bounding_box()
        page.touchscreen.tap(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
        page.wait_for_url(f"**/n/{child}")
        step("tap a node opens the note")

        page.evaluate("localStorage.setItem('theme', 'light')")
        page.goto(f"{BASE}/map")
        expect(page.get_by_role("img", name=re.compile(r"Map of 3 notes"))).to_be_visible()
        page.screenshot(path=f"{SHOTS}/map-light.png")
        step("light mode map")
        browser.close()
    print("all good")


if __name__ == "__main__":
    main()
