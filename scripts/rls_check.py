#!/usr/bin/env python3
"""Checks that one user cannot read or write another user's rows (RLS).

    SUPABASE_URL=... SUPABASE_ANON_KEY=... \
    OWNER_EMAIL=... OWNER_PASSWORD=... INTRUDER_EMAIL=... INTRUDER_PASSWORD=... \
        python scripts/rls_check.py

The owner must already have at least one entry with a code snippet.
The intruder account is created if it doesn't exist.
"""
import os
import sys

import requests

URL = os.environ["SUPABASE_URL"].rstrip("/")
ANON = os.environ["SUPABASE_ANON_KEY"]
TABLES = ["entries", "snippets"]
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
owner_uid = rest("GET", f"entries?select=user_id&id=eq.{entry_id}", owner).json()[0]["user_id"]
r = rest("POST", "entries", intruder, json={"title": "spoof", "user_id": owner_uid})
check(not r.ok, f"intruder can't insert rows as the owner ({r.status_code})")
r = rest("POST", "rpc/search_entries", intruder, json={"terms": []})
check(r.ok and r.json() == [], "search RPC returns nothing of the owner's")
r = rest("POST", "rpc/search_entries", None, json={"terms": []})
check(not r.ok or r.json() == [], f"anonymous can't call search ({r.status_code})")
still = rest("GET", f"entries?select=title&id=eq.{entry_id}", owner).json()
check(still and still[0]["title"] != "pwned", "owner's data unchanged")
check(len(rest("GET", "snippets?select=id", owner).json()) == len(mine["snippets"]), "owner's snippets intact")

print("RLS OK" if not failures else f"RLS FAILURES: {len(failures)}")
sys.exit(1 if failures else 0)
