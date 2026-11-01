#!/usr/bin/env python
"""Create TestFlight groups and attach testers for YARG Remote. WRITES to App Store Connect.

    C:\\dev\\adhd-nagger\\server\\.venv\\Scripts\\python.exe tools\\asc-testflight-setup.py

Needs `op` enabled first:  . C:\\dev\\_environment\\enable-headless-op.ps1

What it will and will not do:
  * creates an INTERNAL group and attaches the builds to it          -> yes
  * creates an EXTERNAL group and adds a tester by email             -> yes
  * submits a build for Beta App Review                              -> NO, never here

The last one is deliberate. External testers cannot install anything until a build passes Beta
App Review, and submitting is an outward-facing act with Apple that should be a decision, not a
side effect of a setup script. This prints what would be needed and stops.

Internal testers must already be App Store Connect users on the team; Apple will reject an email
that is not one. That is reported rather than worked around.
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
EXTERNAL_GROUP = "Friends"
EXTERNAL_TESTERS = [
    {"email": "justin.alan.burgess@gmail.com", "firstName": "Justin", "lastName": "Burgess"},
    {"email": "careya89@gmail.com", "firstName": "Jason", "lastName": "Carey-Schilling"},
]


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

    print("--- App Store Connect users on this team (who CAN be an internal tester) ---")
    r = c.get(f"{BASE}/users", params={"limit": 50})
    if r.status_code == 200:
        for u in r.json()["data"]:
            a = u["attributes"]
            print(f"  {a.get('username')}  roles={a.get('roles')}")
    else:
        show("GET /users", r)

    print("\n--- existing beta groups ---")
    r = c.get(f"{BASE}/apps/{APP_ID}/betaGroups", params={"limit": 20})
    groups = {g["attributes"]["name"]: g["id"] for g in r.json()["data"]} if r.status_code == 200 else {}
    print(f"  {groups if groups else 'none'}")

    print("\n--- builds to attach ---")
    r = c.get(f"{BASE}/builds", params={"filter[app]": APP_ID, "limit": 5, "sort": "-uploadedDate"})
    builds = [(b["id"], b["attributes"]["version"]) for b in r.json()["data"]] if r.status_code == 200 else []
    for bid, v in builds:
        print(f"  {v}  {bid}")
    if not builds:
        print("  none; stopping")
        return 2

    def ensure_group(name: str, internal: bool) -> str | None:
        if name in groups:
            print(f"  group '{name}' already exists ({groups[name]})")
            return groups[name]
        body = {"data": {"type": "betaGroups",
                         "attributes": {"name": name, "isInternalGroup": internal},
                         "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}}}}
        rr = c.post(f"{BASE}/betaGroups", json=body)
        if show(f"POST /betaGroups '{name}' (internal={internal})", rr):
            return rr.json()["data"]["id"]
        return None

    print(f"\n--- internal group '{INTERNAL_GROUP}' ---")
    gid = ensure_group(INTERNAL_GROUP, True)
    if gid:
        body = {"data": [{"type": "builds", "id": bid} for bid, _ in builds]}
        show("attach builds", c.post(f"{BASE}/betaGroups/{gid}/relationships/builds", json=body))

    print(f"\n--- external group '{EXTERNAL_GROUP}' + tester ---")
    xgid = ensure_group(EXTERNAL_GROUP, False)
    if xgid:
        body = {"data": [{"type": "builds", "id": bid} for bid, _ in builds]}
        show("attach builds", c.post(f"{BASE}/betaGroups/{xgid}/relationships/builds", json=body))
        for t in EXTERNAL_TESTERS:
            tb = {"data": {"type": "betaTesters",
                           "attributes": t,
                           "relationships": {"betaGroups": {"data": [{"type": "betaGroups", "id": xgid}]}}}}
            show(f"POST /betaTesters {t['email']}", c.post(f"{BASE}/betaTesters", json=tb))

    print("\n--- state afterwards ---")
    r = c.get(f"{BASE}/apps/{APP_ID}/betaGroups", params={"limit": 20})
    if r.status_code == 200:
        for g in r.json()["data"]:
            a = g["attributes"]
            t = c.get(f"{BASE}/betaGroups/{g['id']}/betaTesters", params={"limit": 50})
            n = len(t.json()["data"]) if t.status_code == 200 else "?"
            print(f"  '{a.get('name')}'  internal={a.get('isInternalGroup')}  testers={n}")
            if t.status_code == 200:
                for x in t.json()["data"]:
                    print(f"      - {x['attributes'].get('email')}  state={x['attributes'].get('state')}")

    print("\nNOT DONE HERE: external testers cannot install until a build passes Beta App Review.")
    print("That submission is POST /v1/betaAppReviewSubmissions and is left to a human decision.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
