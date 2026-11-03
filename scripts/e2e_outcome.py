#!/usr/bin/env python3
"""E2E: a note's outcome (Successful / Failed / unmarked) against a deployed Benchjot.

    E2E_EMAIL=... E2E_PASSWORD=... BASE_URL=https://benchjot.vercel.app python scripts/e2e_outcome.py

Use a fresh account. Phone (390px). A failing run leaves the outcome unmarked
(only the user sets it); marking persists across reloads; the list shows the
dot; the outcome filter combines with search and with a project page.
Screenshots go to ./screenshots.
"""
import os
import re
import sys

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from e2e_smoke import BASE, SHOTS, launch, sign_in, step, wait_saved  # noqa: E402


def checked(page, group, name):
    return page.get_by_role("radiogroup", name=group).get_by_role("radio", name=name, exact=True)


def mark(page, name):
    with page.expect_response(lambda r: "/rest/v1/entries" in r.url and r.request.method == "PATCH" and "outcome" in (r.request.post_data or "")) as resp:
        checked(page, "Outcome", name).click()
    assert resp.value.ok, resp.value.text()
    expect(checked(page, "Outcome", name)).to_have_attribute("aria-checked", "true")


def new_note(page, title, code=None):
    page.goto(f"{BASE}/")
    page.get_by_role("button", name="New note").click()
    expect(page).to_have_url(re.compile(r"/n/[0-9a-f-]+"), timeout=15000)
    page.get_by_label("Title").fill(title)
    if code:
        page.get_by_role("button", name="Add code").click()
        page.get_by_label("Language of code 1").select_option("python")
        ed = page.locator(".cm-content").first
        expect(ed).to_be_visible(timeout=15000)
        ed.click()
        page.keyboard.insert_text(code)
        page.get_by_label("Title").click()
    wait_saved(page)
    expect(checked(page, "Outcome", "Unmarked")).to_have_attribute("aria-checked", "true")
    return page.url


def titles(page):
    page.wait_for_timeout(1200)  # let the filtered list settle
    return [t.strip() for t in page.get_by_role("list", name="Notes").get_by_role("link").all_inner_texts()]


def filter_to(page, name):
    page.get_by_role("radiogroup", name="Filter by outcome").get_by_role("radio", name=name, exact=True).click()


def has(rows, title):
    return any(title in r for r in rows)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = launch(p)
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, ignore_https_errors=True)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        sign_in(page)

        # A: a failing run must not mark the note; the user marks it Failed.
        a = new_note(page, "Outcome A", "print('a')\n1 / 0\n")
        page.get_by_role("button", name="Run", exact=True).click()
        expect(page.get_by_role("status", name="Run status")).to_have_text(re.compile("Error on line 2"), timeout=120000)
        page.wait_for_timeout(1500)
        page.reload()
        expect(checked(page, "Outcome", "Unmarked")).to_have_attribute("aria-checked", "true", timeout=20000)
        step("failing run leaves the outcome unmarked (after reload too)")
        mark(page, "Failed")
        page.reload()
        expect(checked(page, "Outcome", "Failed")).to_have_attribute("aria-checked", "true", timeout=20000)
        page.screenshot(path=f"{SHOTS}/o-1-failed.png", full_page=True)
        step("marked Failed, persists after reload")

        # B: Successful, then filed in a project. C: left unmarked.
        b = new_note(page, "Outcome B")
        mark(page, "Successful")
        page.reload()
        expect(checked(page, "Outcome", "Successful")).to_have_attribute("aria-checked", "true", timeout=20000)
        new_note(page, "Outcome C")
        # Unmark/remark round trip on A: back to unmarked and to Failed again.
        page.goto(a)
        mark(page, "Unmarked")
        page.reload()
        expect(checked(page, "Outcome", "Unmarked")).to_have_attribute("aria-checked", "true", timeout=20000)
        mark(page, "Failed")
        step("Successful persists; unmarking and re-marking persist")

        # List: dots and the filter, alone and with search.
        page.goto(f"{BASE}/")
        notes = page.get_by_role("list", name="Notes")
        expect(notes.get_by_role("link", name=re.compile("Outcome A")).get_by_role("img", name="Failed")).to_be_visible(timeout=15000)
        expect(notes.get_by_role("link", name=re.compile("Outcome B")).get_by_role("img", name="Successful")).to_be_visible()
        expect(notes.get_by_role("link", name=re.compile("Outcome C")).get_by_role("img")).to_have_count(0)
        page.screenshot(path=f"{SHOTS}/o-2-list.png", full_page=True)
        step("list shows a dot for Failed and Successful, none for unmarked")

        filter_to(page, "Failed")
        rows = titles(page)
        assert has(rows, "Outcome A") and not has(rows, "Outcome B") and not has(rows, "Outcome C"), rows
        filter_to(page, "Successful")
        rows = titles(page)
        assert has(rows, "Outcome B") and not has(rows, "Outcome A") and not has(rows, "Outcome C"), rows
        filter_to(page, "Unmarked")
        rows = titles(page)
        assert has(rows, "Outcome C") and not has(rows, "Outcome A") and not has(rows, "Outcome B"), rows
        page.get_by_label("Search").fill("Outcome B")
        page.wait_for_timeout(500)
        expect(page.get_by_text("Nothing matches.")).to_be_visible(timeout=10000)
        filter_to(page, "Successful")
        rows = titles(page)
        assert rows and all("Outcome B" in r for r in rows), rows
        page.get_by_label("Search").fill("failed")
        filter_to(page, "All")
        rows = titles(page)
        assert has(rows, "Outcome A"), rows  # the outcome's word is searchable
        page.screenshot(path=f"{SHOTS}/o-3-filter.png", full_page=True)
        step("filter All/Successful/Failed/Unmarked works and combines with search; 'failed' finds Failed notes")

        # Project page: file B in a project; the filter narrows within it.
        page.get_by_label("Search").fill("")
        page.once("dialog", lambda d: d.accept("Outcome project"))
        page.get_by_role("button", name="New project").click()
        expect(page.get_by_role("list", name="Projects").get_by_role("link", name=re.compile("Outcome project"))).to_be_visible(timeout=15000)
        page.goto(b)
        with page.expect_response(lambda r: "/rest/v1/entries" in r.url and r.request.method == "PATCH"):
            page.locator("#project").select_option(label="Outcome project")
        page.get_by_role("link", name="Outcome project").first.click()
        expect(page).to_have_url(re.compile(r"/p/[0-9a-f-]+"), timeout=15000)
        filter_to(page, "Successful")
        rows = titles(page)
        assert rows == [r for r in rows if "Outcome B" in r] and rows, rows
        filter_to(page, "Failed")
        expect(page.get_by_text("Nothing matches.")).to_be_visible(timeout=10000)
        page.screenshot(path=f"{SHOTS}/o-4-project.png", full_page=True)
        step("filter combines with the project page")
        browser.close()
    assert not errors, errors
    print("outcome E2E passed")


if __name__ == "__main__":
    main()
