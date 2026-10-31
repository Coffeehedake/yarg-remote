#!/usr/bin/env python
"""Put the App Store Connect USERS into the internal TestFlight group.

    C:\\dev\\adhd-nagger\\server\\.venv\\Scripts\\python.exe scripts\\asc-add-internal.py

Needs `op` enabled first:  . C:\\dev\\_environment\\enable-headless-op.ps1

Internal testers install immediately with no Beta App Review; external testers cannot install
anything until a build has passed review. So anyone who is already a user on the team belongs in
the internal group, and putting them in an external group instead is a slower path for no gain.

A betaTester record is per-email, not per-group, so an address that already exists (because it was
added to an external group) is ATTACHED to the internal group by id rather than created again -
POSTing the same email twice is an error, not an upsert.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time

import httpx
import jwt

VAULT = "Home-Lab"
ASC_ITEM = "nullpointer - App Store Connect API (manager)"
APP_ID = "6829091050"
BASE = "https://api.appstoreconnect.apple.com/v1"
INTERNAL_GROUP = "Internal"


def client() -> httpx.Client:
    out = subprocess.run(["op", "item", "get", ASC_ITEM, "--vault", VAULT, "--format", "json"],
                         capture_output=True, text=True, check=True).stdout
    f = {x.get("label"): x.get("value") for x in json.loads(out)["fields"]}
    now = int(time.time())
    token = jwt.encode({"iss": f["Issuer ID"].strip(), "iat": now, "exp": now + 600,
                        "aud": "appstoreconnect-v1"},
                       f["Private Key"].replace("\r\n", "\n").strip() + "\n",
                       algorithm="ES256", headers={"kid": f["Key ID"].strip(), "typ": "JWT"})
    return httpx.Client(timeout=30, headers={"Authorization": f"Bearer {token}"})


def show(label, r):
    ok = r.status_code in (200, 201, 204)
    print(f"  {label}: HTTP {r.status_code} {'OK' if ok else 'FAILED'}")
    if not ok:
        try:
            for e in r.json().get("errors", []):
                print(f"      {e.get('code')}: {e.get('title')} - {e.get('detail','')[:200]}")
        except Exception:
            print(f"      {r.text[:300]}")
    return ok


def main() -> int:
    c = client()

    users = c.get(f"{BASE}/users", params={"limit": 50})
    emails = [u["attributes"]["username"] for u in users.json()["data"]] if users.status_code == 200 else []
    print(f"team users: {emails}")

    g = c.get(f"{BASE}/apps/{APP_ID}/betaGroups", params={"limit": 20})
    gid = next((x["id"] for x in g.json()["data"]
                if x["attributes"]["name"] == INTERNAL_GROUP), None)
    if not gid:
        print(f"no '{INTERNAL_GROUP}' group"); return 2
    print(f"internal group id: {gid}")

    existing = c.get(f"{BASE}/betaTesters", params={"filter[apps]": APP_ID, "limit": 100})
    by_email = {t["attributes"]["email"].lower(): t["id"]
                for t in existing.json()["data"]} if existing.status_code == 200 else {}
    print(f"existing testers on the app: {list(by_email)}")

    for email in emails:
        key = email.lower()
        if key in by_email:
            # Already a tester somewhere - attach the existing record, do not re-create it.
            body = {"data": [{"type": "betaTesters", "id": by_email[key]}]}
            show(f"attach existing {email} -> {INTERNAL_GROUP}",
                 c.post(f"{BASE}/betaGroups/{gid}/relationships/betaTesters", json=body))
        else:
            body = {"data": {"type": "betaTesters",
                             "attributes": {"email": email},
                             "relationships": {"betaGroups":
                                               {"data": [{"type": "betaGroups", "id": gid}]}}}}
            show(f"create {email} in {INTERNAL_GROUP}", c.post(f"{BASE}/betaTesters", json=body))

    print("\n--- state afterwards ---")
    g = c.get(f"{BASE}/apps/{APP_ID}/betaGroups", params={"limit": 20})
    for x in g.json()["data"]:
        a = x["attributes"]
        t = c.get(f"{BASE}/betaGroups/{x['id']}/betaTesters", params={"limit": 50})
        print(f"  '{a.get('name')}' internal={a.get('isInternalGroup')}")
        if t.status_code == 200:
            for y in t.json()["data"]:
                ya = y["attributes"]
                print(f"      - {ya.get('email')}  state={ya.get('state')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
