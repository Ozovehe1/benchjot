#!/usr/bin/env python3
"""Checks that one user cannot read or write another user's rows (RLS).

    SUPABASE_URL=... SUPABASE_ANON_KEY=... \
    OWNER_EMAIL=... OWNER_PASSWORD=... INTRUDER_EMAIL=... INTRUDER_PASSWORD=... \
        python scripts/rls_check.py

The owner must already have at least one project, and an entry with a code snippet.
The intruder account is created if it doesn't exist.
"""
import os
import sys

import requests

URL = os.environ["SUPABASE_URL"].rstrip("/")
ANON = os.environ["SUPABASE_ANON_KEY"]
TABLES = ["projects", "entries", "snippets"]
failures = []


def check(cond, msg):
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond:
        failures.append(msg)


def token(email, password, create=False):
    if create:
        requests.post(f"{URL}/auth/v1/signup", json={"email": email, "password": password}, headers={"apikey": ANON}, timeout=20)
    r = requests.post(f"{URL}/auth/v1/token?grant_type=password", json={"email": email, "password": password}, headers={"apikey": ANON}, timeout=20)
    r.raise_for_status()
    return r.json()["access_token"]


def rest(method, path, tok=None, **kw):
    headers = {"apikey": ANON, "Authorization": f"Bearer {tok or ANON}", "Prefer": "return=representation"}
    return requests.request(method, f"{URL}/rest/v1/{path}", headers=headers, timeout=20, **kw)


owner = token(os.environ["OWNER_EMAIL"], os.environ["OWNER_PASSWORD"])
intruder = token(os.environ["INTRUDER_EMAIL"], os.environ["INTRUDER_PASSWORD"], create=True)

mine = {t: rest("GET", f"{t}?select=id", owner).json() for t in TABLES}
for t in TABLES:
    check(len(mine[t]) > 0, f"owner can read own {t} ({len(mine[t])})")
entry_id = mine["entries"][0]["id"]
snip_id = mine["snippets"][0]["id"]
proj_id = mine["projects"][0]["id"]

for t in TABLES:
    check(rest("GET", f"{t}?select=id", intruder).json() == [], f"intruder sees no {t}")
    anon_rows = rest("GET", f"{t}?select=id").json()
    check(not isinstance(anon_rows, list) or anon_rows == [], f"anonymous sees no {t}")

r = rest("PATCH", f"entries?id=eq.{entry_id}", intruder, json={"title": "pwned"})
check(r.ok and r.json() == [], "intruder can't update owner's entry")
r = rest("DELETE", f"snippets?id=eq.{snip_id}", intruder)
check(r.ok and r.json() == [], "intruder can't delete owner's snippet")
r = rest("DELETE", f"entries?id=eq.{entry_id}", intruder)
check(r.ok and r.json() == [], "intruder can't delete owner's entry")
r = rest("POST", "snippets", intruder, json={"entry_id": entry_id, "content": "x", "language": "python"})
check(not r.ok, f"intruder can't attach a snippet to owner's entry ({r.status_code})")
r = rest("PATCH", f"projects?id=eq.{proj_id}", intruder, json={"name": "pwned"})
check(r.ok and r.json() == [], "intruder can't rename owner's project")
r = rest("DELETE", f"projects?id=eq.{proj_id}", intruder)
check(r.ok and r.json() == [], "intruder can't delete owner's project")
own = rest("POST", "entries", intruder, json={"title": "mine"}).json()[0]["id"]
r = rest("PATCH", f"entries?id=eq.{own}", intruder, json={"project_id": proj_id})
check(not r.ok, f"intruder can't file a note into owner's project ({r.status_code})")
r = rest("POST", "rpc/search_entries", intruder, json={"terms": [], "p_project": proj_id})
check(r.ok and r.json() == [], "search within owner's project returns nothing")
owner_uid = rest("GET", f"entries?select=user_id&id=eq.{entry_id}", owner).json()[0]["user_id"]
r = rest("POST", "entries", intruder, json={"title": "spoof", "user_id": owner_uid})
check(not r.ok, f"intruder can't insert rows as the owner ({r.status_code})")
r = rest("POST", "rpc/search_entries", intruder, json={"terms": []})
check(r.ok and all(row["id"] != entry_id for row in r.json()), "search RPC returns nothing of the owner's")
r = rest("POST", "rpc/search_entries", None, json={"terms": []})
check(not r.ok or r.json() == [], f"anonymous can't call search ({r.status_code})")
still = rest("GET", f"entries?select=title&id=eq.{entry_id}", owner).json()
check(still and still[0]["title"] != "pwned", "owner's data unchanged")
pname = rest("GET", f"projects?select=name&id=eq.{proj_id}", owner).json()
check(pname and pname[0]["name"] != "pwned", "owner's project unchanged")
check(len(rest("GET", "snippets?select=id", owner).json()) == len(mine["snippets"]), "owner's snippets intact")

# Plan: readable only for yourself, never writable by a user (no self-upgrade to Pro).
prof = rest("GET", "profiles?select=user_id,plan", intruder).json()
check(len(prof) == 1 and prof[0]["plan"] == "free", "intruder sees only their own profile, on free")
intruder_uid = prof[0]["user_id"] if prof else None
anon_prof = rest("GET", "profiles?select=plan").json()
check(not isinstance(anon_prof, list) or anon_prof == [], "anonymous sees no profiles")
r = rest("PATCH", f"profiles?user_id=eq.{intruder_uid}", intruder, json={"plan": "pro"})
check(not r.ok or r.json() == [], f"intruder can't set own plan to pro via update ({r.status_code})")
r = rest("POST", "profiles", intruder, json={"user_id": intruder_uid, "plan": "pro"}, params={"on_conflict": "user_id"})
check(not r.ok, f"intruder can't upsert a pro profile ({r.status_code})")
r = requests.post(f"{URL}/rest/v1/profiles", headers={"apikey": ANON, "Authorization": f"Bearer {intruder}", "Prefer": "resolution=merge-duplicates,return=representation"}, json={"user_id": intruder_uid, "plan": "pro"}, timeout=20)
check(not r.ok, f"intruder can't merge-upsert a pro profile ({r.status_code})")
r = rest("DELETE", f"profiles?user_id=eq.{intruder_uid}", intruder)
check(not r.ok or r.json() == [], f"intruder can't delete own profile ({r.status_code})")
r = rest("PATCH", f"profiles?user_id=eq.{owner_uid}", intruder, json={"plan": "free"})
check(not r.ok or r.json() == [], f"intruder can't change the owner's plan ({r.status_code})")
after = rest("GET", "profiles?select=plan", intruder).json()
check(after and after[0]["plan"] == "free", "intruder's plan is still free")

print("RLS OK" if not failures else f"RLS FAILURES: {len(failures)}")
sys.exit(1 if failures else 0)
